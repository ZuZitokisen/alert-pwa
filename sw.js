/* Static schedule shell only, scoped to this GitHub Pages project. Push is opt-in through configured backend. */
const CACHE='alert-pwa-static-shell-v7-10';
const BASE=new URL('./',self.location.href);
const FILES=['./push-config.js','./push-client.js','./','./index.html','./app.js?v=0.7.10','./pwa-update.js?v=0.7.10','./feature-core.js','./calendar-subscriptions.js?v=0.7.10','./artist-config.js?v=0.7.10','./schedule-store.js?v=0.7.10','./style.css?v=0.7.10','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png'];
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

// Never execute payload HTML or open an arbitrary notification URL.
function notificationTarget(value){
 try{const url=new URL(value,BASE);if(url.origin===BASE.origin&&(url.pathname===BASE.pathname||url.pathname===BASE.pathname+'index.html')&&!url.username&&!url.password&&!url.search&&['','#changes','#calendar','#favorites'].includes(url.hash))return new URL('./'+(url.hash||'#changes'),BASE).href;}catch{}
 return new URL('./#changes',BASE).href;
}
function notificationPayload(value){
 if(!value||typeof value!=='object'||!['new','change','reminder'].includes(value.kind)||typeof value.eventId!=='string'||value.eventId.length>200||!value.eventId||!['string','number'].includes(typeof value.revision)||String(value.revision).length>100)return null;
 const clean=(text,max)=>typeof text==='string'?text.replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,' ').slice(0,max):'';
 // Server supplies a stable SHA256 identity, including reminder instant where needed.
 if(typeof value.tag!=='string'||!/^[a-f0-9]{64}$/.test(value.tag))return null;
 return {title:clean(value.title,120)||'予定のお知らせ',options:{body:clean(value.body,500),tag:'alert-'+value.kind+'-'+value.tag,icon:new URL('icon-192.png',BASE).href,badge:new URL('icon-192.png',BASE).href,data:{url:notificationTarget(value.url)},renotify:false}};
}
self.addEventListener('push',event=>{
 let payload;try{const raw=event.data?.text();if(!raw||raw.length>8192)return;payload=notificationPayload(JSON.parse(raw));}catch{return;}
 if(payload)event.waitUntil(self.registration.showNotification(payload.title,payload.options));
});
self.addEventListener('notificationclick',event=>{
 event.notification.close();const safeTarget=notificationTarget(event.notification.data?.url),target=safeTarget.endsWith('#changes')?safeTarget.replace(/#changes$/,'#notification-changes'):safeTarget;
 event.waitUntil((async()=>{const windows=await self.clients.matchAll({type:'window',includeUncontrolled:false});for(const client of windows){let u;try{u=new URL(client.url);}catch{continue;}if(u.origin===BASE.origin&&(u.pathname===BASE.pathname||u.pathname===BASE.pathname+'index.html')){await client.navigate(target);return client.focus();}}return self.clients.openWindow(target);})());
});
