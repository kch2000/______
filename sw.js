const CACHE='eliptica-v71-cache';
const CORE=['./','./index.html?v=v71','./app.js?v=v71','./manifest.webmanifest?v=v71','./icon-192.png?v=v71','./icon-512.png?v=v71'];
self.addEventListener('install',e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)));
});
self.addEventListener('activate',e=>{
  e.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET') return;
  const url=new URL(e.request.url);
  const isNav=e.request.mode==='navigate';
  const sameOrigin=url.origin===self.location.origin;
  if(isNav){
    e.respondWith((async()=>{
      try{
        const fresh=await fetch(e.request,{cache:'no-store'});
        const cache=await caches.open(CACHE);
        cache.put('./index.html?v=v71', fresh.clone());
        return fresh;
      }catch(err){
        return (await caches.match('./index.html?v=v71')) || (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }
  if(sameOrigin && /\.(?:js|css|png|webmanifest|html)$/i.test(url.pathname)){
    e.respondWith((async()=>{
      const cache=await caches.open(CACHE);
      const cached=await cache.match(e.request, {ignoreSearch:false}) || await cache.match(url.pathname, {ignoreSearch:true});
      const networkPromise=fetch(e.request,{cache:'no-store'}).then(resp=>{ cache.put(e.request, resp.clone()); return resp; }).catch(()=>cached);
      return cached || networkPromise;
    })());
  }
});
self.addEventListener('message',e=>{ if(e.data&&e.data.type==='SKIP_WAITING') self.skipWaiting(); });
