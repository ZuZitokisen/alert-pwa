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
 assert.equal(f.run('agendaRange'),'day');assert.deepEqual(bounds(f),{start:'2026-11-12',end:'2026-11-13'});assert.deepEqual(f.titles(),['today']);assert.equal(f.get('agenda-title').textContent,'11月12日(木)');assert.ok(f.get('calendar').classList.contains('month-grid'));
 const empty=fixture({events:[event('tomorrow','2026-11-13')]});assert.deepEqual(empty.titles(),[]);assert.match(empty.get('agenda').textContent,/該当する予定はありません/);assert.equal(empty.get('agenda-title').textContent,'11月12日(木)');
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
 weekButton(f,'2026-11-29').click();assert.equal(f.run('agendaRange'),'week');assert.equal(f.run('period'),'2026-11-01');assert.deepEqual(bounds(f),{start:'2026-11-29',end:'2026-12-06'});assert.deepEqual(f.titles(),['Sunday','December','Saturday']);assert.equal(f.get('agenda-title').textContent,'11月29日(日) 〜 12月5日(土)');assert.equal(f.get('calendar').querySelectorAll('.range-selected').length,7);assert.equal(weekButton(f,'2026-11-29').getAttribute('aria-pressed'),'true');assert.ok(f.get('calendar').classList.contains('month-grid'));
 weekButton(f,'2026-11-29').click();assert.deepEqual(bounds(f),{start:'2026-11-29',end:'2026-12-06'});
});
test('month heading selects month while date clicks select only that day',()=>{
 const f=fixture({events:[event('early','2026-11-01'),event('today','2026-11-12'),event('late','2026-11-30'),event('December','2026-12-01')]});
 assert.equal(f.get('month-label').tagName.toLowerCase(),'button');assert.equal(f.get('month-label').getAttribute('aria-pressed'),'false');f.get('month-label').click();assert.equal(f.get('month-label').getAttribute('aria-pressed'),'true');assert.equal(f.run('agendaRange'),'month');assert.deepEqual(f.titles(),['early','today','late']);assert.equal(f.get('agenda-title').textContent,'2026年11月の予定');
 weekButton(f,'2026-11-08').click();dateButton(f,'2026-11-12').click();assert.equal(f.run('agendaRange'),'day');assert.deepEqual(f.titles(),['today']);assert.equal(f.run('selectedWeekStart'),null);
 dateButton(f,'2026-12-01').click();assert.equal(f.run('period'),'2026-12-01');assert.deepEqual(f.titles(),['December']);
});
test('clicking a calendar event selects its day without opening the detail dialog',()=>{
 const f=fixture({events:[event('early','2026-11-01'),event('today','2026-11-12')]});f.get('calendar').querySelector('.calendar-event').click();assert.equal(f.run('agendaRange'),'day');assert.deepEqual(f.titles(),['early']);assert.equal(f.get('detail').open,false);
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
 f.run("selectDay('2028-02-29')");assert.deepEqual(bounds(f),{start:'2028-02-29',end:'2028-03-01'});
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
 for(const copy of ['アプリの更新','通知とリマインド','本体カレンダーへ','お気に入りと保存','情報源とアーティスト','通知は試走中です','別端末との同期はありません','iPhone実機での購読・更新反映は未検証'])assert.ok(news.textContent.includes(copy),copy);
 for(const id of ['push-settings','storage-status','source-list'])assert.ok(news.querySelector('#'+id),id);
});
test('legacy information routes show News without losing the selected calendar range',()=>{
 const f=fixture({events:[event('today','2026-11-12')]});weekButton(f,'2026-11-08').click();
 for(const hash of ['#about','#settings','#changes']){f.context.location.hash=hash;f.run('route()');assert.deepEqual(f.document.querySelectorAll('.view').filter(v=>!v.hidden).map(v=>v.id),['changes-view']);assert.equal(f.get('view-title').textContent,'News');assert.equal(f.run('agendaRange'),'week');assert.deepEqual(bounds(f),{start:'2026-11-08',end:'2026-11-15'});}
 f.context.location.hash='#calendar';f.run('route()');assert.deepEqual(f.document.querySelectorAll('.view').filter(v=>!v.hidden).map(v=>v.id),['calendar-view']);assert.equal(f.get('view-title').textContent,'Schedule');assert.deepEqual(f.titles(),['today']);
});
test('event names in an adjacent-month cell select that cell month just like its date button',()=>{
 const f=fixture({events:[event('November','2026-11-12'),event('December','2026-12-01')]});
 const outside=f.get('calendar').querySelectorAll('.day-cell').find(d=>d.dataset.date==='2026-12-01');assert.ok(outside.classList.contains('outside'));outside.querySelector('.calendar-event').click();assert.equal(f.run('period'),'2026-12-01');assert.equal(f.run('agendaRange'),'day');assert.deepEqual(f.titles(),['December']);assert.equal(f.get('detail').open,false);
});

test('consecutive date, cell whitespace and dots clicks preserve day selection, including empty days',()=>{
 const f=fixture({events:[event('today','2026-11-12'),event('tomorrow','2026-11-13')]});
 for(const day of ['2026-11-13','2026-11-12','2026-11-13']){
  dateButton(f,day).click();assert.equal(f.run('agendaRange'),'day');assert.deepEqual(bounds(f),{start:day,end:f.run(`addDays('${day}',1)`)});
  assert.equal(f.get('calendar').querySelectorAll('.range-selected').length,1);
 }
 f.get('calendar').querySelectorAll('.day-cell').find(d=>d.dataset.date==='2026-11-12').querySelector('.event-dots').click();assert.deepEqual(f.titles(),['today']);
 f.get('calendar').querySelectorAll('.day-cell').find(d=>d.dataset.date==='2026-11-14').click();assert.deepEqual(f.titles(),[]);assert.equal(f.run('agendaRange'),'day');
 f.get('month-label').click();assert.deepEqual(f.titles(),['today','tomorrow']);assert.equal(f.run('agendaRange'),'month');
});
test('week controls keep their full hit target but no tile in either state',()=>{
 const css=fs.readFileSync(new URL('./style.css',import.meta.url),'utf8');
 assert.match(css,/\.week-select\{[^}]*min-width:44px;min-height:44px/);
 assert.match(css,/\.week-select\{[^}]*border:0;border-radius:0;box-shadow:none;background:transparent/);
 assert.match(css,/\.week-select\[aria-pressed=true\]\{background:transparent;color:var\(--accent\)\}/);
});

// Artist selector preview: visual surfaces change, existing selection semantics do not.
test('artist first paint contains native named controls and final decorative SVGs before JavaScript',()=>{
 const doc=parseDocument(html),group=doc.getElementById('artist-filters'),buttons=group.querySelectorAll('button');
 assert.equal(group.getAttribute('role'),'group');assert.equal(group.getAttribute('data-all-selected'),'true');
 assert.deepEqual(buttons.map(b=>b.getAttribute('data-artist')),['all','tokisen','re-ge','straightangeli','oneloveoneheart']);
 assert.deepEqual(buttons.map(b=>b.getAttribute('aria-label')),['すべてのアーティスト','超ときめき♡宣伝部','RE-GE','Straight Angeli','ONE LOVE ONE HEART']);
 assert.deepEqual(buttons.map(b=>b.getAttribute('aria-pressed')),['true','false','false','false','false']);
 assert.equal(buttons[0].querySelector('.artist-label').textContent,'ALL');
 assert.equal(buttons[1].querySelector('svg').getAttribute('data-artist-symbol'),'megaphone');
 assert.equal(buttons[3].querySelector('svg').getAttribute('data-artist-symbol'),'wings');
 assert.equal(buttons[4].querySelector('svg').getAttribute('data-artist-symbol'),'heart');
 assert.equal(buttons[2].querySelector('svg'),null);
 for(const button of buttons){assert.equal(button.getAttribute('type'),'button');assert.ok(button.querySelector('.artist-face'));assert.equal(button.querySelectorAll('.nav-count').length,0);}
 for(const svg of group.querySelectorAll('svg')){assert.equal(svg.getAttribute('aria-hidden'),'true');assert.equal(svg.getAttribute('focusable'),'false');}
});
test('artist renders reuse controls, toggle multiple choices and reset with ALL',()=>{
 const f=fixture(),group=f.get('artist-filters'),buttons=group.querySelectorAll('button'),faces=buttons.map(b=>b.querySelector('.artist-face'));
 const selected=new Set();
 for(const index of [1,2,3,4,2,1,3,1,3,4,0,0]){
  if(index===0)selected.clear();else if(selected.has(index))selected.delete(index);else selected.add(index);
  buttons[index].click();f.run('renderArtists();renderArtists()');
  assert.deepEqual(group.querySelectorAll('button'),buttons);assert.deepEqual(buttons.map(b=>b.querySelector('.artist-face')),faces);
  assert.deepEqual(buttons.map(b=>b.getAttribute('aria-pressed')),buttons.map((_,i)=>String(i===0?selected.size===0:selected.has(i))));
  assert.equal(group.getAttribute('data-all-selected'),String(selected.size===0));assert.equal(buttons[index].focused,true);
 }
});
test('artist choice and day clicks preserve exact filter, date range, route and event data',()=>{
 const events=['tokisen','re-ge','straightangeli'].flatMap(artistId=>['2026-11-12','2026-11-13'].map(start=>event(artistId+' '+start,start,{artistId}))),before=JSON.stringify(events),f=fixture({events}),group=f.get('artist-filters');
 for(const artistId of ['tokisen','re-ge','straightangeli']){
  group.querySelector('[data-artist="all"]').click();group.querySelector(`[data-artist="${artistId}"]`).click();dateButton(f,'2026-11-13').click();
  assert.deepEqual(f.titles(),[artistId+' 2026-11-13']);assert.equal(f.run('agendaRange'),'day');assert.equal(f.context.location.hash,'#calendar');
  assert.deepEqual(f.get('calendar').querySelectorAll('.calendar-event').map(b=>b.textContent),[artistId+' 2026-11-12',artistId+' 2026-11-13']);
 }
 group.querySelector('[data-artist="all"]').click();assert.equal(f.titles().length,3);assert.equal(f.run('selectedDate'),'2026-11-13');assert.equal(JSON.stringify(events),before);
});
test('artist choice does not erase favorites or alter the subscription preset passed to existing handler',()=>{
 const f=fixture({events:[event('keep favorite','2026-11-12')]}),group=f.get('artist-filters');
 f.get('agenda').querySelector('.favorite-button').click();const saved=f.saved.get('alert-pwa-favorites-v1');
 f.run('globalThis.subscriptionCalls=[];openSubscriptions=id=>subscriptionCalls.push(id)');
 for(const id of ['tokisen','re-ge','straightangeli','all']){group.querySelector('[data-artist="all"]').click();group.querySelector(`[data-artist="${id}"]`).click();f.get('agenda-subscriptions').click();assert.equal(f.saved.get('alert-pwa-favorites-v1'),saved);}
 assert.deepEqual(Array.from(f.context.subscriptionCalls),['tokisen','re-ge','straightangeli',undefined]);assert.deepEqual(f.titles('favorites'),['keep favorite']);
});
test('artist generated fallback matches static labels and paths without adding an RE-GE icon',()=>{
 const f=fixture(),group=f.get('artist-filters'),original=group.querySelectorAll('button'),svgPaths=original.map(b=>b.querySelectorAll('path').map(p=>p.getAttribute('d')));
 group.replaceChildren();f.run('renderArtists()');const next=group.querySelectorAll('button');
 assert.deepEqual(next.map(b=>b.textContent),original.map(b=>b.textContent));assert.deepEqual(next.map(b=>b.querySelectorAll('path').map(p=>p.getAttribute('d'))),svgPaths);assert.equal(next[2].querySelector('svg'),null);
});
test('artist motion affects only noninteractive surfaces, with reduced-motion and visible keyboard focus',()=>{
 const css=fs.readFileSync(new URL('./style.css',import.meta.url),'utf8');
 assert.match(css,/#artist-filters\.artist-pills\{[\s\S]*?grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
 assert.match(css,/#artist-filters::before\{[^}]*pointer-events:none/);assert.match(css,/#artist-filters \.artist-face\{[^}]*pointer-events:none/);
 assert.match(css,/#artist-filters>button\.artist-option\{[^}]*transform:none/);
 assert.match(css,/#artist-filters>button:focus-visible\{outline:3px/);
 assert.match(css,/@media\(prefers-reduced-motion:reduce\)\{#artist-filters::before,#artist-filters \.artist-face\{transition:none\}\}/);
});
function contrastRatio(a,b){const luminance=hex=>{const rgb=hex.match(/[a-f\d]{2}/gi).map(x=>parseInt(x,16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);}
test('selected orange gold and blue plus unselected foregrounds meet normal-text AA contrast',()=>{
 for(const color of ['f3aa59','e9cc73','78b9ee','f3f2f6','9cddd7'])assert.ok(contrastRatio(color,'202025')>=4.5,color);
 for(const color of ['925b2e','796228','356b95','62606a','255f65'])assert.ok(contrastRatio(color,'e9e9ed')>=4.5,color);
 for(const color of ['d29c6f','c2ad72','92b7d2','d4d1dc','a1c9c6'])assert.ok(contrastRatio(color,'39383f')>=4.5,color);
});
test('startup binds static artist controls before a pending or rejected first data request',async()=>{
 for(const fails of [false,true]){
  const f=fixture(),buttons=f.get('artist-filters').querySelectorAll('button');for(const b of buttons)b.onclick=null;
  f.context.scheduleRequest=()=>fails?Promise.reject(Error('offline')):new Promise(()=>{});
  const startup=source.slice(source.indexOf("window.addEventListener('hashchange',route);"));
  assert.ok(startup.indexOf('renderArtists();')<startup.indexOf('refresh({notice:'),'bind before awaiting data');f.run(startup);await Promise.resolve();await Promise.resolve();
  assert.equal(typeof buttons[2].onclick,'function');buttons[2].click();assert.equal(f.run('artist'),'re-ge');assert.equal(buttons[2].getAttribute('aria-pressed'),'true');
 }
});
test('icon-only artist controls hide only two captions while keeping accessible names and typographic marks',()=>{
 const css=fs.readFileSync(new URL('./style.css',import.meta.url),'utf8'),doc=parseDocument(html),group=doc.getElementById('artist-filters');
 const hideRule='#artist-filters [data-artist=tokisen] .artist-label,#artist-filters [data-artist=straightangeli] .artist-label{display:none}';assert.ok(css.includes(hideRule));
 for(const [id,name,symbol] of [['tokisen','超ときめき♡宣伝部','megaphone'],['straightangeli','Straight Angeli','wings']]){const button=group.querySelector(`[data-artist="${id}"]`);assert.equal(button.getAttribute('aria-label'),name);assert.equal(button.querySelector('svg').getAttribute('data-artist-symbol'),symbol);}
 assert.equal(group.querySelector('[data-artist="all"] .artist-label').textContent,'ALL');assert.equal(group.querySelector('[data-artist="re-ge"] .artist-label').textContent,'RE-GE');assert.equal(group.querySelector('[data-artist="re-ge"]').querySelector('svg'),null);
 assert.match(css,/#artist-filters \.artist-face\{[^}]*align-items:center;justify-content:center/);assert.match(css,/#artist-filters \.artist-symbol\{[^}]*width:24px;height:22px/);
});

test('multiple artist filtering is a union across calendar, agenda, favorites and news without mutating events',()=>{
 const ids=['tokisen','re-ge','straightangeli'],events=ids.map(artistId=>event(artistId,'2026-11-12',{artistId})),original=JSON.stringify(events),f=fixture({events}),group=f.get('artist-filters');
 f.run("favorites=new Set(state.events.map(e=>F.stableEventKey(e)));state.changes=state.events.map((e,i)=>({id:i+1,kind:'new',after:e,fields:[],detected:'2026-11-12T03:00:00Z'}))");
 for(const id of ['tokisen','straightangeli'])group.querySelector(`[data-artist="${id}"]`).click();
 assert.deepEqual(f.titles().sort(),['straightangeli','tokisen']);assert.deepEqual(f.titles('favorites').sort(),['straightangeli','tokisen']);
 assert.deepEqual(f.get('calendar').querySelectorAll('.calendar-event').map(b=>b.textContent).sort(),['straightangeli','tokisen']);
 assert.equal(f.get('changes').querySelectorAll('.event-card').length,2);
 group.querySelector('[data-artist="tokisen"]').click();assert.deepEqual(f.titles(),['straightangeli']);
 group.querySelector('[data-artist="straightangeli"]').click();assert.equal(f.titles().length,3);assert.equal(group.getAttribute('data-all-selected'),'true');
 assert.equal(JSON.stringify(events),original);
});

test('News reuses Schedule card structure, certainty border and source category projection',()=>{
 const e=event('news-card','2026-11-12',{status:'possible',category:'BENEFIT'}),f=fixture({events:[e]});f.context.news={kind:'updated',after:e,before:{...e,location:'旧会場'},fields:['location'],revision:2,detected:'2026-11-12T04:00:00Z'};f.run('state.changes=[news];renderChanges()');
 const n=f.get('changes').querySelector('.event-card'),s=f.get('agenda').querySelector('.event-card');assert.equal(n.tagName,'ARTICLE');assert.equal(n.className,s.className);assert.ok(n.classList.contains('possible'));for(const cls of ['category','artist-name','card-time','card-location'])assert.equal(n.querySelector('.'+cls).textContent,s.querySelector('.'+cls).textContent);assert.equal(n.querySelectorAll('button button').length,0);assert.equal(n.querySelectorAll('.favorite-button').length,1);assert.equal(n.querySelector('.card-bottom-note').textContent,'更新 · 場所変更');assert.ok(f.get('changes').classList.contains('cards'));
});
test('News favorite toggles shared identity without opening change details',()=>{
 const e=event('favorite-news','2026-11-12'),f=fixture({events:[e]});f.context.news={kind:'new',after:e,fields:[],revision:1,detected:'2026-11-12T04:00:00Z'};f.run('state.changes=[news];renderChanges()');const key=f.run('F.stableEventKey(fixtureEvents[0])');f.get('changes').querySelector('.favorite-button').click();assert.equal(f.get('detail').open,false);assert.ok(JSON.parse(f.saved.get('alert-pwa-favorites-v1')).includes(key));assert.equal(f.get('agenda').querySelector('.favorite-button').getAttribute('aria-pressed'),'true');assert.equal(f.get('changes').querySelector('.favorite-button').getAttribute('aria-pressed'),'true');f.get('changes').querySelector('.card-open').click();assert.equal(f.get('detail').open,true);assert.match(f.get('detail-content').textContent,/検知/);
});
test('News missing record retains previous facts and does not claim cancellation',()=>{
 const e=event('missing-news','2026-11-12'),f=fixture({events:[e]});f.context.news={kind:'unavailable',before:e,after:null,fields:[],revision:2,detected:'2026-11-12T04:00:00Z'};f.run('state.changes=[news];renderChanges()');const n=f.get('changes').querySelector('.event-card');assert.ok(n.classList.contains('missing'));assert.equal(n.classList.contains('cancelled'),false);assert.equal(n.querySelector('h3').textContent,e.title);assert.match(n.querySelector('.card-bottom-note').textContent,/中止とは判断していません/);assert.equal(f.context.news.before.present,true);n.querySelector('.card-open').click();assert.match(f.get('detail-content').textContent,/中止とは判断しません/);
});
test('v0.7.11 markup and worker asset versions match without touching push config',()=>{
 const sw=fs.readFileSync(new URL('./sw.js',import.meta.url),'utf8');assert.match(sw,/static-shell-v7-11/);for(const file of ['app.js','style.css','artist-config.js','schedule-store.js','calendar-subscriptions.js','pwa-update.js']){assert.ok(html.includes(file+'?v=0.7.11'));assert.ok(sw.includes(file+'?v=0.7.11'));}assert.ok(html.includes('v0.7.11'));assert.ok(html.includes('v0.7.9'));
});

test('News creation/missing captions avoid duplicates and time changes collapse',()=>{const e=event('compact-news','2026-11-12'),f=fixture({events:[e]});f.context.news={kind:'new',after:e,fields:['start','end','title'],revision:1,detected:'2026-11-12T04:00:00Z'};f.run('state.changes=[news];renderChanges()');assert.equal(f.get('changes').querySelector('.card-bottom-note').textContent,'新着');f.context.news.kind='updated';f.run('renderChanges()');assert.equal(f.get('changes').querySelector('.card-bottom-note').textContent,'更新 · 日時変更・タイトル変更');f.context.news.kind='unavailable';f.run('renderChanges()');assert.equal(f.get('changes').querySelector('.card-bottom-note').textContent,'中止とは判断していません');assert.equal((f.get('changes').textContent.match(/掲載消失/g)||[]).length,1);});
