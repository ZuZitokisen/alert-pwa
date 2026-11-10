/* Static demo shell only, scoped to this GitHub Pages project. No push subscription. */
const CACHE='alert-pwa-static-shell-v1';
const BASE=new URL('./',self.location.href);
const FILES=['./','./index.html','./app.js','./demo-data.js','./demo-store.js','./style.css','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png'];
const URLS=FILES.map(p=>new URL(p,BASE).href);
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(URLS))));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('alert-pwa-static-shell-')&&k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{const url=new URL(event.request.url);url.hash='';if(event.request.method!=='GET'||url.origin!==BASE.origin||!URLS.includes(url.href))return;event.respondWith(fetch(event.request).catch(async()=>await caches.match(event.request)||new Response('保存済みデータがありません',{status:503})));});
