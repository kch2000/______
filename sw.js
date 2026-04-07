const VERSION='v58';
const CACHE=`eliptica-${VERSION}-cache`;
const CORE=[
  './',
  './index.html?v=v58',
  './app.js?v=v58',
  './manifest.webmanifest?v=v58',
  './icon-192.png?v=v58',
  './icon-512.png?v=v58'
];

self.addEventListener('install',event=>{
  self.skipWaiting();
  event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(CORE)));
});

self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

function isAppShell(request){
  const url=new URL(request.url);
  return request.mode==='navigate' || /\/(index\.html|app\.js|manifest\.webmanifest)$/i.test(url.pathname);
}

async function networkFirst(request){
  const cache=await caches.open(CACHE);
  try{
    const response=await fetch(request,{cache:'no-store'});
    if(response && response.ok) cache.put(request, response.clone());
    return response;
  }catch(err){
    const cached=await cache.match(request, {ignoreSearch:false}) || await cache.match(request, {ignoreSearch:true});
    if(cached) return cached;
    return caches.match('./index.html?v=v58', {ignoreSearch:true});
  }
}

async function cacheFirst(request){
  const cache=await caches.open(CACHE);
  const cached=await cache.match(request, {ignoreSearch:false}) || await cache.match(request, {ignoreSearch:true});
  if(cached) return cached;
  const response=await fetch(request);
  if(response && response.ok) cache.put(request, response.clone());
  return response;
}

self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET') return;
  const url=new URL(event.request.url);
  if(isAppShell(event.request)){
    event.respondWith(networkFirst(event.request));
    return;
  }
  if(/\.(png|jpg|jpeg|webp|svg)$/i.test(url.pathname)){
    event.respondWith(cacheFirst(event.request));
    return;
  }
  event.respondWith(cacheFirst(event.request));
});

self.addEventListener('message',event=>{
  if(event.data && event.data.type==='SKIP_WAITING') self.skipWaiting();
});
