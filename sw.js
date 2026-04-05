const CACHE='eliptica-v49-cache';
const ASSETS=['./','./index.html','./app.js','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});
self.addEventListener('activate',e=>{e.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));await self.clients.claim();})())});
self.addEventListener('fetch',e=>{if(e.request.method!=='GET') return; e.respondWith(caches.match(e.request).then(r=>r||fetch(e.request).catch(()=>caches.match('./index.html'))))});
self.addEventListener('message',e=>{if(e.data&&e.data.type==='SKIP_WAITING') self.skipWaiting()});
