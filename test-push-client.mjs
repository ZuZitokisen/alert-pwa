import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const script=fs.readFileSync(new URL('./push-client.js',import.meta.url),'utf8');const ctx={URL,atob,Uint8Array};vm.createContext(ctx);vm.runInContext(script,ctx);const P=ctx.AlertPush;
test('backend is absent by default and only approved HTTPS origins allowed',()=>{assert.equal(P.endpoint({},'https://app.test'),null);for(const backendUrl of ['http://app.test','https://evil.test','https://u:p@app.test','https://app.test/?token=a'])assert.equal(P.endpoint({backendUrl},'https://app.test'),null);assert.equal(P.endpoint({backendUrl:'https://push.test/base/',allowedOrigins:['https://push.test']},'https://app.test'),'https://push.test/base');});
test('VAPID keys are bounded uncompressed P256 keys',()=>{assert.throws(()=>P.keyBytes('bad'));assert.throws(()=>P.keyBytes(Buffer.alloc(65).toString('base64url')));const b=Buffer.alloc(65);b[0]=4;assert.equal(P.keyBytes(b.toString('base64url')).length,65);});
const source=fs.readFileSync(new URL('./sw.js',import.meta.url),'utf8');function worker(){const handlers={},calls=[],c={URL,Request,self:{location:{href:'https://app.test/alert/sw.js'},addEventListener:(n,f)=>handlers[n]=f,registration:{showNotification:async(...v)=>calls.push(v)},clients:{matchAll:async()=>[],openWindow:async u=>calls.push(u)}}};vm.createContext(c);vm.runInContext(source,c);return{c,handlers,calls};}
const valid={title:'予定\u202e',body:'a'.repeat(900),eventId:'e',revision:1,kind:'change',tag:'a'.repeat(64),url:'https://evil.test/'};
test('push sanitizes/bounds payload and refuses malformed identities',async()=>{const {c,handlers,calls}=worker();let pending;handlers.push({data:{text:()=>JSON.stringify(valid)},waitUntil:p=>pending=p});await pending;assert.equal(calls.length,1);assert.equal(calls[0][1].body.length,500);assert.equal(calls[0][1].data.url,'https://app.test/alert/#changes');assert.equal(calls[0][1].tag,'alert-change-'+'a'.repeat(64));assert.equal(c.notificationPayload({...valid,tag:'bad'}),null);assert.equal(c.notificationPayload({...valid,kind:'updated'}),null);for(const data of ['bad','x'.repeat(8193)])handlers.push({data:{text:()=>data},waitUntil:()=>assert.fail()});});
test('click target cannot escape scope or reach redirect query',async()=>{const {c,handlers,calls}=worker();for(const u of ['https://evil.test/','//evil.test/','https://app.test/redirect?to=evil','https://app.test/alert/?next=evil','https://app.test/alert/../outside','javascript:alert(1)'])assert.equal(c.notificationTarget(u),'https://app.test/alert/#changes');let closed=false,pending;handlers.notificationclick({notification:{data:{url:'https://evil.test'},close:()=>closed=true},waitUntil:p=>pending=p});await pending;assert.equal(closed,true);assert.equal(calls[0],'https://app.test/alert/#notification-changes');});
test('UI permission request exists only inside explicit enable handler',()=>{const start=script.indexOf('enable.onclick=');const request=script.indexOf('Notification.requestPermission()');const end=script.indexOf('testPush.onclick=');assert.ok(start<request&&request<end);assert.ok(script.includes('if(!base){say('));const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');assert.ok(html.includes('data-enable disabled'));assert.ok(!html.includes('ログインして'));});
function clientFixture({configured=true,failPost=false,installing=false}={}){
 const nodes={};for(const k of ['[role=status]','[data-enable]','[data-disable]','[data-test]'])nodes[k]={textContent:'',checked:false,append(){}};
 const panel={querySelector:s=>nodes[s],querySelectorAll:()=>[{value:'a'}]},calls=[],storage=new Map();let subscription=null;
 const registration={active:{},pushManager:{getSubscription:async()=>subscription,subscribe:async()=>{calls.push('subscribe');subscription={toJSON:()=>({endpoint:'https://push.test/device',keys:{p256dh:'key',auth:'auth'}}),unsubscribe:async()=>{calls.push('unsubscribe');subscription=null;return true;}};return subscription;}}};
 const key=Buffer.alloc(65);key[0]=4;
 const c={URL,atob,Uint8Array,setTimeout,clearTimeout,AbortController,location:{origin:'https://app.test',href:'https://app.test/alert/'},isSecureContext:true,PushManager:{},ALERT_ARTISTS:[{id:'a',name:'A'}],ALERT_PUSH_CONFIG:{backendUrl:configured?'https://app.test':''},navigator:{serviceWorker:{getRegistration:async()=>installing?null:registration}},Notification:{permission:'default',requestPermission:async()=>{calls.push('permission');return'granted';}},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},document:{querySelector:()=>panel,createElement:()=>({append(){}}),createTextNode:s=>s},fetch:async(url,options)=>{calls.push([url,options]);if(options.method==='POST'&&failPost)throw Error('offline');const data=url.endsWith('/config')?{vapidPublicKey:key.toString('base64url')}:{deviceId:'opaque',deviceToken:'t'.repeat(32)};return{ok:true,status:options.method==='DELETE'?204:200,text:async()=>JSON.stringify(data)};}};
 let readyResolve;const listeners={};c.navigator.serviceWorker.ready=new Promise(resolve=>readyResolve=resolve);c.navigator.serviceWorker.addEventListener=(name,fn)=>listeners[name]=fn;c.navigator.serviceWorker.removeEventListener=name=>delete listeners[name];vm.createContext(c);vm.runInContext(script,c);return{c,nodes,calls,storage,readyResolve,registration,listeners};
}
const tick=()=>new Promise(r=>setTimeout(r,0));
test('no backend never fetches, requests permission, or subscribes',async()=>{const f=clientFixture({configured:false});await tick();assert.deepEqual(f.calls,[]);assert.equal(f.nodes['[data-enable]'].disabled,true);});
test('explicit opt-in and stop use opaque-token device API',async()=>{const f=clientFixture();await tick();assert.equal(f.calls.filter(c=>c==='permission').length,0);await f.nodes['[data-enable]'].onclick();assert.ok(f.calls.includes('permission'));assert.ok(f.calls.includes('subscribe'));const post=f.calls.find(c=>Array.isArray(c)&&c[1].method==='POST');assert.deepEqual(Object.keys(JSON.parse(post[1].body)),['subscription']);assert.equal(post[1].credentials,'omit');await f.nodes['[data-disable]'].onclick();assert.equal(f.storage.size,0);assert.ok(f.calls.includes('unsubscribe'));});
test('registration network failure rolls back newly created subscription',async()=>{const f=clientFixture({failPost:true});await tick();await f.nodes['[data-enable]'].onclick();assert.ok(f.calls.includes('unsubscribe'));assert.equal(f.storage.size,0);assert.equal(f.nodes['[data-disable]'].disabled,true);});

test('test push is hidden before registration and explicit authenticated request only',async()=>{const f=clientFixture();await tick();assert.equal(f.nodes['[data-test]'].hidden,true);assert.equal(f.calls.some(c=>Array.isArray(c)&&c[0].endsWith('/test')),false);await f.nodes['[data-enable]'].onclick();assert.equal(f.nodes['[data-test]'].hidden,false);const permissions=f.calls.filter(c=>c==='permission').length;await f.nodes['[data-test]'].onclick();const sent=f.calls.find(c=>Array.isArray(c)&&c[0].endsWith('/test'));assert.equal(sent[1].method,'POST');assert.equal(sent[1].headers.Authorization,'Bearer '+'t'.repeat(32));assert.equal(sent[1].credentials,'omit');assert.equal(sent[1].mode,'cors');assert.equal(f.calls.filter(c=>c==='permission').length,permissions);assert.match(f.nodes['[role=status]'].textContent,/リクエストしました/);await f.nodes['[data-disable]'].onclick();assert.equal(f.nodes['[data-test]'].hidden,true);});
test('test push failure does not report successful delivery or change subscription',async()=>{const f=clientFixture();await tick();await f.nodes['[data-enable]'].onclick();f.c.fetch=async()=>{throw Error('offline');};await f.nodes['[data-test]'].onclick();assert.match(f.nodes['[role=status]'].textContent,/完了できません/);assert.equal(f.nodes['[data-test]'].hidden,false);assert.equal(f.calls.includes('unsubscribe'),false);});

test('three explicit switches are rendered independently while artist and certainty stay out',()=>{const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');const panel=html.slice(html.indexOf('id="push-settings"'),html.indexOf('</article>',html.indexOf('id="push-settings"')));for(const forbidden of ['data-artists','data-possible','data-reminders','data-save','morning-time','fieldset'])assert.equal(panel.includes(forbidden),false);for(const k of ['news','daily','personal'])assert.equal((panel.match(new RegExp('data-notification-kind="'+k+'"','g'))||[]).length,1);});

test('clean-install ready race recovers controls without permission prompt',async()=>{const f=clientFixture({installing:true});await tick();assert.equal(f.nodes['[data-enable]'].disabled,true);assert.equal(f.calls.length,0);assert.match(f.nodes['[role=status]'].textContent,/準備/);f.readyResolve(f.registration);await tick();assert.equal(f.nodes['[data-enable]'].disabled,false);assert.equal(f.calls.filter(c=>c==='permission').length,0);assert.equal(f.calls.filter(c=>Array.isArray(c)).length,1);await f.listeners.controllerchange();assert.equal(f.calls.filter(c=>Array.isArray(c)).length,1);});
test('controllerchange can recover active worker before ready settles',async()=>{const f=clientFixture({installing:true});await tick();f.c.navigator.serviceWorker.getRegistration=async()=>f.registration;await f.listeners.controllerchange();await tick();assert.equal(f.nodes['[data-enable]'].disabled,false);assert.equal(f.calls.includes('permission'),false);});

test('bell confirm/cancel, OFF priority, explicit restart preserve the selection',async()=>{
 const key=Buffer.alloc(65);key[0]=4;
 const nodes={},controls=['news','daily','personal'].map(k=>({dataset:{notificationKind:k},addEventListener(_,fn){this.change=fn;}}));
 for(const sel of ['[role=status]','[data-enable]','[data-disable]','[data-test]'])nodes[sel]={};
 nodes['[data-notification-types]']={querySelectorAll:()=>controls};
 const states={news:false,daily:false,personal:false},calls=[];
 let selected=false, consent=false;
 const d={backend:'https://app.test',deviceId:'fixture',deviceToken:'x'.repeat(32)},app='https://app.test/alert/';
 const ctx={URL,atob,Uint8Array,AbortController,setTimeout,clearTimeout,PushManager:{},isSecureContext:true,location:{origin:'https://app.test',href:app},
  ALERT_PUSH_CONFIG:{backendUrl:d.backend},Notification:{permission:'granted'},navigator:{serviceWorker:{getRegistration:async()=>({active:{},scope:app,pushManager:{getSubscription:async()=>({})}})}},
  localStorage:{getItem:()=>JSON.stringify(d)},confirm(){calls.push('confirm');return consent;},
  document:{querySelector:()=>({querySelector:s=>nodes[s]}),createElement:()=>({dataset:{},attrs:{},setAttribute(k,v){this.attrs[k]=v;},focus(){}})},
  fetch:async(url,o)=>{
   const p=new URL(url).pathname;const b=o.body?JSON.parse(o.body):null;
   if(p.endsWith('/config'))return result({vapidPublicKey:key.toString('base64url'),notificationTypes:true,dailyAvailable:true,personalAvailable:true});
   if(p.endsWith('/settings')){if(o.method==='PATCH'){calls.push(b);Object.assign(states,b);}return result(states);}
   if(o.method==='POST'){calls.push(b);if(b.enablePersonal)states.personal=true;selected=true;}
   if(o.method==='DELETE'){calls.push('delete');selected=false;return result(null,204);}
   return result({selected,globalOn:states.personal,enabled:selected,at:null});
  }};
 function result(data,status=200){return{ok:true,status,text:async()=>JSON.stringify(data)};}
 vm.createContext(ctx);vm.runInContext(script,ctx);await tick();
 const slot={isConnected:true,hidden:true,append(x){this.button=x;}};
 ctx.AlertPush.mountPersonalBell(slot,{id:'e',present:true,status:'confirmed',start:'2099-11-22T10:00:00+09:00'});
 await tick();
 assert.equal(slot.hidden,false);
 await slot.button.onclick();
 assert.deepEqual(calls,['confirm']);assert.equal(selected,false);
 consent=true;await slot.button.onclick();
 assert.deepEqual(calls,['confirm','confirm',{enablePersonal:true}]);assert.equal(selected,true);assert.equal(slot.button.attrs['aria-pressed'],'true');assert.equal(controls[2].checked,true);
 controls[2].checked=false;await controls[2].change();await tick();
 assert.equal(selected,true);assert.equal(slot.button.attrs['aria-pressed'],'false');assert.equal(slot.button.dataset.paused,'true');
 await slot.button.onclick();
 assert.equal(states.personal,true);assert.equal(selected,true);assert.ok(!calls.includes('delete'));
 controls[1].checked=true;await controls[1].change();assert.deepEqual(states,{news:false,daily:true,personal:true});
 await slot.button.onclick();assert.equal(selected,false);assert.equal(states.personal,true);
});
