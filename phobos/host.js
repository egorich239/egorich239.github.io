// host.js -- the JavaScript side of the hypercall ABI (hypercall.h): the
// host object the wasm module calls with a function id and three
// arguments, pointer ones already offsets into the module's heap.
//
// The same object serves the page's worker and a node run: what differs
// -- where text goes, what a frame becomes, where keys come from -- is
// given at creation. Keys and sleeping share one SharedArrayBuffer with
// the page: Int32 cells for the sleep (never notified, so the wait is
// the timeout), the ring's head and tail, and the ring of key events
// behind them, (pressed << 8) | doomkey each. fetchBytes is how the page
// and the worker both get the artifacts, gzip'd in the published bundle.

"use strict";

const TowerHost = (() => {
  const CALL = {
    HOST_READ: 1, HOST_WRITE: 2, PUBLISH: 3, DOOM_FRAME: 4, DOOM_KEY: 5,
    DOOM_TICKS: 6, DOOM_SLEEP: 7, DOOM_WAD_SIZE: 8, DOOM_WAD_READ: 9,
    DOOM_MOUSE: 10,
  };
  const ENOSYS = 38;
  const ENOENT = 2;
  const KEY_RING = 64;
  const CELL_SLEEP = 0, CELL_HEAD = 1, CELL_TAIL = 2, RING_AT = 8;

  function keyRingBytes() {
    return (RING_AT + KEY_RING) * 4;
  }

  // The page's side of the ring: an event dropped in, oldest one out
  // when full, exactly as doom.cc's queue behaves.
  function keyPush(cells, pressed, doomkey) {
    const head = Atomics.load(cells, CELL_HEAD);
    let tail = Atomics.load(cells, CELL_TAIL);
    const next = (head + 1) % KEY_RING;
    if (next === tail) Atomics.store(cells, CELL_TAIL, (tail + 1) % KEY_RING);
    Atomics.store(cells, RING_AT + head, (pressed << 8) | doomkey);
    Atomics.store(cells, CELL_HEAD, next);
  }

  function keyPop(cells) {
    const tail = Atomics.load(cells, CELL_TAIL);
    if (tail === Atomics.load(cells, CELL_HEAD)) return 0;
    const event = Atomics.load(cells, RING_AT + tail);
    Atomics.store(cells, CELL_TAIL, (tail + 1) % KEY_RING);
    return event;
  }

  // The host object. options: write(fd, text), frame(rgba, w, h), wad (a
  // Uint8Array or null), cells (the Int32Array over the shared buffer,
  // or null for no keys and a spinning sleep), now() in ms.
  function create(options) {
    const decoder = new TextDecoder();
    const start = options.now();
    let module = null;

    function heap() {
      return module.HEAPU8;
    }

    function sleep(ms) {
      if (options.cells) {
        Atomics.wait(options.cells, CELL_SLEEP, 0, ms);
      } else {
        const until = options.now() + ms;
        while (options.now() < until) {}
      }
    }

    function frame(at, width, height) {
      const pixels = heap().subarray(at, at + width * height * 4);
      const rgba = new Uint8ClampedArray(width * height * 4);
      for (let i = 0; i < width * height * 4; i += 4) {
        rgba[i] = pixels[i + 2];
        rgba[i + 1] = pixels[i + 1];
        rgba[i + 2] = pixels[i];
        rgba[i + 3] = 255;
      }
      return options.frame(rgba, width, height);
    }

    function wadRead(offset, at, count) {
      const wad = options.wad;
      if (!wad) return -ENOENT;
      const n = Math.max(0, Math.min(count, wad.length - offset));
      heap().set(wad.subarray(offset, offset + n), at);
      return n;
    }

    return {
      attach(m) {
        module = m;
      },
      call(id, a, b, c) {
        switch (id) {
          case CALL.HOST_READ:
            return 0;
          case CALL.HOST_WRITE:
            options.write(a, decoder.decode(heap().subarray(b, b + c)));
            return c;
          case CALL.PUBLISH: {
            const name = heap().subarray(a, heap().indexOf(0, a));
            options.write(2, "publish: " + decoder.decode(name) + " (" + c +
                          " bytes)\n");
            return 0;
          }
          case CALL.DOOM_FRAME:
            return frame(a, b, c);
          case CALL.DOOM_KEY:
            return options.cells ? keyPop(options.cells) : 0;
          case CALL.DOOM_TICKS:
            return Math.floor(options.now() - start);
          case CALL.DOOM_SLEEP:
            sleep(a);
            return 0;
          case CALL.DOOM_WAD_SIZE:
            return options.wad ? options.wad.length : -ENOENT;
          case CALL.DOOM_WAD_READ:
            return wadRead(a, b, c);
          case CALL.DOOM_MOUSE:
            return 0;
          default:
            return -ENOSYS;
        }
      },
    };
  }

  // The run itself: the module created around the host, the image and
  // the state to resume from (or null) put on its heap, the driver
  // entered. Resolves to the driver's exit status.
  async function run(createTower, host, image, state, locateFile) {
    const module = await createTower({host, locateFile, noExitRuntime: true});
    host.attach(module);
    const at = module._malloc(image.length + 1);
    module.HEAPU8.set(image, at);
    module.HEAPU8[at + image.length] = 0;
    let stateAt = 0, stateLength = 0;
    if (state) {
      stateAt = module._malloc(state.length);
      module.HEAPU8.set(state, stateAt);
      stateLength = state.length;
    }
    return module._tower_run(at, image.length, stateAt, stateLength, 0);
  }

  // A program the tower built, run with no tower under it: the image and
  // the wad on the module's heap, the driver's other entry taken. The
  // wad is the guest's to open, so the driver writes it where the game
  // looks; nothing here needs an image of the tower at all.
  async function runDoom(createTower, host, elf, wad, locateFile) {
    const module = await createTower({host, locateFile, noExitRuntime: true});
    host.attach(module);
    const at = module._malloc(elf.length);
    module.HEAPU8.set(elf, at);
    const wadAt = module._malloc(wad.length);
    module.HEAPU8.set(wad, wadAt);
    return module._doom_run(at, elf.length, wadAt, wad.length, 0);
  }

  // The bytes at url: the .gz beside it if there is one (the bundle ships
  // the big files that way; a local build has them plain), inflated here
  // unless the host already served it decoded.
  async function fetchBytes(url) {
    let response = await fetch(url + ".gz");
    if (response.ok) {
      const packed = new Uint8Array(await response.arrayBuffer());
      if (packed[0] !== 0x1f || packed[1] !== 0x8b) return packed;
      const inflated = new Blob([packed]).stream().pipeThrough(
          new DecompressionStream("gzip"));
      return new Uint8Array(await new Response(inflated).arrayBuffer());
    }
    response = await fetch(url);
    if (!response.ok) throw new Error(url + ": " + response.status);
    return new Uint8Array(await response.arrayBuffer());
  }

  return {create, run, runDoom, keyPush, keyRingBytes, fetchBytes, KEY_RING};
})();

if (typeof module !== "undefined") module.exports = TowerHost;
