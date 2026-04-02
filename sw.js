const CACHE = 'eliptica-pwa-v43';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './eliptica_pwa_reescrita_desde_cero_v43_mejoras_total_fix.html',
];
self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
});
self.addEventListener('activate', event => {
  event.waitUntil((async()=>{
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  event.respondWith((async()=>{
    const cached = await caches.match(event.request, {ignoreSearch:true});
    if (cached) return cached;
    const resp = await fetch(event.request);
    const cache = await caches.open(CACHE);
    cache.put(event.request, resp.clone());
    return resp;
  })().catch(()=>caches.match('./index.html')));
});
self.addEventListener('message', event => { if (event.data === 'SKIP_WAITING') self.skipWaiting(); });
