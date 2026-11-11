'use strict';
const $=s=>document.querySelector(s), F=globalThis.AlertFeatures, S=globalThis.AlertCalendarSubscriptions;
const el=(tag,value='',cls='')=>{const e=document.createElement(tag);e.textContent=value;if(cls)e.className=cls;return e;};
const statusNames={possible:'かも？',confirmed:'確定',unknown:'未確認',cancelled:'中止'};
const fields={title:'タイトル',start:'開始',end:'終了',allDay:'終日',status:'確度',category:'種類',location:'場所',note:'メモ',evidence:'根拠',artistId:'アーティスト',deadline:'正式締切'};
const kindNames={new:'新着',updated:'更新',unavailable:'掲載消失',restored:'再掲載'};
const colors={BENEFIT:'#eaa75d',LIVE:'#e65091',EVENT:'#eaa75d',STREAM:'#8a6cdb',TV:'#6886d3',RADIO:'#4da79f',REMIND:'#cf8958',MEMO:'#8693a7'};
const icons={BENEFIT:'◇',LIVE:'♬',EVENT:'◇',STREAM:'▷',TV:'▣',RADIO:'◉',REMIND:'◷',MEMO:'▤'};
const artists=globalThis.ALERT_ARTISTS;
const getArtist=id=>artists.find(a=>a.id===id);
let state={events:[],changes:[],sources:[],outboxCount:0},artist='all',filter='all',calendarMode='month',view='calendar',returnView='calendar';
let selectedDate=F.dateKey(new Date().toISOString()),period=selectedDate.slice(0,7)+'-01',requestGeneration=0,mutating=false,toastTimer,storageFailed=false;
function stored(key,fallback){try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{storageFailed=true;return fallback;}}
function save(key,value){try{localStorage.setItem(key,JSON.stringify(value));return true;}catch{storageFailed=true;renderStorage();toast('保存領域を利用できません。この画面でのみ設定を保持します。');return false;}}
const storedFavorites=stored('alert-pwa-favorites-v1',[]),storedSelected=stored('alert-pwa-selected-v1',[]),storedReminders=stored('alert-pwa-reminders-v2',{});
let favorites=new Set(Array.isArray(storedFavorites)?storedFavorites:[]),selected=new Set(Array.isArray(storedSelected)?storedSelected:[]),reminders=storedReminders&&typeof storedReminders==='object'&&!Array.isArray(storedReminders)?storedReminders:{},readThrough=Number(stored('alert-pwa-curated-read-v1',0))||0;
let morningTime=stored('alert-pwa-morning-v1','08:00');if(typeof morningTime!=='string'||!/^([01]\d|2[0-3]):[0-5]\d$/.test(morningTime))morningTime='08:00';
function presentEvent(e){return {...e,artist:getArtist(e.artistId)?.name||e.artistId};}
function toast(message){$('#toast').textContent=message;$('#toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').hidden=true,5500);}
function prettyDate(value){if(!value)return '日時未定';if(value.length===10)return value.replaceAll('-','/');return new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value));}
function timeOnly(value){if(!value||value.length===10)return '未定';return new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(value));}
function dayDate(key){return new Date(key+'T12:00:00+09:00');}
function addDays(key,days){const d=dayDate(key);d.setUTCDate(d.getUTCDate()+days);return F.dateKey(d.toISOString());}
function timing(e){if(!e.start)return e.dateLabel||'日時未定';if(e.allDay)return `${prettyDate(e.start)}${e.end?' 〜 '+prettyDate(addDays(e.end,-1)):''} · 終日`;return `${prettyDate(e.start)}${e.start.length===10?' · 時刻未定':''}${e.end?' 〜 '+prettyDate(e.end):''}`;}
function colorFor(e){return colors[e.category]||colors.EVENT;}
function statusBadge(e){return el('span',e.present===false?'掲載消失':statusNames[e.status]||'未確認',`status ${e.present===false?'missing':e.status}`);}
function matching(extra={}){return F.filterEvents(state.events,{artist,category:'all',status:'all',sort:'date',favorites,...extra});}
function activeEvents(){return matching().filter(e=>e.present!==false&&e.status!=='cancelled');}
function renderArtists(){const list=[{id:'all',name:'すべてのアーティスト'},...artists];$('#artist-filters').replaceChildren(...list.map(a=>{const b=el('button');b.type='button';b.setAttribute('aria-pressed',String(artist===a.id));if(a.accent){const dot=el('i','','artist-dot');dot.style.setProperty('--artist',a.accent);dot.setAttribute('aria-hidden','true');b.append(dot);}b.append(document.createTextNode(a.name));b.onclick=()=>{artist=a.id;render();[...$('#artist-filters').children].find(x=>x.getAttribute('aria-pressed')==='true')?.focus();};return b;}));}
function toggleFavorite(e){const key=F.stableEventKey(e);favorites.has(key)?favorites.delete(key):favorites.add(key);save('alert-pwa-favorites-v1',[...favorites]);render();}
function favoriteMark(active){const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('class','favorite-icon');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');const heart=document.createElementNS(ns,'path');heart.setAttribute('d','M12 20.5 3.8 12.4C.2 8.8 2.2 3.5 6.5 3.5c2.3 0 4 1.4 5.5 3.2 1.5-1.8 3.2-3.2 5.5-3.2 4.3 0 6.3 5.3 2.7 8.9Z');heart.setAttribute('fill',active?'#fff':'#222332');heart.setAttribute('stroke','#222332');heart.setAttribute('stroke-width','1.4');heart.setAttribute('stroke-linejoin','round');svg.append(heart);return svg;}
function favoriteButton(e){const b=el('button','','favorite-button');b.append(favoriteMark(favorites.has(F.stableEventKey(e))));b.type='button';b.setAttribute('aria-label',`${e.title}のお気に入り`);b.setAttribute('aria-pressed',String(favorites.has(F.stableEventKey(e))));b.onclick=()=>{const container=b.closest('[id]')?.id;toggleFavorite(e);if(container)[...document.getElementById(container).querySelectorAll('button[aria-label]')].find(x=>x.getAttribute('aria-label')===`${e.title}のお気に入り`)?.focus({preventScroll:true});};return b;}
function card(e,selectable=false){const key=F.stableEventKey(e),c=el('article','',`event-card ${e.present===false?'missing':e.status}`);c.style.setProperty('--event-color',colorFor(e));const body=el('div','','card-body'),top=el('div','','card-top');top.append(el('span',`${icons[e.category]||'◇'} ${e.category}`,'category'),statusBadge(e));body.append(top);const open=el('button','','card-open');open.type='button';open.setAttribute('aria-label',`${e.title}の詳細`);open.append(el('h3',e.title));open.onclick=()=>openEvent(e);body.append(open,el('p',getArtist(e.artistId)?.name||'サンプル','artist-name'),el('p',timing(e),'card-time'),el('p',e.location||'場所未定','card-location'));const actions=el('div','','card-actions');if(selectable){const label=el('label','','select-label'),input=document.createElement('input');input.type='checkbox';input.checked=selected.has(key);input.disabled=!F.exportEligibility(e).eligible;input.setAttribute('aria-label',`${e.title}を選択`);input.onchange=()=>{input.checked?selected.add(key):selected.delete(key);save('alert-pwa-selected-v1',[...selected]);renderSelection();};label.append(input,document.createTextNode(input.disabled?'日時を確認待ち':'まとめて登録'));actions.append(label);}else actions.append(el('span',e.checkedAt?'確認 '+prettyDate(e.checkedAt):'出典を確認','card-bottom-note'));actions.append(favoriteButton(e));body.append(actions);c.append(body);return c;}
function appendSourcesAndTimes(area,e){
if(e.timings?.length){area.append(el('h3','開催・受付の日時'));const list=el('ul','','event-timings');for(const t of e.timings){const line=el('li');line.append(el('strong',t.label+'：'),document.createTextNode((t.at?prettyDate(t.at):t.date?prettyDate(t.date)+'・時刻未定':'時刻未定')+(t.status==='possible'?'（外部情報・かも？）':'')+(t.note?' / '+t.note:'')));list.append(line);}area.append(list);}
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
function openDialog(){
 const detail=$('#detail');
 if(detail.open)return;
 unlockDialogScroll();
 lockDialogScroll();
 try{detail.showModal();detail.scrollTop=0;}catch(error){unlockDialogScroll();throw error;}
}
function closeDialog(){$('#detail').close();unlockDialogScroll();}
function onDialogClosed(){if(!$('#detail').open)unlockDialogScroll();}

function openEvent(e){const area=$('#detail-content');area.dataset.panel='event';area.replaceChildren(statusBadge(e),el('h2',e.title),el('p',getArtist(e.artistId)?.name||'サンプル','detail-meta'),el('p',timing(e)),el('p',e.location||'場所未定'),el('p',e.note));if(e.deadline)area.append(el('p','正式締切 '+prettyDate(e.deadline)));const actions=el('div','','detail-actions');const fav=favoriteButton(e);fav.onclick=()=>{toggleFavorite(e);openEvent(e);$('#detail-content .favorite-button')?.focus({preventScroll:true});};actions.append(fav);const exportButton=el('button','本体カレンダーに追加','primary');exportButton.onclick=()=>openSubscriptions(e.artistId);actions.append(exportButton);area.append(actions);if(exportButton.disabled)area.append(el('p',F.exportEligibility(e).label||'日時未定・中止・掲載消失の情報は出力できません。','hint'));area.append(el('h3','判断の根拠'),el('p',e.evidence||'根拠未登録','evidence'));if(e.present===false)area.append(el('p','元ページから掲載がなくなりました。中止とは確定していません。'));appendSourcesAndTimes(area,e);
const box=el('div','','reminder-box');box.append(el('h3','通知時刻の確認'));const label=el('label','リマインド例 '),select=document.createElement('select');select.setAttribute('aria-label','リマインド設定例');for(const [value,title] of [['off','設定しない'],['morning1h',`朝${morningTime}＋開始1時間前`],...(e.deadline?[['deadline2',`朝${morningTime}＋締切前`]]:[])]){const o=el('option',title);o.value=value;select.append(o);}const key=F.stableEventKey(e);select.value=reminders[key]||'off';select.disabled=!e.start||(!e.allDay&&e.start.length===10)||e.present===false||e.status==='cancelled';select.onchange=()=>{reminders[key]=select.value;save('alert-pwa-reminders-v2',reminders);openEvent(e);toast('通知時刻の設定例を保存しました。実通知は未接続です。');};label.append(select);box.append(label);if(select.value!=='off'&&!select.disabled){const plan=F.reminderTimes(e,{mode:select.value,morningTime,now:new Date().toISOString()});for(const t of plan.times)box.append(el('p',`${prettyDate(t.at)} · ${t.label}`));for(const u of plan.unresolved)box.append(el('p',u.label||'時刻の確認が必要です。','hint'));if(!plan.times.length)box.append(el('p','これからの通知候補はありません。過去の通知や開始後の朝通知は出しません。','hint'));}box.append(el('p','時刻のプレビューです。通知は予約・配信されません。','hint'));area.append(box);
const preview=F.notificationPreview(presentEvent(e),{real:true}),notice=el('div','','notification-preview');notice.append(el('small','通知表示のプレビュー · 実通知ではありません'),el('strong',preview.title),el('p',preview.body));area.append(notice);const latest=state.changes.find(c=>c.eventId===e.id&&c.source===e.source);if(latest){const b=el('button','最後の変更を見る');b.onclick=()=>openChange(latest);area.append(b);}openDialog();}
let subscriptionChoices=new Set(),subscriptionManifest=null,subscriptionLoading=false,subscriptionError=false,subscriptionLoadGeneration=0;
async function loadSubscriptions(){
 if(subscriptionLoading)return;subscriptionLoading=true;subscriptionError=false;const generation=++subscriptionLoadGeneration;
 try{const manifest=await S.loadManifest();if(generation!==subscriptionLoadGeneration)return;subscriptionManifest=manifest;}catch{if(generation!==subscriptionLoadGeneration)return;subscriptionManifest=null;subscriptionError=true;}finally{if(generation===subscriptionLoadGeneration)subscriptionLoading=false;}
 if($('#detail').open&&$('#detail-content').dataset.panel==='subscriptions')renderSubscriptions();
}
function openSubscriptions(artistId){
 if(artistId&&S.ARTISTS.includes(artistId))subscriptionChoices=new Set([artistId+'-all']);
 subscriptionLoadGeneration++;subscriptionManifest=null;subscriptionError=false;subscriptionLoading=false;
 $('#detail-content').dataset.panel='subscriptions';renderSubscriptions();openDialog();loadSubscriptions();
}
function renderSubscriptions(){
 const area=$('#detail-content');area.replaceChildren(el('h2','本体カレンダーに追加'));
 const groups=el('div','','subscription-presets');
 for(const id of S.ARTISTS){const section=el('section');section.append(el('h3',getArtist(id)?.name||id));for(const preset of S.PRESETS.filter(p=>p.artist===id)){const label=el('label','','source-item'),input=document.createElement('input');input.type='checkbox';input.value=preset.id;input.dataset.preset=preset.id;input.checked=subscriptionChoices.has(preset.id);const name=preset.label.split(' / ')[1];input.setAttribute('aria-label',(getArtist(id)?.name||id)+' '+name);input.onchange=()=>{if(input.checked){if(preset.category==='all')for(const p of S.PRESETS.filter(p=>p.artist===id))subscriptionChoices.delete(p.id);else subscriptionChoices.delete(id+'-all');subscriptionChoices.add(preset.id);}else subscriptionChoices.delete(preset.id);subscriptionChoices=new Set(S.planSelection([...subscriptionChoices]).selected);renderSubscriptions();area.querySelector('input[data-preset="'+preset.id+'"]')?.focus({preventScroll:true});};label.append(el('span',name),input);section.append(label);}groups.append(section);}area.append(groups);
 const selected=S.planSelection([...subscriptionChoices]).selected;
 if(!selected.length)area.append(el('p','購読したい範囲を選んでください。','hint'));
 if(!subscriptionManifest){const status=el('p',subscriptionError?'購読先を確認できません。通信状態を確認して再試行してください。':'購読先を確認しています…','hint');status.setAttribute('role','status');area.append(status);if(subscriptionError){const retry=el('button','再試行');retry.onclick=()=>{subscriptionError=false;renderSubscriptions();loadSubscriptions();};area.append(retry);}return;}
 if(selected.length)area.append(el('p','1種類ずつ追加してください。全予定とその内訳の重複登録にご注意ください。','hint'));
 for(const id of selected){const feed=subscriptionManifest.feeds.find(f=>f.id===id),urls=S.links(id),row=el('section','','subscription-link');row.append(el('h3',feed.label),el('p',feed.count+'件'+(feed.omittedUnknownDate?' · 日付未定'+feed.omittedUnknownDate+'件は未配信':''),'hint'));const actions=el('div','','detail-actions'),subscribe=el('a','本体カレンダーで購読','primary subscription-action');subscribe.href=urls.webcal;subscribe.setAttribute('aria-label',feed.label+'を購読');actions.append(subscribe);const copy=el('button','URLをコピー');copy.type='button';copy.setAttribute('aria-label',feed.label+'の購読URLをコピー');copy.onclick=async()=>{try{if(!navigator.clipboard?.writeText)throw new Error('unavailable');await navigator.clipboard.writeText(urls.https);toast('購読URLをコピーしました。');}catch{field.hidden=false;field.focus({preventScroll:true});field.select();toast('表示されたURLを選択してコピーしてください。');}};actions.append(copy);row.append(actions);const field=document.createElement('input');field.type='url';field.value=urls.https;field.readOnly=true;field.hidden=true;field.className='subscription-url';field.setAttribute('aria-label',feed.label+'の購読URL');row.append(field);area.append(row);}
 area.append(el('p','読み取り専用 · 反映に時間差あり','hint'));const help=el('a','購読の説明を見る','subscription-help');help.href='#about';help.onclick=()=>closeDialog();area.append(help);
}
function openExport(events){const result=F.buildICS(events.map(presentEvent),{now:new Date().toISOString()}),area=$('#detail-content');area.replaceChildren(el('h2','カレンダーに渡す予定'),el('p',`${result.included.length}件の架空サンプルをICSファイルにします。`));const list=el('ul','','export-list');for(const e of result.included)list.append(el('li',`${e.status==='possible'?'［かも？］':''}${e.title} · ${timing(e)}`));area.append(list);for(const s of result.skipped)area.append(el('p',`${s.event?.title||'予定'}：${s.label||s.reason}（出力しません）`,'hint'));area.append(el('p','ファイルを保存しただけでは、本体カレンダーへの登録は完了しません。対応するカレンダーで内容を確認して追加してください。iPhoneでの受け渡しは実機未検証です。','evidence'),el('p','自動同期ではありません。内容が変わっても自動更新しません。通知設定はファイルに含めません。','hint'));const b=el('button',`${result.included.length}件のICSを作成`,'primary');b.disabled=!result.included.length;b.onclick=()=>{const url=URL.createObjectURL(new Blob([result.ics],{type:'text/calendar;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download='alert-sample-events.ics';a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);toast('ICSファイルを作成しました。本体への追加はカレンダー側で確認してください。');};area.append(b);openDialog();}
function showValue(key,value){if(value===null||value===undefined||value==='')return '未設定';if(key==='status')return statusNames[value]||value;if(key==='artistId')return getArtist(value)?.name||value;if(key==='allDay')return value?'終日':'時刻指定／時刻未定';if(['start','end','deadline'].includes(key))return prettyDate(value);return String(value);}
function openChange(c){const area=$('#detail-content'),e=c.after||c.before;area.replaceChildren(el('span',kindNames[c.kind],'status'),el('h2',e.title),el('p',`検知 ${prettyDate(c.detected)} · r${c.revision}`,'hint'));if(c.kind==='unavailable')area.append(el('p','掲載がなくなったため前回の内容を保持しています。中止とは判断しません。','evidence'));else for(const key of c.fields){const row=el('div','','diff-item');row.append(el('div',fields[key]||key,'diff-label'));if(c.before)row.append(el('div',showValue(key,c.before[key]),'diff-before'));if(c.after)row.append(el('div',showValue(key,c.after[key]),'diff-after'));area.append(row);}const p=F.notificationPreview({...c,before:c.before?presentEvent(c.before):null,after:c.after?presentEvent(c.after):null},{real:true}),preview=el('div','','notification-preview');preview.append(el('small','通知のプレビュー · 送信していません'),el('strong',p.title),el('p',p.body));area.append(preview);openDialog();}
function visibleCards(){return matching({status:filter,query:$('#search').value,sort:$('#sort').value});}
function renderCards(){const list=visibleCards();$('#cards').replaceChildren(...(list.length?list.map(e=>card(e)):[el('p','該当する予定はありません。','empty')]));const f=matching({favoritesOnly:true});$('#favorites').replaceChildren(...(f.length?f.map(e=>card(e)):[el('p','お気に入りはまだありません。','empty')]));renderSelection();}
function renderSelection(){const eligible=visibleCards().filter(e=>F.exportEligibility(e).eligible),all=eligible.length>0&&eligible.every(e=>selected.has(F.stableEventKey(e)));$('#select-visible').checked=all;$('#select-visible').indeterminate=!all&&eligible.some(e=>selected.has(F.stableEventKey(e)));$('#select-visible').disabled=!eligible.length;const count=state.events.filter(e=>selected.has(F.stableEventKey(e))&&F.exportEligibility(e).eligible).length;$('#selected-count').textContent=count;$('#export-selected').disabled=!count;}
function calendarEvent(e){const b=el('button',e.title,`calendar-event ${e.status}`);b.style.setProperty('--event-color',colorFor(e));b.title=`${e.title} · ${statusNames[e.status]} · ${timing(e)}`;b.onclick=()=>openEvent(e);return b;}
function selectDay(key){selectedDate=key;period=key.slice(0,7)+'-01';renderCalendar();}
function renderCalendar(){const y=Number(period.slice(0,4)),m=Number(period.slice(5,7));$('#year-label').textContent=String(y);const monthLabel=$('#month-label');monthLabel.replaceChildren(document.createTextNode(`${m}月`),el('span',new Intl.DateTimeFormat('en',{month:'long',timeZone:'Asia/Tokyo'}).format(dayDate(period))));document.querySelectorAll('[data-mode]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.mode===calendarMode)));const grid=$('#calendar'),events=activeEvents();grid.className='calendar'+(calendarMode==='week'?' week':calendarMode==='day'?' day-view':'');grid.replaceChildren();const getEvents=key=>events.filter(e=>F.overlapsDay(e,key));const today=F.dateKey(new Date().toISOString());
if(calendarMode==='month'){grid.append(...'日月火水木金土'.split('').map((d,i)=>el('div',d,`weekday ${i===0?'sun':i===6?'sat':''}`)));const offset=dayDate(period).getUTCDay(),last=new Date(Date.UTC(y,m,0)).getUTCDate(),cells=Math.ceil((offset+last)/7)*7;for(let i=0;i<cells;i++){const key=addDays(period,i-offset),day=el('div','',`day-cell ${key.slice(0,7)!==period.slice(0,7)?'outside':''} ${key===selectedDate?'selected':''} ${key===today?'today':''}`);const b=el('button',String(Number(key.slice(-2))),'date-button');b.setAttribute('aria-label',`${key}の予定`);b.setAttribute('aria-pressed',String(key===selectedDate));b.onclick=()=>selectDay(key);day.append(b);const entries=getEvents(key),dots=el('div','','event-dots');dots.setAttribute('aria-hidden','true');for(const e of entries.slice(0,4)){const dot=el('i','',e.status);dot.style.setProperty('--event-color',colorFor(e));dots.append(dot);}day.append(dots,...entries.slice(0,3).map(calendarEvent));if(entries.length>3)day.append(el('span',`＋${entries.length-3}件`,'hint'));grid.append(day);}}
else if(calendarMode==='week'){const start=addDays(selectedDate,-dayDate(selectedDate).getUTCDay());for(let i=0;i<7;i++){const key=addDays(start,i),column=el('div','',`week-column ${key===selectedDate?'selected':''}`);column.append(el('p','日月火水木金土'[i],'week-name'));const b=el('button',String(Number(key.slice(-2))),'date-button');b.setAttribute('aria-label',`${key}の予定`);b.onclick=()=>selectDay(key);column.append(b,...getEvents(key).map(calendarEvent));grid.append(column);}}
else{const entries=getEvents(selectedDate);for(const e of entries){const row=el('div','','day-agenda-row');row.append(el('time',e.allDay?'終日':timeOnly(e.start)),card(e));grid.append(row);}if(!entries.length)grid.append(el('p','この日の予定はありません。','empty'));}
$('#calendar-count').textContent=`${events.filter(e=>e.start&&F.dateKey(e.start).startsWith(period.slice(0,7))).length}件の予定`;
$('#selected-date').textContent=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'long',day:'numeric',weekday:'long'}).format(dayDate(selectedDate));const entries=getEvents(selectedDate);$('#agenda-title').textContent=entries.length?'この日の予定':'次に気になる予定';const next=entries.length?entries:events.filter(e=>e.start&&F.dateKey(e.start)>=selectedDate).slice(0,2);$('#agenda').replaceChildren(...(next.length?next.map(e=>card(e)):[el('p','この日以降の予定はまだありません。','empty')]));const undated=events.filter(e=>!e.start);$('#undated').replaceChildren(...(undated.length?[el('h3','日付未定'),...undated.map(e=>card(e))]:[]));}
function renderChanges(){const list=state.changes.filter(c=>artist==='all'||(c.after||c.before)?.artistId===artist).map(c=>{const b=el('button','','change'),copy=el('div');b.append(el('span',c.kind==='new'?'+':'↻','change-mark'));copy.append(el('h3',`${kindNames[c.kind]} · ${(c.after||c.before).title}`),el('p',c.kind==='unavailable'?'掲載消失。中止とは判断していません。':c.fields.map(f=>fields[f]||f).join('・')),el('time',prettyDate(c.detected)));b.append(copy);b.onclick=()=>openChange(c);return b;});$('#changes').replaceChildren(...(list.length?list:[el('p','新着・変更はまだありません。','empty')]));}
function renderStorage(){$('#storage-status').replaceChildren(el('span','このブラウザへの保存'),el('strong',storageFailed?'利用できません':'端末内のみ'));}
function render(){renderArtists();renderCalendar();renderCards();renderChanges();renderStorage();$('#favorite-count').textContent=state.events.filter(e=>favorites.has(F.stableEventKey(e))).length;$('#unread').textContent=state.changes.filter(c=>c.id>readThrough).length;const source=state.sources[0];$('#connection').classList.toggle('offline',!!source?.error);$('#connection').textContent=source?.error?source.error:`${state.events.length}件 · データ更新 ${prettyDate(state.generatedAt)}`;if(state.storageAvailable===false){storageFailed=true;renderStorage();}}
async function refresh({notice=false}={}){const g=++requestGeneration;try{const r=await scheduleRequest('state'),next=await r.json();if(g!==requestGeneration)return false;if(!Array.isArray(next.events))throw Error('read');state=next;render();if(!r.ok){toast(next.baselineReady?'予定の更新を取得できませんでした。保存済みの情報を表示しています。':'予定の初回取得ができませんでした。接続を確認してください。');return false;}if(notice)toast('アプリと予定を再読み込みしました。お気に入りは保持しています。');return true;}catch{if(g!==requestGeneration)return false;toast('予定を読み込めませんでした。接続を確認して再読み込みしてください。');return false;}}
let appUpdating=false;
const APP_RELOAD_NOTICE='alert-pwa-reload-notice-v1';
function rememberAppReload(){try{sessionStorage.setItem(APP_RELOAD_NOTICE,String(Date.now()));}catch{}}
function takeAppReloadNotice(){try{const at=Number(sessionStorage.getItem(APP_RELOAD_NOTICE));sessionStorage.removeItem(APP_RELOAD_NOTICE);return at>0&&Date.now()-at>=0&&Date.now()-at<60000;}catch{return false;}}
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


function route(){
const hash=location.hash.slice(1),previousView=view;
view=['calendar','cards','favorites','changes','about'].includes(hash)?hash:hash==='settings'?'about':hash==='watch'?'cards':'calendar';
if(view==='about'&&previousView!=='about')returnView=previousView;
const names={calendar:'カレンダー',cards:'カード',favorites:'お気に入り',changes:'お知らせ',about:'説明'};
$('#view-title').textContent=names[view];
const back=$('#back-to-view');back.hidden=view!=='about';back.href='#'+returnView;back.setAttribute('aria-label',names[returnView]+'に戻る');
document.querySelectorAll('.view').forEach(e=>e.hidden=e.id!==`${view}-view`);
document.querySelectorAll('[data-view]').forEach(a=>{a.classList.toggle('active',a.dataset.view===view);if(a.dataset.view===view)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});
if($('#detail').open)closeDialog();
if(view!==previousView&&(view==='about'||previousView==='about')){window.scrollTo({top:0,left:0,behavior:'instant'});$('#view-title').focus({preventScroll:true});}
}
$('#morning-time').value=morningTime;$('#morning-time').onchange=()=>{const value=$('#morning-time').value;if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)){toast('朝の時刻を指定してください。');return;}morningTime=value;save('alert-pwa-morning-v1',morningTime);toast('朝の通知時刻の設定例を保存しました。実通知は未接続です。');};
$('#detail').addEventListener('close',onDialogClosed);$('#close-detail').onclick=closeDialog;$('#detail').addEventListener('click',e=>{if(e.target===$('#detail')){const r=e.target.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeDialog();}});
$('#open-subscriptions').onclick=()=>openSubscriptions(artist==='all'?undefined:artist);$('#about-subscriptions').onclick=()=>openSubscriptions(artist==='all'?undefined:artist);
$('#refresh').onclick=refreshApp;$('#search').oninput=renderCards;$('#sort').onchange=renderCards;document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{filter=b.dataset.filter;document.querySelectorAll('[data-filter]').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));renderCards();});document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{calendarMode=b.dataset.mode;renderCalendar();});
function movePeriod(direction){if(calendarMode==='month'){const d=dayDate(period);d.setUTCMonth(d.getUTCMonth()+direction);period=F.dateKey(d.toISOString()).slice(0,7)+'-01';selectedDate=period;}else{selectedDate=addDays(selectedDate,direction*(calendarMode==='week'?7:1));period=selectedDate.slice(0,7)+'-01';}renderCalendar();}
$('#prev-period').onclick=()=>movePeriod(-1);$('#next-period').onclick=()=>movePeriod(1);$('#today').onclick=()=>selectDay(F.dateKey(new Date().toISOString()));$('#read-all').onclick=()=>{readThrough=Math.max(readThrough,...state.changes.map(c=>c.id));save('alert-pwa-curated-read-v1',readThrough);render();toast('確認済みにしました。履歴は残ります。');};$('#select-visible').onchange=()=>{for(const e of visibleCards().filter(e=>F.exportEligibility(e).eligible)){const key=F.stableEventKey(e);$('#select-visible').checked?selected.add(key):selected.delete(key);}save('alert-pwa-selected-v1',[...selected]);renderCards();};$('#export-selected').onclick=()=>openExport(state.events.filter(e=>selected.has(F.stableEventKey(e))));
$('#source-list').replaceChildren(...artists.map(a=>{const row=el('div','','source-item'),link=el('a','公式サイト ↗');link.href=a.officialUrl;link.target='_blank';link.rel='noopener noreferrer';row.append(el('strong',a.name),link);return row;}));window.addEventListener('hashchange',route);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});if('serviceWorker' in navigator)navigator.serviceWorker.register('./sw.js',{updateViaCache:'none'}).catch(()=>toast('オフライン用の準備ができませんでした。'));route();refresh({notice:takeAppReloadNotice()});
