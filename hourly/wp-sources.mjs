/** Public official WordPress schedules. Dates from detail datetime only, never publication dates.
 * Partial results MUST NOT remove existing records or replace richer verified times. */
export const WP_SOURCES = Object.freeze({rege:{artistId:'re-ge',origin:'https://re-ge.com'},straightangeli:{artistId:'straightangeli',origin:'https://straight-angeli.com'}});
const MAX_BYTES=2_000_000;
const categoryMap={'LIVE・EVENT':'EVENT','LIVE / EVENT':'EVENT',TV:'TV',RADIO:'RADIO',WEB:'STREAM',OTHER:'EVENT'};
function validDay(s){return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;}
function bounds(from,through){if(!validDay(from)||!validDay(through)||from>through||Date.parse(through)-Date.parse(from)>366*864e5)throw Error('Invalid date range');}
function config(id){if(!WP_SOURCES[id])throw Error('Unsupported source');return WP_SOURCES[id];}
function safeUrl(url,id,kind){const u=new URL(url),c=config(id);if(u.origin!==c.origin||u.username||u.password||u.hash)throw Error('Unapproved URL');if(kind==='detail'){if(u.search||!/^\/schedule\/[a-z0-9-]+\/$/.test(u.pathname)||u.pathname==='/schedule/page/')throw Error('Invalid detail URL');}else if(!/^\/schedule\/(?:page\/[1-9]\d?\/)?$/.test(u.pathname)||[...u.searchParams.keys()].some(k=>k!=='ym')||!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(u.searchParams.get('ym')||''))throw Error('Invalid archive URL');return u;}
function text(s){return s.replace(/<[^>]*>/g,'').replace(/&amp;/g,'&').replace(/&quot;/g,'"').replace(/&#039;|&apos;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&#(x[0-9a-f]+|\d+);/gi,(_,n)=>{const c=n[0].toLowerCase()==='x'?parseInt(n.slice(1),16):Number(n);return c>0&&c<=0x10ffff?String.fromCodePoint(c):'';}).replace(/\s+/g,' ').trim();}
function fail(sourceUrl,code,detail){return {events:[],diagnostics:[{sourceUrl,code,detail}],complete:false};}
export function parseWpSchedule(html,{sourceId,sourceUrl,from,through,checkedAt=new Date().toISOString()}={}){
 bounds(from,through);const u=safeUrl(sourceUrl,sourceId,'detail'),c=config(sourceId);
 if(typeof html!=='string'||Buffer.byteLength(html)>MAX_BYTES)return fail(sourceUrl,'invalid_document','Missing or oversized document');
 const sections=[...html.matchAll(/<section\b[^>]*class=["']post-meta["'][^>]*>([\s\S]*?)<\/section>/gi)];
 if(sections.length!==1)return fail(sourceUrl,'structure_changed','Expected one post-meta section');
 const section=sections[0][1],dates=[...section.matchAll(/<time\b[^>]*datetime=["'](\d{4}\.\d{2}\.\d{2})["'][^>]*>/gi)],titles=[...section.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)],term=section.match(/<span\b[^>]*class=["']term["'][^>]*>([\s\S]*?)<\/span>/i);
 if(dates.length!==1||titles.length!==1||!term)return fail(sourceUrl,'structure_changed','Missing unique event datetime, title or category');
 const day=dates[0][1].replaceAll('.','-'),title=text(titles[0][1]),category=categoryMap[text(term[1])];
 if(!validDay(day)||!title||title.length>1000||!category)return fail(sourceUrl,'invalid_fields','Invalid date/title/category');
 if(day<from||day>through)return {events:[],diagnostics:[],complete:true};
 const id=c.artistId+'-hourly-official-'+u.pathname.split('/')[2];
 return {events:[{id,source:'curated-calendar',artistId:c.artistId,title,start:day,end:null,allDay:false,status:'confirmed',category,location:'',note:'本人公式スケジュールの日付を確認。開始・終了時刻と会場は自動抽出対象外。',evidence:'本人公式スケジュール詳細のイベント日付属性・見出し・カテゴリ。公開日を開催日として使用していません。',sourceUrl,sources:[{url:sourceUrl,type:'artist_official',checkedAt}],checkedAt,timings:[],deadline:null,revision:1,present:true,groupId:id}],diagnostics:[],complete:true};
}
export function parseWpArchive(html,{sourceId,sourceUrl,month}){
 const u=safeUrl(sourceUrl,sourceId,'archive');const current=html.match(/class=["']current["'][^>]*>\s*<strong>(\d{4})\.(\d{2})<\/strong>/);
 if(!current||current[1]+'-'+current[2]!==month)throw Error('Archive month mismatch');
 const urls=[];for(const article of html.matchAll(/<article\b[^>]*class=["'][^"']*schedule-archive-item[^"']*["'][^>]*>([\s\S]*?)<\/article>/gi)){const href=article[1].match(/<a\b[^>]*href=["']([^"']+)["']/i)?.[1];if(!href)throw Error('Missing archive item link');const detail=new URL(text(href),u).href;safeUrl(detail,sourceId,'detail');urls.push(detail);}
 const nextMatch=html.match(/<a\b[^>]*class=["']next page-numbers["'][^>]*href=["']([^"']+)["']/i);let next=null;
 if(nextMatch){const n=new URL(text(nextMatch[1]),u);n.searchParams.set('ym',month);safeUrl(n.href,sourceId,'archive');next=n.href;}
 return {urls:[...new Set(urls)],next};
}
async function getHtml(url,fetchImpl){const r=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(12000),headers:{Accept:'text/html'}});if(!r.ok)throw Error('HTTP '+r.status);if(r.url&&r.url!==url)throw Error('Unexpected redirect');if(!/^text\/html\b/i.test(r.headers.get('content-type')||''))throw Error('Unexpected content type');if(Number(r.headers.get('content-length')||0)>MAX_BYTES)throw Error('Oversized document');const reader=r.body?.getReader();if(!reader)throw Error('Missing body');let size=0;const chunks=[];try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BYTES){await reader.cancel();throw Error('Oversized document');}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}return Buffer.concat(chunks).toString('utf8');}
export async function collectRegeStraight({from,through,now=new Date().toISOString(),fetchImpl=globalThis.fetch,sourceIds=['rege','straightangeli'],maxPages=4,maxDetails=60}={}){
 bounds(from,through);if(!Number.isFinite(Date.parse(now))||!Number.isInteger(maxPages)||maxPages<1||maxPages>10||!Number.isInteger(maxDetails)||maxDetails<1||maxDetails>100)throw Error('Invalid collection limits');
 const events=[],diagnostics=[];let complete=true;
 for(const sourceId of [...new Set(sourceIds)]){const c=config(sourceId),details=new Set();let month=from.slice(0,7);
  while(month<=through.slice(0,7)){let url=c.origin+'/schedule/?ym='+month,pages=0;const visited=new Set();
   while(url){if(pages>=maxPages||visited.has(url)){complete=false;diagnostics.push({sourceId,sourceUrl:url,code:'page_limit'});break;}visited.add(url);pages++;
    try{const result=parseWpArchive(await getHtml(url,fetchImpl),{sourceId,sourceUrl:url,month});for(const x of result.urls)details.add(x);diagnostics.push({source:sourceId,sourceUrl:url,code:'source_ok',count:result.urls.length});url=result.next;}
    catch(e){complete=false;diagnostics.push({sourceId,sourceUrl:url,code:'archive_failed',detail:e.message});break;}}
   const [y,m]=month.split('-').map(Number);month=new Date(Date.UTC(y,m,1)).toISOString().slice(0,7);
  }
  if(details.size>maxDetails){complete=false;diagnostics.push({sourceId,code:'detail_limit',detail:String(details.size)});}
  for(const sourceUrl of [...details].slice(0,maxDetails)){try{const result=parseWpSchedule(await getHtml(sourceUrl,fetchImpl),{sourceId,sourceUrl,from,through,checkedAt:now});events.push(...result.events);diagnostics.push(...result.diagnostics);complete=complete&&result.complete;}catch(e){complete=false;diagnostics.push({sourceId,sourceUrl,code:'detail_failed',detail:e.message});}}
 }
 return {events:events.sort((a,b)=>a.start.localeCompare(b.start)||a.id.localeCompare(b.id)),diagnostics,complete};
}
