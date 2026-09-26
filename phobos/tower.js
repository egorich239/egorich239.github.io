// tower.js -- the page: the book (stage0's source under its banner, then
// the image) and the Doom box, a canvas fixed in the corner that the
// widgets grow to the viewport or fold to a tab. The worker runs the
// tower; its frames are painted here, its text goes nowhere. Keys reach
// Doom through the shared key ring whenever the box is not minimized,
// mapped to Doom's codes as doom/host/doom.cc maps SDL's.

"use strict";

(() => {
  const DOOM_KEYS = {
    Enter: 13, NumpadEnter: 13, Escape: 27, Tab: 9, Backspace: 0x7f,
    ArrowLeft: 0xac, ArrowRight: 0xae, ArrowUp: 0xad, ArrowDown: 0xaf,
    ControlLeft: 0xa3, ControlRight: 0xa3, Space: 0xa2,
    ShiftLeft: 0x80 + 0x36, ShiftRight: 0x80 + 0x36,
    AltLeft: 0x80 + 0x38, AltRight: 0x80 + 0x38,
    F1: 0x80 + 0x3b, F2: 0x80 + 0x3c, F3: 0x80 + 0x3d, F4: 0x80 + 0x3e,
    F5: 0x80 + 0x3f, F6: 0x80 + 0x40, F7: 0x80 + 0x41, F8: 0x80 + 0x42,
    F9: 0x80 + 0x43, F10: 0x80 + 0x44, F11: 0x80 + 0x57, F12: 0x80 + 0x58,
    Equal: 0x3d, NumpadAdd: 0x3d, Minus: 0x2d, NumpadSubtract: 0x2d,
    Pause: 0xff, CapsLock: 0x80 + 0x3a, NumLock: 0x80 + 0x45,
    ScrollLock: 0x80 + 0x46, PrintScreen: 0x80 + 0x59,
    Home: 0x80 + 0x47, End: 0x80 + 0x4f, PageUp: 0x80 + 0x49,
    PageDown: 0x80 + 0x51, Insert: 0x80 + 0x52, Delete: 0x80 + 0x53,
  };

  // Doom's code for a key event, or 0: the named keys above, else a
  // printable character lowercased, as doom.cc reads SDL keycodes.
  function doomKeyOf(event) {
    if (event.code in DOOM_KEYS) return DOOM_KEYS[event.code];
    if (event.key.length === 1) {
      const code = event.key.toLowerCase().charCodeAt(0);
      if (code > 32 && code < 127) return code;
    }
    return 0;
  }

  const base = new URL(".", location.href).href;
  const banner = document.getElementById("banner");
  const stage0 = document.getElementById("stage0");
  const book = document.getElementById("book");
  const box = document.getElementById("doom");
  const canvas = document.getElementById("screen");
  const context = canvas.getContext("2d");
  const note = document.getElementById("note");

  // The image is bytes; latin1 keeps every byte one character.
  async function fetchText(path, encoding) {
    const bytes = await TowerHost.fetchBytes(base + "build/" + path);
    return new TextDecoder(encoding || "utf-8").decode(bytes);
  }

  // Cross-origin isolation on a host that sends no headers: coi.js is
  // the service worker that adds them; the first load registers it and
  // reloads once so the document itself comes through it. The flag
  // keeps a host where that does not help from reloading forever.
  async function isolate() {
    if (!("serviceWorker" in navigator)) return;
    await navigator.serviceWorker.register("coi.js");
    await navigator.serviceWorker.ready;
    if (sessionStorage.getItem("coi-reloaded")) return;
    sessionStorage.setItem("coi-reloaded", "1");
    location.reload();
  }

  // The contents bar: stage0's source and the stream's sections under
  // "bfg", the archive's files as a foldable tree under "filesystem",
  // every entry a link to its first line, indented by depth. Returns the
  // highlighter of the entry at the top of the viewport, given the book's
  // top line (-1 above the book); a folded directory stands in for what
  // it hides.
  function showContents(contents, view) {
    const entries = [], links = [];
    function link(parent, name, title, depth, go) {
      const anchor = document.createElement("a");
      const label = document.createElement("span");
      anchor.href = "#";
      anchor.title = title;
      anchor.style.paddingLeft = 10 + 12 * depth + "px";
      label.textContent = name;
      anchor.appendChild(label);
      anchor.onclick = (event) => { event.preventDefault(); go(); };
      parent.appendChild(anchor);
      return anchor;
    }
    function entry(parent, name, title, depth, item) {
      entries.push(item);
      links.push(link(parent, name, title, depth, () => view.scrollToLine(item.line)));
    }
    function grow(parent, nodes, depth) {
      for (const node of nodes) {
        if (!node.nodes) { entry(parent, node.name, node.path, depth, node); continue; }
        const dir = document.createElement("div");
        const name = document.createElement("div");
        const kids = document.createElement("div");
        dir.className = "dir";
        name.className = "name";
        kids.className = "kids";
        name.style.paddingLeft = 10 + 12 * depth + "px";
        name.textContent = node.name;
        name.onclick = () => { dir.classList.toggle("folded"); highlight(shown); };
        dir.appendChild(name);
        dir.appendChild(kids);
        parent.appendChild(dir);
        grow(kids, node.nodes, depth + 1);
      }
    }
    const bfg = document.getElementById("bfg");
    links.push(link(bfg, "stage0.asm", "stage0.asm", 0, () => stage0.scrollIntoView()));
    for (const section of contents.sections) entry(bfg, section.name, section.name, 0, section);
    grow(document.getElementById("fs"), Book.tree(contents.files), 0);

    const starts = entries.map((item) => item.line);
    let current = null, shown = -1;
    function highlight(line) {
      shown = line;
      let next = links[line < 0 ? 0 : Book.lastAtMost(starts, line) + 1];
      for (let node = next.parentElement; node; node = node.parentElement) {
        if (node.classList.contains("folded")) next = node.firstChild;
      }
      if (next === current) return;
      if (current) current.classList.remove("current");
      current = next;
      current.classList.add("current");
      current.scrollIntoView({block: "nearest"});
    }
    return highlight;
  }

  // The bar's width: dragged at its right edge within its bounds, kept in
  // localStorage, and followed by the book column through --bar.
  function resizableBar() {
    const handle = document.getElementById("handle");
    let width = 260;
    function setWidth(wanted) {
      width = Math.max(120, Math.min(window.innerWidth / 2, wanted));
      document.documentElement.style.setProperty("--bar", width + "px");
    }
    try { setWidth(Number(localStorage.getItem("bar-width")) || width); } catch (e) {}
    handle.onpointerdown = (event) => {
      handle.setPointerCapture(event.pointerId);
      document.body.classList.add("dragging");
      handle.onpointermove = (move) => setWidth(move.clientX);
      handle.onpointerup = () => {
        handle.onpointermove = null;
        document.body.classList.remove("dragging");
        try { localStorage.setItem("bar-width", String(width)); } catch (e) {}
      };
    };
  }

  // The book, in reading order: the banner, stage0's source, the image.
  async function showBook() {
    const [size, source, image] = await Promise.all([
      fetchText("stage0.size"), fetchText("stage0.asm"),
      fetchText("image.bin", "latin1"),
    ]);
    banner.textContent = "This is the source of the " + size.trim() +
        "-byte blob that boots everything.";
    stage0.textContent = source;
    const lines = Book.splitLines(image);
    let highlight = () => {};
    const view = Book.mount(book, lines, (line) => highlight(line));
    highlight = showContents(Book.contents(lines), view);
    highlight(-1);
  }
  resizableBar();

  // The box's state: corner, full or min; the widgets move between them.
  let state = "corner";
  function setState(next) {
    state = next;
    box.className = next;
    document.getElementById("full").innerHTML =
        next === "full" ? "&#x2199;" : "&#x26F6;";
  }
  document.getElementById("min").onclick = () => setState("min");
  document.getElementById("full").onclick =
      () => setState(state === "full" ? "corner" : "full");
  document.getElementById("tab").onclick = () => setState("corner");
  document.getElementById("widgets").onmousedown = (e) => e.preventDefault();

  showBook().catch((error) => { note.textContent = String(error); });

  if (typeof SharedArrayBuffer === "undefined") {
    note.textContent = "no SharedArrayBuffer: isolating the page";
    isolate().catch((error) => { note.textContent = String(error); });
    return;
  }

  const keys = new SharedArrayBuffer(TowerHost.keyRingBytes());
  const cells = new Int32Array(keys);
  const worker = new Worker("worker.js");

  worker.onmessage = (event) => {
    const message = event.data;
    if (message.kind === "frame") {
      if (canvas.width !== message.width || canvas.height !== message.height) {
        canvas.width = message.width;
        canvas.height = message.height;
      }
      if (state !== "min") {
        context.putImageData(
            new ImageData(message.rgba, message.width, message.height), 0, 0);
      }
    } else if (message.kind === "exit") {
      note.textContent = "tower exited with status " + message.status;
    }
  };

  // Keys go to Doom, and never to the page, unless the box is minimized.
  function onKey(pressed) {
    return (event) => {
      if (state === "min" || event.repeat) return;
      const doomkey = doomKeyOf(event);
      if (doomkey === 0) return;
      event.preventDefault();
      TowerHost.keyPush(cells, pressed ? 1 : 0, doomkey);
    };
  }
  window.addEventListener("keydown", onKey(true));
  window.addEventListener("keyup", onKey(false));

  // The default resumes from the state the native driver saved when the
  // tower published /bin/doom; ?boot=scratch runs the whole boot instead.
  const resume = new URLSearchParams(location.search).get("boot") !== "scratch";
  worker.postMessage({keys, base, resume});
})();
