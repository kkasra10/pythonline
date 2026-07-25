/* PythonLine service worker — makes the app work offline.

   Strategy:
   - App shell (same-origin files): network-first, so you always get the
     latest build when online, with a cached fallback when offline.
   - CDN assets (Pyodide runtime + packages, CodeMirror): cache-first, since
     they live at versioned URLs and are large — cache once, reuse forever.

   After one online visit (and one run, to pull numpy/pandas/matplotlib),
   everything is cached and the app runs with no network. */

const VERSION = "v1";
const SHELL_CACHE = "pythonline-shell-" + VERSION;
const RUNTIME_CACHE = "pythonline-runtime-" + VERSION;

const SHELL = [
  "./",
  "index.html",
  "app.js",
  "worker.js",
  "styles.css",
  "manifest.webmanifest",
  "icon-192.png",
  "icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== SHELL_CACHE && k !== RUNTIME_CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Explicit pre-caching requested by the page ("Download for offline").
self.addEventListener("message", (e) => {
  const d = e.data;
  if (d && d.type === "precache") precache(d.urls || [], e.ports && e.ports[0]);
});

async function precache(urls, port) {
  const cache = await caches.open(RUNTIME_CACHE);
  let done = 0;
  for (const url of urls) {
    try {
      const existing = await cache.match(url);
      if (!existing) {
        const res = await fetch(url, { mode: "cors" });
        if (res && (res.ok || res.type === "opaque")) await cache.put(url, res.clone());
      }
    } catch (err) { /* skip failures, keep going */ }
    done++;
    if (port) port.postMessage({ done, total: urls.length });
  }
  if (port) port.postMessage({ done: urls.length, total: urls.length, complete: true });
}

function isCDN(url) {
  return url.hostname.endsWith("jsdelivr.net") || url.hostname.endsWith("cloudflare.com");
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  if (!sameOrigin && !isCDN(url)) return; // leave other origins alone

  if (sameOrigin) {
    // Network-first: fresh when online, cached when offline.
    e.respondWith(
      fetch(req)
        .then((res) => {
          const clone = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put(req, clone));
          return res;
        })
        .catch(() => caches.match(req))
    );
    return;
  }

  // CDN: cache-first (versioned URLs, big files).
  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && (res.ok || res.type === "opaque")) {
          const clone = res.clone();
          caches.open(RUNTIME_CACHE).then((c) => c.put(req, clone));
        }
        return res;
      });
    })
  );
});
