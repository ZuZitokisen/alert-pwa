/* Static schedule shell only, scoped to this GitHub Pages project. No push subscription. */
const CACHE='alert-pwa-static-shell-v7-1';
const BASE=new URL('./',self.location.href);
const FILES=['./','./index.html','./app.js?v=0.7.1','./pwa-update.js?v=0.7.1','./feature-core.js','./calendar-subscriptions.js?v=0.7.1','./artist-config.js?v=0.7.1','./schedule-store.js?v=0.7.1','./style.css?v=0.7.1','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png'];
const URLS=FILES.map(p=>new URL(p,BASE).href);
// Data is fetched by schedule-store, which validates and keeps its own last-good copy.
// Do not intercept/cache its requests here: a cache fallback would hide offline status.
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(URLS.map(url=>new Request(url,{cache:'no-cache'}))))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('alert-pwa-static-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);url.hash='';if(event.request.method!=='GET'||url.origin!==BASE.origin||!URLS.includes(url.href))return;event.respondWith(fetch(event.request,{cache:'no-cache'}).catch(async()=>await caches.match(event.request)||new Response('保存済みデータがありません',{status:503})));});

// Only a deliberate update request from a window in this app may activate early.
self.addEventListener('message',event=>{
 if(event.data?.type!=='ALERT_PWA_SKIP_WAITING'||event.source?.type!=='window')return;
 let source;try{source=new URL(event.source.url);}catch{return;}
 if(source.origin===BASE.origin&&source.pathname.startsWith(BASE.pathname))event.waitUntil(self.skipWaiting());
});
