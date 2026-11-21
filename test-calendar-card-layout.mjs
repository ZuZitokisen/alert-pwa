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
 const context={document,Date:Clock,Intl,URL,Blob,console,location:{hash:'#calendar'},navigator:{},localStorage:storage(saved),sessionStorage:storage(session),setTimeout:()=>1,setInterval:()=>1,clearTimeout(){},getComputedStyle:()=>({paddingRight:'0px'}),window:{scrollX:0,scrollY:0,innerWidth:390,scrollTo(){},addEventListener(){}},AlertCalendarSubscriptions:{ARTISTS:['tokisen','re-ge']}};
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
 assert.equal(f.run('agendaRange'),'day');assert.deepEqual(bounds(f),{start:'2026-11-12',end:'2026-11-13'});assert.deepEqual(f.titles(),['today']);assert.equal(f.get('agenda-title').textContent,'2026.11.12');assert.ok(f.get('calendar').classList.contains('month-grid'));
 const empty=fixture({events:[event('tomorrow','2026-11-13')]});assert.deepEqual(empty.titles(),[]);assert.match(empty.get('agenda').textContent,/該当する予定はありません/);assert.equal(empty.get('agenda-title').textContent,'2026.11.12');
});
test('today is computed in Japan rather than the UTC date',()=>{
 const f=fixture({now:'2026-11-11T15:01:00Z',events:[event('JST today','2026-11-12'),event('UTC yesterday','2026-11-11')]});assert.equal(f.run('selectedDate'),'2026-11-12');assert.deepEqual(f.titles(),['JST today']);
});
test('every month row begins with a labeled Sunday-to-Saturday week button',()=>{
 const f=fixture();assert.deepEqual(f.get('calendar').querySelectorAll('.weekday').map(e=>e.textContent),['Sun','Mon','Tue','Wed','Thu','Fri','Sat']);
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
 assert.equal(f.get('month-label').tagName.toLowerCase(),'button');assert.equal(f.get('month-label').children[0].textContent,'11');assert.equal(f.get('month-label').querySelector('.month-en').textContent,'November');assert.equal(f.get('month-label').querySelector('.month-en').lang,'en');assert.equal(f.get('month-label').getAttribute('aria-label'),'2026年11月の予定を選択');assert.equal(f.get('month-label').getAttribute('aria-pressed'),'false');f.get('month-label').click();assert.equal(f.get('month-label').getAttribute('aria-pressed'),'true');assert.equal(f.run('agendaRange'),'month');assert.deepEqual(f.titles(),['early','today','late']);assert.equal(f.get('agenda-title').textContent,'2026.11');
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
test('Schedule certainty and sort survive ranges independently of Search query',()=>{
 const f=fixture({events:[event('Zeta','2026-11-12',{status:'possible'}),event('Alpha','2026-11-13',{status:'possible'}),event('Confirmed','2026-11-12')]});
 f.get('search').value='Zeta';f.get('search').oninput();f.get('agenda-sort').value='title';f.document.querySelector('[data-agenda-filter="possible"]').click();
 weekButton(f,'2026-11-08').click();assert.deepEqual(f.titles(),['Alpha','Zeta']);assert.deepEqual(f.titles('cards'),['Zeta']);f.get('month-label').click();assert.equal(f.get('search').value,'Zeta');assert.equal(f.document.getElementById('agenda-search'),null);
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
 f.run('closeDialog();globalThis.subscriptionCalls=[];openSubscriptions=id=>subscriptionCalls.push(id)');f.get('calendar-share').click();assert.equal(f.context.subscriptionCalls.length,1);assert.equal(f.context.subscriptionCalls[0],undefined);f.run("artist='re-ge'");f.get('calendar-share').click();assert.equal(f.context.subscriptionCalls[1],'re-ge');
});
test('layout keeps month and cards together with exactly Schedule, Favorite and News navigation',()=>{
 const document=parseDocument(html),calendar=document.querySelector('.calendar-panel'),agenda=document.querySelector('.agenda-panel');assert.equal(document.querySelectorAll('[data-mode]').length,0);assert.equal(calendar.querySelectorAll('.card-legend').length,0);assert.equal(agenda.querySelectorAll('.card-legend').length,0);assert.equal(document.querySelectorAll('.card-legend').length,0);
 for(const id of ['agenda-sort','calendar-share','search','sort','cards-view','changes-view','favorites-view'])assert.ok(document.getElementById(id),id);
 const links=document.querySelectorAll('nav a');assert.deepEqual(links.map(a=>a.dataset.view),['calendar','favorites','search','changes']);for(const [index,label] of ['Schedule','Favorite','Search','News'].entries())assert.ok(links[index].textContent.includes(label),label);
 assert.equal(document.getElementById('about-view'),null);assert.equal(document.querySelector('.header-actions a[href="#about"]'),null);assert.equal(document.querySelectorAll('.mobile-info').length,0);
 const css=fs.readFileSync(new URL('./style.css',import.meta.url),'utf8');assert.match(css,/\.calendar-layout\{grid-template-columns:minmax\(0,1fr\)\}/);assert.ok(!/nav a\[data-view=changes\]\s*\{display:none/.test(css),'News must not remain hidden by the earlier two-tab mobile rule');
});
test('News retains change history, update guidance, specifications and access to all schedules',()=>{
 const document=parseDocument(html),news=document.getElementById('changes-view');assert.ok(news.querySelector('#changes'));assert.ok(news.querySelector('#read-all'));assert.ok(news.querySelector('a[href="#cards"]'));
 for(const copy of ['アプリの更新','通知設定','本体カレンダーへ','お気に入りと保存','情報源とアーティスト','通知は試走中です','別端末との同期はありません','iPhone実機での登録・更新反映は未検証'])assert.ok(news.textContent.includes(copy),copy);
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
test('week controls and selected date cells have rounded corners without shrinking targets',()=>{
 const css=fs.readFileSync(new URL('./style.css',import.meta.url),'utf8');
 assert.match(css,/\.week-select\{[^}]*min-width:44px;min-height:44px/);
 assert.match(css,/\.week-select\{[^}]*border:0;border-radius:10px;box-shadow:none;background:transparent/);
 assert.match(css,/\.week-select\[aria-pressed=true\]\{background:color-mix\([^}]+color:var\(--accent\)\}/);
 assert.match(css,/\.day-cell\.range-selected\{border-radius:10px/);
});

// Artist selector preview: visual surfaces change, existing selection semantics do not.
test('artist first paint contains native named controls and final decorative SVGs before JavaScript',()=>{
 const doc=parseDocument(html),group=doc.getElementById('artist-filters'),buttons=group.querySelectorAll('button');
 assert.equal(group.getAttribute('role'),'group');assert.equal(group.getAttribute('data-all-selected'),'true');
 assert.deepEqual(buttons.map(b=>b.getAttribute('data-artist')),['all','ebichu','tokisen','tohokusan','oneloveoneheart','straightangeli','re-ge']);
 assert.deepEqual(buttons.map(b=>b.getAttribute('aria-label')),['すべてのアーティスト','私立恵比寿中学','超ときめき♡宣伝部','いぎなり東北産','ONE LOVE ONE HEART','Straight Angeli','RE-GE']);
 assert.deepEqual(buttons.map(b=>b.getAttribute('aria-pressed')),['true','false','false','false','false','false','false']);
 assert.equal(buttons[0].querySelector('.artist-label').textContent,'ALL');
 assert.equal(buttons[1].querySelector('svg').getAttribute('data-artist-symbol'),'shrimp');
 assert.equal(buttons[2].querySelector('svg').getAttribute('data-artist-symbol'),'megaphone');
 assert.equal(buttons[5].querySelector('svg').getAttribute('data-artist-symbol'),'wings');
 assert.equal(buttons[4].querySelector('svg').getAttribute('data-artist-symbol'),'heart');
 assert.equal(buttons[6].querySelector('svg'),null);
 for(const button of buttons){assert.equal(button.getAttribute('type'),'button');assert.ok(button.querySelector('.artist-face'));assert.equal(button.querySelectorAll('.nav-count').length,0);}
 for(const svg of group.querySelectorAll('svg')){assert.equal(svg.getAttribute('aria-hidden'),'true');assert.equal(svg.getAttribute('focusable'),'false');}
});
test('artist renders reuse controls, toggle multiple choices and reset with ALL',()=>{
 const f=fixture(),group=f.get('artist-filters'),buttons=group.querySelectorAll('button'),faces=buttons.map(b=>b.querySelector('.artist-face'));
 const selected=new Set();
 for(const index of [1,2,3,4,5,6,2,1,3,5,1,3,4,6,0,0]){
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
 for(const id of ['tokisen','re-ge','straightangeli','all']){group.querySelector('[data-artist="all"]').click();group.querySelector(`[data-artist="${id}"]`).click();f.get('calendar-share').click();assert.equal(f.saved.get('alert-pwa-favorites-v1'),saved);}
 assert.deepEqual(Array.from(f.context.subscriptionCalls),['tokisen','re-ge','straightangeli',undefined]);assert.deepEqual(f.titles('favorites'),['keep favorite']);
});
test('artist generated fallback matches static labels and paths without adding an RE-GE icon',()=>{
 const f=fixture(),group=f.get('artist-filters'),original=group.querySelectorAll('button'),svgPaths=original.map(b=>b.querySelectorAll('path').map(p=>p.getAttribute('d')));
 group.replaceChildren();f.run('renderArtists()');const next=group.querySelectorAll('button');
 assert.deepEqual(next.map(b=>b.textContent),original.map(b=>b.textContent));assert.deepEqual(next.map(b=>b.querySelectorAll('path').map(p=>p.getAttribute('d'))),svgPaths);assert.equal(next[6].querySelector('svg'),null);
});
test('artist motion affects only noninteractive surfaces, with reduced-motion and visible keyboard focus',()=>{
 const css=fs.readFileSync(new URL('./style.css',import.meta.url),'utf8');
 assert.match(css,/#artist-filters\.artist-pills\{[\s\S]*?grid-template-columns:repeat\(7,minmax\(0,1fr\)\)/);
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
  assert.equal(typeof buttons[6].onclick,'function');buttons[6].click();assert.equal(f.run('artist'),'re-ge');assert.equal(buttons[6].getAttribute('aria-pressed'),'true');
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
test('v0.7.42 markup and worker asset versions match without touching push config',()=>{
 const sw=fs.readFileSync(new URL('./sw.js',import.meta.url),'utf8');assert.match(sw,/static-shell-v7-42/);for(const file of ['app.js','style.css','artist-config.js','schedule-store.js','calendar-subscriptions.js','pwa-update.js']){assert.ok(html.includes(file+'?v=0.7.42'));assert.ok(sw.includes(file+'?v=0.7.42'));}assert.ok(html.includes('v0.7.12'));assert.ok(html.includes('v0.7.9'));
});

test('News creation/missing captions avoid duplicates and time changes collapse',()=>{const e=event('compact-news','2026-11-12'),f=fixture({events:[e]});f.context.news={kind:'new',after:e,fields:['start','end','title'],revision:1,detected:'2026-11-12T04:00:00Z'};f.run('state.changes=[news];renderChanges()');assert.equal(f.get('changes').querySelector('.card-bottom-note').textContent,'New!');f.context.news.kind='updated';f.run('renderChanges()');assert.equal(f.get('changes').querySelector('.card-bottom-note').textContent,'更新 · 日時変更・タイトル変更');f.context.news.kind='unavailable';f.run('renderChanges()');assert.equal(f.get('changes').querySelector('.card-bottom-note').textContent,'中止とは判断していません');assert.equal((f.get('changes').textContent.match(/掲載消失/g)||[]).length,1);});

test('fifth artist has a plain short mark and preserves exact filtering and detail name',()=>{const f=fixture({events:[event('東北の予定','2026-11-12',{artistId:'tohokusan'}),event('他の予定','2026-11-12')]});const b=f.get('artist-filters').querySelector('[data-artist="tohokusan"]');assert.equal(b.getAttribute('aria-label'),'いぎなり東北産');assert.equal(b.querySelector('.artist-label').textContent,'産');assert.equal(b.querySelector('svg').getAttribute('data-artist-symbol'),'san-brush');b.click();assert.deepEqual(f.titles(),['東北の予定']);assert.equal(f.run("presentEvent(state.events[0]).artist"),'いぎなり東北産');});

test('seven artist targets keep 48px height and compact type at 320px',()=>{const css=fs.readFileSync(new URL('./style.css',import.meta.url),'utf8');assert.match(css,/grid-template-columns:repeat\(7,minmax\(0,1fr\)\)/);assert.ok(css.includes('width:calc(100% / 7 - 8px)'));assert.match(css,/width:100%;min-height:48px;height:48px/);assert.ok((320-18*2)/7>=40);assert.ok(css.includes('@media(max-width:360px){#artist-filters .artist-face{padding-inline:1px}#artist-filters [data-artist=re-ge] .artist-label{font-size:11px;letter-spacing:0}}'));for(const [fg,bg] of [['664a88','e9e9ed'],['cbb6df','39383f'],['d5b5f2','202025']])assert.ok(contrastRatio(fg,bg)>=4.5);});

test('ALL frame has exact five pixel inner clearance around fixed circular surfaces',()=>{
 const css=fs.readFileSync(new URL('./style.css',import.meta.url),'utf8');
 assert.ok(css.includes('grid-template-columns:repeat(7,minmax(0,1fr));width:322px'));
 assert.ok(css.includes('width:100%;height:48px;min-height:48px;padding:0;align-items:center'));
 assert.ok(css.includes('flex:none;width:36px;height:36px;padding:0;border-radius:50%;transform:none'));
 assert.ok(css.includes('#artist-filters[data-all-selected=true]::before{left:-1px;top:0;bottom:0;width:calc(100% + 2px)}'));
 const targetW=46,targetH=48,diameter=36,border=1,frameLeft=-1;
 assert.equal((targetW-diameter)/2-frameLeft-border,5);
 assert.equal((targetH-diameter)/2-border,5);
 assert.ok(targetW>=44&&targetH>=44);assert.ok(7*targetW===322);const narrowW=(320-36)/7;assert.ok(narrowW>=40);assert.ok((narrowW-30)/2>=5);
});
test('genre tint is common to all event cards without adding strips or overriding dashed status',()=>{
 const css=fs.readFileSync(new URL('./style.css',import.meta.url),'utf8');
 assert.ok(css.includes('.event-card,.event-card.possible{background:color-mix(in srgb,var(--event-color,transparent) 7%,var(--surface))}'));
 assert.ok(css.includes('var(--event-color,transparent) 11%,var(--surface)'));
 assert.match(css,/\.event-card\.possible\{border:1.5px dashed/);
 const f=fixture(),a=f.run("card({id:'same',title:'a',artistId:'tokisen',category:'LIVE',status:'confirmed'})"),b=f.run("card({id:'other',title:'b',artistId:'tohokusan',category:'LIVE',status:'possible'})"),c=f.run("card({id:'tv',title:'c',artistId:'tokisen',category:'TV',status:'confirmed'})");
 assert.equal(a.style.getPropertyValue('--event-color'),b.style.getPropertyValue('--event-color'));
 assert.notEqual(a.style.getPropertyValue('--event-color'),c.style.getPropertyValue('--event-color'));
});

test('selected month is distinguished by weight, not an underline',()=>{
 const css=fs.readFileSync(new URL('./style.css',import.meta.url),'utf8');
 assert.match(css,/#month-label\s*\{[^}]*font-weight:600/);
 assert.match(css,/#month-label\[aria-pressed=true\]\{font-weight:800\}/);
 assert.match(css,/#month-label\s*\{[^}]*align-items:baseline/);
 assert.match(css,/#month-label \.month-en\{[^}]*font-size:12px/);
 assert.match(css,/#month-label:focus-visible\{outline:/);
});

test('month selection highlights every in-month date, not overflow days or week controls',()=>{
 for(const month of ['2026-11-01','2026-05-01','2026-08-01','2027-02-01','2028-02-01','2026-01-01']){
  const f=fixture();f.run(`selectDay('${month}')`);f.get('month-label').click();
  const grid=f.get('calendar'),cells=grid.querySelectorAll('.day-cell');
  const days=new Date(Date.UTC(Number(month.slice(0,4)),Number(month.slice(5,7)),0)).getUTCDate();
  assert.equal(f.get('month-label').getAttribute('aria-pressed'),'true');
  assert.equal(grid.querySelectorAll('.range-selected').length,days);
  for(const cell of cells){
   const inMonth=cell.dataset.date.startsWith(month.slice(0,7));
   assert.equal(cell.classList.contains('range-selected'),inMonth);
   assert.equal(cell.querySelector('.date-button').getAttribute('aria-pressed'),String(inMonth));
  }
  assert.equal(grid.querySelectorAll('.month-perimeter').length,0);
  for(const week of grid.querySelectorAll('.week-select'))assert.equal(week.getAttribute('aria-pressed'),'false');
  dateButton(f,month).click();assert.equal(f.run('agendaRange'),'day');
  assert.equal(grid.querySelectorAll('.range-selected').length,1);
  assert.equal(dateButton(f,month).getAttribute('aria-pressed'),'true');
 }
});

test('scheduled card footer shows a quieter timestamp without its label',()=>{
 const f=fixture({events:[event('checked','2026-11-12',{checkedAt:'2026-11-12T04:10:00Z'})]});
 const t=f.get('agenda').querySelector('time.card-checked-time');assert.ok(t);
 assert.equal(t.dateTime,'2026-11-12T04:10:00Z');assert.equal(t.textContent,'11/12 13:10');
 assert.match(fs.readFileSync(new URL('./style.css',import.meta.url),'utf8'),/card-checked-time\{color:color-mix/);
});

test('favorite focus follows the correct occurrence when titles match and stays within the view',()=>{
 const f=fixture({events:['16','23','30'].map((day,i)=>event('radio-'+i,'2026-11-'+day,{title:'吉川ひよりの超♡まっ茶りタイム！'}))});
 f.get('month-label').click();
 const buttons=()=>f.get('agenda').querySelectorAll('.favorite-button');
 assert.equal(buttons().length,3);
 const key=buttons()[1].dataset.favoriteKey;
 buttons()[1].click();
 assert.deepEqual(buttons().map(b=>b.getAttribute('aria-pressed')),['false','true','false']);
 assert.equal(buttons().find(b=>b.focused)?.dataset.favoriteKey,key);
 f.context.location.hash='#favorites';f.run('route()');
 f.get('favorites').querySelector('.favorite-button').click();
 assert.equal(f.get('favorites').querySelectorAll('.favorite-button').length,0);
 assert.equal(f.get('view-title').focused,true);
});
test('no standalone certainty legend, with card certainty still present',()=>{
 const f=fixture({events:[event('first','2026-11-12'),event('second','2026-11-12',{status:'possible'})]});
 assert.equal(f.document.querySelectorAll('.card-legend').length,0);
 assert.deepEqual(f.get('agenda').querySelectorAll('.status').map(b=>b.textContent),['確定','かも？']);
});

test('card list heading uses dotted month and day while retaining the existing week range',()=>{
 const f=fixture({now:'2026-11-21T03:00:00Z'});
 const heading=f.get('agenda-title');
 assert.equal(heading.textContent,'2026.11.21');
 f.get('month-label').click();assert.equal(heading.textContent,'2026.11');
 weekButton(f,'2026-11-29').click();assert.equal(heading.textContent,'11月29日(日) 〜 12月5日(土)');
 f.run("selectDay('2027-01-02')");assert.equal(heading.textContent,'2027.01.02');
 f.get('month-label').click();assert.equal(heading.textContent,'2027.01');
});

test('card toolbar presents filters first, followed by an accessible unlabeled-on-screen sort select',()=>{
 const f=fixture(),rows=f.document.querySelectorAll('.card-filter-row');
 assert.equal(rows.length,2);
 for(const row of rows){
  const controls=row.children;
  assert.equal(controls.length,2);
  assert.ok(controls[0].classList.contains('filter-pills'));
  assert.equal(controls[1].tagName,'SELECT');
  assert.equal(controls[1].getAttribute('aria-label'),'並び順');
  assert.ok(!row.textContent.includes('並び順'));
 }
});

test('header share leads to calendar subscriptions and sits just left of theme',()=>{
 const f=fixture(),actions=f.document.querySelector('.header-actions');
 assert.deepEqual(actions.children.map(b=>b.id),['calendar-share','theme-toggle','refresh']);
 assert.equal(f.get('calendar-share').getAttribute('aria-label'),'本体カレンダーに追加');
 assert.equal(f.get('agenda-subscriptions'),null);
 assert.equal(f.get('open-subscriptions'),null);
 f.run('globalThis.subscriptionCalls=[];openSubscriptions=id=>subscriptionCalls.push(id)');
 f.get('calendar-share').click();f.run("artist='oneloveoneheart'");f.get('calendar-share').click();
 assert.deepEqual(Array.from(f.context.subscriptionCalls),[undefined,'oneloveoneheart']);
});

test('the Tokisen icon has no handle and enlarges only the artwork',()=>{
 const f=fixture(),b=f.document.querySelector('[data-artist="tokisen"]');
 assert.equal(b.getAttribute('aria-label'),'超ときめき♡宣伝部');
 const svg=b.querySelector('svg');
 assert.equal(svg.querySelectorAll('path')[1].getAttribute('d'),'M27 10l3-2m-3 8h4m-4 6 3 2');
 assert.match(fs.readFileSync(new URL('./style.css',import.meta.url),'utf8'),/\[data-artist=tokisen\] \.artist-symbol\{width:28px;height:28px\}/);
});

test('Search navigation and heading use the same large decorative icon',()=>{
 const f=fixture();
 const marker=f.document.querySelector('nav [data-view="search"] .search-symbol');
 assert.equal(marker.tagName,'SVG');assert.equal(marker.getAttribute('viewBox'),'0 0 24 24');
 assert.match(source,/menuIcon\.cloneNode\(true\)/);
 const css=fs.readFileSync(new URL('./style.css',import.meta.url),'utf8');
 assert.match(css,/\.search-symbol\{[^}]*width:22px;height:22px/);
});

test('both card filter bars are vertically centered and fit a 320px viewport without wrapping',()=>{
 const css=fs.readFileSync(new URL('./style.css',import.meta.url),'utf8');
 assert.match(css,/\.card-filter-row\{[^}]*align-items:center/);
 assert.match(css,/\.card-filter-row \.filter-pills\{[^}]*flex-wrap:nowrap/);
 assert.match(css,/\.card-filter-row \.filter-pills button\{[^}]*min-height:44px/);
 assert.match(css,/\.card-filter-row select\{[^}]*min-height:44px/);
 const narrow=css.slice(css.indexOf('@media(max-width:385px)'));
 const width=Number(narrow.match(/\.filter-pills button\{width:(\d+)px/)[1]);
 const gap=Number(narrow.match(/\.filter-pills\{gap:(\d+)px/)[1]);
 const sort=Number(narrow.match(/\.card-filter-row select\{width:(\d+)px/)[1]);
 const column=Number(narrow.match(/column-gap:(\d+)px/)[1]);
 const f=fixture();
 for(const bar of f.document.querySelectorAll('.card-filter-row')){
  const items=bar.querySelectorAll('.filter-pills button').length;
  assert.equal(items,4);
  assert.ok(items*width+(items-1)*gap+sort+column<=320-2*18-2*2);
 }
});

test('Search separates its input and filter row by 16px without changing Schedule',()=>{
 const css=fs.readFileSync(new URL('./style.css',import.meta.url),'utf8');
 const f=fixture(),toolbar=f.get('cards-view').children[0];
 assert.ok(toolbar.querySelector('#search'));
 assert.ok(f.get('cards-view').children[1].classList.contains('card-filter-row'));
 assert.match(css,/#cards-view > \.toolbar\{margin-block-end:16px\}/);
 assert.ok(!f.get('calendar-view').querySelector('.toolbar'));
});

test('Search accepts date, short date, fullwidth and month formats with JST overlap and existing filters',()=>{
 const f=fixture({events:[
  event('公演A','2026-11-21',{status:'possible'}),
  event('終日公演','2026-11-20',{end:'2026-11-22'}),
  event('深夜放送','2026-11-20T15:30:00Z'),
  event('別の月','2026-12-21'),event('未定',null)
 ]});
 const query=value=>{f.get('search').value=value;f.get('search').oninput();return f.titles('cards');};
 const day=['終日公演','公演A','深夜放送'];
 for(const value of ['11/21','2026.11.21','2026-11-21','2026/11/21','11月21日','２０２６年１１月２１日','2026.11']) assert.deepEqual(query(value),day,value);
 assert.deepEqual(query('2026-02-30'),[]);
 assert.deepEqual(query('2027/11/21'),[]);
 assert.deepEqual(query('公演A'),['公演A']);
 query('11/21');f.document.querySelector('[data-filter="possible"]').click();assert.deepEqual(f.titles('cards'),['公演A']);
 assert.equal(f.get('search').getAttribute('placeholder'),'予定・日付・場所・メモを検索');
});

test('mobile navigation fade is below controls and cannot intercept taps',()=>{
 const css=fs.readFileSync(new URL('./style.css',import.meta.url),'utf8');
 const rule=css.match(/@media\(max-width:700px\)\{\s*\.sidebar::before\{([^}]+)\}/)?.[1];
 assert.ok(rule);assert.match(rule,/z-index:19/);assert.match(rule,/pointer-events:none/);
 assert.match(rule,/safe-area-inset-bottom/);assert.match(rule,/backdrop-filter:blur\(16px\)/);
 assert.match(rule,/mask-image:linear-gradient\(to bottom,transparent,#000\)/);
});

test('shared close control uses a symmetric decorative cross and keeps its label and dialog behavior',()=>{
 const f=fixture(),close=f.get('close-detail');
 const svg=close.querySelector('svg'),path=svg.querySelector('path');
 assert.equal(close.getAttribute('type'),'button');
 assert.equal(close.getAttribute('aria-label'),'閉じる');
 assert.equal(svg.getAttribute('aria-hidden'),'true');
 assert.equal(svg.getAttribute('viewBox'),'0 0 24 24');
 assert.equal(path.getAttribute('d'),'M6 6l12 12M18 6L6 18');
 const css=fs.readFileSync(new URL('./style.css',import.meta.url),'utf8');
 assert.match(css,/\.dialog-close\{[^}]*place-items:center;[^}]*inline-size:44px;block-size:44px;[^}]*background:transparent/);
 assert.equal(f.document.querySelectorAll('.dialog-close').length,1);
 f.run('openDialog()');assert.equal(f.get('detail').open,true);
 close.click();assert.equal(f.get('detail').open,false);
});

test('event details keep sources without extra evidence or change shortcuts; News keeps the changes',()=>{
 const e=event('evidence-card','2026-11-12',{evidence:'本人公式の掲載'});
 const f=fixture({events:[e]});
 f.context.news={kind:'updated',source:e.source,eventId:e.id,after:e,before:{...e,location:'旧会場'},fields:['location'],revision:2,detected:'2026-11-12T04:00:00Z'};
 f.run('state.changes=[news];openEvent(fixtureEvents[0])');
 const panel=f.get('detail-content');
 assert.doesNotMatch(panel.textContent,/判断の根拠|本人公式の掲載|最後の変更を見る/);
 assert.match(panel.textContent,/出典と確認時刻/);
 assert.doesNotMatch(panel.textContent,/通知時刻の確認|リマインド例/);
 assert.equal(panel.querySelector('.personal-bell-slot').hidden,true);
 assert.equal(panel.querySelector('.notification-preview'),null);
 f.run('closeDialog();renderChanges()');
 f.get('changes').querySelector('.card-open').click();
 assert.match(panel.textContent,/旧会場/);
 assert.equal(panel.querySelector('.notification-preview'),null);
});

test('expanded event and News cards share one title typography rule with the list',()=>{
 const e=event('typographic-title','2026-11-12'),f=fixture({events:[e]});
 f.get('agenda').querySelector('.card-open').click();
 assert.equal(f.get('detail-content').querySelector('h2.event-detail-title').textContent,e.title);
 f.context.news={kind:'new',after:e,fields:[],revision:1,detected:'2026-11-12T04:00:00Z'};
 f.run('state.changes=[news];renderChanges()');
 f.get('changes').querySelector('.card-open').click();
 assert.equal(f.get('detail-content').querySelector('h2.event-detail-title').textContent,e.title);
 const css=fs.readFileSync(new URL('./style.css',import.meta.url),'utf8');
 assert.match(css,/\.event-card \.card-open h3,#detail h2\.event-detail-title\{[^}]*font-size:17px;font-weight:700;line-height:1\.35;letter-spacing:-\.02em/);
});

test('Search defaults to today onwards in Japan time and other sort options retain past search',()=>{
 const f=fixture({now:'2026-11-11T15:01:00Z',events:[
  event('昨日','2026-11-11T14:40:00Z'),
  event('開催中','2026-11-11',{end:'2026-11-13'}),
  event('昨日で終了','2026-11-11',{end:'2026-11-12'}),
  event('今日','2026-11-11T15:00:00Z'),
  event('明日','2026-11-13'),
  event('未定',null)
 ]});
 const select=f.get('sort'),first=select.children[0];
 assert.equal(first.textContent,'本日以降');assert.equal(first.value,'upcoming');assert.notEqual(first.getAttribute('selected'),null);
 assert.deepEqual(select.children.map(n=>n.value),['upcoming','title','category','favorites']);
 select.value=first.value;select.onchange();
 assert.deepEqual(f.titles('cards'),['開催中','今日','明日']);
 f.get('search').value='昨日';f.get('search').oninput();assert.deepEqual(f.titles('cards'),[]);
 select.value='title';select.onchange();assert.equal(f.titles('cards').length,2);
 assert.equal(f.get('agenda-sort').children[0].value,'date');
});

test('expanded event puts the favorite to the right of the title and no calendar-add button in the card',()=>{
 const e=event('detail-favorite','2026-11-12'),f=fixture({events:[e]});
 f.get('agenda').querySelector('.card-open').click();
 const panel=f.get('detail-content'),heading=panel.querySelector('.event-detail-heading');
 assert.equal(heading.children[0].textContent,e.title);
 assert.ok(heading.children[1].classList.contains('personal-bell-slot'));
 assert.ok(heading.children[2].classList.contains('favorite-button'));
 assert.doesNotMatch(panel.textContent,/本体カレンダーに追加/);
 assert.equal(f.get('calendar-share').getAttribute('aria-label'),'本体カレンダーに追加');
 heading.children[2].click();
 assert.equal(panel.querySelector('.favorite-button').getAttribute('aria-pressed'),'true');
});

test('News does not repeat its heading and keeps the mark-all action',()=>{
 const f=fixture(),news=f.get('changes-view');
 assert.doesNotMatch(news.textContent,/予定の新着・変更/);
 const actions=news.querySelector('.news-actions');
 assert.ok(actions.querySelector('#read-all'));
 assert.equal(actions.querySelector('#news-events-tab').getAttribute('aria-selected'),'true');
 assert.equal(news.querySelector('#news-history-panel').hidden,true);
 assert.equal(actions.querySelector('#news-other-tab').textContent,'その他');
 const others=news.querySelector('#news-other-panel');
 assert.equal(others.hidden,true);
 assert.equal(others.querySelector('.info-grid').children[0].id,'push-settings');
 assert.equal(others.querySelector('#push-settings h2').textContent,'通知設定');
 assert.equal(news.querySelector('#news-history-panel').querySelector('#push-settings'),null);
 const css=fs.readFileSync(new URL('./style.css',import.meta.url),'utf8');
 assert.match(css,/\.news-actions\{[^}]*grid-template-columns:minmax\(0,1fr\) auto;[^}]*align-items:center/);
 assert.match(css,/\.news-tabs button,\.news-actions #read-all\{min-height:44px;white-space:nowrap/);
});

test('pink shrimp is the first artist after ALL and filters only Ebichu schedules',()=>{
 const f=fixture({events:[event('エビ中の予定','2026-11-12',{artistId:'ebichu'}),event('とき宣の予定','2026-11-12')]});
 const buttons=f.get('artist-filters').querySelectorAll('button');const b=buttons[1];
 assert.equal(b.getAttribute('data-artist'),'ebichu');assert.equal(buttons[2].getAttribute('data-artist'),'tokisen');
 assert.equal(b.getAttribute('aria-label'),'私立恵比寿中学');assert.equal(b.querySelector('svg').getAttribute('data-artist-symbol'),'shrimp');
 b.click();assert.deepEqual(f.titles(),['エビ中の予定']);assert.equal(f.run("presentEvent(state.events[0]).artist"),'私立恵比寿中学');
 const css=fs.readFileSync(new URL('./style.css',import.meta.url),'utf8');
 assert.match(css,/\[data-artist=ebichu\]\{--artist-muted:#ae376b;--artist-selected:#f48bbb\}/);
 for(const [fg,bg] of [['ae376b','e9e9ed'],['ee8db6','39383f'],['f48bbb','202025']])assert.ok(contrastRatio(fg,bg)>=4.0);
});

test('shrimp has a separate fan tail and Tokisen drawing includes its centering offset',()=>{const doc=parseDocument(html),buttons=doc.getElementById('artist-filters').querySelectorAll('button');assert.equal(buttons[1].querySelector('svg').getAttribute('viewBox'),'2 1 32 32');assert.equal(buttons[1].querySelectorAll('path').length,5);assert.match(buttons[1].querySelectorAll('path')[3].getAttribute('d'),/^M20.6 22.1/);assert.equal(buttons[2].querySelector('svg').getAttribute('viewBox'),'2.5 0 32 32');});

test('calendar registration opens the native confirmation once, and URL copies without a second screen',async()=>{
 const f=fixture(),panel=f.get('detail-content'),dialog=f.get('detail'),copied=[],opened=[];
 const subs=fs.readFileSync(new URL('./calendar-subscriptions.js',import.meta.url),'utf8');
 vm.runInContext(subs,f.context);
 const host='https://calendar.example';
 f.context.ALERT_PUSH_CONFIG={backendUrl:host,allowedOrigins:[host]};
 f.context.navigator.clipboard={writeText:async url=>copied.push(url)};
 f.context.window.location={assign:url=>opened.push(url)};
 f.run('Object.assign(S,AlertCalendarSubscriptions);openSubscriptions()');
 const control=key=>panel.querySelector('[data-subscription-focus="'+key+'"]');
 const change=(key,checked)=>{const c=control(key);c.checked=checked;c.onchange();};
 const register=()=>panel.querySelector('[data-subscription-submit]');
 const urlButton=()=>panel.querySelector('[data-subscription-show-urls]');
 assert.equal(register().disabled,true);assert.equal(urlButton().disabled,true);
 assert.equal(control('tokisen-all-notice'),null);
 assert.equal(f.get('subscription-genres-tokisen').hidden,true);
 assert.equal(panel.querySelector('.subscription-expand').getAttribute('data-subscription-focus'),'ebichu-expand');
 dialog.scrollTop=287;const same=control('tokisen-expand');same.click();
 assert.equal(f.get('subscription-genres-tokisen').hidden,false);assert.equal(same.getAttribute('aria-expanded'),'true');
 assert.equal(dialog.scrollTop,287);assert.equal(control('tokisen-expand'),same);
 const input=control('tokisen-live-sync');
 change('tokisen-live-sync',true);change('tokisen-media-sync',true);change('ebichu-all-sync',true);
 assert.equal(control('tokisen-live-sync'),input);assert.equal(dialog.scrollTop,287);assert.deepEqual(opened,[]);
 register().click();assert.deepEqual(opened,['webcal://calendar.example/v1/calendar/tokisen-live,tokisen-media,ebichu-all.ics']);
 assert.equal(panel.querySelector('.subscription-results'),null);
 await urlButton().onclick();assert.deepEqual(copied,[host+'/v1/calendar/tokisen-live,tokisen-media,ebichu-all.ics']);
 assert.equal(opened.length,1);
 change('tokisen-all-sync',true);assert.equal(control('tokisen-live-sync').checked,false);
 change('ebichu-all-sync',false);register().click();
 assert.match(opened[1],/^webcal:.+\/tokisen-all\.ics$/);
 assert.equal(dialog.scrollTop,287);
 const style=fs.readFileSync(new URL('./style.css',import.meta.url),'utf8');
 assert.match(style,/#detail:has\(#detail-content\[data-panel=subscriptions\]\)\{[\s\S]*?inset-block-start:var\(--subscription-top\)/);
 assert.match(style,/subscription-chevron\{transform:rotate\(90deg\)\}/);
});
