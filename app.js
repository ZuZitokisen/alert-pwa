'use strict';
const $=s=>document.querySelector(s), F=globalThis.AlertFeatures, S=globalThis.AlertCalendarSubscriptions;
const el=(tag,value='',cls='')=>{const e=document.createElement(tag);e.textContent=value;if(cls)e.className=cls;return e;};
const statusNames={possible:'かも？',confirmed:'確定',unknown:'未確認',cancelled:'中止'};
const fields={title:'タイトル',start:'開始',end:'終了',allDay:'終日',status:'確度',category:'種類',location:'場所',note:'メモ',evidence:'根拠',artistId:'アーティスト',deadline:'正式締切'};
const kindNames={new:'新着',updated:'更新',unavailable:'掲載消失',restored:'再掲載'};
const colors={BENEFIT:'#eaa75d',LIVE:'#e65091',EVENT:'#eaa75d',STREAM:'#8a6cdb',TV:'#6886d3',RADIO:'#4da79f',REMIND:'#cf8958',MEMO:'#8693a7'};
const icons={BENEFIT:'◇',LIVE:'♬',EVENT:'◇',STREAM:'▷',TV:'▣',RADIO:'◉',REMIND:'◷',MEMO:'▤'};
const artists=globalThis.ALERT_ARTISTS;
const APP_RELEASE='0.7.46';
const MONTH_NAMES=['January','February','March','April','May','June','July','August','September','October','November','December'];
const WEEKDAY_NAMES=['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const artistOrder=['ebichu','batten','tokisen','tohokusan','oneloveoneheart','straightangeli','re-ge'];
const getArtist=id=>artists.find(a=>a.id===id);
const readKey=artists.some(a=>a.id==='ebichu')?'alert-pwa-curated-read-v5':artists.some(a=>a.id==='tohokusan')?'alert-pwa-curated-read-v4':artists.some(a=>a.id==='oneloveoneheart')?'alert-pwa-curated-read-v3':'alert-pwa-curated-read-v2';
let state={events:[],changes:[],sources:[],outboxCount:0},artist='all',selectedArtists=new Set(),filter='all',agendaFilter='all',agendaRange='day',selectedWeekStart=null,view='calendar',returnView='calendar';
let selectedDate=F.dateKey(new Date().toISOString()),period=selectedDate.slice(0,7)+'-01',requestGeneration=0,mutating=false,toastTimer,storageFailed=false;
function stored(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{storageFailed=true;return fallback;}}
function save(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{storageFailed=true;renderStorage();toast('保存領域を利用できません。この画面でのみ設定を保持します。');return false;}}
const ARTIST_SELECTION_KEY='alert-pwa-artist-selection-v1';
function restoreArtistSelection(){
 const saved=stored(ARTIST_SELECTION_KEY,[]);
 selectedArtists=new Set(Array.isArray(saved)&&saved.every(id=>typeof id==='string'&&artists.some(a=>a.id===id))?saved:[]);
 artist=selectedArtists.size===1?[...selectedArtists][0]:'all';
}
function chooseArtist(id){
 if(id!=='all'&&!artists.some(a=>a.id===id))return;
 if(id==='all')selectedArtists.clear();else if(selectedArtists.has(id))selectedArtists.delete(id);else selectedArtists.add(id);
 artist=selectedArtists.size===1?[...selectedArtists][0]:'all';
 save(ARTIST_SELECTION_KEY,[...selectedArtists]);
}
restoreArtistSelection();
const storedFavorites=stored('alert-pwa-favorites-v1',[]),storedSelected=stored('alert-pwa-selected-v1',[]),storedReminders=stored('alert-pwa-reminders-v2',{});
let favorites=new Set(Array.isArray(storedFavorites)?storedFavorites:[]),selected=new Set(Array.isArray(storedSelected)?storedSelected:[]),reminders=storedReminders&&typeof storedReminders==='object'&&!Array.isArray(storedReminders)?storedReminders:{},readThrough=readMarker();
let morningTime=stored('alert-pwa-morning-v1','08:00');if(typeof morningTime!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(morningTime))morningTime='08:00';
// Each cache generation has its own history marker; v4 can read older markers.
function readMarker(){const current=stored(readKey,null),legacy=current===null?(readKey.endsWith('-v5')?stored('alert-pwa-curated-read-v4',null):null)??stored('alert-pwa-curated-read-v3',null)??stored('alert-pwa-curated-read-v2',null)??stored('alert-pwa-curated-read-v1',0):current;const value=Number.isSafeInteger(legacy)&&legacy>=0?legacy:0;if(current===null)save(readKey,value);return value;}
function reconcileReadMarker(){const limit=Math.max(0,(state.nextChangeId||1)-1);if(readThrough>limit){readThrough=limit;save(readKey,readThrough);}}
function presentEvent(e){return {...e,artist:getArtist(e.artistId)?.name||e.artistId};}
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,5500);}
function prettyDate(value){if(!value)return '日時未定';if(value.length===10)return value.replaceAll('-','/');return new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value));}
function timeOnly(value){if(!value||value.length===10)return '未定';return new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value));}
function dayDate(key){return new Date(key+'T12:00:00+09:00');}
function addDays(key,days){const d=dayDate(key);d.setUTCDate(d.getUTCDate()+days);return F.dateKey(d.toISOString());}
function timing(e){if(!e.start)return e.dateLabel||'日時未定';if(e.allDay)return `${prettyDate(e.start)}${e.end?' 〜 '+prettyDate(addDays(e.end,-1)):''} · 終日`;return `${prettyDate(e.start)}${e.start.length===10?' · 時刻未定':''}${e.end?' 〜 '+prettyDate(e.end):''}`;}
function colorFor(e){return colors[e.category]||colors.EVENT;}
function statusBadge(e){return el('span',e.present===false?'掲載消失':statusNames[e.status]||'未確認',`status ${e.present===false?'missing':e.status}`);}
// Keep source categories and subscribed feeds stable; merge special-event categories only in the UI.
function uiEvent(e){return e.category==='BENEFIT'?{...e,category:'EVENT'}:e;}
function matchesArtist(id){return selectedArtists.size===0||selectedArtists.has(id);}
function matching(extra={}){return F.filterEvents(state.events.filter(e=>matchesArtist(e.artistId)).map(uiEvent),{artist:'all',category:'all',status:'all',sort:'date',favorites,...extra});}
function activeEvents(){return matching().filter(e=>e.present!==false&&e.status!=='cancelled');}
function artistSymbol(id){
 const specs={batten:{viewBox:"0 0 32 32",kind:"batten-cross",paths:[{d:"M8 8l16 16m0-16L8 24",fill:"none",stroke:"currentColor","stroke-width":"3.6","stroke-linecap":"round"}]},ebichu:{viewBox:'2 1 32 32',kind:'shrimp',paths:[{"d":"M25.4 12.2c1.1-.7 1.2-2.3.2-3.2-1.8-1.7-4.5-2.8-7.5-2.8-7 0-12.9 4.6-12.9 11 0 5.9 4.7 9.3 10.4 9.3 2.9 0 5.1-.9 7.3-2.5l-1.5-2.6c-1.8 1-3.4 1.3-5.1 1.1-3.2-.3-5.3-2.2-5.3-5 0-2.6 1.9-4.8 4.7-5.4 2.7-.6 4.4.9 6.4 1.2 1.3.2 2.4-.2 3.3-1.1Z","fill":"currentColor"},{"d":"M23.1 10.2C25.7 5.7 28.4 4 30.7 4.5M25.2 11c2.1-1.9 4-2 5.6-1.4","fill":"none","stroke":"currentColor","stroke-width":"1.35","stroke-linecap":"round"},{"d":"M12.5 7.6l2.4 4.9M7.4 11.6l4.1 3.4M5.7 17.5l5.6.9M9.1 23.9l4-2.3M22 9.8h.2","fill":"none","stroke":"var(--artist-face-bg)","stroke-width":"1.25","stroke-linecap":"round"},{"d":"M20.6 22.1c1.1-.8 2.2-1.3 3.5-1.5 2.1-.3 4 .1 5.3.9.5.3.5.9 0 1.2l-3 1.6c1.4.3 2.5.9 3.1 1.9.3.5.1 1-.4 1.1l-4 .5.8 1.7c.2.5-.1 1-.7.9-2.5-.3-4.7-2-5.7-4.4-.5-1.4-.1-2.9 1.1-3.9Z","fill":"currentColor"},{"d":"M21 23.7c1.2.2 2.9.1 4.8-.3M21.5 25.1c1.3.9 2.4 1.8 3.2 2.9","fill":"none","stroke":"var(--artist-face-bg)","stroke-width":"1.1","stroke-linecap":"round"}]},tohokusan:{viewBox:'0 0 34 34',kind:'san-brush',paths:[{d:'M16 2Q19 2 20 3L19 6 16 6Z M6 6Q16 7 25 6L27 4 30 8 7 8Z M9 9Q14 10 13 13L11 14Q11 11 9 9Z M23 9L27 10Q24 13 21 14L20 13Z M5 14Q17 15 27 14L29 12 32 16 8 16Q8 26 2 31L1 30Q5 23 5 14Z M13 17L16 18Q14 22 10 24L9 23Z M19 17L22 18 21 29 18 29Z M13 21Q20 22 26 21L28 19 30 23 12 23Z M12 25L26 25 28 23 30 27 12 27Z M8 29Q19 30 28 29L30 27 33 31 8 31Z',fill:'currentColor'}]},oneloveoneheart:{viewBox:'0 0 32 32',kind:'heart',paths:[{d:'M16 27S3 19.4 3 10.9C3 4.8 10.9 2.3 16 8c5.1-5.7 13-3.2 13 2.9C29 19.4 16 27 16 27Z',fill:'currentColor'}]},tokisen:{viewBox:'2.5 0 32 32',kind:'megaphone',paths:[{d:'M5 12h6l13-6v20l-13-6H5z',fill:'currentColor'},{d:'M27 10l3-2m-3 8h4m-4 6 3 2',fill:'none',stroke:'currentColor','stroke-width':'2.2','stroke-linecap':'round','stroke-linejoin':'round'}]},straightangeli:{viewBox:'0 0 32 30',kind:'wings',paths:[{d:'M5 27C3 23 4 18 8 15c4-3 10-3 16-11l4-3c1 6-3 12-9 16 5-2 8-5 11-8 0 6-5 11-12 13 4 0 7-2 10-4-2 6-8 9-14 8l7 1c-6 4-12 3-16 0Z',fill:'currentColor'},{d:'M7 25c2-5 6-8 11-11',fill:'none',stroke:'var(--artist-face-bg)','stroke-width':'1.3','stroke-linecap':'round'}]}};
 const spec=specs[id];if(!spec)return null;
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');
 for(const [key,value]of Object.entries({class:'artist-symbol','data-artist-symbol':spec.kind,viewBox:spec.viewBox,'aria-hidden':'true',focusable:'false'}))svg.setAttribute(key,value);
 for(const attrs of spec.paths){const path=document.createElementNS(ns,'path');for(const [key,value]of Object.entries(attrs))path.setAttribute(key,value);svg.append(path);}
 return svg;
}
function renderArtists(){
 const list=[{id:'all',name:'すべてのアーティスト'},...artists.slice().sort((a,b)=>artistOrder.indexOf(a.id)-artistOrder.indexOf(b.id))],container=$('#artist-filters');
 const existing=[...container.querySelectorAll('button[data-artist]')];
 const buttons=list.map(a=>{
  let button=existing.find(b=>b.getAttribute('data-artist')===a.id);
  if(!button){
   button=el('button','','artist-option');button.type='button';button.setAttribute('data-artist',a.id);
   const face=el('span','','artist-face');
   const symbol=artistSymbol(a.id);if(symbol)face.append(symbol);
   face.append(el('span',a.id==='all'?'ALL':a.buttonName||a.name,'artist-label'));button.append(face);
  }
  button.setAttribute('aria-pressed',String(a.id==='all'?selectedArtists.size===0:selectedArtists.has(a.id)));button.setAttribute('aria-label',a.name);
  const label=button.querySelector('.artist-label'),name=a.id==='all'?'ALL':a.buttonName||a.name;if(label.textContent!==name)label.textContent=name;
  button.onclick=()=>{
   chooseArtist(a.id);
   render();button.focus({preventScroll:true});
  };
  return button;
 });
 // Keep the existing elements in place so refreshes do not restart transitions
 // or move focus. The static first-paint markup already has this same shape.
 if(existing.length!==buttons.length||existing.some((button,index)=>button!==buttons[index]))container.replaceChildren(...buttons);
 container.setAttribute('data-all-selected',String(selectedArtists.size===0));
}

function toggleFavorite(e){const key=F.stableEventKey(e);favorites.has(key)?favorites.delete(key):favorites.add(key);save('alert-pwa-favorites-v1',[...favorites]);render();}
function favoriteMark(active){const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('class','favorite-icon');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');const heart=document.createElementNS(ns,'path');heart.setAttribute('d','M12 20.5 3.8 12.4C.2 8.8 2.2 3.5 6.5 3.5c2.3 0 4 1.4 5.5 3.2 1.5-1.8 3.2-3.2 5.5-3.2 4.3 0 6.3 5.3 2.7 8.9Z');heart.setAttribute('fill',active?'#fff':'#222332');heart.setAttribute('stroke','#222332');heart.setAttribute('stroke-width','1.4');heart.setAttribute('stroke-linejoin','round');svg.append(heart);return svg;}
function favoriteButton(e){
 const b=el('button','','favorite-button'),key=F.stableEventKey(e),active=favorites.has(key);
 b.append(favoriteMark(active));b.type='button';
 b.setAttribute('aria-label',`${e.title}のお気に入り`);b.setAttribute('aria-pressed',String(active));
 b.dataset.favoriteKey=key;
 b.onclick=()=>{
  const list=b.closest('[id]'),id=list?.id,selector='button.favorite-button';
  const position=id?[...list.querySelectorAll(selector)].indexOf(b):-1;
  toggleFavorite(e);
  if(position<0)return;
  const buttons=[...(document.getElementById(id)?.querySelectorAll(selector)||[])];
  const same=buttons[position]?.dataset.favoriteKey===key?buttons[position]:buttons.find(x=>x.dataset.favoriteKey===key);
  const target=same||buttons[Math.min(position,buttons.length-1)]||$('#view-title');
  target?.focus({preventScroll:true});
 };
 return b;
}
function card(e,selectable=false){const key=F.stableEventKey(e),c=el('article','',`event-card ${e.present===false?'missing':e.status}`);c.style.setProperty('--event-color',colorFor(e));const body=el('div','','card-body'),top=el('div','','card-top');top.append(el('span',`${icons[e.category]||'◇'} ${e.category}`,'category'),statusBadge(e));body.append(top);const open=el('button','','card-open');open.type='button';open.setAttribute('aria-label',`${e.title}の詳細`);open.append(el('h3',e.title));open.onclick=()=>openEvent(e,c.getBoundingClientRect?.());body.append(open,el('p',getArtist(e.artistId)?.name||'サンプル','artist-name'),el('p',timing(e),'card-time'),el('p',e.location||'場所未定','card-location'));const actions=el('div','','card-actions');if(selectable){const label=el('label','','select-label'),input=document.createElement('input');input.type='checkbox';input.checked=selected.has(key);input.disabled=!F.exportEligibility(e).eligible;input.setAttribute('aria-label',`${e.title}を選択`);input.onchange=()=>{input.checked?selected.add(key):selected.delete(key);save('alert-pwa-selected-v1',[...selected]);renderSelection();};label.append(input,document.createTextNode(input.disabled?'日時を確認待ち':'まとめて登録'));actions.append(label);}else if(e.checkedAt){const checked=el('time',prettyDate(e.checkedAt),'card-bottom-note card-checked-time');checked.dateTime=e.checkedAt;actions.append(checked);}else actions.append(el('span','出典を確認','card-bottom-note'));actions.append(favoriteButton(e));body.append(actions);c.append(body);return c;}
function appendSourcesAndTimes(area,e){
if(e.timings?.length){area.append(el('h3','開催・受付の日時'));const list=el('ul','','event-timings');for(const t of e.timings){const line=el('li');line.append(el('strong',t.label+'：'),document.createTextNode((t.at?prettyDate(t.at):t.date?prettyDate(t.date)+'・時刻未定':'時刻未定')+(t.status==='possible'?'（かも？）':'')+(t.note?' / '+t.note:'')));list.append(line);}area.append(list);}
area.append(el('h3','出典と確認時刻'));const list=el('ul','','event-sources');for(const item of e.sources||[]){let url;try{url=new URL(item.url);if(url.protocol!=='https:'||url.username||url.password)continue;}catch{continue;}const li=el('li'),link=el('a',(item.type.startsWith('artist_official')?'本人公式':'外部情報')+' · '+url.hostname+' ↗');link.href=item.url;link.target='_blank';link.rel='noopener noreferrer';li.append(link,el('small','確認 '+prettyDate(item.checkedAt)));list.append(li);}area.append(list);
}
// Safari can scroll the inert page behind a native dialog, including its backdrop.
// Keep the page at its opening position while the dialog retains its own scroller.
let dialogScrollState=null;
const dialogBodyStyleKeys=['position','top','left','width','overflow','padding-right'];
function lockDialogScroll(){
 if(dialogScrollState)return;
 const body=document.body,root=document.documentElement;
 const gap=Math.max(0,window.innerWidth-root.clientWidth);
 const padding=parseFloat(getComputedStyle(body).paddingRight)||0;
 dialogScrollState={x:window.scrollX,y:window.scrollY,hadClass:root.classList.contains('dialog-scroll-locked'),offset:[root.style.getPropertyValue('--dialog-scroll-offset'),root.style.getPropertyPriority('--dialog-scroll-offset')],styles:dialogBodyStyleKeys.map(key=>[key,body.style.getPropertyValue(key),body.style.getPropertyPriority(key)])};
 body.style.setProperty('position','fixed');
 body.style.setProperty('top',`${-dialogScrollState.y}px`);
 body.style.setProperty('left',`${-dialogScrollState.x}px`);
 body.style.setProperty('width','100%');
 body.style.setProperty('overflow','hidden');
 if(gap)body.style.setProperty('padding-right',`${padding+gap}px`);
 root.style.setProperty('--dialog-scroll-offset',`${dialogScrollState.y}px`);
 root.classList.add('dialog-scroll-locked');
}
function unlockDialogScroll(){
 if(!dialogScrollState)return;
 const saved=dialogScrollState,body=document.body,root=document.documentElement;
 dialogScrollState=null;
 for(const [key,value,priority] of saved.styles){if(value)body.style.setProperty(key,value,priority);else body.style.removeProperty(key);}
 if(!saved.hadClass)root.classList.remove('dialog-scroll-locked');
 if(saved.offset[0])root.style.setProperty('--dialog-scroll-offset',...saved.offset);else root.style.removeProperty('--dialog-scroll-offset');
 const behavior=root.style.getPropertyValue('scroll-behavior'),priority=root.style.getPropertyPriority('scroll-behavior');
 root.style.setProperty('scroll-behavior','auto');
 window.scrollTo(saved.x,saved.y);
 if(behavior)root.style.setProperty('scroll-behavior',behavior,priority);else root.style.removeProperty('scroll-behavior');
}
let cardOpenMotion=null;
function expandFromCard(detail,origin){
 if(!origin||!detail.animate||window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)return;
 const target=detail.getBoundingClientRect();
 if(!origin.width||!origin.height||!target.width||!target.height)return;
 const center=(rect,key,size)=>rect[key]+rect[size]/2;
 const clamp=(n,limit)=>Math.max(-limit,Math.min(limit,n));
 const x=clamp(center(origin,'left','width')-center(target,'left','width'),170);
 const y=clamp(center(origin,'top','height')-center(target,'top','height'),180);
 const width=Math.max(.78,Math.min(1,origin.width/target.width));
 const height=Math.max(.84,Math.min(1,origin.height/target.height));
 try{
  cardOpenMotion=detail.animate([{transform:`translate(${x}px,${y}px) scale(${width},${height})`,opacity:.86},{transform:'none',opacity:1}],{duration:235,easing:'cubic-bezier(.18,.78,.24,1)'});
 }catch{} // Native dialog remains usable if animation is unavailable.
}
function openDialog(origin){
 const detail=$('#detail');
 if(detail.open)return;
 unlockDialogScroll();
 lockDialogScroll();
 try{detail.showModal();detail.scrollTop=0;}catch(error){unlockDialogScroll();throw error;}
 expandFromCard(detail,origin);
}
function stopCardOpenMotion(){cardOpenMotion?.cancel();cardOpenMotion=null;}
function closeDialog(){stopCardOpenMotion();$('#detail').close();unlockDialogScroll();}
function onDialogClosed(){if(!$('#detail').open){globalThis.AlertPush?.unmountPersonalBell?.();stopCardOpenMotion();unlockDialogScroll();$('#detail').setAttribute('aria-label','予定と通知の詳細');}}

// Track only a single deliberate horizontal touch on an expanded card.
function installCardSwipe(dialog,getPanel,dismiss){
 let drag=null;
 const cardPanel=()=>{const panel=getPanel();return panel==='event'||panel==='change'?panel:null;};
 const point=(list,id)=>Array.from(list||[]).find(t=>t.identifier===id);
 const delta=t=>({x:t.clientX-drag.x,y:t.clientY-drag.y});
 dialog.addEventListener('touchstart',event=>{
  drag=null;const panel=cardPanel();
  if(!dialog.open||!panel||event.touches.length!==1||event.target===dialog||event.target.closest?.('button,a,input,select,textarea,label,summary,[contenteditable]'))return;
  const t=event.touches[0];
  drag={id:t.identifier,x:t.clientX,y:t.clientY,panel};
 },{passive:true});
 dialog.addEventListener('touchmove',event=>{
  if(!drag)return;
  const t=point(event.touches,drag.id);
  if(!t||event.touches.length!==1){drag=null;return;}
  const {x,y}=delta(t);
  if((Math.abs(y)>18&&Math.abs(y)>Math.abs(x)*.75)||(x>24&&x>Math.abs(y)))drag=null;
 },{passive:true});
 dialog.addEventListener('touchend',event=>{
  if(!drag)return;
  const t=point(event.changedTouches,drag.id),panel=drag.panel;
  const movement=t?delta(t):null;drag=null;
  if(!movement||event.touches.length||!dialog.open||cardPanel()!==panel)return;
  if(movement.x<=-65&&Math.abs(movement.y)<=Math.abs(movement.x)*.55)dismiss();
 },{passive:true});
 for(const name of ['touchcancel','close'])dialog.addEventListener(name,()=>{drag=null;},{passive:true});
}

function openEvent(e,origin){
 const area=$('#detail-content');area.dataset.panel='event';
 const heading=el('div','','event-detail-heading'),fav=favoriteButton(e);
 fav.onclick=()=>{toggleFavorite(e);openEvent(e);$('#detail-content .favorite-button')?.focus({preventScroll:true});};
 const bell=el('span','','personal-bell-slot');bell.hidden=true;
 heading.append(el('h2',e.title,'event-detail-title'),bell,fav);
 area.replaceChildren(statusBadge(e),heading,el('p',getArtist(e.artistId)?.name||'サンプル','detail-meta'),el('p',timing(e)),el('p',e.location||'場所未定'),el('p',e.note));
 if(e.deadline)area.append(el('p','正式締切 '+prettyDate(e.deadline)));
 if(e.present===false)area.append(el('p','元ページから掲載がなくなりました。中止とは確定していません。'));
 appendSourcesAndTimes(area,e);
 openDialog(origin);globalThis.AlertPush?.mountPersonalBell?.(bell,e);}
let subscriptionChoices=new Set();
function openSubscriptions(artistId){
 if(artistId&&S.ARTISTS.includes(artistId))subscriptionChoices=new Set([artistId+'-all']);
 $('#detail-content').dataset.panel='subscriptions';renderSubscriptions();openDialog();
}
function renderSubscriptions(){
 const area=$('#detail-content'),selection=el('div','','subscription-selection');
 const groups=el('div','','subscription-presets subscription-selector'),checks=[];
 const columns=el('div','','subscription-grid subscription-columns');
 columns.append(el('span','アーティスト'),el('span','同期'));
 groups.append(columns);
 const footer=el('div','','detail-actions subscription-actions subscription-submit');
 const urlButton=el('button','URL'),register=el('button','登録','primary');
 urlButton.type=register.type='button';
 urlButton.setAttribute('aria-label','登録URLをコピー');
 register.setAttribute('data-subscription-submit','');
 urlButton.setAttribute('data-subscription-show-urls','');
 footer.append(urlButton,register);
 const field=document.createElement('input');field.type='url';field.readOnly=true;field.hidden=true;field.className='subscription-url';field.setAttribute('aria-label','登録URL');
 function refreshChecks(){
  for(const {input,id} of checks)input.checked=subscriptionChoices.has(id);
  register.disabled=urlButton.disabled=!subscriptionChoices.size;
  field.hidden=true;field.value='';
 }
 function addChecks(row,preset,artistName){
  const name=preset.label.split(' / ')[1],scope=artistName+' '+name;
  const label=el('label','','subscription-check'),input=document.createElement('input');
  input.type='checkbox';input.setAttribute('data-subscription-focus',preset.id+'-sync');input.setAttribute('aria-label',scope+'の同期');
  checks.push({input,id:preset.id});
  input.onchange=()=>{
   if(input.checked){
    if(preset.category==='all'){for(const part of S.PRESETS.filter(p=>p.artist===preset.artist))subscriptionChoices.delete(part.id);}
    else subscriptionChoices.delete(preset.artist+'-all');
    subscriptionChoices.add(preset.id);
   }else subscriptionChoices.delete(preset.id);
   refreshChecks();
  };
  label.append(input);row.append(label);
 }
 for(const artistId of artistOrder.filter(id=>S.ARTISTS.includes(id))){
  const presets=S.PRESETS.filter(p=>p.artist===artistId),artistName=getArtist(artistId)?.name||artistId;
  const section=el('section','','subscription-artist'),row=el('div','','subscription-grid'),listId='subscription-genres-'+artistId;
  const toggle=el('button',artistName,'subscription-expand'),list=el('div','','subscription-genres');
  list.id=listId;list.hidden=true;
  toggle.type='button';toggle.setAttribute('aria-expanded','false');toggle.setAttribute('aria-controls',listId);toggle.setAttribute('data-subscription-focus',artistId+'-expand');
  const chevron=el('span','›','subscription-chevron');chevron.setAttribute('aria-hidden','true');toggle.append(chevron);
  toggle.onclick=()=>{list.hidden=!list.hidden;toggle.setAttribute('aria-expanded',String(!list.hidden));};
  row.append(toggle);addChecks(row,presets.find(p=>p.category==='all'),artistName);section.append(row);
  for(const preset of presets.filter(p=>p.category!=='all')){
   const item=el('div','','subscription-grid');item.append(el('span',preset.label.split(' / ')[1]));addChecks(item,preset,artistName);list.append(item);
  }
  section.append(list);groups.append(section);
 }
 function currentLinks(){
  try{return S.registrationLinks([...subscriptionChoices]);}
  catch{toast('登録URLを用意できませんでした。');return null;}
 }
 register.onclick=()=>{const urls=currentLinks();if(!urls)return;
  if(!urls.separate){window.location.assign(urls.webcal);return;}
  const list=el('ul','','export-list');
  for(const item of urls.separate){const a=el('a',item.label);a.href=item.webcal;const li=el('li','');li.append(a);list.append(li);}
  area.replaceChildren(el('h2','本体カレンダーに登録'),list);
 };
 urlButton.onclick=async()=>{const urls=currentLinks();if(!urls)return;
  if(urls.separate){register.onclick();return;}
  try{if(!navigator.clipboard?.writeText)throw new Error('unavailable');await navigator.clipboard.writeText(urls.https);toast('登録URLをコピーしました。');}
  catch{
   if(!selection.isConnected||currentLinks()?.https!==urls.https)return;
   field.value=urls.https;field.hidden=false;field.focus({preventScroll:true});field.select();
  }
 };
 selection.append(groups,footer,field);
 area.replaceChildren(el('h2','本体カレンダーに登録'),selection);
 refreshChecks();
}
function openExport(events){const result=F.buildICS(events.map(presentEvent),{now:new Date().toISOString()}),area=$('#detail-content');area.dataset.panel='export';area.replaceChildren(el('h2','カレンダーに渡す予定'),el('p',`${result.included.length}件の架空サンプルをICSファイルにします。`));const list=el('ul','','export-list');for(const e of result.included)list.append(el('li',`${e.status==='possible'?'［かも？］':''}${e.title} · ${timing(e)}`));area.append(list);for(const s of result.skipped)area.append(el('p',`${s.event?.title||'予定'}：${s.label||s.reason}（出力しません）`,'hint'));area.append(el('p','ファイルを保存しただけでは、本体カレンダーへの登録は完了しません。対応するカレンダーで内容を確認して追加してください。iPhoneでの受け渡しは実機未検証です。','evidence'),el('p','自動同期ではありません。内容が変わっても自動更新しません。通知設定はファイルに含めません。','hint'));const b=el('button',`${result.included.length}件のICSを作成`,'primary');b.disabled=!result.included.length;b.onclick=()=>{const url=URL.createObjectURL(new Blob([result.ics],{type:'text/calendar;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='alert-sample-events.ics';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);toast('ICSファイルを作成しました。本体への追加はカレンダー側で確認してください。');};area.append(b);openDialog();}
function showValue(key,value){if(value===null||value===undefined||value==='')return '未設定';if(key==='status')return statusNames[value]||value;if(key==='category'&&value==='BENEFIT')return 'EVENT';if(key==='artistId')return getArtist(value)?.name||value;if(key==='allDay')return value?'終日':'時刻指定／時刻未定';if(['start','end','deadline'].includes(key))return prettyDate(value);return String(value);}
function openChange(c,origin){const area=$('#detail-content'),e=c.after||c.before;area.dataset.panel='change';area.replaceChildren(el('span',kindNames[c.kind],'status'),el('h2',e.title,'event-detail-title'),el('p',`検知 ${prettyDate(c.detected)} · r${c.revision}`,'hint'));if(c.kind==='unavailable')area.append(el('p','掲載がなくなったため前回の内容を保持しています。中止とは判断しません。','evidence'));else for(const key of c.fields){const row=el('div','','diff-item');row.append(el('div',fields[key]||key,'diff-label'));if(c.before)row.append(el('div',showValue(key,c.before[key]),'diff-before'));if(c.after)row.append(el('div',showValue(key,c.after[key]),'diff-after'));area.append(row);}openDialog(origin);}
function searchDate(value){
 const q=value.normalize('NFKC').trim();
 const match=/^(\d{4})\s*([./-])\s*(\d{1,2})(?:\s*\2\s*(\d{1,2}))?$/.exec(q);
 const japanese=/^(?:(\d{4})\s*年\s*)?(\d{1,2})\s*月(?:\s*(\d{1,2})\s*日)?$/.exec(q);
 const short=/^(\d{1,2})\s*[./-]\s*(\d{1,2})$/.exec(q);
 if(!match&&!japanese&&!short)return null;
 const year=match?.[1]||japanese?.[1]||null;
 const month=+(match?.[3]||japanese?.[2]||short?.[1]);
 const day=+(match?.[4]||japanese?.[3]||short?.[2]||0);
 const hasDay=!!(match?.[4]||japanese?.[3]||short);
 return {year,month,day,hasDay};
}
function matchesSearchDate(event,{year,month,day,hasDay}){
 const start=F.dateKey(event.start);
 if(!start||month<1||month>12||(hasDay&&(day<1||day>31)))return false;
 const finish=F.dateKey(event.end)||start;
 const first=year?+year:+start.slice(0,4),last=year?+year:Math.max(first,+finish.slice(0,4));
 for(let y=first;y<=last;y++){
  const prefix=String(y).padStart(4,'0')+'-'+String(month).padStart(2,'0');
  const key=prefix+'-'+String(hasDay?day:1).padStart(2,'0');
  if(F.dateKey(key)&&(F.overlapsDay(event,key)||(!hasDay&&event.present!==false&&start.startsWith(prefix+'-'))))return true;
 }
 return false;
}
function visibleCards(){
 const query=$('#search').value,date=searchDate(query);
 const mode=$('#sort').value;
 let events=matching({status:filter,query:date?'':query,sort:mode==='upcoming'?'date':mode});
 if(mode==='upcoming'){
  const today=F.dateKey(new Date().toISOString());
  events=events.filter(e=>{const day=F.dateKey(e.start);return !!day&&(day>=today||F.overlapsDay(e,today));});
 }
 return date?events.filter(e=>matchesSearchDate(e,date)):events;
}
function renderCards(){const list=visibleCards();$('#cards').replaceChildren(...(list.length?list.map(e=>card(e)):[el('p','該当する予定はありません。','empty')]));const f=matching({favoritesOnly:true});$('#favorites').replaceChildren(...(f.length?f.map(e=>card(e)):[el('p','お気に入りはまだありません。','empty')]));renderSelection();}
function renderSelection(){const eligible=visibleCards().filter(e=>F.exportEligibility(e).eligible),all=eligible.length>0&&eligible.every(e=>selected.has(F.stableEventKey(e)));$('#select-visible').checked=all;$('#select-visible').indeterminate=!all&&eligible.some(e=>selected.has(F.stableEventKey(e)));$('#select-visible').disabled=!eligible.length;const count=state.events.filter(e=>selected.has(F.stableEventKey(e))&&F.exportEligibility(e).eligible).length;$('#selected-count').textContent=count;$('#export-selected').disabled=!count;}
// Calendar stays in month view. Range selection only changes the cards below it.
function calendarEvent(e,key=period){const b=el('button',e.title,`calendar-event ${e.status}`);b.type='button';b.style.setProperty('--event-color',colorFor(e));b.title=`${e.title} · ${statusNames[e.status]} · ${timing(e)}`;b.onclick=()=>selectDay(key);return b;}
// Keep the gesture state outside date nodes because selection replaces the calendar DOM.
let lastCalendarDateTap=null;
function resetCalendarDateTap(event){
 const day=event.target?.closest?.('.day-cell'),control=event.target?.closest?.('button,a,input,select');
 if(!day||(control&&!control.classList.contains('date-button')))lastCalendarDateTap=null;
}
function activateCalendarDate(key,event){
 const pointer=event&&event.detail>0&&event.button===0&&!event.metaKey&&!event.ctrlKey&&!event.shiftKey&&!event.altKey;
 const at=event?.timeStamp,kind=event?.pointerType||'mouse';
 const jump=pointer&&Number.isFinite(at)&&lastCalendarDateTap?.key===key&&lastCalendarDateTap.kind===kind&&at-lastCalendarDateTap.at>0&&at-lastCalendarDateTap.at<=350;
 lastCalendarDateTap=pointer&&Number.isFinite(at)&&!jump?{key,at,kind}:null;
 selectDay(key);
 $('#calendar').querySelector('[data-date="'+key+'"] .date-button')?.focus({preventScroll:true});
 if(jump){
  const heading=$('#agenda-title');
  heading.scrollIntoView({block:'start',behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  heading.focus({preventScroll:true});
 }
}
function selectDay(key){selectedDate=key;period=key.slice(0,7)+'-01';agendaRange='day';selectedWeekStart=null;renderCalendar();}
function selectMonth(){agendaRange='month';selectedWeekStart=null;renderCalendar();}
function selectWeek(start){selectedWeekStart=start;agendaRange='week';renderCalendar();}
function selectToday(){selectedDate=F.dateKey(new Date().toISOString());period=selectedDate.slice(0,7)+'-01';agendaRange='day';selectedWeekStart=null;renderCalendar();}
function agendaBounds(){
 if(agendaRange==='week'){const start=selectedWeekStart||addDays(selectedDate,-dayDate(selectedDate).getUTCDay());return {start,end:addDays(start,7)};}
 if(agendaRange==='month'){const d=dayDate(period);d.setUTCMonth(d.getUTCMonth()+1);return {start:period,end:F.dateKey(d.toISOString())};}
 return {start:selectedDate,end:addDays(selectedDate,1)};
}
function agendaCandidates(){return matching({status:agendaFilter,sort:$('#agenda-sort').value}).filter(e=>e.present!==false&&e.status!=='cancelled');}
function agendaEntries(){const bounds=agendaBounds(),days=[];for(let key=bounds.start;key<bounds.end;key=addDays(key,1))days.push(key);return agendaCandidates().filter(e=>e.start&&days.some(key=>F.overlapsDay(e,key)));}
function renderAgenda(){
 const bounds=agendaBounds(),label=key=>new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'long',day:'numeric',weekday:'short'}).format(dayDate(key));
 $('#agenda-title').textContent=agendaRange==='month'?bounds.start.slice(0,7).replaceAll('-','.'):agendaRange==='week'?`${label(bounds.start)} 〜 ${label(addDays(bounds.end,-1))}`:selectedDate.replaceAll('-','.');
 const entries=agendaEntries(), agenda=$('#agenda'), rail=agendaRange==='day'&&$('#agenda-sort').value==='date';
 agenda.classList.toggle('time-rail',rail&&entries.length>0);
 agenda.replaceChildren(...(entries.length?entries.map(e=>{
   const node=card(e);if(!rail)return node;
   const row=el('div','','time-rail-row'), time=el('time',e.allDay?'終日':timeOnly(e.start),'rail-time');
   if(e.start)time.dateTime=e.start;
   if(e.start&&F.dateKey(e.start)<selectedDate)time.textContent='継続';
   if(e.start&&e.start.length>10&&!e.allDay&&F.dateKey(e.start)===selectedDate&&!e.end)node.querySelector('.card-time').classList.add('rail-duplicate-time');
   row.append(time,node);return row;
 }):[el('p','該当する予定はありません。','empty')]));
 const undated=agendaCandidates().filter(e=>!e.start);$('#undated-section').hidden=!undated.length;$('#undated-count').textContent=`${undated.length}件`;$('#undated').replaceChildren(...undated.map(e=>card(e)));
}
function renderCalendar(){
 const y=Number(period.slice(0,4)),m=Number(period.slice(5,7));$('#year-label').textContent=String(y);const monthLabel=$('#month-label');const monthEn=el('span',MONTH_NAMES[m-1],'month-en');monthEn.lang='en';monthEn.setAttribute('aria-hidden','true');monthLabel.replaceChildren(document.createTextNode(String(m)),monthEn);monthLabel.setAttribute('aria-label',`${y}年${m}月の予定を選択`);monthLabel.setAttribute('aria-pressed',String(agendaRange==='month'));
 const grid=$('#calendar'),events=activeEvents();grid.className='calendar month-grid';grid.replaceChildren();const getEvents=key=>events.filter(e=>F.overlapsDay(e,key)),today=F.dateKey(new Date().toISOString()),bounds=agendaBounds();
 const weekHeading=el('span','','week-selector-heading');weekHeading.setAttribute('aria-hidden','true');grid.append(weekHeading,...WEEKDAY_NAMES.map((d,i)=>el('div',d,`weekday ${i===0?'sun':i===6?'sat':''}`)));
 const offset=dayDate(period).getUTCDay(),last=new Date(Date.UTC(y,m,0)).getUTCDate(),cells=Math.ceil((offset+last)/7)*7;
 for(let i=0;i<cells;i++){
  const key=addDays(period,i-offset);
  if(i%7===0){const button=el('button','›','week-select');button.type='button';button.dataset.weekStart=key;button.setAttribute('aria-label',`${prettyDate(key)}〜${prettyDate(addDays(key,6))}の週を選択`);button.setAttribute('aria-pressed',String(agendaRange==='week'&&selectedWeekStart===key));button.onclick=()=>{selectWeek(key);$('#calendar').querySelector('[data-week-start="'+key+'"]')?.focus({preventScroll:true});};grid.append(button);}
  const inRange=key>=bounds.start&&key<bounds.end,day=el('div','',`day-cell ${key.slice(0,7)!==period.slice(0,7)?'outside':''} ${inRange?'range-selected':''} ${agendaRange==='day'&&key===selectedDate?'selected':''} ${key===today?'today':''}`);day.dataset.date=key;
  const b=el('button',String(Number(key.slice(-2))),'date-button');b.type='button';b.setAttribute('aria-label',`${key}の予定`);b.setAttribute('aria-pressed',String(inRange));if(key===today)b.setAttribute('aria-current','date');b.onclick=event=>activateCalendarDate(key,event);day.append(b);
  const entries=getEvents(key),dots=el('div','','event-dots');dots.setAttribute('aria-hidden','true');for(const e of entries.slice(0,4)){const dot=el('i','',e.status);dot.style.setProperty('--event-color',colorFor(e));dots.append(dot);}day.append(dots,...entries.slice(0,3).map(e=>calendarEvent(e,key)));if(entries.length>3)day.append(el('span',`＋${entries.length-3}件`,'hint'));grid.append(day);
 }
 $('#calendar-count').textContent=`${events.filter(e=>e.start&&F.dateKey(e.start).startsWith(period.slice(0,7))).length}件の予定`;
 renderAgenda();
}
function changeCard(change){
 // Use the same event card and favorite identity as Schedule. Missing is not cancelled.
 const original=change.after||change.before,e=uiEvent(change.kind==='unavailable'?{...original,present:false}:original),node=card(e);
 const open=node.querySelector('.card-open');open.onclick=()=>openChange(change,node.getBoundingClientRect?.());open.setAttribute('aria-label',`${e.title}の変更内容`);
 const detail=change.kind==='updated'?[...new Set((change.fields||[]).map(key=>['start','end','allDay'].includes(key)?'日時変更':(fields[key]||key)+'変更'))].join('・'):'';
 node.querySelector('.card-bottom-note').textContent=change.kind==='unavailable'?'中止とは判断していません':[change.kind==='new'?'New!':(kindNames[change.kind]||'更新'),detail].filter(Boolean).join(' · ');
 return node;
}
function renderChanges(){const list=state.changes.filter(c=>matchesArtist((c.after||c.before)?.artistId)).map(changeCard);$('#changes').replaceChildren(...(list.length?list:[el('p','新着・変更はまだありません。','empty')]));}
function renderStorage(){$('#storage-status').replaceChildren(el('span','このブラウザへの保存'),el('strong',storageFailed?'利用できません':'端末内のみ'));}
function render(){reconcileReadMarker();renderArtists();renderCalendar();renderCards();renderChanges();renderStorage();$('#favorite-count').textContent=state.events.filter(e=>favorites.has(F.stableEventKey(e))).length;$('#unread').textContent=state.changes.filter(c=>c.id>readThrough).length;const source=state.sources[0];$('#connection').classList.toggle('offline',!!source?.error);$('#connection').textContent=source?.error?source.error:`${state.events.length}件 · データ更新 ${prettyDate(state.generatedAt)}`;if(state.storageAvailable===false){storageFailed=true;renderStorage();}}
function markFurinReady(mode){
 const root=globalThis.document?.documentElement;if(!root)return;
 const publish=()=>{root.dataset.furinReady=mode;globalThis.window?.dispatchEvent?.(new Event('furin-calendar-ready'));};
 // Wait until the rendered calendar/agenda DOM has reached a frame boundary.
 if(typeof requestAnimationFrame==='function')requestAnimationFrame(()=>requestAnimationFrame(publish));else publish();
}
async function refresh({notice=false,bootstrap=false}={}){
 const g=++requestGeneration;
 if(bootstrap){try{
   const cached=await scheduleRequest('cached-state'),saved=await cached.json();
   if(g!==requestGeneration)return false;
   if(saved.baselineReady&&Array.isArray(saved.events)){state=saved;render();markFurinReady('cached');}
 }catch{}}
try{const r=await scheduleRequest('state'),next=await r.json();if(g!==requestGeneration)return false;if(!Array.isArray(next.events))throw Error('read');state=next;render();markFurinReady(next.baselineReady?(r.ok?'ready':'cached'):'unavailable');if(!r.ok){toast(next.baselineReady?'予定の更新を取得できませんでした。保存済みの情報を表示しています。':'予定の初回取得ができませんでした。接続を確認してください。');return false;}if(notice)toast('アプリと予定を再読み込みしました。お気に入りは保持しています。');return true;}catch{if(g!==requestGeneration)return false;try{render();}catch{}markFurinReady(state.baselineReady?'cached':'unavailable');toast('予定を読み込めませんでした。接続を確認して再読み込みしてください。');return false;}}
let appUpdating=false;
const APP_RELOAD_NOTICE='alert-pwa-reload-notice-v1';
function rememberAppReload(){try{sessionStorage.setItem(APP_RELOAD_NOTICE,String(Date.now()));}catch{}}
function takeAppReloadNotice(){try{const at=Number(sessionStorage.getItem(APP_RELOAD_NOTICE));sessionStorage.removeItem(APP_RELOAD_NOTICE);return at>0&&Date.now()-at>=0&&Date.now()-at<60000;}catch{return false;}}
function setupNewsTabs(){
 const keys=['events','history','other'],tabs=keys.map(k=>$('#news-'+k+'-tab')),panels=keys.map(k=>$('#news-'+k+'-panel'));
 if(tabs.some(x=>!x)||panels.some(x=>!x))return;
 function activate(next,focus=false){
  tabs.forEach((tab,i)=>{tab.setAttribute('aria-selected',String(i===next));tab.tabIndex=i===next?0:-1;panels[i].hidden=i!==next;});
  if(focus)tabs[next].focus();
 }
 tabs.forEach((tab,i)=>{
  tab.onclick=()=>activate(i);
  tab.onkeydown=e=>{
   const next=e.key==='Home'?0:e.key==='End'?tabs.length-1:e.key==='ArrowLeft'?(i+tabs.length-1)%tabs.length:e.key==='ArrowRight'?(i+1)%tabs.length:null;
   if(next===null)return;e.preventDefault();activate(next,true);
  };
 });
}
let availableAppRelease=null,releaseChecking=false;
const shownAppReleases=new Set();
function showAvailableAppRelease(){
 if(!availableAppRelease||$('#detail').open||appUpdating)return false;
 const area=$('#detail-content');area.dataset.panel='app-release';
 area.replaceChildren(el('h2','v'+availableAppRelease.version+' が配信されました'));
 for(const note of availableAppRelease.notes)area.append(el('p',note));
 area.append(el('p','更新するまで、現在の画面をそのまま使えます。','hint'));
 const actions=el('div','','detail-actions'),close=el('button','キャンセル'),update=el('button','更新する','primary');
 close.onclick=closeDialog;update.onclick=()=>{closeDialog();refreshApp();};
 actions.append(close,update);area.append(actions);openDialog();$('#detail').setAttribute('aria-label','アプリの更新案内');
 shownAppReleases.add(availableAppRelease.version);
 try{localStorage.setItem('alert-pwa-release-announced-v1',availableAppRelease.version);}catch{}
 return true;
}
async function checkAppRelease(){
 if(document.hidden||releaseChecking||document.documentElement?.dataset.furinLaunch||!globalThis.AlertAppReleases)return;
 releaseChecking=true;
 try{
  const release=await globalThis.AlertAppReleases.check(APP_RELEASE);
  if(!release)return;
  availableAppRelease=release;
  const entry=$('#available-app-update');entry.hidden=false;entry.textContent='v'+release.version+' の更新内容を見る';
  let alreadyShown=shownAppReleases.has(release.version);
  try{alreadyShown=alreadyShown||localStorage.getItem('alert-pwa-release-announced-v1')===release.version;}catch{alreadyShown=true;}
  if(!alreadyShown&&!document.hidden)showAvailableAppRelease();
 }catch{}finally{releaseChecking=false;}
}

async function refreshApp(){
 if(appUpdating)return;
 appUpdating=true;
 const button=$('#refresh');button.disabled=true;button.setAttribute('aria-busy','true');
 const labels={checking:'アプリの更新を確認しています…',installing:'新しいアプリを準備しています…',activating:'アプリを切り替えています…',reloading:'アプリと予定を再読み込みしています…'};
 try{
  if(!globalThis.AlertPwaUpdates)throw Error('update-module-missing');
  await globalThis.AlertPwaUpdates.updateAndReload({onStatus:status=>{const label=labels[status];if(label){button.setAttribute('aria-label',label);toast(label);}},beforeReload:rememberAppReload});
 }catch(error){
  const reason=error?.code==='offline'?'オフラインのため更新できません。':error?.code==='timeout'?'更新の確認に時間がかかっています。':'アプリの更新を確認できませんでした。';
  toast(reason+' お気に入りと保存済みの予定はそのままです。接続を確認してもう一度押してください。');
 }finally{appUpdating=false;button.disabled=false;button.removeAttribute('aria-busy');button.setAttribute('aria-label','アプリと予定を更新');}
}


// After native scrolling settles, only nearby Schedule headings qualify.
function scheduleSnapTarget(y,anchors){
 if(y<=12)return null;
 let best=null,distance=Infinity;
 for(const [anchor,limit] of anchors){
  const d=Math.abs(anchor-y);
  if(d<=limit&&d<distance){best=anchor;distance=d;}
 }
 return distance>=4?best:null;
}
function scheduleAgendaTarget(y,target,direction,row,visibleBottom){
 return direction>0&&target-y>=4&&row.top>=0&&row.bottom>row.top&&row.bottom<=visibleBottom?target:null;
}
function initScheduleScroll(){
 const calendar=$('.calendar-panel'),agenda=$('#agenda-title'),layout=$('.calendar-layout'),section=$('#calendar-view'),filters=$('#calendar-view .card-filter-row'),nav=$('.sidebar nav');
 const narrow=window.matchMedia?.('(max-width: 700px)');
 if(!calendar||!agenda||!layout||!section||!filters||!nav||!narrow)return;
 let lastEnd=null,timer,held=false,previousY=window.scrollY,direction=0;
 const measure=()=>{
  if(section.hidden||!narrow.matches||$('#detail').open)return;
  const end=Math.ceil(calendar.getBoundingClientRect().bottom+window.scrollY);
  if(end>0&&end!==lastEnd){lastEnd=end;layout.style.setProperty('--schedule-calendar-end',end+'px');}
 };
 const calculate=()=>{
  if(held||section.hidden||!narrow.matches||$('#detail').open||window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches)return;
  const y=window.scrollY;
  const max=Math.max(0,document.documentElement.scrollHeight-window.innerHeight);
  const contentStart=node=>Math.max(0,Math.min(max,Math.round(node.getBoundingClientRect().top+y-(parseFloat(getComputedStyle(node).scrollMarginTop)||0))));
  const visibleBottom=Math.min(window.visualViewport?.height??window.innerHeight,nav.getBoundingClientRect().top);
  const cardTarget=scheduleAgendaTarget(y,contentStart(agenda),direction,filters.getBoundingClientRect(),visibleBottom);
  const calendarTarget=scheduleSnapTarget(y,[[0,60],[contentStart(calendar),140]]);
  const anchor=cardTarget??(calendarTarget!==null&&calendarTarget<=y?calendarTarget:null);
  if(anchor!==null)window.scrollTo({top:anchor,left:0,behavior:'smooth'});
 };
 const settle=()=>{clearTimeout(timer);if(!held)timer=setTimeout(calculate,140);};
 if(typeof ResizeObserver!=='undefined'){
  const observer=new ResizeObserver(measure);observer.observe(calendar);
  for(const node of [$('.app-header'),$('#artist-filters')])if(node)observer.observe(node);
 }
 window.addEventListener('resize',measure,{passive:true});
 window.addEventListener('hashchange',()=>{clearTimeout(timer);previousY=window.scrollY;direction=0;measure();});
 window.addEventListener('touchstart',()=>{held=true;clearTimeout(timer);},{passive:true});
 window.addEventListener('touchend',event=>{held=event.touches.length>0;settle();},{passive:true});
 window.addEventListener('touchcancel',()=>{held=false;clearTimeout(timer);},{passive:true});
 window.addEventListener('scroll',()=>{const y=window.scrollY;if(y!==previousY)direction=Math.sign(y-previousY);previousY=y;settle();},{passive:true});measure();
}
function route(){
// Only notification entry clears the artist filter; a normal News tab keeps it.
if(location.hash==='#notification-changes'){selectedArtists.clear();artist='all';history.replaceState(null,'','#changes');$('#news-events-tab')?.click();renderArtists();renderChanges();}

const hash=location.hash.slice(1),previousView=view;
if(hash==='settings'||hash==='about')$('#news-other-tab')?.click();
view=['calendar','favorites','changes'].includes(hash)?hash:['find','cards','watch'].includes(hash)?'search':['about','settings'].includes(hash)?'changes':'calendar';
const names={calendar:'Schedule',search:'Search',favorites:'Favorite',changes:'News & Setting'};
$('#view-title').textContent=names[view];
const menuIcon=$(`nav [data-view="${view}"] > span:first-child`);
if(menuIcon){const icon=menuIcon.cloneNode(true);icon.className='view-title-icon';icon.setAttribute('aria-hidden','true');$('#view-title').prepend(icon);}
const back=$('#back-to-view'),leavingLegacySearch=view==='search'&&hash==='find'&&!back.hidden;back.hidden=!['cards','watch'].includes(hash);back.href='#changes';back.setAttribute('aria-label','News & Settingに戻る');
document.querySelectorAll('.view').forEach(e=>e.hidden=e.id!==`${view==='search'?'cards':view}-view`);
const nav=$('.sidebar nav');
if(nav&&view!==previousView){
 const order=['calendar','favorites','search','changes'];
 nav.dataset.slide=order.indexOf(view)>order.indexOf(previousView)?'right':'left';
}
document.querySelectorAll('[data-view]').forEach(a=>{a.classList.toggle('active',a.dataset.view===view);if(a.dataset.view===view)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
if($('#detail').open)closeDialog();
if(leavingLegacySearch||(view!==previousView&&(view==='calendar'||view==='changes'||previousView==='changes'||view==='search'))){window.scrollTo({top:0,left:0,behavior:'instant'});$('#view-title').focus({preventScroll:true});}
}

// Re-activating the visible tab jumps to the beginning without following its fragment.
function preventActiveTabNavigation(event){
 if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
 if(event.currentTarget.dataset.view!==view||(view==='search'&&location.hash!=='#find'))return;
 event.preventDefault();
 window.scrollTo({top:0,left:0,behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
}

$('#detail').addEventListener('close',onDialogClosed);installCardSwipe($('#detail'),()=>$('#detail-content').dataset.panel,closeDialog);$('#close-detail').onclick=closeDialog;$('#detail').addEventListener('click',e=>{if(e.target===$('#detail')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeDialog();}});
$('#calendar-share').onclick=()=>openSubscriptions(artist==='all'?undefined:artist);$('#about-subscriptions').onclick=()=>openSubscriptions(artist==='all'?undefined:artist);
function initAppearance(){
 const button=$('#theme-toggle');if(!button)return;
 const preference=window.matchMedia?.('(prefers-color-scheme: dark)');
 const key='furin-appearance-v1',root=document.documentElement;
 let choice=null;
 try{const stored=localStorage.getItem(key);if(stored==='light'||stored==='dark')choice=stored;}catch{}
 const paint=()=>{
  const theme=choice||(preference?.matches?'dark':'light');
  root.dataset.theme=theme;
  $('meta[name="theme-color"]')?.setAttribute('content',theme==='dark'?'#17171d':'#f7f6fb');
  button.setAttribute('aria-label',theme==='dark'?'明るい表示に切り替える':'暗い表示に切り替える');
 };
 button.onclick=()=>{
  choice=root.dataset.theme==='dark'?'light':'dark';
  try{localStorage.setItem(key,choice);}catch{}
  paint();
 };
 preference?.addEventListener?.('change',paint);paint();button.hidden=false;
}
initAppearance();
$('#refresh').onclick=refreshApp;$('#search').oninput=renderCards;$('#sort').onchange=renderCards;document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));renderCards();});$('#agenda-sort').onchange=renderAgenda;document.querySelectorAll('[data-agenda-filter]').forEach(b=>b.onclick=()=>{agendaFilter=b.dataset.agendaFilter;document.querySelectorAll('[data-agenda-filter]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));renderAgenda();});$('#month-label').onclick=selectMonth;$('.calendar-panel').onclick=e=>{if(e.target.closest('button,a,input,select'))return;const day=e.target.closest('.day-cell');if(day)activateCalendarDate(day.dataset.date,e);};
function movePeriod(direction){const d=dayDate(period);d.setUTCMonth(d.getUTCMonth()+direction);period=F.dateKey(d.toISOString()).slice(0,7)+'-01';selectedDate=period;agendaRange='month';selectedWeekStart=null;renderCalendar();}
$('#prev-period').onclick=()=>movePeriod(-1);$('#next-period').onclick=()=>movePeriod(1);$('#today').onclick=selectToday;$('#read-all').onclick=()=>{readThrough=Math.max(readThrough,...state.changes.map(c=>c.id));save(readKey,readThrough);render();toast('確認済みにしました。履歴は残ります。');};$('#select-visible').onchange=()=>{for(const e of visibleCards().filter(e=>F.exportEligibility(e).eligible)){const key=F.stableEventKey(e);$('#select-visible').checked?selected.add(key):selected.delete(key);}save('alert-pwa-selected-v1',[...selected]);renderCards();};$('#export-selected').onclick=()=>openExport(state.events.filter(e=>selected.has(F.stableEventKey(e))));
setupNewsTabs();$('#available-app-update').onclick=showAvailableAppRelease;
document.querySelectorAll('[data-view]').forEach(link=>link.addEventListener('click',preventActiveTabNavigation));
$('#source-list').replaceChildren(...artists.map(a=>{const row=el('div','','source-item'),link=el('a','公式サイト ↗');link.href=a.officialUrl;link.target='_blank';link.rel='noopener noreferrer';row.append(el('strong',a.name),link);return row;}));window.addEventListener('click',resetCalendarDateTap,true);window.addEventListener('hashchange',route);document.addEventListener('visibilitychange',()=>{if(!document.hidden){refresh();checkAppRelease();}});if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).catch(()=>toast('オフライン用の準備ができませんでした。'));renderArtists();route();initScheduleScroll();refresh({notice:takeAppReloadNotice(),bootstrap:true});window.addEventListener('furin-launch-closed',checkAppRelease,{once:true});checkAppRelease();setInterval(()=>{if(!document.hidden)checkAppRelease();},300000);
