import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the actual app functions and click handlers without browser dependencies.
// These are DOM/state regression checks, not a substitute for iPhone device testing.
const source=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
const html=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');
const features=fs.readFileSync(new URL('./feature-core.js',import.meta.url),'utf8');
const artistConfig=fs.readFileSync(new URL('./artist-config.js',import.meta.url),'utf8');

class Element {
 constructor(tag='div',text=''){
  this.tagName=tag.toUpperCase();this.children=[];this.parentElement=null;this.attributes={};this.dataset={};this._text=String(text);this.className='';this.value='';this.hidden=false;this.open=false;
  const styles=new Map();this.style={setProperty:(k,v)=>styles.set(k,String(v)),getPropertyValue:k=>styles.get(k)||'',getPropertyPriority:()=>'',removeProperty:k=>styles.delete(k)};
  this.classList={contains:k=>this.className.split(/\s+/).includes(k),add:(...keys)=>{this.className=[...new Set([...this.className.split(/\s+/).filter(Boolean),...keys])].join(' ');},remove:(...keys)=>{this.className=this.className.split(/\s+/).filter(k=>!keys.includes(k)).join(' ');},toggle:(key,on)=>{const active=on??!this.classList.contains(key);active?this.classList.add(key):this.classList.remove(key);return active;}};
 }
 get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
 set textContent(value){this._text=String(value??'');this.children=[];}
 append(...nodes){for(const node of nodes){const child=typeof node==='string'?new Element('#text',node):node;if(child.parentElement)child.parentElement.children=child.parentElement.children.filter(c=>c!==child);child.parentElement=this;this.children.push(child);}}
 replaceChildren(...nodes){this.children=[];this._text='';this.append(...nodes);}
 setAttribute(key,value){this.attributes[key]=String(value);if(key==='class')this.className=String(value);if(key==='id')this.id=String(value);if(key==='href')this.href=String(value);if(key==='value')this.value=String(value);if(key==='hidden')this.hidden=true;if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=String(value);}
 getAttribute(key){if(key==='class')return this.className;return this.attributes[key]??null;}
 removeAttribute(key){delete this.attributes[key];}
 matches(selector){
  return selector.split(',').some(part=>{
   let rest=part.trim();const attrs=[...rest.matchAll(/\[([^\]=]+)(?:=["']?([^\]"']+)["']?)?\]/g)];rest=rest.replace(/\[[^\]]+\]/g,'');
   if(attrs.some(([,k,v])=>this.getAttribute(k)===null||(v!==undefined&&this.getAttribute(k)!==v)))return false;
   const id=rest.match(/#([\w-]+)/);if(id&&this.id!==id[1])return false;
   if([...rest.matchAll(/\.([\w-]+)/g)].some(([,c])=>!this.classList.contains(c)))return false;
   const tag=rest.match(/^[\w-]+/);return !tag||this.tagName===tag[0].toUpperCase();
  });
 }
 querySelectorAll(selector){const parts=selector.trim().split(/\s+/),result=[];const visit=node=>{for(const child of node.children){if(child.matches(parts.at(-1))){let ancestor=child.parentElement,index=parts.length-2;while(index>=0&&ancestor){if(ancestor.matches(parts[index]))index--;ancestor=ancestor.parentElement;}if(index<0)result.push(child);}visit(child);}};visit(this);return result;}
 querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
 closest(selector){for(let element=this;element;element=element.parentElement)if(element.matches(selector))return element;return null;}
 addEventListener(type,listener){this.listeners??={};(this.listeners[type]??=[]).push(listener);}
 focus(){this.focused=true;}
 click(){const event={target:this,currentTarget:this,stopped:false,stopPropagation(){this.stopped=true;},preventDefault(){this.defaultPrevented=true;}};for(let node=this;node;node=node.parentElement){event.currentTarget=node;node.onclick?.(event);for(const listener of node.listeners?.click||[])listener(event);if(event.stopped)break;}return event;}
 showModal(){this.open=true;}
 close(){this.open=false;}
}
function parseDocument(markup){
 const root=new Element('document'),stack=[root],voids=new Set(['meta','link','input','br','hr','img']);
 for(const token of markup.matchAll(/<!--[\s\S]*?-->|<![^>]*>|<\/?[^>]+>|[^<]+/g)){
  const value=token[0];if(value.startsWith('<!'))continue;
  if(value.startsWith('</')){const tag=value.match(/^<\/([^\s>]+)/)[1].toUpperCase();while(stack.length>1){const item=stack.pop();if(item.tagName===tag)break;}continue;}
  if(value.startsWith('<')){const match=value.match(/^<([^\s/>]+)([\s\S]*?)\/?\s*>$/);if(!match)continue;const node=new Element(match[1]);for(const attr of match[2].matchAll(/([^\s=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))node.setAttribute(attr[1],attr[2]??attr[3]??attr[4]??'');stack.at(-1).append(node);if(!voids.has(match[1].toLowerCase()))stack.push(node);}
  else stack.at(-1).append(new Element('#text',value));
 }
 root.createElement=tag=>new Element(tag);root.createElementNS=(_,tag)=>new Element(tag);root.createTextNode=text=>new Element('#text',text);root.getElementById=id=>root.querySelector('#'+id);root.body=root.querySelector('body');root.documentElement=root.querySelector('html');root.documentElement.clientWidth=390;return root;
}
function fixture({events=[],now='2026-11-12T03:00:00Z'}={}){
 const document=parseDocument(html),saved=new Map(),session=new Map();
 const storage=data=>({getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,String(v)),removeItem:k=>data.delete(k)});
 class Clock extends Date{constructor(...args){super(...(args.length?args:[now]));}static now(){return new Date(now).getTime();}}
 const context={document,Date:Clock,Intl,URL,Blob,console,location:{hash:'#calendar'},navigator:{},localStorage:storage(saved),sessionStorage:storage(session),setTimeout:()=>1,clearTimeout(){},getComputedStyle:()=>({paddingRight:'0px'}),window:{scrollX:0,scrollY:0,innerWidth:390,scrollTo(){},addEventListener(){}},AlertCalendarSubscriptions:{ARTISTS:['tokisen','re-ge']}};
 vm.createContext(context);vm.runInContext(features,context);vm.runInContext(artistConfig,context);
 // Register actual UI handlers, but do not fetch production data or register a worker.
 const beforeStartup=source.slice(0,source.indexOf("window.addEventListener('hashchange',route);"));
 assert.ok(beforeStartup.length>source.length/2,'locate the app startup boundary');
 vm.runInContext(beforeStartup,context);
 const run=code=>vm.runInContext(code,context),get=id=>document.getElementById(id);
 for(const input of document.querySelectorAll('input[type="search"]'))input.value='';
 for(const select of document.querySelectorAll('select'))select.value=select.querySelector('option')?.value||'';
 context.fixtureEvents=events;run("state={events:fixtureEvents,changes:[],sources:[],outboxCount:0,generatedAt:'2026-11-12T03:00:00Z'};render();route();");
 return {run,get,document,saved,context,titles:(id='agenda')=>get(id).querySelectorAll('.event-card h3').map(e=>e.textContent)};
}
function event(id,start,extra={}){return {id,source:'test',artistId:'tokisen',title:id,start,end:null,status:'confirmed',category:'LIVE',location:'会場',present:true,allDay:typeof start==='string'&&start.length===10,...extra};}

const bounds=f=>JSON.parse(f.run('JSON.stringify(agendaBounds())'));
const weekButton=(f,start)=>f.get('calendar').querySelectorAll('.week-select').find(b=>b.dataset.weekStart===start);
const dateButton=(f,date)=>f.get('calendar').querySelectorAll('.day-cell').find(d=>d.dataset.date===date)?.querySelector('.date-button');

test('initial monthly calendar shows only today cards, with no next-event fallback',()=>{
 const f=fixture({events:[event('yesterday','2026-11-11'),event('today','2026-11-12'),event('tomorrow','2026-11-13')]});
 assert.equal(f.run('agendaRange'),'day');assert.deepEqual(bounds(f),{start:'2026-11-12',end:'2026-11-13'});assert.deepEqual(f.titles(),['today']);assert.equal(f.get('agenda-title').textContent,'この日の予定');assert.ok(f.get('calendar').classList.contains('month-grid'));
 const empty=fixture({events:[event('tomorrow','2026-11-13')]});assert.deepEqual(empty.titles(),[]);assert.match(empty.get('agenda').textContent,/該当する予定はありません/);assert.equal(empty.get('agenda-title').textContent,'この日の予定');
});
test('today is computed in Japan rather than the UTC date',()=>{
 const f=fixture({now:'2026-11-11T15:01:00Z',events:[event('JST today','2026-11-12'),event('UTC yesterday','2026-11-11')]});assert.equal(f.run('selectedDate'),'2026-11-12');assert.deepEqual(f.titles(),['JST today']);
});
test('every month row begins with a labeled Sunday-to-Saturday week button',()=>{
 const f=fixture();assert.deepEqual(f.get('calendar').querySelectorAll('.weekday').map(e=>e.textContent),['日','月','火','水','木','金','土']);
 const starts=f.get('calendar').querySelectorAll('.week-select').map(b=>b.dataset.weekStart);assert.deepEqual(starts,['2026-11-01','2026-11-08','2026-11-15','2026-11-22','2026-11-29']);
 for(const b of f.get('calendar').querySelectorAll('.week-select')){assert.equal(b.type,'button');assert.match(b.getAttribute('aria-label'),/の週を選択$/);assert.equal(b.getAttribute('aria-pressed'),'false');const siblings=b.parentElement.children,index=siblings.indexOf(b);assert.deepEqual(siblings.slice(index+1,index+8).map(d=>d.dataset.date),Array.from({length:7},(_,i)=>f.run(`addDays('${b.dataset.weekStart}',${i})`)));}
});
test('week click selects the full row across a month boundary without switching the calendar',()=>{
 const f=fixture({events:[event('before','2026-11-28'),event('Sunday','2026-11-29'),event('December','2026-12-02'),event('Saturday','2026-12-05'),event('after','2026-12-06')]});
 weekButton(f,'2026-11-29').click();assert.equal(f.run('agendaRange'),'week');assert.equal(f.run('period'),'2026-11-01');assert.deepEqual(bounds(f),{start:'2026-11-29',end:'2026-12-06'});assert.deepEqual(f.titles(),['Sunday','December','Saturday']);assert.equal(f.get('agenda-title').textContent,'この週の予定');assert.equal(f.get('calendar').querySelectorAll('.range-selected').length,7);assert.equal(weekButton(f,'2026-11-29').getAttribute('aria-pressed'),'true');assert.ok(f.get('calendar').classList.contains('month-grid'));
 weekButton(f,'2026-11-29').click();assert.deepEqual(bounds(f),{start:'2026-11-29',end:'2026-12-06'});
});
test('calendar surface and date clicks select month cards rather than day cards',()=>{
 const f=fixture({events:[event('early','2026-11-01'),event('today','2026-11-12'),event('late','2026-11-30'),event('December','2026-12-01')]});
 f.get('month-label').click();assert.equal(f.run('agendaRange'),'month');assert.deepEqual(f.titles(),['early','today','late']);assert.equal(f.get('agenda-title').textContent,'この月の予定');
 weekButton(f,'2026-11-08').click();dateButton(f,'2026-11-12').click();assert.equal(f.run('agendaRange'),'month');assert.deepEqual(f.titles(),['early','today','late']);assert.equal(f.run('selectedWeekStart'),null);
 dateButton(f,'2026-12-01').click();assert.equal(f.run('period'),'2026-12-01');assert.deepEqual(f.titles(),['December']);
});
test('clicking a calendar event selects the month without opening the detail dialog',()=>{
 const f=fixture({events:[event('early','2026-11-01'),event('today','2026-11-12')]});f.get('calendar').querySelector('.calendar-event').click();assert.equal(f.run('agendaRange'),'month');assert.deepEqual(f.titles(),['early','today']);assert.equal(f.get('detail').open,false);
});
test('month arrows switch month card ranges across years and repeated navigation',()=>{
 const f=fixture({events:[event('January','2027-01-01'),event('December','2026-12-31')]});f.run("selectDay('2026-12-31')");f.get('next-period').click();assert.deepEqual(bounds(f),{start:'2027-01-01',end:'2027-02-01'});assert.deepEqual(f.titles(),['January']);assert.equal(f.run('selectedWeekStart'),null);
 f.get('prev-period').click();assert.deepEqual(bounds(f),{start:'2026-12-01',end:'2027-01-01'});assert.deepEqual(f.titles(),['December']);f.get('prev-period').click();assert.deepEqual(bounds(f),{start:'2026-11-01',end:'2026-12-01'});
});
test('today button returns from another month and week to today cards only',()=>{
 const f=fixture({events:[event('today','2026-11-12'),event('tomorrow','2026-11-13'),event('January','2027-01-02')]});f.run("selectDay('2027-01-01');selectWeek('2026-12-27')");f.get('today').click();assert.deepEqual(bounds(f),{start:'2026-11-12',end:'2026-11-13'});assert.equal(f.run('period'),'2026-11-01');assert.equal(f.run('agendaRange'),'day');assert.equal(f.run('selectedWeekStart'),null);assert.deepEqual(f.titles(),['today']);f.get('today').click();assert.deepEqual(f.titles(),['today']);
});
test('week ranges include year boundaries and leap day; month grids handle six rows',()=>{
 const f=fixture();f.run("selectDay('2027-01-01');selectWeek('2026-12-27')");assert.deepEqual(bounds(f),{start:'2026-12-27',end:'2027-01-03'});
 f.run("selectDay('2028-02-01');selectWeek('2028-02-27')");assert.deepEqual(bounds(f),{start:'2028-02-27',end:'2028-03-05'});assert.equal(f.get('calendar').querySelectorAll('.range-selected').length,7);
 f.run("selectDay('2028-02-29')");assert.deepEqual(bounds(f),{start:'2028-02-01',end:'2028-03-01'});
 f.run("selectDay('2027-05-01')");assert.equal(f.get('calendar').querySelectorAll('.week-select').length,6);assert.equal(f.get('calendar').querySelectorAll('.day-cell').length,42);
});
test('range inclusion honors all-day exclusive ends and timed overlaps without duplicates',()=>{
 const f=fixture({events:[event('all-day span','2026-11-10',{end:'2026-11-14'}),event('exclusive past end','2026-11-10',{end:'2026-11-12'}),event('overnight','2026-11-11T23:30:00+09:00',{end:'2026-11-12T00:30:00+09:00',allDay:false}),event('exact midnight end','2026-11-11T23:30:00+09:00',{end:'2026-11-12T00:00:00+09:00',allDay:false}),event('unknown time','2026-11-12',{allDay:false})]});
 assert.deepEqual(f.titles(),['all-day span','overnight','unknown time']);weekButton(f,'2026-11-08').click();assert.equal(f.titles().filter(t=>t==='all-day span').length,1);
});
test('missing and cancelled events never leak into selected-range cards',()=>{
 const f=fixture({events:[event('confirmed','2026-11-12'),event('possible','2026-11-12',{status:'possible'}),event('cancelled','2026-11-12',{status:'cancelled'}),event('missing','2026-11-12',{present:false})]});assert.deepEqual(f.titles(),['confirmed','possible']);f.run('selectMonth()');assert.deepEqual(f.titles(),['confirmed','possible']);
});
test('undated items remain a separate initially closed section and never fill an empty day',()=>{
 const f=fixture({events:[event('undated',null),event('future','2026-11-13')]});assert.deepEqual(f.titles(),[]);assert.deepEqual(f.titles('undated'),['undated']);assert.equal(f.get('undated-section').hidden,false);assert.equal(f.get('undated-section').getAttribute('open'),null);assert.equal(f.get('undated-count').textContent,'1件');
 const empty=fixture();assert.equal(empty.get('undated-section').hidden,true);
});
test('agenda search, certainty and sort survive range changes independently of all-cards controls',()=>{
 const f=fixture({events:[event('Zeta match','2026-11-12',{status:'possible'}),event('Alpha match','2026-11-13',{status:'possible'}),event('Confirmed match','2026-11-12'),event('Other','2026-11-12',{status:'possible'})]});
 f.get('agenda-search').value='match';f.get('agenda-search').oninput();f.get('agenda-sort').value='title';f.get('agenda-sort').onchange();f.document.querySelector('[data-agenda-filter="possible"]').click();assert.deepEqual(f.titles(),['Zeta match']);
 weekButton(f,'2026-11-08').click();assert.deepEqual(f.titles(),['Alpha match','Zeta match']);f.get('month-label').click();assert.deepEqual(f.titles(),['Alpha match','Zeta match']);assert.equal(f.get('agenda-search').value,'match');assert.equal(f.get('agenda-sort').value,'title');assert.equal(f.run('agendaFilter'),'possible');assert.equal(f.run('filter'),'all');assert.equal(f.get('search').value,'');assert.equal(f.get('sort').value,'date');
 f.get('today').click();assert.deepEqual(f.titles(),['Zeta match']);
});
test('artist filtering preserves the selected range and applies to calendar and agenda',()=>{
 const f=fixture({events:[event('tokisen','2026-11-12'),event('re-ge','2026-11-13',{artistId:'re-ge'})]});weekButton(f,'2026-11-08').click();f.get('artist-filters').querySelectorAll('button').find(b=>b.textContent==='RE-GE').click();assert.equal(f.run('agendaRange'),'week');assert.deepEqual(bounds(f),{start:'2026-11-08',end:'2026-11-15'});assert.deepEqual(f.titles(),['re-ge']);assert.deepEqual(f.get('calendar').querySelectorAll('.calendar-event').map(b=>b.textContent),['re-ge']);
});
test('favorites can be toggled from range cards, persist, and remain available outside the range',()=>{
 const f=fixture({events:[event('today','2026-11-12'),event('future','2026-11-13')]});f.get('agenda').querySelector('.favorite-button').click();assert.deepEqual(JSON.parse(f.saved.get('alert-pwa-favorites-v1')),[JSON.stringify(['test','today'])]);assert.deepEqual(f.titles('favorites'),['today']);assert.equal(f.get('agenda').querySelector('.favorite-button').getAttribute('aria-pressed'),'true');assert.equal(f.get('detail').open,false);
 f.run("selectWeek('2026-11-15')");assert.deepEqual(f.titles(),[]);assert.deepEqual(f.titles('favorites'),['today']);f.get('favorites').querySelector('.favorite-button').click();assert.deepEqual(f.titles('favorites'),[]);
});
test('agenda favorite-first sorting rerenders immediately without changing selected week',()=>{
 const f=fixture({events:[event('earlier','2026-11-09'),event('later','2026-11-12')]});weekButton(f,'2026-11-08').click();f.get('agenda-sort').value='favorites';f.get('agenda-sort').onchange();f.get('agenda').querySelectorAll('.favorite-button')[1].click();assert.deepEqual(f.titles(),['later','earlier']);assert.equal(f.run('agendaRange'),'week');assert.equal(f.run('selectedWeekStart'),'2026-11-08');
});
test('agenda cards still open details and the subscription action retains artist selection',()=>{
 const f=fixture({events:[event('today','2026-11-12')]});f.get('agenda').querySelector('.card-open').click();assert.equal(f.get('detail').open,true);assert.match(f.get('detail-content').textContent,/today/);assert.equal(f.run('agendaRange'),'day');
 f.run('closeDialog();globalThis.subscriptionCalls=[];openSubscriptions=id=>subscriptionCalls.push(id)');f.get('agenda-subscriptions').click();assert.equal(f.context.subscriptionCalls.length,1);assert.equal(f.context.subscriptionCalls[0],undefined);f.run("artist='re-ge'");f.get('agenda-subscriptions').click();assert.equal(f.context.subscriptionCalls[1],'re-ge');
});
test('layout keeps month and cards together with exactly Schedule, Favorite and News navigation',()=>{
 const document=parseDocument(html),calendar=document.querySelector('.calendar-panel'),agenda=document.querySelector('.agenda-panel');assert.equal(document.querySelectorAll('[data-mode]').length,0);assert.equal(calendar.querySelectorAll('.card-legend').length,0);assert.equal(agenda.querySelectorAll('.card-legend').length,1);
 for(const id of ['agenda-search','agenda-sort','agenda-subscriptions','search','sort','cards-view','changes-view','favorites-view'])assert.ok(document.getElementById(id),id);
 const links=document.querySelectorAll('nav a');assert.deepEqual(links.map(a=>a.dataset.view),['calendar','favorites','changes']);for(const [index,label] of ['Schedule','Favorite','News'].entries())assert.ok(links[index].textContent.includes(label),label);
 assert.equal(document.getElementById('about-view'),null);assert.equal(document.querySelector('.header-actions a[href="#about"]'),null);assert.equal(document.querySelectorAll('.mobile-info').length,0);
 const css=fs.readFileSync(new URL('./style.css',import.meta.url),'utf8');assert.match(css,/\.calendar-layout\{grid-template-columns:minmax\(0,1fr\)\}/);assert.ok(!/nav a\[data-view=changes\]\s*\{display:none/.test(css),'News must not remain hidden by the earlier two-tab mobile rule');
});
test('News retains change history, update guidance, specifications and access to all schedules',()=>{
 const document=parseDocument(html),news=document.getElementById('changes-view');assert.ok(news.querySelector('#changes'));assert.ok(news.querySelector('#read-all'));assert.ok(news.querySelector('a[href="#cards"]'));
 for(const copy of ['アプリの更新','通知とリマインド','本体カレンダーへ','お気に入りと保存','情報源とアーティスト','実通知・自動監視は未接続','別端末との同期はありません','iPhone実機での購読・更新反映は未検証'])assert.ok(news.textContent.includes(copy),copy);
 for(const id of ['morning-time','storage-status','source-list'])assert.ok(news.querySelector('#'+id),id);
});
test('legacy information routes show News without losing the selected calendar range',()=>{
 const f=fixture({events:[event('today','2026-11-12')]});weekButton(f,'2026-11-08').click();
 for(const hash of ['#about','#settings','#changes']){f.context.location.hash=hash;f.run('route()');assert.deepEqual(f.document.querySelectorAll('.view').filter(v=>!v.hidden).map(v=>v.id),['changes-view']);assert.equal(f.get('view-title').textContent,'News');assert.equal(f.run('agendaRange'),'week');assert.deepEqual(bounds(f),{start:'2026-11-08',end:'2026-11-15'});}
 f.context.location.hash='#calendar';f.run('route()');assert.deepEqual(f.document.querySelectorAll('.view').filter(v=>!v.hidden).map(v=>v.id),['calendar-view']);assert.equal(f.get('view-title').textContent,'Schedule');assert.deepEqual(f.titles(),['today']);
});
test('event names in an adjacent-month cell select that cell month just like its date button',()=>{
 const f=fixture({events:[event('November','2026-11-12'),event('December','2026-12-01')]});
 const outside=f.get('calendar').querySelectorAll('.day-cell').find(d=>d.dataset.date==='2026-12-01');assert.ok(outside.classList.contains('outside'));outside.querySelector('.calendar-event').click();assert.equal(f.run('period'),'2026-12-01');assert.equal(f.run('agendaRange'),'month');assert.deepEqual(f.titles(),['December']);assert.equal(f.get('detail').open,false);
});
