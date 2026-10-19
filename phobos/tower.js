// tower.js -- the page: the book (the image from stage0's code on) and the Doom box, a canvas fixed in the corner that the
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
  const book = document.getElementById("book");
  const titled = document.getElementById("title");
  const box = document.getElementById("doom");
  const canvas = document.getElementById("screen");
  const context = canvas.getContext("2d");
  const note = document.getElementById("note");

  async function fetchBuilt(path) {
    return TowerHost.fetchBytes(base + "build/" + path);
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

  // A title page line: its leading comment marker dimmed, the rest as is.
  function showName(element, line) {
    const [, marker, words] = /^([^\w\s]*\s*)(.*)$/.exec(line);
    const dim = document.createElement("span");
    dim.className = "marker";
    dim.textContent = marker;
    element.textContent = "";
    element.append(dim, words);
  }

  // The book, in reading order: the image from its first byte, opening on
  // the title page. Its head is shown as `hd` shows it, since stage0's NULs
  // and newlines are not the stream's: whole rows, past stage0's code and
  // on into the text it runs into. The text itself starts where stage0's
  // code ends: its title and subtitle are set on the title page, and the
  // book goes on from there.
  const DUMP_BYTES = 80;
  async function showBook() {
    const [size, image] = await Promise.all([
      fetchBuilt("stage0.size"), fetchBuilt("image.bin"),
    ]);
    const code = Number(new TextDecoder().decode(size).trim());
    // The dump reads the bytes themselves: a browser's latin1 is
    // windows-1252, which turns some of them into other characters. The
    // text keeps one character per byte either way.
    const text = new TextDecoder("latin1").decode(image.subarray(code));
    const page = Book.titlePage(text);
    titled.querySelector("#dump").textContent =
        Book.hexdump(image.subarray(0, DUMP_BYTES));
    showName(titled.querySelector(".title"), page.title);
    showName(titled.querySelector(".subtitle"), page.subtitle);
    const lines = Book.splitLines(page.rest);
    Book.mount(book, lines);
  }

  // The box's state: corner, full or min; the widgets move between them.
  // It starts minimized, and Doom starts the first time it is opened.
  let state = "min";
  let cells = null;
  function setState(next) {
    state = next;
    box.className = next;
    if (next !== "min") startDoom();
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

  function startDoom() {
    if (cells || typeof SharedArrayBuffer === "undefined") return;
    const keys = new SharedArrayBuffer(TowerHost.keyRingBytes());
    cells = new Int32Array(keys);
    const worker = new Worker("worker.js");
    worker.onmessage = onMessage;
    // The default resumes from the state the native driver saved when the
    // tower published /bin/doom; ?boot=scratch runs the whole boot instead.
    const resume = new URLSearchParams(location.search).get("boot") !== "scratch";
    worker.postMessage({keys, base, resume});
  }

  function onMessage(event) {
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
  }

  // Keys go to Doom, and never to the page, unless the box is minimized.
  function onKey(pressed) {
    return (event) => {
      if (state === "min" || !cells || event.repeat) return;
      const doomkey = doomKeyOf(event);
      if (doomkey === 0) return;
      event.preventDefault();
      TowerHost.keyPush(cells, pressed ? 1 : 0, doomkey);
    };
  }
  window.addEventListener("keydown", onKey(true));
  window.addEventListener("keyup", onKey(false));
})();
