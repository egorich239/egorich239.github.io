// book.js -- the book: the machine's input shown verbatim, virtualized,
// with its table of contents. The text is split into lines once, a NUL
// byte becoming a row of its own (the seam between two sections); each
// line wraps into the rows its length needs at the current column
// count, and only the lines around the scroll position are in the DOM,
// over a spacer of the full height. The contents are the stream's
// sections and the archive's files, the latter also as a tree of
// directories in the book's own order. Everything but mount is pure
// over the line array, so node can exercise it.

"use strict";

const Book = (() => {
  const OVERSCAN = 100;
  const NUL = "\0";
  const MARKER = /^\\ FILE: (.+)$/;
  const HEADER = /^(\/\S*) (\d+)$/;

  // A tab moves to the next multiple of eight, as the page renders it.
  function expandTabs(line) {
    if (line.indexOf("\t") < 0) return line;
    let out = "";
    for (const ch of line) {
      if (ch === "\t") out += " ".repeat(8 - out.length % 8);
      else out += ch;
    }
    return out;
  }

  // The lines of the text, every NUL byte lifted out as a line of its own.
  function splitLines(text) {
    const out = [];
    for (const line of text.split("\n")) {
      if (line.indexOf(NUL) < 0) { out.push(expandTabs(line)); continue; }
      line.split(NUL).forEach((piece, i) => {
        if (i > 0) out.push(NUL);
        if (piece !== "") out.push(expandTabs(piece));
      });
    }
    return out;
  }

  // rows[i] is the first display row of line i and rows[n] the total:
  // a line takes ceil(length / cols) rows, at least one.
  function rowOffsets(lines, cols) {
    const rows = new Uint32Array(lines.length + 1);
    let total = 0;
    for (let i = 0; i < lines.length; i++) {
      rows[i] = total;
      total += Math.max(1, Math.ceil(lines[i].length / cols));
    }
    rows[lines.length] = total;
    return rows;
  }

  // The index of the last element not above the value in a sorted array,
  // or -1 when the value is below the first.
  function lastAtMost(sorted, value) {
    let low = -1, high = sorted.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (sorted[mid] <= value) low = mid;
      else high = mid - 1;
    }
    return low;
  }

  // The line holding a display row, clamped to the lines there are.
  function lineAtRow(rows, row) {
    return Math.min(Math.max(0, lastAtMost(rows, row)), rows.length - 2);
  }

  // The line at the top of the viewport: the row the larger part of
  // which is there, so a whole-pixel scroll position that falls a
  // fraction short of a row's boundary still names that row.
  function topLine(rows, scrollTop, rowHeight) {
    return lineAtRow(rows, Math.round(scrollTop / rowHeight));
  }

  // The lines to render for a scroll position: [first, last) and the
  // pixel offset of the first within the book.
  function windowOf(rows, scrollTop, viewHeight, rowHeight) {
    const count = rows.length - 1;
    if (count <= 0) return {first: 0, last: 0, top: 0};
    const firstRow = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN);
    const lastRow = Math.ceil((scrollTop + viewHeight) / rowHeight) + OVERSCAN;
    const first = lineAtRow(rows, firstRow);
    const last = Math.min(count, lineAtRow(rows, lastRow) + 1);
    return {first, last, top: rows[first] * rowHeight};
  }

  // The entries of the book, {name, line} each in order: sections are the
  // NUL-delimited ones, named by the catz marker on their first line or
  // numbered; files are the archive's, by tower path from its headers, a
  // section of headers being the archive.
  function contents(lines) {
    const sections = [], files = [];
    let number = 0;
    function section(from, to) {
      if (from >= to) return;
      number++;
      if (HEADER.test(lines[from])) return archive(from, to);
      const marker = MARKER.exec(lines[from]);
      sections.push({name: marker ? marker[1] : "section " + number, line: from});
    }
    function archive(from, to) {
      for (let i = from; i < to;) {
        const header = HEADER.exec(lines[i]);
        if (!header) return;
        files.push({name: header[1], line: i});
        i += Number(header[2]) + 2;
      }
    }
    let start = 0;
    for (let i = 0; i < lines.length; i++) {
      if (lines[i] === NUL) { section(start, i); start = i + 1; }
    }
    section(start, lines.length);
    return {sections, files};
  }

  // The files as a tree in their own order: a directory node {name, nodes}
  // stays open while the following paths share its prefix and is opened
  // anew when a later path returns to it; a file node is its entry with
  // the path's last segment as name.
  function tree(files) {
    const root = {name: "", nodes: []};
    let open = [];
    for (const file of files) {
      const segments = file.name.split("/").filter((s) => s !== "");
      const dirs = segments.slice(0, -1);
      let shared = 0;
      while (shared < open.length && shared < dirs.length &&
             open[shared].name === dirs[shared]) shared++;
      open = open.slice(0, shared);
      for (const dir of dirs.slice(shared)) {
        const node = {name: dir, nodes: []};
        (open.length ? open[open.length - 1] : root).nodes.push(node);
        open.push(node);
      }
      (open.length ? open[open.length - 1] : root).nodes.push(
          {name: segments[segments.length - 1], path: file.name, line: file.line});
    }
    return root.nodes;
  }

  // The size of one character cell of the element's font.
  function measureCell(element) {
    const probe = document.createElement("pre");
    probe.className = "probe";
    probe.textContent = "x".repeat(100);
    element.appendChild(probe);
    const rect = probe.getBoundingClientRect();
    element.removeChild(probe);
    return {width: rect.width / 100, height: rect.height};
  }

  // Shows the lines in the element and keeps the window in step with the
  // page's scroll position and width; onTop hears the line at the top of
  // the viewport (-1 above the book). Returns {scrollToLine}.
  function mount(element, lines, onTop) {
    const spacer = document.createElement("div");
    const window_ = document.createElement("pre");
    spacer.className = "spacer";
    window_.className = "window";
    element.appendChild(spacer);
    element.appendChild(window_);

    let cell, cols, rows, shown = {first: -1, last: -1};

    // The window is as wide as the columns it wraps at, plus half a pixel
    // so a line of exactly that many characters stays on one row.
    function layout() {
      const style = getComputedStyle(element);
      const inner = element.clientWidth - parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight);
      cell = measureCell(element);
      cols = Math.max(1, Math.floor(inner / cell.width));
      rows = rowOffsets(lines, cols);
      spacer.style.height = rows[lines.length] * cell.height + "px";
      window_.style.left = style.paddingLeft;
      window_.style.width = cols * cell.width + 0.5 + "px";
      window_.style.setProperty("--row", cell.height + "px");
      shown = {first: -1, last: -1};
      render();
    }

    // Every line is a div of at least one row; a NUL line is the seam rule.
    function fill(first, last) {
      const fragment = document.createDocumentFragment();
      for (let i = first; i < last; i++) {
        const div = document.createElement("div");
        if (lines[i] === NUL) div.className = "nul";
        else div.textContent = lines[i];
        fragment.appendChild(div);
      }
      window_.textContent = "";
      window_.appendChild(fragment);
    }

    function render() {
      const scrollTop = -element.getBoundingClientRect().top;
      onTop(scrollTop < 0 ? -1 : topLine(rows, scrollTop, cell.height));
      const next = windowOf(rows, scrollTop, window.innerHeight, cell.height);
      if (next.first === shown.first && next.last === shown.last) return;
      shown = next;
      window_.style.top = next.top + "px";
      fill(next.first, next.last);
    }

    function scrollToLine(line) {
      const top = element.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, top + rows[line] * cell.height);
    }

    let pending = false;
    function onScroll() {
      if (pending) return;
      pending = true;
      requestAnimationFrame(() => { pending = false; render(); });
    }
    window.addEventListener("scroll", onScroll, {passive: true});
    new ResizeObserver(layout).observe(element);
    layout();
    return {scrollToLine};
  }

  return {NUL, OVERSCAN, expandTabs, splitLines, rowOffsets, lastAtMost,
          lineAtRow, topLine, windowOf, contents, tree, mount};
})();

if (typeof module !== "undefined") module.exports = Book;
