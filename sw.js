const CACHE='eliptica-v55';
const ASSETS=['./','./index.html','./app.js?v=v55','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)).catch(()=>{}));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{const req=e.request; e.respondWith(caches.match(req,{ignoreSearch:true}).then(r=>r||fetch(req)));});
self.addEventListener('message',e=>{if(e.data&&e.data.type==='SKIP_WAITING') self.skipWaiting();});
