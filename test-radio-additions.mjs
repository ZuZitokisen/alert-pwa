import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import C from './production-feed-core.cjs';
const require=createRequire(import.meta.url),F=require('./feature-core.js');
const read=name=>JSON.parse(fs.readFileSync(new URL(name,import.meta.url),'utf8'));
const base=read('./fixtures/published-v070/schedule-data-v2.json'),prior=read('./fixtures/published-v070/state.json'),oldManifest=read('./fixtures/published-v070/manifest-v2.json');
const data=read('./schedule-data-v2.json'),additions=read('./radio-additions.json'),verification=read('./fixtures/radio-source-verification.json'),options={production:true,publicSource:'schedule-data-v2.json'},result=C.build(data,prior,options);
const prefix='straightangeli-nene-jrt-',agency='https://www.stardust.co.jp/talent/section3/matsumotonene/',radiko='https://radiko.jp/mobile/events/14166483';
const radio=data.events.filter(e=>e.id.startsWith(prefix)),unfold=ics=>ics.replace(/\r\n /g,'');
const components=ics=>new Map(unfold(ics).split('BEGIN:VEVENT\r\n').slice(1).map(chunk=>{const body='BEGIN:VEVENT\r\n'+chunk.slice(0,chunk.indexOf('END:VEVENT\r\n')+'END:VEVENT\r\n'.length);return [body.match(/\r\nUID:([^\r]+)\r\n/)[1],body];}));
function client(saved=new Map()){
 const queue=[],c=vm.createContext({Date,URL,navigator:{onLine:true},localStorage:{getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v)},fetch:async()=>({ok:true,redirected:false,headers:{get:()=>null},json:async()=>structuredClone(queue.shift())})});
 vm.runInContext(fs.readFileSync(new URL('./schedule-store.js',import.meta.url),'utf8'),c);
 return {saved,async get(payload){queue.push(payload);const response=await c.scheduleRequest('state');return {ok:response.ok,state:JSON.parse(JSON.stringify(await response.json()))};}};
}
test('radio update is exactly twenty appended occurrences; all published 263 events remain field-identical',()=>{
 assert.equal(data.events.length,283);assert.equal(radio.length,20);assert.deepEqual(radio,additions);assert.deepEqual(data.events.slice(0,263),base.events);assert.equal(data.events.filter(e=>!e.id.startsWith(prefix)).length,263);assert.deepEqual(data.coverage,base.coverage);assert.notEqual(data.version,base.version);assert.ok(Date.parse(data.generatedAt)>Date.parse(base.generatedAt));assert.equal(new Set(data.events.map(F.stableEventKey)).size,283);
});
test('only the individually corroborated November 13 occurrence is confirmed with a known ten-minute window',()=>{
 const first=radio[0];assert.equal(first.id,prefix+'20261113');assert.equal(first.status,'confirmed');assert.equal(first.start,'2026-11-13T16:40:00+09:00');assert.equal(first.end,'2026-11-13T16:50:00+09:00');assert.equal(first.sourceUrl,radiko);assert.deepEqual(first.sources.map(s=>s.url),[radiko,agency]);assert.equal(radio.filter(e=>e.status==='confirmed').length,1);assert.match(first.evidence,/個別回が一致/);assert.deepEqual(first.timings.map(t=>t.kind),['broadcast_start','broadcast_end']);
});
test('nineteen future Fridays remain rule-derived possible candidates with no invented end or date-specific source',()=>{
 assert.equal(radio.at(-1).start,'2027-03-26T16:40:00+09:00');
 for(const [index,e] of radio.entries()){const date=e.start.slice(0,10);assert.equal(new Date(date+'T00:00:00Z').getUTCDay(),5);assert.equal(e.id,prefix+date.replace(/-/g,''));assert.equal(e.groupId,'straightangeli-nene-jrt');assert.equal(e.category,'RADIO');assert.equal(e.allDay,false);assert.equal(e.deadline,null);if(index){assert.equal(Date.parse(e.start)-Date.parse(radio[index-1].start),7*24*60*60*1000);assert.equal(e.status,'possible');assert.equal(e.end,null);assert.equal(e.sourceUrl,agency);assert.equal(e.sources.length,1);assert.equal(e.sources[0].url,agency);assert.match(e.sources[0].type,/recurring/);assert.match(e.note,/個別回の番組表は未確認/);assert.match(e.note,/終了時刻は未確認/);assert.match(e.note,/継続放送を確定するものではありません/);assert.match(e.evidence,/毎週金曜16:40/);assert.equal(e.timings.length,1);assert.equal(e.timings[0].status,'possible');assert.match(e.timings[0].note,/定例由来/);}}
});
test('every source check time comes from explicit verification and never from a fabricated prior timestamp',()=>{
 assert.equal(verification.sources.length,2);for(const e of radio){for(const s of e.sources){const evidence=verification.sources.find(v=>v.url===s.url);assert.ok(evidence);assert.equal(s.checkedAt,evidence.checkedAt);assert.ok(Number.isFinite(Date.parse(s.checkedAt)));assert.ok(Date.parse(s.checkedAt)<=Date.parse(data.generatedAt));}assert.equal(Date.parse(e.checkedAt),Math.max(...e.sources.map(s=>Date.parse(s.checkedAt))));}
});
test('all published 263 UID, sequence, created, modified and memberships remain unchanged',()=>{
 const next=new Map(result.state.records.map(r=>[r.key,r]));for(const old of prior.records)assert.deepEqual(next.get(old.key),old);
 const newRecords=result.state.records.filter(r=>r.event.id.startsWith(prefix));assert.equal(newRecords.length,20);for(const r of newRecords){assert.equal(r.sequence,0);assert.equal(r.created,data.generatedAt);assert.equal(r.modified,data.generatedAt);assert.deepEqual(r.memberships,['straightangeli-all','straightangeli-media']);}
});
test('only the two third-artist radio-containing ICS change, with all previous VEVENT bytes retained',()=>{
 for(const p of C.PRESETS){const before=C.buildFeed(prior,p.id).ics,after=result.files[p.id+'.ics'];assert.equal(C.hash(before),oldManifest.feeds.find(f=>f.id===p.id).sha256);if(['straightangeli-all','straightangeli-media'].includes(p.id)){const oldEvents=components(before),newEvents=components(after);assert.equal(newEvents.size,oldEvents.size+20);for(const [uid,event] of oldEvents)assert.equal(newEvents.get(uid),event);}else assert.equal(after,before,p.id);}
});
test('candidate ICS is explicitly tentative with the maybe suffix and no DTEND or duration',()=>{
 for(const id of ['straightangeli-all','straightangeli-media']){const events=components(result.files[id+'.ics']);for(const e of radio){const component=events.get(C.uid(e));assert.ok(component);if(e.status==='possible'){assert.match(component,/STATUS:TENTATIVE\r\n/);assert.match(component,/SUMMARY:.*（かも？）\r\n/);assert.ok(!component.includes('DTEND'));assert.ok(!component.includes('DURATION'));assert.match(component,/個別放送回は未確認/);}else{assert.match(component,/STATUS:CONFIRMED\r\n/);assert.match(component,/DTEND:20261113T075000Z\r\n/);assert.ok(!component.includes('（かも？）'));}}}
});
test('repeat generation is idempotent and later explicit confirmation keeps the occurrence UID',()=>{
 assert.deepEqual(C.build(data,result.state,options).files,result.files);
 // In-memory validation fixture only. This does not promote a real occurrence.
 const changed=structuredClone(data),event=changed.events.find(e=>e.id===prefix+'20261120');changed.version+='-test-confirmation';changed.generatedAt=new Date(Date.parse(data.generatedAt)+60000).toISOString();event.status='confirmed';event.evidence='Test-only explicit confirmation fixture';
 const updated=C.build(changed,result.state,options),before=result.state.records.find(r=>r.event.id===event.id),after=updated.state.records.find(r=>r.event.id===event.id);assert.equal(after.uid,before.uid);assert.equal(after.sequence,before.sequence+1);assert.equal(after.created,before.created);assert.equal(after.event.end,null);assert.deepEqual(C.build(changed,updated.state,options).state,updated.state);
});
test('existing favorites survive and the browser records twenty new items once without changing published events',async()=>{
 const app=client();await app.get(base);const next=await app.get(data);assert.equal(next.ok,true);assert.equal(next.state.newChanges,20);assert.equal(next.state.changes.length,20);assert.ok(next.state.changes.every(c=>c.kind==='new'&&c.eventId.startsWith(prefix)));
 assert.deepEqual(next.state.events.slice(0,263),base.events);const favorites=new Set(base.events.map(F.stableEventKey));for(const e of next.state.events.slice(0,263))assert.equal(F.isFavorite(e,favorites),true);for(const e of radio)assert.equal(F.isFavorite(e,favorites),false);
 assert.equal((await app.get(data)).state.newChanges,0);assert.equal((await client(app.saved).get(data)).state.newChanges,0);
});
test('checked-in outputs match the full update and distinguish counts from certainty',()=>{
 for(const [name,bytes] of Object.entries(result.files))assert.equal(fs.readFileSync(new URL('./calendar-feeds/'+name,import.meta.url),'utf8'),bytes,name);
 assert.equal(result.legacyDataJson,fs.readFileSync(new URL('./schedule-data.json',import.meta.url),'utf8'));
 const feeds=result.manifest.feeds.filter(f=>f.artist==='straightangeli');assert.deepEqual(Object.fromEntries(feeds.map(f=>[f.category,f.count])),{all:36,live:4,benefit:10,media:22,other:0});assert.equal(radio.filter(e=>e.status==='possible').length,19);assert.match(data.notes.join('\n'),/定例から作った個別未確認の候補/);
});
