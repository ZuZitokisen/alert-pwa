import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
const refreshSource=source.slice(source.indexOf('async function refresh('),source.indexOf('function route(){'));
function fixture({update,saved=new Map()}={}){
 const button={disabled:false,attributes:{},setAttribute(k,v){this.attributes[k]=v;},removeAttribute(k){delete this.attributes[k];}};
 const messages=[],calls=[],state={events:[{id:'kept'}],changes:[]};
 const context={Date,state,requestGeneration:0,render(){calls.push('render');},toast:m=>messages.push(m),$:()=>button,sessionStorage:{getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v),removeItem:k=>saved.delete(k)},scheduleRequest:async()=>({ok:true,json:async()=>state}),AlertPwaUpdates:{updateAndReload:update||async function(){}}};
 vm.createContext(context);vm.runInContext(refreshSource,context);
 return {context,button,messages,calls,saved,run:code=>vm.runInContext(code,context)};
}
test('update button handles one request and shows progress without changing geometry',async()=>{
 let done,count=0;const f=fixture({update:async({onStatus,beforeReload})=>{count++;onStatus('checking');await new Promise(resolve=>done=resolve);onStatus('reloading');beforeReload();}});
 const first=f.run('refreshApp()');assert.equal(f.button.disabled,true);assert.equal(f.button.attributes['aria-busy'],'true');assert.match(f.messages[0],/確認しています/);
 await f.run('refreshApp()');assert.equal(count,1);done();await first;
 assert.equal(f.button.disabled,false);assert.equal(f.button.attributes['aria-busy'],undefined);assert.equal(f.button.attributes['aria-label'],'アプリと予定を更新');assert.ok(f.saved.has('alert-pwa-reload-notice-v1'));
});
for(const code of ['offline','timeout','update-failed'])test(`update ${code} leaves data intact and allows another click`,async()=>{
 const saved=new Map([['alert-pwa-favorites-v1','keep'],['alert-pwa-reminders-v2','keep']]);const f=fixture({saved,update:async()=>{throw Object.assign(Error(code),{code});}});
 const before=JSON.stringify(f.context.state);await f.run('refreshApp()');assert.equal(f.button.disabled,false);assert.equal(JSON.stringify(f.context.state),before);assert.equal(saved.get('alert-pwa-favorites-v1'),'keep');assert.equal(saved.get('alert-pwa-reminders-v2'),'keep');assert.match(f.messages[0],/そのまま/);
});
test('completion notice is once-only and does not delete preferences',()=>{
 const saved=new Map([['alert-pwa-reload-notice-v1',String(Date.now())],['alert-pwa-favorites-v1','keep']]);const f=fixture({saved});assert.equal(f.run('takeAppReloadNotice()'),true);assert.equal(f.run('takeAppReloadNotice()'),false);assert.equal(saved.get('alert-pwa-favorites-v1'),'keep');
});
test('old completion notice is ignored',()=>{const f=fixture({saved:new Map([['alert-pwa-reload-notice-v1',String(Date.now()-120000)]])});assert.equal(f.run('takeAppReloadNotice()'),false);});
test('startup refresh completion reports only successful data fetches',async()=>{
 const f=fixture();await f.run('refresh({notice:true})');assert.match(f.messages[0],/再読み込みしました/);
 f.messages.length=0;f.context.scheduleRequest=async()=>({ok:false,json:async()=>({...f.context.state,baselineReady:true})});await f.run('refresh({notice:true})');assert.match(f.messages[0],/取得できません/);assert.ok(!f.messages.join().includes('再読み込みしました'));
});
test('manual app refresh differs from automatic data-only refresh',()=>{
 assert.match(source,/\$\('#refresh'\)\.onclick=refreshApp/);assert.match(source,/visibilitychange',\(\)=>\{if\(!document.hidden\)refresh\(\)/);assert.match(source,/register\('\.\/sw.js',\{updateViaCache:'none'\}\)/);
 const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');assert.ok(html.indexOf('pwa-update.js')<html.indexOf('app.js'));assert.match(html,/aria-label="アプリと予定を更新"/);
});
