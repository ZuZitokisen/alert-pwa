import {readFileSync} from 'node:fs';
import core from '../production-feed-core.cjs';

const aliases=JSON.parse(readFileSync(new URL('./source-aliases.json',import.meta.url),'utf8'));
const firstParty = Object.freeze({
  tokisen: ['toki-sen.com'],
  tohokusan: ['madeintohoku.com'],
  're-ge': ['re-ge.com'],
  straightangeli: ['straight-angeli.com'],
  oneloveoneheart: ['oneloveoneheart.jp', '5th.oneloveoneheart.jp', 'oneloveoneheart.officialfc.jp'],
});
// Only explicit cooperating broadcast/organizer adapters may provide "possible".
const partnerHosts = ['fmosaka.net','www.tbs.co.jp','tbs.co.jp','radiko.jp'];
const dateOnly = /^\d{4}-\d{2}-\d{2}$/;
const exactTime = /^\d{4}-\d{2}-\d{2}T\d\d:\d\d:\d\d(?:\.\d+)?(?:Z|\+09:00)$/;
const named = Object.prototype.hasOwnProperty;
const day = v => v && dateOnly.test(v) ? v : new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(v));
const validStart = s => typeof s==='string' && (dateOnly.test(s) || exactTime.test(s)) && Number.isFinite(Date.parse(s));
const folded = s => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
const identity = e=>e.source+'\0'+e.id;
const keyFields = ['title','start','end','location','status','category','deadline'];
function safeSource(raw){
 const u=new URL(raw);
 if(u.protocol!=='https:'||u.username||u.password||u.port||u.hash)throw Error('Unapproved source URL');
 return u.hostname;
}
function validate(e){
 if(!e||typeof e!=='object'||!named.call(firstParty,e.artistId)||e.source!=='curated-calendar'||typeof e.id!=='string'||!e.id.startsWith(e.artistId+'-'))throw Error('Unapproved event identity');
 if(!validStart(e.start)||e.allDay!==false||e.present!==true||e.revision!==1||!['confirmed','possible'].includes(e.status))throw Error('Unapproved event shape');
 if(typeof e.title!=='string'||e.title.length>180||folded(e.title).length<3||e.location?.length>180||e.note?.length>450||e.evidence?.length>300)throw Error('Unapproved text length');
 if(!Array.isArray(e.sources)||!e.sources.length||e.sources.length>8)throw Error('Missing or excessive sources');
 const exactSource=e.sources.find(s=>s.url===e.sourceUrl);
 if(e.status==='confirmed'&&(!exactSource?.type.startsWith('artist_official')||!firstParty[e.artistId].includes(safeSource(exactSource.url))))throw Error('Confirmed event needs artist official evidence');
 if(e.status==='possible'&&(!exactSource||!partnerHosts.includes(safeSource(exactSource.url))))throw Error('Possible event needs an approved partner source');
 for(const s of e.sources)if(![...firstParty[e.artistId],...partnerHosts].includes(safeSource(s.url)))throw Error('Unapproved evidence host');
}
function near(a,b){
 if(a.artistId!==b.artistId||!validStart(b.start)||day(a.start)!==day(b.start))return false;
 // Same organizer URL may announce several different times/benefit events.
 const titleA=folded(a.title),titleB=folded(b.title);
 const closeTitle=titleA===titleB||Math.min(titleA.length,titleB.length)>=8&&(titleA.includes(titleB)||titleB.includes(titleA));
 if(!closeTitle)return false;
 if(!dateOnly.test(a.start)&&!dateOnly.test(b.start)&&Math.abs(Date.parse(a.start)-Date.parse(b.start))>=90*60*1000)return false;
 return true;
}
function alert(kind,event,fields=[]){
 return {kind,eventId:event.id,artistId:event.artistId,title:event.title,start:event.start,status:event.status,location:event.location,fields};
}
export function mergeOfficialSchedules(base,candidates,now=new Date()){
 if(!Array.isArray(candidates)||candidates.length>1000)throw Error('Invalid candidate batch');
 const stamp=now.toISOString(), today=day(stamp);
 const indexed=new Map(base.events.map(e=>[identity(e),e]));
 const kept=[...base.events], notices=[], skipped=[], staged=new Map();
 // Deterministic ordering and conflicting-source rejection within a run.
 for(const e of candidates) {
  const k=e&&typeof e.id==='string'?e.id:null;
  if(!k) {skipped.push({reason:'invalid identity'});continue;}
  try{validate(e);core.validateInput({...base,events:[e]},{production:true,publicSource:'schedule-data-v4.json'});}
  catch{skipped.push({eventId:k,reason:'invalid candidate or source'});continue;}
  const prev=staged.get(k);
  if(prev===false)continue;
  if(prev&&keyFields.some(f=>(prev[f]??null)!==(e[f]??null))){staged.set(k,false);skipped.push({eventId:k,reason:'conflicting observations'});}
  else if(!prev)staged.set(k,e);
 }
 for(const [,e] of [...staged.entries()].sort((a,b)=>a[0].localeCompare(b[0],'en'))) {
  if(!e)continue;
  const d=day(e.start);
  if(d<today||d<base.coverage.from||d>base.coverage.through){skipped.push({eventId:e.id,reason:'outside current coverage'});continue;}
  const old=indexed.get(identity(e));
  if(old){
   // Never overwrite hand-curated events or downgrade certainty on a scrape.
   if(!old.id.includes('-hourly-')||old.status==='confirmed'&&e.status!=='confirmed')continue;
   const fields=keyFields.filter(f=>(old[f]??null)!==(e[f]??null));
   if(!fields.length)continue;
   if(!old.sources.some(s=>s.url===e.sourceUrl)){skipped.push({eventId:e.id,reason:'stable event source changed'});continue;}
   // An index without a clock cannot erase a time, deadline or venue already known.
   if(!dateOnly.test(old.start)&&dateOnly.test(e.start)||old.end&&!e.end||old.deadline&&!e.deadline||old.location&&!e.location){skipped.push({eventId:e.id,reason:'less specific observation'});continue;}
   kept[kept.indexOf(old)]=e;indexed.set(identity(e),e);notices.push(alert('updated',e,fields));continue;
  }
  const linked=aliases[e.id];
  if(linked&&base.events.some(row=>row.id===linked&&row.artistId===e.artistId)){skipped.push({eventId:e.id,reason:'covered by existing verified item'});continue;}
  if(kept.some(row=>row.artistId===e.artistId&&validStart(row.start)&&day(e.start)===day(row.start)&&row.sources.some(s=>s.url===e.sourceUrl&&/^\/(?:schedules\/[0-9a-f-]{36}|schedule\/item-[0-9]+\/)$/.test(new URL(s.url).pathname))||near(e,row))){skipped.push({eventId:e.id,reason:'possible duplicate'});continue;}
  kept.push(e);indexed.set(identity(e),e);notices.push(alert('new',e));
 }
 if(!notices.length)return {next:base,notices,skipped};
 if(notices.length>75)throw Error('Candidate exceeds per-run safety limit (75); no write performed');
 if(+now<=Date.parse(base.generatedAt))throw Error('Collection time is not newer than last publication');
 const next={...base,version:'hourly-'+stamp,generatedAt:stamp,events:kept};
 core.validateInput(next,{production:true,publicSource:'schedule-data-v4.json'});
 return {next,notices,skipped};
}
