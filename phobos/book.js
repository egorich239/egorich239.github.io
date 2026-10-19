// book.js -- the book: the machine's input shown verbatim, virtualized.
// The text is split into lines once, a NUL byte becoming a row of its own
// (the seam between two sections); each line wraps into the rows its
// length needs at the current column count, and only the lines around
// the scroll position are in the DOM, over a spacer of the full height.
// Everything but mount is pure, so node can exercise it.

"use strict";

const Book = (() => {
  const OVERSCAN = 100;
  const NUL = "\0";

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

  // Bytes, a Uint8Array, as `hd` shows them: the offset, sixteen bytes in
  // hex in two groups of eight, and the same bytes as text, a dot for any
  // that is not printable ASCII. Rows join with newlines, none after the
  // last.
  function hexdump(bytes) {
    const rows = [];
    for (let at = 0; at < bytes.length; at += 16) {
      const row = bytes.subarray(at, at + 16);
      let hex = "", text = "";
      for (let i = 0; i < 16; i++) {
        hex += i < row.length ? row[i].toString(16).padStart(2, "0") + " " : "   ";
        if (i === 7) hex += " ";
      }
      for (const b of row) text += b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : ".";
      rows.push(at.toString(16).padStart(8, "0") + "  " + hex + " |" + text + "|");
    }
    return rows.join("\n");
  }

  // The title page of a text: its first non-empty line is the title, the
  // second the subtitle, and the rest is everything after the subtitle's
  // line.
  function titlePage(text) {
    const found = [];
    let at = 0;
    while (found.length < 2 && at < text.length) {
      let end = text.indexOf("\n", at);
      if (end < 0) end = text.length;
      const line = text.slice(at, end);
      if (line.trim() !== "") found.push(line);
      at = end + 1;
    }
    return {title: found[0] || "", subtitle: found[1] || "", rest: text.slice(at)};
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
  // page's scroll position and width.
  function mount(element, lines) {
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
      const next = windowOf(rows, scrollTop, window.innerHeight, cell.height);
      if (next.first === shown.first && next.last === shown.last) return;
      shown = next;
      window_.style.top = next.top + "px";
      fill(next.first, next.last);
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
  }

  return {NUL, OVERSCAN, hexdump, titlePage, expandTabs, splitLines, rowOffsets, lastAtMost,
          lineAtRow, windowOf, mount};
})();

if (typeof module !== "undefined") module.exports = Book;
