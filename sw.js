// App shell: cache-first. Schedule data: network-first, falling back to cache (venue Wi-Fi).
const CACHE = "upp-v2";
const SHELL = ["./", "index.html", "styles.css", "app.js", "manifest.webmanifest", "icon.svg", "data/talks.json"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  const networkFirst = url.pathname.endsWith("/data/talks.json") || url.pathname.endsWith(".js") || url.pathname.endsWith(".css") || e.request.mode === "navigate";
  if (networkFirst) {
    e.respondWith(fetch(e.request, { cache: "no-cache" }).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true })));
  } else {
    e.respondWith(caches.match(e.request).then(hit => hit || fetch(e.request)));
  }
});
