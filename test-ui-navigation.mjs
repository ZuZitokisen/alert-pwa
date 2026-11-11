import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
const routeSource=source.slice(source.indexOf('function route(){'),source.indexOf("\n$('#morning-time').value"));
const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
function fixture(initialHash=''){
 const views=['calendar','cards','favorites','changes','about'].map(name=>({id:name+'-view',hidden:false}));
 const links=views.map(v=>({dataset:{view:v.id.replace('-view','')},attributes:{},classList:{toggle(){}},setAttribute(k,v){this.attributes[k]=v},removeAttribute(k){delete this.attributes[k]}}));
 const title={textContent:'',focus(){this.focused=(this.focused||0)+1}},back={hidden:true,href:'',attributes:{},setAttribute(k,v){this.attributes[k]=v}},detail={open:false};
 const context={location:{hash:initialHash},document:{querySelectorAll(s){return s==='.view'?views:links}},window:{scrollTo(){context.scrollCount++}},scrollCount:0,closeDialog(){detail.open=false;context.closed=(context.closed||0)+1},$:(s)=>({'#view-title':title,'#back-to-view':back,'#detail':detail}[s])};
 vm.createContext(context);vm.runInContext("let view='calendar',returnView='calendar';"+routeSource,context);
 function go(hash){context.location.hash=hash;vm.runInContext('route()',context);return views.filter(v=>!v.hidden).map(v=>v.id);}
 return {context,views,links,title,back,detail,go};
}
test('normal view does not show a back control',()=>{const f=fixture();assert.deepEqual(f.go('#calendar'),['calendar-view']);assert.equal(f.back.hidden,true);assert.equal(f.title.textContent,'カレンダー');});
test('information uses explanatory title and returns to calendar',()=>{const f=fixture();f.go('#calendar');assert.deepEqual(f.go('#about'),['about-view']);assert.equal(f.title.textContent,'説明');assert.equal(f.back.hidden,false);assert.equal(f.back.href,'#calendar');assert.equal(f.back.attributes['aria-label'],'カレンダーに戻る');assert.deepEqual(f.go(f.back.href),['calendar-view']);});
test('information returns to each prior app view',()=>{for(const route of ['cards','favorites','changes']){const f=fixture();f.go('#'+route);f.go('#about');assert.equal(f.back.href,'#'+route);assert.deepEqual(f.go(f.back.href),[route+'-view']);}});
test('repeated information route preserves return destination',()=>{const f=fixture();f.go('#cards');f.go('#about');f.go('#about');assert.equal(f.back.href,'#cards');});
test('direct about and legacy settings URLs have safe in-app return',()=>{for(const route of ['about','settings']){const f=fixture();assert.deepEqual(f.go('#'+route),['about-view']);assert.equal(f.back.href,'#calendar');assert.equal(f.back.hidden,false);assert.deepEqual(f.go(f.back.href),['calendar-view']);}});
test('unknown routes stay within app and old watch route remains valid',()=>{const f=fixture();assert.deepEqual(f.go('#unknown'),['calendar-view']);assert.deepEqual(f.go('#watch'),['cards-view']);});
test('entering and leaving information reveals heading and closes dialogs',()=>{const f=fixture();f.detail.open=true;f.go('#about');assert.equal(f.detail.open,false);assert.equal(f.context.closed,1);assert.equal(f.context.scrollCount,1);assert.equal(f.title.focused,1);f.go('#about');assert.equal(f.context.scrollCount,1);f.go('#calendar');assert.equal(f.context.scrollCount,2);});
test('accessible information icon is plain i, not settings gear',()=>{assert.match(html,/class="icon-button mobile-info information-icon" aria-label="このアプリについて">i<\/a>/);assert.ok(!html.includes('⚙'));assert.match(html,/id="back-to-view"[^>]+href="#calendar"[^>]+hidden/);assert.ok(!html.includes('配信環境の接続後に設定</button>'));});
test('card markup no longer generates redundant decorative color strips',()=>{assert.ok(!source.includes('card-colorbar'));});
test('primary calendar entry uses production presets rather than a file download',()=>{assert.match(source,/exportButton.onclick=\(\)=>openSubscriptions\(e.artistId\)/);assert.ok(!source.includes('購読先は準備中'));assert.match(html,/<div class="selection-toolbar" hidden>/);assert.ok(!source.includes('card(e,true)'));assert.ok(html.indexOf('calendar-subscriptions.js')<html.indexOf('app.js'));assert.match(source,/subscribe.href=urls.webcal/);assert.ok(source.includes('1種類ずつ追加してください'));});

const favoriteSource=source.slice(source.indexOf('function favoriteMark(active)'),source.indexOf('function favoriteButton(e)'));
for(const active of [false,true])test(`favorite icon uses accessible decorative SVG and ${active?'white saved':'black unsaved'} heart`,()=>{const context={document:{createElementNS(ns,tag){return {ns,tag,attributes:{},children:[],setAttribute(k,v){this.attributes[k]=v},append(...children){this.children.push(...children)}}}}};vm.createContext(context);vm.runInContext(favoriteSource,context);const icon=vm.runInContext(`favoriteMark(${active})`,context);assert.equal(icon.attributes['aria-hidden'],'true');assert.equal(icon.attributes.focusable,'false');assert.equal(icon.attributes.viewBox,'0 0 24 24');assert.equal(icon.children.length,1);const heart=icon.children[0];assert.equal(heart.tag,'path');assert.match(heart.attributes.d,/^M12 20\.5/);assert.equal(heart.attributes.fill,active?'#fff':'#222332');assert.equal(heart.attributes.stroke,'#222332');assert.equal(heart.attributes['stroke-width'],'1.4');});
test('favorite help describes hearts and their saved state',()=>{assert.ok(!source.includes('カードの星'));assert.ok(html.includes('黒いハートは未登録、白いハートは登録済みです。'));assert.ok(source.includes('お気に入りはまだありません。'));});
test('heart preserves white circle, card position and touch/icon geometry',()=>{const css=fs.readFileSync(new URL('./style.css',import.meta.url),'utf8');assert.match(css,/\.favorite-button\{position:relative;[^}]*width:44px;height:44px;[^}]*padding:7px/);assert.match(css,/\.favorite-button::before\{[^}]*inset:7px;[^}]*border-radius:50%;background:#fff\}/);assert.match(css,/\.favorite-button svg\{display:block;width:20px;height:20px\}/);assert.match(css,/\.event-card \.favorite-button\{position:absolute;right:4px;bottom:4px\}/);});

test('regular screens omit introductory copy and keep important guidance in information',()=>{
 const regular=html.slice(html.indexOf('<main>'),html.indexOf('<section id="about-view"'));
 for(const text of ['気になる、を集めよう','お気に入りはこの端末','予定を、カードで','新しい発表と、予定の変化','非公式の情報集約'])assert.ok(!regular.includes(text));
 const info=html.slice(html.indexOf('<section id="about-view"'));
 for(const text of ['非公式の情報集約','アプリの更新','黒いハートは未登録','別端末との同期はありません','自動監視は未稼働'])assert.ok(info.includes(text));
 assert.ok(source.includes('通知は予約・配信されません。'));assert.ok(html.includes('更新間隔は端末側に依存'));
});
