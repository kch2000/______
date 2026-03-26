const CACHE_NAME='eliptica-v18-cache';
const ASSETS=['./','./index.html','./eliptica_pwa_reescrita_desde_cero_v18_fix_botones_grafica_total.html','./manifest.webmanifest','./icon-192.png','./icon-512.png'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting()));});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',event=>{if(event.request.method!=='GET') return; event.respondWith(caches.match(event.request).then(resp=>resp||fetch(event.request).then(net=>{const copy=net.clone(); caches.open(CACHE_NAME).then(c=>c.put(event.request,copy)).catch(()=>{}); return net;}).catch(()=>caches.match('./index.html'))));});
