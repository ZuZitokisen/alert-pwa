import {collectRegeStraight} from './wp-sources.mjs';
/** Conservative public-source collector. No credentials, private APIs or SNS.
 * Calendar time is NOT treated as an event start: known FC listing conflicts with
 * a detailed event announcement. Emit date-only candidates for reconciliation.
 * Never infer removals from empty/error results. Consumer must merge by sourceUrl,
 * preserve richer verified detail, and review changes before external publishing.
 */
export const SOURCE_CONFIG = Object.freeze({
  loveone: Object.freeze({artistId:'oneloveoneheart', origin:'https://oneloveoneheart.officialfc.jp', path:'/calendars', enabled:true}),
  tokisen: Object.freeze({artistId:'tokisen',origin:'https://toki-sen.com',enabled:false,reason:'No validated structured public parser yet'}),
  rege: Object.freeze({artistId:'re-ge',origin:'https://re-ge.com',enabled:true}),
  straightangeli: Object.freeze({artistId:'straightangeli',origin:'https://straight-angeli.com',enabled:true})
});
const CATEGORIES={LIVE:'LIVE',EVENT:'EVENT',TV:'TV',RADIO:'RADIO',WEB:'STREAM',MUSIC:'EVENT',MAGAZINE:'EVENT'};
const MAX_BYTES=2_000_000;
function validDay(s){return typeof s==='string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;}
function bounds(from,through){if(!validDay(from)||!validDay(through)||from>through||Date.parse(through)-Date.parse(from)>366*864e5)throw Error('Invalid date range (maximum 366 days)');}
function safeUrl(url){const u=new URL(url);if(u.origin!==SOURCE_CONFIG.loveone.origin||u.username||u.password||u.search||u.hash||!/^\/calendars\/\d{4}\/(?:[1-9]|1[0-2])$/.test(u.pathname))throw Error('Unapproved source URL');return u;}
export function parseLoveoneCalendar(html,{sourceUrl,from,through,checkedAt=new Date().toISOString()}={}){
 bounds(from,through); const u=safeUrl(sourceUrl); const events=[],diagnostics=[];
 const fail=(code,detail)=>({events:[],diagnostics:[{sourceUrl,code,detail}],complete:false});
 if(typeof html!=='string'||Buffer.byteLength(html)>MAX_BYTES)return fail('invalid_document','Missing or oversized HTML');
 const matches=[...html.matchAll(/<script\b(?=[^>]*\bid=["']__NEXT_DATA__["'])[^>]*>([\s\S]*?)<\/script>/gi)];
 if(matches.length!==1)return fail('structure_changed','Expected one public __NEXT_DATA__ script');
 let data;try{data=JSON.parse(matches[0][1]);}catch{return fail('invalid_json','Public page JSON could not be parsed');}
 const p=data?.props?.pageProps;
 const parts=u.pathname.split('/');
 if(data.page!=='/calendars/[year]/[month]'||String(data.query?.year)!==parts[2]||String(data.query?.month)!==parts[3])return fail('wrong_page','Calendar route/year/month mismatch');
 if(!p?.fcContents?.some(x=>x.id==='schedule'&&x.requiredUserStatus==='guest'))return fail('not_public','Schedule not explicitly guest-readable');
 if(!Array.isArray(p.scheduleListItemDataCollection))return fail('structure_changed','Missing schedule collection');
 const seen=new Set();
 for(const row of p.scheduleListItemDataCollection){
  if(!row||typeof row.id!=='string'||! /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(row.id)||typeof row.title!=='string'||!row.title.trim()||row.title.length>1000||!CATEGORIES[row.category]){diagnostics.push({sourceUrl,code:'skipped_row',detail:'Unsupported category or malformed ID/title'});continue;}
  // Require an explicit JST calendar timestamp; never reinterpret timezone.
  const match=typeof row.time==='string'&&row.time.match(/^(\d{4}-\d{2}-\d{2})T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\+09:00$/);
  if(!match||!validDay(match[1])){diagnostics.push({sourceUrl,code:'invalid_date',id:row.id});continue;}
  const day=match[1];if(day.slice(0,4)!==parts[2]||Number(day.slice(5,7))!==Number(parts[3])){diagnostics.push({sourceUrl,code:'wrong_month_row',id:row.id});continue;}
  if(day<from||day>through)continue;
  if(typeof row.publishTime!=='string'||!Number.isFinite(Date.parse(row.publishTime))){diagnostics.push({sourceUrl,code:'unknown_publication',id:row.id});continue;}
  if(Date.parse(row.publishTime)>Date.parse(checkedAt)){diagnostics.push({sourceUrl,code:'not_yet_published',id:row.id});continue;}
  if(seen.has(row.id)){diagnostics.push({sourceUrl,code:'duplicate_id',id:row.id});continue;}seen.add(row.id);
  const detailUrl=SOURCE_CONFIG.loveone.origin+'/schedules/'+row.id;
  events.push({id:'oneloveoneheart-hourly-fc-'+row.id,source:'curated-calendar',artistId:SOURCE_CONFIG.loveone.artistId,title:row.title.trim(),start:day,end:null,allDay:false,status:'confirmed',category:CATEGORIES[row.category],location:'',note:'公式FCカレンダー掲載日。開始時刻・終了時刻・会場詳細は未確認。一覧内部時刻は管理用の場合があるため採用していません。',evidence:'本人公式FCの一般公開カレンダーで日付・タイトルを確認。',sourceUrl:detailUrl,sources:[{url:sourceUrl,type:'artist_official',checkedAt},{url:detailUrl,type:'artist_official',checkedAt}],checkedAt,timings:[],deadline:null,revision:1,present:true,groupId:'oneloveoneheart-hourly-fc-'+row.id});
 }
 return {events,diagnostics,complete:true};
}
async function getPublicHtml(url,fetchImpl){
 safeUrl(url);const response=await fetchImpl(url,{redirect:'error',signal:AbortSignal.timeout(15000),headers:{Accept:'text/html'}});
 if(!response.ok)throw Error('HTTP '+response.status);
 if(response.url&&response.url!==url)throw Error('Unexpected response URL');
 if(!/^text\/html\b/i.test(response.headers.get('content-type')||''))throw Error('Unexpected content type');
 if(Number(response.headers.get('content-length')||0)>MAX_BYTES)throw Error('Oversized response');
 const reader=response.body?.getReader();if(!reader)throw Error('Missing response body');
 let n=0;const chunks=[];try{while(true){const {done,value}=await reader.read();if(done)break;n+=value.byteLength;if(n>MAX_BYTES){await reader.cancel();throw Error('Oversized response');}chunks.push(Buffer.from(value));}}finally{reader.releaseLock();}
 return Buffer.concat(chunks).toString('utf8');
}
export async function collectOfficialSchedules({from,through,now=new Date().toISOString(),fetchImpl=globalThis.fetch,sourceIds=['loveone']}={}){
 bounds(from,through);if(!Number.isFinite(Date.parse(now)))throw Error('Invalid now');
 const events=[],diagnostics=[];let complete=true;
 for(const id of sourceIds){const config=SOURCE_CONFIG[id];if(!config?.enabled){diagnostics.push({source:id,code:'unsupported_source',detail:config?.reason||'Unknown source'});complete=false;continue;}
  if(id==='rege'||id==='straightangeli'){const result=await collectRegeStraight({from,through,now,fetchImpl,sourceIds:[id],maxPages:3,maxDetails:24});events.push(...result.events);diagnostics.push(...result.diagnostics);complete=complete&&result.complete;continue;}
  let month=from.slice(0,7);while(month<=through.slice(0,7)){
   const [y,m]=month.split('-').map(Number),url=config.origin+'/calendars/'+y+'/'+m;
   try{const html=await getPublicHtml(url,fetchImpl);const result=parseLoveoneCalendar(html,{sourceUrl:url,from,through,checkedAt:now});events.push(...result.events);diagnostics.push(...result.diagnostics);if(!result.complete)complete=false;else diagnostics.push({source:id,sourceUrl:url,code:'source_ok',count:result.events.length});}
   catch(error){complete=false;diagnostics.push({sourceUrl:url,code:'fetch_failed',detail:String(error.message)});}
   month=new Date(Date.UTC(y,m,1)).toISOString().slice(0,7);
  }
 }
 return {events:events.sort((a,b)=>a.start.localeCompare(b.start)||a.id.localeCompare(b.id)),diagnostics,complete};
}
