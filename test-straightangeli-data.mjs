import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import C from './production-feed-core.cjs';
const require=createRequire(import.meta.url),F=require('./feature-core.js'),S=require('./calendar-subscriptions.js'),L=require('./fixtures/legacy/calendar-subscriptions.js');
const read=name=>JSON.parse(fs.readFileSync(new URL(name,import.meta.url),'utf8'));
const data=read('./schedule-data-v2.json'),legacy=read('./schedule-data.json'),old=read('./fixtures/legacy/schedule-data.json'),prior=read('./fixtures/legacy/state.json'),original=read('./fixtures/straightangeli-source-events.json');
const events=data.events.filter(e=>e.artistId==='straightangeli'),byId=id=>events.find(e=>e.id==='straightangeli-'+id);
const result=C.build(data,prior,{production:true,publicSource:'schedule-data-v2.json'});
const unfold=ics=>ics.replace(/\r\n /g,'');

test('real three-artist release keeps 247 old events exact and adds only the verified sixteen',()=>{
 assert.equal(data.events.length,263);assert.equal(events.length,16);assert.deepEqual(data.coverage,old.coverage);assert.deepEqual(data.events.filter(e=>e.artistId!=='straightangeli'),old.events);assert.deepEqual(legacy.events,old.events);assert.equal(new Set(data.events.map(F.stableEventKey)).size,263);
 assert.deepEqual(events.map(e=>e.id).sort(),original.map(e=>e.id).sort());assert.ok(Date.parse(data.generatedAt)>Date.parse(old.generatedAt));assert.notEqual(data.version,old.version);
});
test('converted dates, exact times, unknown ends and source URLs match the researched source records',()=>{
 for(const src of original){const e=events.find(e=>e.id===src.id);assert.equal(e.sourceUrl,src.sourceUrl,e.id);assert.equal(e.location,src.venue,e.id);assert.equal(e.start,src.startTime?`${src.date}T${src.startTime}:00+09:00`:src.date,e.id);assert.equal(e.end,src.endTime?`${src.date}T${src.endTime}:00+09:00`:null,e.id);assert.equal(e.allDay,false);assert.equal(e.status,src.certainty);assert.ok(e.sources.some(s=>s.url===e.sourceUrl&&s.type==='artist_official_site'));}
});
test('five benefit-containing events use BENEFIT internally, with four live/event, two media and five reminders',()=>{
 assert.equal(events.filter(e=>e.category==='BENEFIT').length,5);assert.equal(events.filter(e=>e.category==='EVENT').length,4);assert.equal(events.filter(e=>e.category==='RADIO').length,2);assert.equal(events.filter(e=>e.category==='REMIND').length,5);
 for(const id of ['1355-part1','1355-part2','1357-part1','1357-part2','1278-benefit'])assert.equal(byId(id).category,'BENEFIT');
 const feeds=result.manifest.feeds.filter(f=>f.artist==='straightangeli');assert.deepEqual(Object.fromEntries(feeds.map(f=>[f.category,f.count])),{all:16,live:4,benefit:10,media:2,other:0});
});
test('11/18 sixteen-hour window and 12/12 unannounced time remain date-only, never a fabricated exact time',()=>{
 for(const id of ['1363-radio','1214-live']){const e=byId(id);assert.match(e.start,/^\d{4}-\d{2}-\d{2}$/);assert.equal(e.end,null);assert.ok(e.timings.every(t=>t.at===null));assert.equal(F.reminderTimes(e,{now:'2026-11-12T00:00:00Z'}).times.length,0);}
 assert.match(byId('1363-radio').note,/16時台/);const ics=unfold(result.files['straightangeli-media.ics']);assert.match(ics,/DTSTART;VALUE=DATE:20261118/);assert.match(ics,/時刻未定/);assert.ok(!ics.includes('20261118T070000Z'));
});
test('radio programme window and HBC event start never become claims of individual appearance times',()=>{
 const radio=byId('1359-radio'),hbc=byId('1343-live');assert.match(radio.title,/番組枠/);assert.match(radio.note,/正確な時刻は未公表/);assert.equal(radio.timings.find(t=>t.kind==='appearance_start').at,null);
 assert.match(hbc.title,/イベント開演/);assert.match(hbc.note,/個別出演時刻は未公表/);assert.equal(hbc.timings.find(t=>t.kind==='appearance_start').at,null);
 const all=unfold(result.files['straightangeli-all.ics']);assert.match(all,/【番組枠】/);assert.match(all,/【イベント開演】/);assert.match(all,/個別出演時刻は未公表/);
});
test('venue disagreement keeps both official sources; changed second show keeps 17:00 rather than old 17:30',()=>{
 for(const id of ['1355-part1','1355-part2','1355-sales']){const e=byId(id);assert.match(e.location,/相違/);assert.match(e.evidence,/未確定/);assert.ok(e.sources.some(s=>s.url==='https://towershibuya.jp/2026/11/14/236995'));}
 assert.equal(byId('1355-part2').start,'2026-11-14T17:00:00+09:00');assert.match(byId('1355-part2').note,/旧情報/);
});
test('release contains only public allowed fields, no research errors, fixtures, private state or personal notifications',()=>{
 const serialized=JSON.stringify(data);assert.ok(!/throttled|取得不能|取得失敗|private|ローカル検証専用|fixture|"favorite"|deviceToken|calendarPermission/.test(serialized));
 for(const e of events){assert.equal(e.source,'curated-calendar');assert.equal(e.revision,1);assert.equal(e.present,true);assert.ok(['2026-11-12T13:10:22+09:00','2026-11-12T13:25:46+09:00'].includes(e.checkedAt));for(const s of e.sources){const url=new URL(s.url);assert.equal(url.protocol,'https:');assert.ok(['straight-angeli.com','towershibuya.jp','www.a-sketch.com','www.hbc.co.jp'].includes(url.hostname));}}
 for(const f of result.manifest.feeds)assert.ok(!/VALARM|TRIGGER:/.test(result.files[f.id+'.ics']));
});
test('generated real release preserves all old ICS bytes and all old revision records exactly',()=>{
 const next=new Map(result.state.records.map(r=>[r.key,r]));for(const r of prior.records)assert.deepEqual(next.get(r.key),r);
 for(const p of L.PRESETS)assert.equal(result.files[p.id+'.ics'],fs.readFileSync(new URL('./fixtures/legacy/calendar-feeds/'+p.id+'.ics',import.meta.url),'utf8'));
 const added=result.state.records.filter(r=>r.event.artistId==='straightangeli');assert.equal(added.length,16);for(const r of added){assert.equal(r.sequence,0);assert.equal(r.created,data.generatedAt);assert.equal(r.modified,data.generatedAt);}
});
test('checked-in real generated files exactly match source/state and both manifests pass their actual clients',()=>{
 for(const [name,bytes] of Object.entries(result.files))assert.equal(fs.readFileSync(new URL('./calendar-feeds/'+name,import.meta.url),'utf8'),bytes,name);
 assert.equal(result.legacyDataJson,fs.readFileSync(new URL('./schedule-data.json',import.meta.url),'utf8'));
 assert.equal(L.validateManifest(read('./calendar-feeds/manifest.json')).feeds.length,10);assert.equal(S.validateManifest(read('./calendar-feeds/manifest-v2.json')).feeds.length,15);
 const full=result.manifest.feeds.filter(f=>f.category==='all');assert.equal(full.reduce((n,f)=>n+f.count,0),252);assert.equal(full.reduce((n,f)=>n+f.omittedUnknownDate,0),11);
});
test('actual new and old clients ingest their release snapshots without schema weakening',async()=>{
 for(const [script,snapshot,count] of [['./schedule-store.js',data,263],['./fixtures/legacy/schedule-store.js',legacy,247]]){const saved=new Map(),context=vm.createContext({Date,URL,navigator:{onLine:true},localStorage:{getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v)},fetch:async()=>({ok:true,redirected:false,headers:{get:()=>null},json:async()=>structuredClone(snapshot)})});vm.runInContext(fs.readFileSync(new URL(script,import.meta.url),'utf8'),context);const r=await context.scheduleRequest('state');assert.equal(r.ok,true,script);const state=await r.json();assert.equal(state.events.length,count);assert.equal(state.changes.length,0);}
});
test('early FC membership is a payment-completion deadline, never an application form deadline',()=>{
 const e=byId('1334-early-fc-deadline');assert.equal(e.start,'2026-11-30T23:59:00+09:00');assert.equal(e.deadline,e.start);assert.equal(e.category,'REMIND');assert.equal(e.end,null);assert.deepEqual(e.timings.map(t=>t.kind),['membership_payment_deadline']);assert.equal(e.timings[0].label,'入会・決済完了期限');assert.match(e.note,/応募フォームの締切ではありません/);assert.match(e.note,/月額550円または年額6000円/);assert.equal(e.sourceUrl,'https://straight-angeli.com/news/item-1334/');
});
test('LINE MUSIC keeps a label-verified application deadline without inventing a separate listening-period deadline',()=>{
 const e=byId('1338-deadline');assert.equal(e.deadline,'2026-12-15T23:59:00+09:00');assert.match(e.note,/応募期間は11\/1 0:00〜12\/15 23:59/);assert.match(e.note,/再生カウント期間の独立した締切は未確認/);assert.ok(e.sources.some(s=>s.type==='artist_official_label'&&new URL(s.url).hostname==='www.a-sketch.com'));assert.deepEqual(e.timings.map(t=>t.kind),['application_start','application_deadline']);assert.match(e.evidence,/11月6日記事/);assert.ok(!e.timings.some(t=>/campaign|listening/.test(t.kind)));
});
test('HBC age-policy disagreement is disclosed with both official sources instead of silently corrected',()=>{
 const e=byId('1343-live');assert.match(e.note,/小学生以下が要チケット/);assert.match(e.note,/小学生以上が要チケット/);assert.match(e.note,/表記が相違/);assert.match(e.note,/未就学児無料・膝上不可/);assert.ok(e.sources.some(s=>s.url==='https://www.hbc.co.jp/event/idolfes/'&&s.type==='organizer_official'));assert.ok(e.sources.some(s=>s.url===e.sourceUrl&&s.type==='artist_official_site'));assert.match(e.evidence,/誤植と断定せず/);
});
test('makeup-ticket condition is attached only to six verified photo-sale entries and invents no December 31 event',()=>{
 const expected=['1355-part1','1355-part2','1355-sales','1357-part1','1357-part2','1357-sales'].map(id=>'straightangeli-'+id).sort();
 const actual=events.filter(e=>e.sources.some(s=>s.url==='https://straight-angeli.com/news/item-1167/'));assert.deepEqual(actual.map(e=>e.id).sort(),expected);
 for(const e of actual){assert.match(e.note,/8\/22中止分の特典券・トライアルチケット保有者/);assert.match(e.note,/12月末までの生写真販売イベントで振替対応/);assert.match(e.note,/対象条件は公式案内を確認/);}
 assert.ok(!events.some(e=>e.start?.startsWith('2026-12-31')||e.id.includes('1167')));
});
test('public release notes distinguish available subscription feeds from unverified device reflection and disconnected Push',()=>{
 const notes=data.notes.join('\n');assert.match(notes,/購読の公開URLは配信済み/);assert.match(notes,/端末での登録・更新反映は未検証/);assert.match(notes,/継続監視・Pushは未接続/);assert.ok(!notes.includes('Push・本体カレンダー購読は未接続'));
});
