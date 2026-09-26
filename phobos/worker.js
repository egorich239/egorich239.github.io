// worker.js -- the page's worker: Blink and the tower run here, so the
// page stays alive while they do. The page sends the shared key buffer,
// where the artifacts are and whether to resume from the saved state;
// text and frames go back as messages.

"use strict";

importScripts("host.js", "build/tower.js");

const fetchBytes = TowerHost.fetchBytes;

function say(fd, text) {
  postMessage({kind: "text", fd, text});
}

onmessage = async (event) => {
  const {keys, base, resume} = event.data;
  const cells = new Int32Array(keys);
  try {
    const [image, wad, state] = await Promise.all([
      fetchBytes(base + "build/image.bin"),
      fetchBytes(base + "build/doom1.wad"),
      resume ? fetchBytes(base + "build/state.bin") : null,
    ]);
    const host = TowerHost.create({
      now: () => performance.now(),
      cells,
      wad,
      write: say,
      frame: (rgba, width, height) => {
        postMessage({kind: "frame", rgba, width, height}, [rgba.buffer]);
        return 0;
      },
    });
    say(2, "tower: image " + image.length + " bytes, wad " + wad.length +
           " bytes" + (state ? ", state " + state.length + " bytes" : "") +
           "\n");
    const status = await TowerHost.run(createTower, host, image, state,
                                       (path) => base + "build/" + path);
    postMessage({kind: "exit", status});
  } catch (error) {
    say(2, "worker: " + error + "\n");
    postMessage({kind: "exit", status: -1});
  }
};
