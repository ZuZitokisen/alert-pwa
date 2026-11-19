// Deliberately narrow: current public schedule and one explicit start in an
// official article. Ticket windows, multiple occurrences and other routes
// belong to manual verification. Never infer removals from this source.
const ORIGIN='https://madeintohoku.com';
const ARCHIVE=ORIGIN+'/contents/schedule';
const SOURCE='tohokusan';
const MAX=2_000_000, LIMIT=24;
const trim=s=>s.replace(/&(?:amp|nbsp|quot|lt|gt|#39);/g,m=>({'&amp;':'&','&nbsp;':' ','&quot;':'"','&lt;':'<','&gt;':'>','&#39;':"'"}[m])).replace(/\s+/g,' ').trim();
const dayOK=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
const detailOK=url=>typeof url==='string'&&/^https:\/\/madeintohoku\.com\/contents\/[1-9]\d{0,11}$/.test(url);
const identities=raw=>[...raw.matchAll(/<time class="time event-date" datetime="([^"]+)"[^>]*>/g)].map(m=>m[1]);
const categories=raw=>[...raw.matchAll(/<span class="tag">\s*([A-Z]+)\s*<\/span>/g)].map(m=>m[1]);
const validTitle=s=>s.length>0&&s.length<=300&&!/[<>&\x00-\x1f\x7f]/.test(s);
const note=(sourceUrl,code,detail)=>({source:SOURCE,sourceUrl,code,detail});
export function parseTohokusanArchive(html){
 if(typeof html!=='string'||Buffer.byteLength(html)>MAX||!/<title>SCHEDULE \| いぎなり東北産オフィシャルサイト<\/title>/.test(html))throw Error('Unexpected schedule document');
 const lists=[...html.matchAll(/<div id="js-contents-list" class="contents-list fadein">([\s\S]*?)<div class="paging(?: [^"]*)?">/g)];
 if(lists.length!==1)throw Error('Expected one schedule list');
 const region=lists[0][1],blocks=[...region.matchAll(/<div class="contents-list-item fadein">([\s\S]*?)<\/a>/g)];
 if(!blocks.length||blocks.length!==(region.match(/class="contents-list-item fadein"/g)||[]).length)throw Error('Malformed or empty schedule list');
 const rows=[], diagnostics=[];
 for(const [,raw] of blocks){
  const href=raw.match(/^\s*<a href="([^"]+)" target="_(?:self|blank)">/)?.[1];
  const title=trim(raw.match(/<h3 class="contents-list-title title">([^<]+)<\/h3>/)?.[1]||'');
  const days=identities(raw),tag=categories(raw);
  if(!href||!title)throw Error('Malformed schedule row');
  const url=href.startsWith('/contents/')?ORIGIN+href:href;
  if(!detailOK(url)||!validTitle(title)||days.length!==1||!dayOK(days[0])||tag.length!==1||!['EVENT','LIVE'].includes(tag[0])){
   diagnostics.push(note(ARCHIVE,'unsupported_event_shape','Not a single dated LIVE/EVENT article'));continue;
  }
  rows.push({sourceUrl:url,title,day:days[0],category:tag[0]});
 }
 const counts=new Map();
 for(const row of rows)counts.set(row.sourceUrl,(counts.get(row.sourceUrl)||0)+1);
 for(const [url,count] of counts)if(count>1)diagnostics.push(note(url,'unsupported_event_shape','Article appears in more than one schedule row'));
 const paging=html.slice(lists[0].index+lists[0][0].length).split('</div>',1)[0];
 if(paging.trim())diagnostics.push(note(ARCHIVE,'page_limit','Only the current index is supported'));
 return {rows:rows.filter(row=>counts.get(row.sourceUrl)===1),diagnostics};
}
export function parseTohokusanDetail(html,row,checkedAt){
 if(!detailOK(row?.sourceUrl)||!dayOK(row?.day)||!Number.isFinite(Date.parse(checkedAt)))throw Error('Invalid article arguments');
 const fail=detail=>({events:[],diagnostics:[note(row.sourceUrl,'unsupported_detail',detail)]});
 if(typeof html!=='string'||Buffer.byteLength(html)>MAX)return fail('Missing or oversized article');
 const og=[...html.matchAll(/<meta property="og:url" content="([^"]+)"[^>]*>/g)];
 const article=[...html.matchAll(/<section class="details-wrapper schedule corner">[\s\S]*?<article class="details">([\s\S]*?)<\/article>/g)];
 if(og.length!==1||og[0][1]!==row.sourceUrl||article.length!==1)return fail('Article identity mismatch');
 const raw=article[0][1],title=trim(raw.match(/<div class="title">\s*<h3>([^<]+)<\/h3>/)?.[1]||'');
 const days=identities(raw),tag=categories(raw);
 if(!validTitle(title)||title!==row.title||days.length!==1||days[0]!==row.day||tag.length!==1||tag[0]!==row.category||!['EVENT','LIVE'].includes(tag[0]))return fail('Listing and article title/date/category mismatch');
 const bodies=[...raw.matchAll(/<div class="body">([\s\S]*?)<\/div>/g)];
 if(bodies.length!==1||/<(?:div|script|iframe|style|template)\b/i.test(bodies[0][1]))return fail('Unsupported article markup');
 const lines=bodies[0][1].replace(/<br\s*\/?>|<\/(?:p|li|h[1-6])>/gi,'\n').replace(/<[^>]*>/g,'').split('\n').map(trim).filter(Boolean);
 const headings=lines.map((line,i)=>/^❏\s*(開催日時|会場)$/.test(line)?i:-1).filter(i=>i>=0);
 const [dateIdx,venueIdx]=headings;
 if(headings.length!==2||venueIdx<=dateIdx+1||!/^❏\s*開催日時$/.test(lines[dateIdx])||!/^❏\s*会場$/.test(lines[venueIdx])||/(?:中止|延期|振替|開演時間変更|開催時間変更)/.test(title+' '+lines.join(' ')))return fail('Ambiguous or changed schedule');
 const when=lines[dateIdx+1].match(/^(?:(\d{4})年)?(\d{1,2})月(\d{1,2})日(?:[（(]([日月火水木金土])[）)])?\s*([01]?\d|2[0-3])[:：]([0-5]\d)\s*(?:スタート|開演|開始)$/);
 const place=lines[venueIdx+1];
 if(!when||!place||!validTitle(place)||place.length>150||/^(?:https?:|[※❏■]|\d)/.test(place))return fail('No explicit adjacent occurrence/venue');
 const date=(when[1]||row.day.slice(0,4))+'-'+when[2].padStart(2,'0')+'-'+when[3].padStart(2,'0');
 if(date!==row.day||when[4]&&when[4]!=='日月火水木金土'[new Date(date+'T00:00:00Z').getUTCDay()])return fail('Explicit occurrence day disagrees');
 const dateSection=lines.slice(dateIdx+2,venueIdx);
 if(dateSection.some(line=>!line.startsWith('※')||/\d{1,2}[:：]\d{2}|\d{1,2}月\d{1,2}日|[一二三１２３1-3]部/.test(line))||lines.some((line,i)=>i!==dateIdx+1&&/(?:[0-2]?\d[:：][0-5]\d\s*(?:開演|スタート|開始)|(?:開演|スタート|開始)\s*[：:]?\s*[0-2]?\d[:：][0-5]\d|第\s*[12１２一二]\s*部|(?:1|１)部|(?:2|２)部|昼公演|夜公演)/.test(line)))return fail('Multiple or ambiguous starts');
 const id='tohokusan-hourly-official-'+row.sourceUrl.split('/').at(-1);
 return {events:[{id,source:'curated-calendar',artistId:SOURCE,title,start:date+'T'+when[5].padStart(2,'0')+':'+when[6]+':00+09:00',end:null,allDay:false,status:'confirmed',category:row.category,location:place,note:'公式詳細の開催日時・会場を採用。終了時刻と受付情報は未収録。',evidence:'本人公式のスケジュール一覧と詳細の掲載日・開催日を照合。',sourceUrl:row.sourceUrl,sources:[{url:row.sourceUrl,type:'artist_official',checkedAt}],checkedAt,timings:[],deadline:null,revision:1,present:true,groupId:id}],diagnostics:[]};
}
async function get(url,fetchImpl){
 if(url!==ARCHIVE&&!detailOK(url))throw Error('Unapproved Tohokusan URL');
 const r=await fetchImpl(url,{redirect:'manual',signal:AbortSignal.timeout(10000),headers:{Accept:'text/html','User-Agent':'AlertPWA-PublicScheduleCollector/1.0 (https://github.com/ZuZitokisen/alert-pwa)'}});
 if(r.redirected||r.status>=300&&r.status<400)throw Error('Redirect rejected');
 if(!r.ok)throw Error('HTTP '+r.status);
 if(r.url&&r.url!==url)throw Error('Unexpected response URL');
 if(!/^text\/html\b/i.test(r.headers.get('content-type')||'')||Number(r.headers.get('content-length')||0)>MAX||!r.body)throw Error('Unexpected or oversized HTML');
 const reader=r.body.getReader(),chunks=[];let size=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>MAX){await reader.cancel();throw Error('Oversized HTML');}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
 return Buffer.concat(chunks).toString('utf8');
}
export async function collectTohokusan({from,through,now,fetchImpl=globalThis.fetch}){
 if(!dayOK(from)||!dayOK(through)||from>through||Date.parse(through)-Date.parse(from)>366*864e5||!Number.isFinite(Date.parse(now)))throw Error('Invalid bounds');
 const events=[],diagnostics=[];let a;
 try{a=parseTohokusanArchive(await get(ARCHIVE,fetchImpl));}catch(e){return {events,diagnostics:[note(ARCHIVE,'archive_failed',e.message)],complete:false};}
 diagnostics.push(...a.diagnostics);
 const rows=a.rows.filter(row=>row.day>=from&&row.day<=through);
 if(rows.length>LIMIT)diagnostics.push(note(ARCHIVE,'page_limit','Article count exceeded'));
 for(let i=0;i<Math.min(rows.length,LIMIT);i+=4)await Promise.all(rows.slice(i,i+4).map(async(row)=>{
  try{const r=parseTohokusanDetail(await get(row.sourceUrl,fetchImpl),row,now);events.push(...r.events);diagnostics.push(...r.diagnostics);}catch(e){diagnostics.push(note(row.sourceUrl,'detail_failed',e.message));}
 }));
 const complete=diagnostics.length===0;
 diagnostics.push({source:SOURCE,sourceUrl:ARCHIVE,code:'source_ok',scope:'single-occurrence-live-event-only',count:events.length});
 return {events:events.sort((a,b)=>a.start.localeCompare(b.start)||a.id.localeCompare(b.id)),diagnostics,complete};
}
