const CACHE = "eliptica-pwa-v36";
const ASSETS = [
  "./",
  "./index.html",
  "./index.html?v=35",
  "./eliptica_pwa_reescrita_desde_cero_v36_scroll_ble_fix.html",
  "./app.js",
  "./manifest.webmanifest",
  "./icon-192.png",
  "./icon-512.png"
];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    caches.match(event.request, {ignoreSearch:true}).then(hit => {
      if (hit) return hit;
      return fetch(event.request).then(response => {
        const copy = response.clone();
        caches.open(CACHE).then(cache => cache.put(event.request, copy)).catch(() => {});
        return response;
      }).catch(() => caches.match("./index.html", {ignoreSearch:true}));
    })
  );
});
