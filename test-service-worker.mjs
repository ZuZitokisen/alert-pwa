import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('./sw.js',import.meta.url),'utf8');
function fixture(){
 const handlers={},calls=[],context={URL,Request,Response,caches:{open:async name=>({addAll:async requests=>calls.push(['precache',name,requests])}),keys:async()=>['alert-pwa-static-shell-v4-1','unrelated'],delete:async key=>calls.push(['delete',key]),match:async()=>new Response('offline')},fetch:async(req,opts)=>{calls.push(['fetch',req,opts]);return new Response('fresh');},self:{location:{href:'https://example.com/alert-pwa/sw.js'},clients:{claim:async()=>calls.push(['claim'])},skipWaiting:async()=>calls.push(['activate']),addEventListener:(type,handler)=>handlers[type]=handler}};
 vm.createContext(context);vm.runInContext(source,context);return {handlers,calls,context};
}
test('precache and shell network requests revalidate and include the updater',async()=>{
 const f=fixture();let pending;f.handlers.install({waitUntil:p=>pending=p});await pending;
 const requests=f.calls[0][2];assert.ok(requests.some(r=>new URL(r.url).pathname.endsWith('/pwa-update.js')));assert.ok(requests.every(r=>r.cache==='no-cache'));
 f.handlers.fetch({request:new Request('https://example.com/alert-pwa/app.js?v=0.7.21'),respondWith:p=>pending=p});await pending;assert.equal(f.calls.at(-1)[2].cache,'no-cache');
});
test('schedule data is not hidden behind a shell cache',()=>{const f=fixture();let intercepted=false;f.handlers.fetch({request:new Request('https://example.com/alert-pwa/schedule-data.json'),respondWith:()=>intercepted=true});assert.equal(intercepted,false);});
test('activation only cleans old app shells, never other stores',async()=>{const f=fixture();let pending;f.handlers.activate({waitUntil:p=>pending=p});await pending;assert.deepEqual(f.calls.filter(c=>c[0]==='delete'),[['delete','alert-pwa-static-shell-v4-1']]);assert.ok(!source.includes('localStorage'));assert.ok(!source.includes('indexedDB'));});
test('only the deliberate message from this app window activates early',async()=>{
 const f=fixture();let pending;const send=(data,url,type='window')=>f.handlers.message({data,source:{type,url},waitUntil:p=>pending=p});
 send({type:'ALERT_PWA_SKIP_WAITING'},'https://other.example/alert-pwa/');send({type:'ALERT_PWA_SKIP_WAITING'},'https://example.com/other/');send({type:'other'},'https://example.com/alert-pwa/');send({type:'ALERT_PWA_SKIP_WAITING'},'https://example.com/alert-pwa/','worker');assert.equal(f.calls.length,0);
 send({type:'ALERT_PWA_SKIP_WAITING'},'https://example.com/alert-pwa/');await pending;assert.deepEqual(f.calls,[['activate']]);
});

test('changed shell assets have identical versioned URLs in document and worker',()=>{const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');for(const asset of ['app.js','pwa-update.js','style.css','calendar-subscriptions.js','artist-config.js','schedule-store.js']){assert.ok(html.includes('./'+asset+'?v=0.7.21'));assert.ok(source.includes("'./"+asset+"?v=0.7.21'"));}});

test('subscription feeds and manifest are never intercepted by the shell cache',()=>{const f=fixture();for(const path of ['calendar-feeds/tokisen-all.ics','calendar-feeds/straightangeli-all.ics','calendar-feeds/manifest.json','calendar-feeds/manifest-v2.json','schedule-data-v2.json','calendar-feeds/manifest-v4.json','schedule-data-v4.json']){let hit=false;f.handlers.fetch({request:new Request('https://example.com/alert-pwa/'+path),respondWith:()=>hit=true});assert.equal(hit,false);}});

test('displayed release and versioned asset URLs agree',()=>{const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');const version=html.match(/SCHEDULE \/ v([0-9.]+)/)[1];for(const asset of ['app.js','pwa-update.js','style.css','calendar-subscriptions.js','artist-config.js','schedule-store.js']){assert.ok(html.includes('./'+asset+'?v='+version));assert.ok(source.includes("'./"+asset+"?v="+version+"'"));}});

test('v0.7.21 installs a distinct complete shell before v7-20 cache retirement',async()=>{
 const f=fixture();let pending;f.handlers.install({waitUntil:p=>pending=p});await pending;
 const precache=f.calls.find(c=>c[0]==='precache');assert.equal(precache[1],'alert-pwa-static-shell-v7-21');
 assert.equal(f.calls.filter(c=>c[0]==='delete').length,0,'installation does not retire old cache');
 for(const request of precache[2]){
  const path=new URL(request.url).pathname.replace(/^\/alert-pwa\//,'')||'index.html';
  assert.ok(fs.existsSync(new URL('./'+path,import.meta.url)),path+' is included in this repository');
 }
 f.context.caches.keys=async()=>['alert-pwa-static-shell-v7-20','alert-pwa-static-shell-v7-21','another-application'];
 f.handlers.activate({waitUntil:p=>pending=p});await pending;
 assert.deepEqual(f.calls.filter(c=>c[0]==='delete'),[['delete','alert-pwa-static-shell-v7-20']]);
 assert.ok(f.calls.some(c=>c[0]==='claim'));assert.ok(!source.includes('localStorage'));assert.ok(!source.includes('indexedDB'));
});
test('v0.7.21 offline shell uses its matching versioned cache request without touching data',async()=>{
 const f=fixture(),url='https://example.com/alert-pwa/style.css?v=0.7.21';let pending,matched;
 f.context.fetch=async()=>{throw Error('offline');};f.context.caches.match=async request=>{matched=request.url;return new Response('current offline style');};
 f.handlers.fetch({request:new Request(url),respondWith:p=>pending=p});assert.equal(await (await pending).text(),'current offline style');assert.equal(matched,url);
 for(const path of ['schedule-data-v2.json','calendar-feeds/manifest-v2.json','calendar-feeds/straightangeli-all.ics']){let intercepted=false;f.handlers.fetch({request:new Request('https://example.com/alert-pwa/'+path),respondWith:()=>intercepted=true});assert.equal(intercepted,false);}
});

test('Fūrin branding updates installed metadata without changing app identity or its origin',()=>{
 const read=name=>fs.readFileSync(new URL('./'+name,import.meta.url),'utf8');
 const m=JSON.parse(read('manifest.webmanifest')),html=read('index.html'),release=JSON.parse(read('app-release.json'));
 assert.deepEqual([m.id,m.start_url,m.scope],['./','./','./']);
 assert.equal(m.name,'Furin');assert.equal(m.short_name,'Furin');
 assert.match(html,/<meta name="apple-mobile-web-app-title" content="Furin">/);
 for(const ext of ['manifest.webmanifest','icon.svg','icon-192.png'])assert.ok(html.includes('href="./'+ext+'?v='+release.version+'"'));
 for(const ico of m.icons)assert.ok(source.includes(ico.src));
 assert.ok(release.notes.length>0&&release.notes.length<=6);
});
