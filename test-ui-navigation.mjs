import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
const routeSource=source.slice(source.indexOf('function route(){'),source.indexOf("\n$('#detail').addEventListener"));
const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
function fixture(initialHash=''){
 const views=['calendar','cards','favorites','changes'].map(name=>({id:name+'-view',hidden:false}));
 const links=views.map(v=>({dataset:{view:v.id==='cards-view'?'search':v.id.replace('-view','')},attributes:{},classList:{toggle(){}},setAttribute(k,v){this.attributes[k]=v},removeAttribute(k){delete this.attributes[k]}}));
 const title={textContent:'',focus(){this.focused=(this.focused||0)+1}},back={hidden:true,href:'',attributes:{},setAttribute(k,v){this.attributes[k]=v}},detail={open:false};
 const context={location:{hash:initialHash},document:{querySelectorAll(s){return s==='.view'?views:links}},window:{scrollTo(settings){context.scrollCount++;context.lastScroll=settings;}},scrollCount:0,closeDialog(){detail.open=false;context.closed=(context.closed||0)+1},$:(s)=>({'#view-title':title,'#back-to-view':back,'#detail':detail}[s])};
 context.selectedArtists=new Set(['tokisen']);context.artist='tokisen';context.renderArtists=()=>{context.artistRenders=(context.artistRenders||0)+1;};context.renderChanges=()=>{context.changeRenders=(context.changeRenders||0)+1;};context.history={replaceState:(_state,_title,hash)=>context.location.hash=hash};
 vm.createContext(context);vm.runInContext("let view='calendar',returnView='calendar';"+routeSource,context);
 function go(hash){context.location.hash=hash;vm.runInContext('route()',context);return views.filter(v=>!v.hidden).map(v=>v.id);}
 return {context,views,links,title,back,detail,go};
}
test('Schedule does not show a back control',()=>{const f=fixture();assert.deepEqual(f.go('#calendar'),['calendar-view']);assert.equal(f.back.hidden,true);assert.equal(f.title.textContent,'Schedule');});
test('News owns change history and specifications',()=>{const f=fixture();assert.deepEqual(f.go('#changes'),['changes-view']);assert.equal(f.title.textContent,'News');assert.equal(f.back.hidden,true);assert.ok(!html.includes('id="about-view"'));assert.ok(html.includes('アプリ更新・仕様'));});
test('Favorite and Schedule remain independent routes',()=>{const f=fixture();assert.deepEqual(f.go('#favorites'),['favorites-view']);assert.equal(f.title.textContent,'Favorite');assert.deepEqual(f.go('#calendar'),['calendar-view']);});
test('all-events route returns to News without losing legacy access',()=>{const f=fixture();f.go('#cards');assert.equal(f.title.textContent,'Search');assert.equal(f.back.href,'#changes');assert.equal(f.back.attributes['aria-label'],'Newsに戻る');assert.equal(f.back.hidden,false);assert.deepEqual(f.go(f.back.href),['changes-view']);});
test('direct legacy about and settings URLs resolve to News',()=>{for(const route of ['about','settings']){const f=fixture();assert.deepEqual(f.go('#'+route),['changes-view']);assert.equal(f.title.textContent,'News');assert.equal(f.back.hidden,true);}});
test('unknown routes stay within app and old watch route remains valid',()=>{const f=fixture();assert.deepEqual(f.go('#unknown'),['calendar-view']);assert.deepEqual(f.go('#watch'),['cards-view']);});
test('entering and leaving News reveals heading and closes dialogs',()=>{const f=fixture();f.detail.open=true;f.go('#changes');assert.equal(f.detail.open,false);assert.equal(f.context.closed,1);assert.equal(f.context.scrollCount,1);assert.equal(f.title.focused,1);f.go('#changes');assert.equal(f.context.scrollCount,1);f.go('#calendar');assert.equal(f.context.scrollCount,2);});
test('redundant i screen is removed and the existing back control remains available',()=>{assert.ok(!html.includes('class="icon-button mobile-info information-icon"'));assert.ok(!html.includes('⚙'));assert.match(html,/id="back-to-view"[^>]+href="#calendar"[^>]+hidden/);assert.ok(!html.includes('配信環境の接続後に設定</button>'));});
test('card markup no longer generates redundant decorative color strips',()=>{assert.ok(!source.includes('card-colorbar'));});
test('primary calendar entry uses production presets rather than a file download',()=>{assert.match(source,/exportButton.onclick=\(\)=>openSubscriptions\(e.artistId\)/);assert.ok(!source.includes('購読先は準備中'));assert.match(html,/<div class="selection-toolbar" hidden>/);assert.ok(!source.includes('card(e,true)'));assert.ok(html.indexOf('calendar-subscriptions.js')<html.indexOf('app.js'));assert.match(source,/subscribe.href=urls.webcal/);assert.ok(source.includes('1種類ずつ追加してください'));});

const favoriteSource=source.slice(source.indexOf('function favoriteMark(active)'),source.indexOf('function favoriteButton(e)'));
for(const active of [false,true])test(`favorite icon uses accessible decorative SVG and ${active?'white saved':'black unsaved'} heart`,()=>{const context={document:{createElementNS(ns,tag){return {ns,tag,attributes:{},children:[],setAttribute(k,v){this.attributes[k]=v},append(...children){this.children.push(...children)}}}}};context.selectedArtists=new Set(['tokisen']);context.artist='tokisen';context.renderArtists=()=>{context.artistRenders=(context.artistRenders||0)+1;};context.renderChanges=()=>{context.changeRenders=(context.changeRenders||0)+1;};context.history={replaceState:(_state,_title,hash)=>context.location.hash=hash};
 vm.createContext(context);vm.runInContext(favoriteSource,context);const icon=vm.runInContext(`favoriteMark(${active})`,context);assert.equal(icon.attributes['aria-hidden'],'true');assert.equal(icon.attributes.focusable,'false');assert.equal(icon.attributes.viewBox,'0 0 24 24');assert.equal(icon.children.length,1);const heart=icon.children[0];assert.equal(heart.tag,'path');assert.match(heart.attributes.d,/^M12 20\.5/);assert.equal(heart.attributes.fill,active?'#fff':'#222332');assert.equal(heart.attributes.stroke,'#222332');assert.equal(heart.attributes['stroke-width'],'1.4');});
test('favorite help describes hearts and their saved state',()=>{assert.ok(!source.includes('カードの星'));assert.ok(html.includes('黒いハートは未登録、白いハートは登録済みです。'));assert.ok(source.includes('お気に入りはまだありません。'));});
test('heart preserves white circle, card position and touch/icon geometry',()=>{const css=fs.readFileSync(new URL('./style.css',import.meta.url),'utf8');assert.match(css,/\.favorite-button\{position:relative;[^}]*width:44px;height:44px;[^}]*padding:7px/);assert.match(css,/\.favorite-button::before\{[^}]*inset:7px;[^}]*border-radius:50%;background:#fff\}/);assert.match(css,/\.favorite-button svg\{display:block;width:20px;height:20px\}/);assert.match(css,/\.event-card \.favorite-button\{position:absolute;right:4px;bottom:4px\}/);});

test('regular screens omit introductory copy and keep important guidance in information',()=>{
 const regular=html.slice(html.indexOf('<main>'),html.indexOf('<section id="changes-view"'));
 for(const text of ['気になる、を集めよう','お気に入りはこの端末','予定を、カードで','新しい発表と、予定の変化','非公式の情報集約'])assert.ok(!regular.includes(text));
 const info=html.slice(html.indexOf('<section id="changes-view"'));
 for(const text of ['非公式の情報集約','アプリの更新','黒いハートは未登録','別端末との同期はありません','一部の公式情報源で自動取得を検証中'])assert.ok(info.includes(text));
 assert.ok(source.includes('通知は予約・配信されません。'));assert.ok(html.includes('更新間隔は端末側に依存'));
});

test('notification News entry resets artist filter but ordinary News preserves it',()=>{const f=fixture();f.go('#changes');assert.deepEqual([...f.context.selectedArtists],['tokisen']);f.go('#notification-changes');assert.equal(f.context.selectedArtists.size,0);assert.equal(f.context.artist,'all');assert.equal(f.context.location.hash,'#changes');assert.equal(f.title.textContent,'News');assert.equal(f.context.artistRenders,1);assert.equal(f.context.changeRenders,1);});

test('re-activating the visible tab scrolls smoothly to top without changing route or focus',()=>{
 for(const name of ['calendar','favorites','search','changes']){
  const f=fixture();f.go(name==='search'?'#find':'#'+name);const before=f.context.scrollCount,focused=f.title.focused;
  let prevented=0;const event={currentTarget:f.links.find(l=>l.dataset.view===name),button:0,preventDefault(){prevented++;}};
  f.context.event=event;vm.runInContext('preventActiveTabNavigation(event)',f.context);
  assert.equal(prevented,1);assert.equal(f.context.scrollCount,before+1);
  assert.equal(f.context.lastScroll.top,0);assert.equal(f.context.lastScroll.left,0);assert.equal(f.context.lastScroll.behavior,'smooth');
  assert.equal(f.context.location.hash,name==='search'?'#find':'#'+name);assert.equal(f.title.focused,focused);
  for(const patch of [{currentTarget:f.links.find(l=>l.dataset.view!==name)},{ctrlKey:true},{button:1},{defaultPrevented:true}]){
   f.context.event={...event,...patch};vm.runInContext('preventActiveTabNavigation(event)',f.context);
  }
  assert.equal(prevented,1);assert.equal(f.context.scrollCount,before+1);
 }
});

test('active-tab scrolling respects reduced motion',()=>{const f=fixture();f.context.window.matchMedia=()=>({matches:true});f.context.event={currentTarget:f.links.find(l=>l.dataset.view==='calendar'),button:0,preventDefault(){}};vm.runInContext('preventActiveTabNavigation(event)',f.context);assert.equal(f.context.lastScroll.behavior,'instant');});

test('Search menu has its own non-anchor route without a News back button',()=>{const f=fixture();assert.deepEqual(f.go('#find'),['cards-view']);assert.equal(f.title.textContent,'Search');assert.equal(f.back.hidden,true);assert.ok(html.includes('href="#find" data-view="search"'));assert.ok(!html.includes('id="find"'));});
test('four mobile tabs retain flexible accessible targets and exact order',()=>{const css=fs.readFileSync(new URL('./style.css',import.meta.url),'utf8');const nav=html.slice(html.indexOf('<nav '),html.indexOf('</nav>'));assert.deepEqual([...nav.matchAll(/data-view="([^"]+)"/g)].map(m=>m[1]),['calendar','favorites','search','changes']);assert.match(css,/nav a\{flex:1;[^}]*min-width:0;min-height:51px/);assert.ok((320-28-16-2-6)/4>=44);});

test('opening Search exposes the input at the top, and legacy links can switch to the normal Search tab',()=>{
 const f=fixture();f.go('#calendar');f.go('#find');assert.equal(f.context.lastScroll.top,0);
 f.go('#watch');assert.equal(f.back.hidden,false);
 const count=f.context.scrollCount;
 let prevented=false;
 f.context.event={currentTarget:f.links.find(l=>l.dataset.view==='search'),button:0,preventDefault(){prevented=true;}};
 vm.runInContext('preventActiveTabNavigation(event)',f.context);
 assert.equal(prevented,false);
 f.go('#find');assert.equal(f.back.hidden,true);assert.equal(f.context.scrollCount,count+1);
});

test('mobile navigation stretches the decorative background in both directions only on route change',()=>{
 const f=fixture(),nav={dataset:{}},lookup=f.context.$;
 f.context.$=s=>s==='.sidebar nav'?nav:lookup(s);
 f.go('#find');assert.equal(nav.dataset.slide,'right');
 f.go('#favorites');assert.equal(nav.dataset.slide,'left');
 f.go('#favorites');assert.equal(nav.dataset.slide,'left');
 f.go('#changes');assert.equal(nav.dataset.slide,'right');
 const css=fs.readFileSync(new URL('./style.css',import.meta.url),'utf8');
 assert.match(css,/\.sidebar nav\[data-slide=left\]\{--nav-left-ease:var\(--nav-lead\);--nav-right-ease:var\(--nav-tail\)/);
 assert.match(css,/\.sidebar nav:has\(a\.active\)::before\{[^}]*pointer-events:none[^}]*transition:left 330ms[^}]*right 330ms/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)\{\.sidebar nav:has\(a\.active\)::before\{transition:none/);
});

test('screen headings cannot be accidentally selected without blocking search or event content',()=>{
 const css=fs.readFileSync(new URL('./style.css',import.meta.url),'utf8');
 assert.match(css,/#view-title\{-webkit-user-select:none;user-select:none\}/);
 assert.doesNotMatch(css,/(?:#search|#detail-content)[^{}]*\{[^}]*user-select:none/);
});
