// coi.js -- the service worker that makes the page cross-origin isolated
// on a host that sets no headers (GitHub Pages): every response passes
// through with the COOP, COEP and CORP headers added, which is what
// SharedArrayBuffer asks of the document and of everything it loads.
// The page registers it and reloads once so its own document comes
// through here too. Nothing is cached; a host that already sends the
// headers is unaffected.

"use strict";

const HEADERS = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
};

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

// A cache-only cross-origin request cannot be answered by a worker at
// all (a browser quirk), so it is left to the browser.
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.cache === "only-if-cached" && request.mode !== "same-origin") {
    return;
  }
  event.respondWith(fetch(request).then(isolated));
});

// The response with the headers added; an opaque one has none to add to.
function isolated(response) {
  if (response.status === 0) return response;
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(HEADERS)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status, statusText: response.statusText, headers,
  });
}
