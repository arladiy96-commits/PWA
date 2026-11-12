const VERSION='__VERSION__';
const CACHE='gruzcontrol-'+new URL(self.registration.scope).pathname+'-'+VERSION;
const ASSETS=__ASSETS__;
const allowed=new Set(ASSETS.map(p=>new URL(p,self.registration.scope).pathname));
self.addEventListener('install',event=>event.waitUntil((async()=>{
  const cache=await caches.open(CACHE);
  // Atomic activation: do not advertise offline readiness with missing runtime/assets.
  try{for(let i=0;i<ASSETS.length;i+=4)await cache.addAll(ASSETS.slice(i,i+4));}
  catch(error){await caches.delete(CACHE);throw error;}
})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const prefix='gruzcontrol-'+new URL(self.registration.scope).pathname+'-';
  for(const key of await caches.keys())if(key.startsWith(prefix)&&key!==CACHE)await caches.delete(key);
  await self.clients.claim();
})()));
self.addEventListener('message',event=>{if(event.data==='ACTIVATE')self.skipWaiting();});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url),scope=new URL(self.registration.scope);
  // Never intercept/cache API, cross-origin traffic, writes, or other apps.
  if(event.request.method!=='GET'||url.origin!==scope.origin||!url.pathname.startsWith(scope.pathname)||url.pathname.includes('/api/'))return;
  const path=url.pathname===scope.pathname?scope.pathname+'index.html':url.pathname;
  if(!allowed.has(path))return;
  event.respondWith((async()=>{const cache=await caches.open(CACHE);return (await cache.match(new URL(path,scope.origin).href))||fetch(event.request);})());
});
