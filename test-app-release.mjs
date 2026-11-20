import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import vm from 'node:vm';
const moduleSource=fs.readFileSync(new URL('./release-check.js',import.meta.url),'utf8'),source=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8'),html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8'),sw=fs.readFileSync(new URL('./sw.js',import.meta.url),'utf8');
const context={AbortSignal};vm.createContext(context);vm.runInContext(moduleSource,context);const api=context.AlertAppReleases;
test('release discovery compares numeric app versions, not schedule updates',()=>{assert.equal(api.newer('0.7.13','0.7.12'),true);assert.equal(api.newer('0.7.12','0.7.12'),false);assert.equal(api.newer('0.7.9','0.7.12'),false);assert.equal(api.newer('0.10.0','0.9.9'),true);assert.equal(api.newer('latest','0.7.12'),false);});
test('release manifest validates bounded notes and schema',()=>{for(const value of [null,{schema:2,version:'0.7.13',notes:['x']},{schema:1,version:'0.7.13',notes:[]},{schema:1,version:'0.7.13',notes:['x'.repeat(201)]}])assert.equal(api.parse(value),null);assert.ok(api.parse({schema:1,version:'0.7.13',notes:['変更']}));});
test('current bundled release creates no availability popup, including fresh install',async()=>{const raw=fs.readFileSync(new URL('./app-release.json',import.meta.url),'utf8');let options;const result=await api.check(JSON.parse(raw).version,{fetchImpl:async(url,opts)=>{assert.equal(url,'./app-release.json');options=opts;return {ok:true,text:async()=>raw}}});assert.equal(result,null);assert.equal(options.cache,'no-store');assert.equal(options.mode,'same-origin');assert.equal(options.redirect,'error');});
test('failed, oversized and malformed discovery never updates or throws',async()=>{for(const fetchImpl of [async()=>{throw Error('offline')},async()=>({ok:false}),async()=>({ok:true,text:async()=>'x'.repeat(4097)}),async()=>({ok:true,text:async()=>'bad'})])assert.equal(await api.check('0.7.12',{fetchImpl}),null);});
function fixture(saved=null){
 const map=new Map(saved?[['alert-pwa-release-announced-v1',saved]]:[]),nodes={};function element(tag,text='',cls=''){return {tag,textContent:text,className:cls,dataset:{},children:[],append(...x){this.children.push(...x)},replaceChildren(...x){this.children=x},setAttribute(){}};}
 nodes['#detail']=element('dialog');nodes['#detail'].open=false;nodes['#detail-content']=element('div');nodes['#available-app-update']=element('button');
 const c={APP_RELEASE:'0.7.12',appUpdating:false,document:{hidden:false},localStorage:{getItem:k=>map.get(k)||null,setItem:(k,v)=>map.set(k,v)},AlertAppReleases:{check:async()=>({version:'0.7.13',notes:['新機能']})},$:s=>nodes[s],el:element,openDialog(){nodes['#detail'].open=true;c.opens++},closeDialog(){nodes['#detail'].open=false;c.closes++},refreshApp(){c.updates++},opens:0,closes:0,updates:0};vm.createContext(c);vm.runInContext(source.slice(source.indexOf('let availableAppRelease='),source.indexOf('async function refreshApp(){')),c);return {c,nodes,map,run:code=>vm.runInContext(code,c)};
}
test('available update offers exact two actions; cancel preserves version and can reopen',async()=>{const f=fixture();await f.run('checkAppRelease()');assert.equal(f.c.opens,1);const actions=f.nodes['#detail-content'].children.at(-1);assert.deepEqual(actions.children.map(x=>x.textContent),['キャンセル','更新する']);actions.children[0].onclick();assert.equal(f.c.updates,0);await f.run('checkAppRelease()');assert.equal(f.c.opens,1);f.run('showAvailableAppRelease()');assert.equal(f.c.opens,2);f.nodes['#detail-content'].children.at(-1).children[1].onclick();assert.equal(f.c.updates,1);});
test('dismissed version stays quiet across reloads and remains available manually',async()=>{const f=fixture('0.7.13');await f.run('checkAppRelease()');assert.equal(f.c.opens,0);assert.equal(f.nodes['#available-app-update'].hidden,false);f.run('showAvailableAppRelease()');assert.equal(f.c.opens,1);});
test('background and occupied dialog do not interrupt or mark the update shown',async()=>{const f=fixture();f.c.document.hidden=true;await f.run('checkAppRelease()');assert.equal(f.c.opens,0);f.c.document.hidden=false;f.nodes['#detail'].open=true;await f.run('checkAppRelease()');assert.equal(f.c.opens,0);assert.equal(f.map.size,0);});
test('release requests bypass SW; heading icons and News jump preserve original routes',()=>{assert.ok(!sw.includes('app-release.json'));assert.ok(sw.includes('release-check.js?v=0.7.24'));assert.ok(html.indexOf('id="open-app-history"')<html.indexOf('id="changes"'));assert.ok(html.includes('id="app-release-history" tabindex="-1"'));assert.ok(source.includes('menuIcon.cloneNode(true)'));assert.ok(source.includes("icon.setAttribute('aria-hidden','true')"));assert.ok(source.includes("if(!document.hidden)checkAppRelease();},300000)"));});
test('all three heading icons clone their matching menu symbol as decorative content',()=>{
 const snippet=source.slice(source.indexOf('const menuIcon='),source.indexOf("const back=$('#back-to-view')"));
 for(const view of ['calendar','favorites','changes']){
  const glyph=html.match(new RegExp('data-view="'+view+'"><span aria-hidden="true">([^<]+)'))[1];let inserted;
  const icon={textContent:glyph,attributes:{},setAttribute(k,v){this.attributes[k]=v}};
  const c={view,$:selector=>selector==='#view-title'?{prepend(value){inserted=value}}:(assert.equal(selector,`nav [data-view="${view}"] > span:first-child`),{cloneNode(deep){assert.equal(deep,true);return icon}})};
  vm.createContext(c);vm.runInContext(snippet,c);assert.equal(inserted.textContent,glyph);assert.equal(inserted.attributes['aria-hidden'],'true');
 }
});
test('history shortcut opens News before scrolling/focusing its history, without extra fragment navigation',()=>{
 const calls=[],c={location:{hash:'#calendar'},history:{pushState(a,b,hash){calls.push('push');c.location.hash=hash}},closeDialog(){calls.push('close')},route(){calls.push('route')},$:selector=>selector==='#detail'?{open:false}:{scrollIntoView(){calls.push('scroll')},focus(options){assert.equal(options.preventScroll,true);calls.push('focus')}}};
 vm.createContext(c);vm.runInContext(source.slice(source.indexOf('function openAppHistory()'),source.indexOf('let availableAppRelease=')),c);vm.runInContext('openAppHistory()',c);assert.equal(c.location.hash,'#changes');assert.deepEqual(calls,['push','route','scroll','focus']);calls.length=0;vm.runInContext('openAppHistory()',c);assert.deepEqual(calls,['route','scroll','focus']);
});

test('workflow-mode Pages artifact includes both release discovery files',()=>{const workflow=fs.readFileSync(new URL('./.github/workflows/hourly-public-refresh.yml',import.meta.url),'utf8');assert.ok(workflow.includes("'release-check.js','app-release.json'"));});

test('appearance uses OS by default, persists deliberate choice, and works without storage',()=>{
 const early=html.match(/<script>([\s\S]+?)<\/script>/)[1];
 const script=source.slice(source.indexOf('function initAppearance(){'),source.indexOf("$('#refresh').onclick=refreshApp;"));
 const f=(system,stored,denied=false)=>{
  let value=stored,listener;
  const media={matches:system,addEventListener(type,cb){assert.equal(type,'change');listener=cb;}};
  const theme={dataset:{}},button={hidden:true,setAttribute(_,label){this.label=label;}},meta={setAttribute(_,color){this.color=color;}};
  const get=s=>s==='#theme-toggle'?button:meta;
  const localStorage={getItem:k=>{assert.equal(k,'furin-appearance-v1');if(denied)throw Error();return value;},setItem:(k,v)=>{assert.equal(k,'furin-appearance-v1');if(denied)throw Error();value=v;}};
  const ctx=vm.createContext({document:{documentElement:theme,querySelector:get},$:get,window:{matchMedia:()=>media},localStorage});
  vm.runInContext(early,ctx);const initial=theme.dataset.theme;
  vm.runInContext(script,ctx);assert.equal(button.hidden,false);assert.equal(theme.dataset.theme,initial);
  return {theme,button,meta,flipOS:()=>{media.matches=!media.matches;listener();},saved:()=>value};
 };
 const auto=f(true,null);assert.equal(auto.theme.dataset.theme,'dark');assert.equal(auto.button.label,'明るい表示に切り替える');
 assert.equal(auto.meta.color,'#17171d');auto.flipOS();assert.equal(auto.theme.dataset.theme,'light');assert.equal(auto.saved(),null);
 auto.button.onclick();assert.equal(auto.saved(),'dark');assert.equal(auto.theme.dataset.theme,'dark');auto.flipOS();assert.equal(auto.theme.dataset.theme,'dark');
 const restored=f(true,'light');assert.equal(restored.theme.dataset.theme,'light');assert.equal(restored.button.label,'暗い表示に切り替える');assert.equal(restored.meta.color,'#f7f6fb');
 const blocked=f(false,null,true);blocked.button.onclick();assert.equal(blocked.theme.dataset.theme,'dark');
 const invalid=f(false,'invalid');assert.equal(invalid.theme.dataset.theme,'light');
});
