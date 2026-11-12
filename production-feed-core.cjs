'use strict';
// Production-only, public allowlist projection. Never consumes browser storage.
const crypto = require('node:crypto');
const F = require('./feature-core.js');
const NAMESPACE = 'alert-pwa.zuzitokisen.github.io';
const LEGACY_ARTISTS = ['tokisen', 're-ge'];
const ARTISTS = [...LEGACY_ARTISTS, 'straightangeli'];
const NAMES = {tokisen:'超ときめき♡宣伝部','re-ge':'RE-GE',straightangeli:'Straight Angeli'};
const CATEGORIES = ['all', 'live', 'benefit', 'media', 'other'];
const PRESETS = ARTISTS.flatMap(artist => CATEGORIES.map(category => ({ id: `${artist}-${category}`, artist, category,
  label: `${NAMES[artist]} / ${{ all:'全予定',live:'ライブ・イベント',benefit:'特典会・応募',media:'メディア',other:'その他' }[category]}` })));
const fail = message => { throw new TypeError(message); };
const assert = (ok, message) => { if (!ok) fail(message); };
const canonical = value => JSON.stringify(value && typeof value === 'object' ? Array.isArray(value) ? value.map(v=>JSON.parse(canonical(v))) : Object.fromEntries(Object.keys(value).sort().map(k=>[k,JSON.parse(canonical(value[k]))])) : value);
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const same = (a,b) => canonical(a) === canonical(b);
function object(v, required, optional=[]) { assert(v && typeof v==='object' && !Array.isArray(v), 'Object required'); assert(required.every(k=>Object.hasOwn(v,k)) && Object.keys(v).every(k=>required.includes(k)||optional.includes(k)), 'Unexpected or missing fields'); }
function text(v, nonempty=false) { assert(typeof v==='string' && v.length<=12000 && (!nonempty || v.trim()) && !/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v), 'Invalid text'); return v; }
function day(v) { return typeof v==='string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && +v.slice(0,4)>0 && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10)===v; }
function instant(v) { const m=typeof v==='string' && /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(v); return !!(m && day(m[1]) && +m[2]<24 && +m[3]<60 && +m[4]<60 && (m[5]==='Z'||(+m[5].slice(1,3)<=14 && +m[5].slice(4)<60 && (+m[5].slice(1,3)<14||+m[5].slice(4)===0))) && Number.isFinite(Date.parse(v))); }
function stamp(v) { assert(instant(v),'Invalid timestamp'); return new Date(v).toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z'); }
function https(v) { text(v,true); let u; try { u=new URL(v); } catch { fail('Invalid source URL'); } assert(u.protocol==='https:' && !u.username && !u.password && !/[\s\\]/.test(v) && !/^(localhost|127\.|0\.|10\.|192\.168\.|\[)/i.test(u.hostname), 'Public HTTPS source required'); return v; }
function timing(e) { assert(e.start===null||day(e.start)||instant(e.start),'Invalid start'); assert(e.end===null||day(e.end)||instant(e.end),'Invalid end'); assert(typeof e.allDay==='boolean' && (!e.allDay || day(e.start)), 'Invalid allDay'); if(e.end) assert(e.start && day(e.start)===day(e.end) && Date.parse(e.end)>Date.parse(e.start),'End must follow start with matching precision'); }
const clientIdentity = e => JSON.stringify([e.source,e.id]);
const identity = e => JSON.stringify([e.artistId,e.source,e.id]);
const uid = e => `public-v1-${hash(identity(e))}@${NAMESPACE}`;
const groups = e => [`${e.artistId}-all`,`${e.artistId}-${e.category}`];
function projected(e) {
  object(e,['artistId','source','id','category','title','start','end','allDay','location','publicNote','status','sourceUrls']);
  assert(ARTISTS.includes(e.artistId) && e.source==='curated-calendar' && typeof e.id==='string' && e.id.length>0 && e.id.length<=256 && !/[\s\x00-\x1f\x7f]/.test(e.id),'Invalid identity');
  assert(e.artistId!=='straightangeli'||e.id.startsWith('straightangeli-'),'Invalid artist identity prefix');
  assert(CATEGORIES.slice(1).includes(e.category),'Invalid category');
  assert(['confirmed','possible','unknown','cancelled','missing'].includes(e.status),'Invalid status');
  for(const k of ['title','location','publicNote']) text(e[k],k==='title');
  assert(Array.isArray(e.sourceUrls)&&e.sourceUrls.length>0&&same(e.sourceUrls,[...new Set(e.sourceUrls)].sort()),'Invalid source links'); e.sourceUrls.forEach(https); timing(e); return e;
}
function validateInput(data, options) {
  assert(options?.production===true && options?.publicSource==='schedule-data-v2.json','Explicit production public source approval required');
  object(data,['schemaVersion','version','generatedAt','coverage','events'],['notes']);
  assert(data.schemaVersion===1 && instant(data.generatedAt),'Invalid production generation'); text(data.version,true);
  object(data.coverage,['from','through']); assert(day(data.coverage.from)&&day(data.coverage.through)&&data.coverage.from<=data.coverage.through,'Invalid coverage');
  if(data.notes!==undefined) { assert(Array.isArray(data.notes),'Invalid notes'); data.notes.forEach(n=>text(n)); }
  assert(Array.isArray(data.events)&&data.events.length>0&&data.events.length<=10000,'Nonempty public event batch required');
  const seen=new Set();
  return data.events.map(e=>{
    object(e,['id','source','artistId','title','start','end','allDay','status','category','location','note','evidence','sourceUrl','sources','checkedAt','timings','revision','present'],['dateLabel','deadline','groupId']);
    assert(instant(e.checkedAt)&&e.revision===1&&typeof e.present==='boolean','Invalid source revision');
    assert(['confirmed','possible','unknown','cancelled'].includes(e.status),'Invalid source status');
    assert(Array.isArray(e.sources)&&e.sources.length>0&&e.sources.length<=100,'Sources required');
    e.sources.forEach(s=>{object(s,['url','type','checkedAt']);https(s.url);text(s.type,true);assert(instant(s.checkedAt),'Invalid source check');});
    https(e.sourceUrl);assert(e.sources.some(s=>s.url===e.sourceUrl),'Primary source missing');
    assert(Array.isArray(e.timings)&&e.timings.length<=100,'Invalid timings');
    e.timings.forEach(t=>{object(t,['kind','label'],['at','date','status','note']);text(t.kind,true);text(t.label,true);if(t.at!=null)assert(instant(t.at),'Invalid timing');if(t.date!==undefined)assert(day(t.date),'Invalid timing date');if(t.status!==undefined)assert(['confirmed','possible','unknown','cancelled'].includes(t.status),'Invalid timing status');if(t.note!==undefined)text(t.note);});
    for(const k of ['note','evidence','dateLabel','groupId']) if(e[k]!==undefined)text(e[k]);
    if(e.deadline!=null)assert(instant(e.deadline),'Invalid deadline');
    const category={LIVE:'live',EVENT:'live',BENEFIT:'benefit',REMIND:'benefit',TV:'media',RADIO:'media',STREAM:'media',MEMO:'other'}[e.category];
    const event=projected({artistId:e.artistId,source:e.source,id:e.id,category,title:e.title,start:e.start,end:e.end,allDay:e.allDay,location:e.location,
      publicNote:[e.note,e.evidence,e.dateLabel||''].filter(Boolean).join('\n'),status:e.present?e.status:'missing',sourceUrls:[...new Set(e.sources.map(s=>s.url))].sort()});
    const key=clientIdentity(event);assert(!seen.has(key),'Duplicate client identity');seen.add(key);return {event};
  }).sort((a,b)=>identity(a.event).localeCompare(identity(b.event),'en'));
}
function validateState(state) {
  object(state,['schemaVersion','namespace','dataVersion','dataGeneratedAt','inputSha256','coverage','records','integritySha256']);
  const {integritySha256,...body}=state; assert(integritySha256===hash(canonical(body)),'State integrity mismatch');
  assert(state.schemaVersion===1&&state.namespace===NAMESPACE&&instant(state.dataGeneratedAt)&&/^[a-f0-9]{64}$/.test(state.inputSha256),'Invalid state header');text(state.dataVersion,true);
  object(state.coverage,['from','through']);assert(day(state.coverage.from)&&day(state.coverage.through)&&state.coverage.from<=state.coverage.through,'Invalid state coverage');
  assert(Array.isArray(state.records)&&state.records.length>0,'Invalid records');const seen=new Set(),clientSeen=new Set();
  for(const r of state.records) {
    object(r,['key','uid','event','sequence','created','modified','lastTiming','memberships']);projected(r.event);
    assert(r.key===identity(r.event)&&r.uid===uid(r.event)&&!seen.has(r.key),'Invalid stored identity');seen.add(r.key);
    const clientKey=clientIdentity(r.event);assert(!clientSeen.has(clientKey),'Duplicate stored client identity');clientSeen.add(clientKey);
    assert(Number.isSafeInteger(r.sequence)&&r.sequence>=0&&r.sequence<=2147483647,'Invalid stored revision');
    assert(instant(r.created)&&instant(r.modified)&&Date.parse(r.created)<=Date.parse(r.modified)&&Date.parse(r.modified)<=Date.parse(state.dataGeneratedAt),'Invalid stored clock');
    if(r.lastTiming!==null){object(r.lastTiming,['start','end','allDay']);timing(r.lastTiming);assert(r.lastTiming.start,'Invalid last timing');}
    if(r.event.start)assert(same(r.lastTiming,{start:r.event.start,end:r.event.end,allDay:r.event.allDay}),'Timing mismatch');
    assert(Array.isArray(r.memberships)&&same(r.memberships,[...new Set(r.memberships)].sort())&&r.memberships.every(id=>PRESETS.some(p=>p.id===id&&p.artist===r.event.artistId))&&groups(r.event).every(id=>r.memberships.includes(id)),'Invalid memberships');
  }
  return state;
}
function reconcile(data,previous,options) {
  const inputs=validateInput(data,options), inputSha256=hash(canonical(data));
  if(previous){validateState(previous);if(inputSha256!==previous.inputSha256)assert(data.version!==previous.dataVersion,'Changed snapshot requires a new version');assert(Date.parse(data.generatedAt)>=Date.parse(previous.dataGeneratedAt),'Stale generation');if(Date.parse(data.generatedAt)===Date.parse(previous.dataGeneratedAt))assert(inputSha256===previous.inputSha256,'Conflicting generation');}
  const priorArtists=new Map((previous?.records||[]).map(r=>[clientIdentity(r.event),r.event.artistId]));
  for(const {event} of inputs)assert(!priorArtists.has(clientIdentity(event))||priorArtists.get(clientIdentity(event))===event.artistId,'Existing identity cannot change artist');
  const map=new Map((previous?.records||[]).map(r=>[r.key,structuredClone(r)]));
  for(const {event} of inputs){const key=identity(event),old=map.get(key),identical=old&&same(old.event,event);
    if(identical)continue;
    const sequence=old?old.sequence+1:0;assert(sequence<=2147483647,'Sequence exhausted');
    map.set(key,{key,uid:uid(event),event,sequence,created:old?.created||data.generatedAt,modified:data.generatedAt,lastTiming:event.start?{start:event.start,end:event.end,allDay:event.allDay}:old?.lastTiming||null,memberships:[...new Set([...(old?.memberships||[]),...groups(event)])].sort()});
  }
  const body={schemaVersion:1,namespace:NAMESPACE,dataVersion:data.version,dataGeneratedAt:data.generatedAt,inputSha256,coverage:data.coverage,records:[...map.values()].sort((a,b)=>a.key<b.key?-1:a.key>b.key?1:0)};
  return {...body,integritySha256:hash(canonical(body))};
}
function buildFeed(state,presetId){validateState(state);const preset=PRESETS.find(p=>p.id===presetId);assert(preset,'Unknown preset');
 const lines=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Alert PWA//Public Calendar Subscription//JA','CALSCALE:GREGORIAN',`X-WR-CALNAME:${F.escapeICSText(preset.label)}`];let count=0,omittedUnknownDate=0;
 for(const r of state.records){if(!r.memberships.includes(presetId))continue;const e=r.event,t=e.start?e:r.lastTiming;if(!t){omittedUnknownDate++;continue;}
  const moved=!groups(e).includes(presetId),removedDate=!e.start,cancelled=moved||removedDate||e.status==='cancelled';
  const notes=[moved?'区分変更のためこの購読から取り下げ。予定自体の中止ではありません。':'',removedDate?'日時未定に変更したため旧日時の配信を取り下げ。予定自体の中止ではありません。':'',e.status==='missing'?'掲載消失。中止とは未確認です。最後に確認した情報を保持しています。':'',day(t.start)&&!t.allDay?'時刻未定。終日開催という意味ではありません。':'',e.publicNote,...e.sourceUrls].filter(Boolean);
  const suffix=moved||removedDate?'（旧掲載取り下げ）':e.status==='cancelled'?'（中止）':e.status==='possible'?'（かも？）':e.status==='missing'?'（掲載消失・未確認）':e.status==='unknown'?'（未確認）':'';
  lines.push('BEGIN:VEVENT',`UID:${r.uid}`,`DTSTAMP:${stamp(r.modified)}`,`CREATED:${stamp(r.created)}`,`LAST-MODIFIED:${stamp(r.modified)}`,`SEQUENCE:${r.sequence}`,day(t.start)?`DTSTART;VALUE=DATE:${t.start.replace(/-/g,'')}`:`DTSTART:${stamp(t.start)}`);
  if(t.end)lines.push(day(t.end)?`DTEND;VALUE=DATE:${t.end.replace(/-/g,'')}`:`DTEND:${stamp(t.end)}`);
  lines.push(`SUMMARY:${F.escapeICSText(e.title+suffix+(day(t.start)&&!t.allDay?'（時刻未定）':''))}`,`DESCRIPTION:${F.escapeICSText(notes.join('\n'))}`,`LOCATION:${F.escapeICSText(e.location)}`,`URL:${e.sourceUrls[0]}`,`STATUS:${cancelled?'CANCELLED':e.status==='confirmed'?'CONFIRMED':'TENTATIVE'}`,'TRANSP:TRANSPARENT','END:VEVENT');count++;
 }
 lines.push('END:VCALENDAR');return {ics:lines.map(F.foldICSLine).join('\r\n')+'\r\n',count,omittedUnknownDate};
}
// Keep the old two-artist schedule and ten-entry manifest consumable by cached clients.
// Only the new manifest is schemaVersion 2; state and public event identities do not reset.
function legacyProjection(data){return {...data,events:data.events.filter(e=>LEGACY_ARTISTS.includes(e.artistId))};}
function build(data,previous,options){const state=reconcile(data,previous,options),files={},feeds=PRESETS.map(p=>{const f=buildFeed(state,p.id),path=`calendar-feeds/${p.id}.ics`;files[`${p.id}.ics`]=f.ics;return {...p,path,count:f.count,omittedUnknownDate:f.omittedUnknownDate,sha256:hash(f.ics)};});
 const manifest={schemaVersion:2,production:true,namespace:NAMESPACE,dataVersion:data.version,dataGeneratedAt:data.generatedAt,coverage:data.coverage,inputSha256:state.inputSha256,feeds};
 const legacyData=legacyProjection(data),legacyManifest={...manifest,schemaVersion:1,inputSha256:hash(canonical(legacyData)),feeds:feeds.filter(f=>LEGACY_ARTISTS.includes(f.artist))};
 files['state.json']=JSON.stringify(state,null,2)+'\n';files['manifest.json']=JSON.stringify(legacyManifest,null,2)+'\n';files['manifest-v2.json']=JSON.stringify(manifest,null,2)+'\n';
 return {state,manifest,legacyManifest,legacyData,legacyDataJson:JSON.stringify(legacyData,null,2)+'\n',files};}
module.exports={NAMESPACE,ARTISTS,LEGACY_ARTISTS,PRESETS,canonical,hash,clientIdentity,identity,uid,validateInput,validateState,reconcile,buildFeed,legacyProjection,build};
