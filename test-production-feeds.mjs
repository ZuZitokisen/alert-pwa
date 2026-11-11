import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import C from './production-feed-core.cjs';
const data=JSON.parse(fs.readFileSync(new URL('./schedule-data.json',import.meta.url),'utf8'));
const options={production:true,publicSource:'schedule-data.json'}, initial=C.build(data,null,options);
const copy=v=>structuredClone(v);
function changed(fn){let d=copy(data);d.generatedAt='2026-11-12T09:32:46Z';d.version='2026-11-12-v1';fn(d);return d;}
const first=initial.state.records.find(r=>r.event.id===data.events[0].id);
test('247 real public records generate ten reproducible public feeds without demo or private state',()=>{
 assert.equal(initial.state.records.length,247);assert.equal(initial.manifest.feeds.length,10);
 assert.deepEqual(C.build(data,initial.state,options).files,initial.files);
 for(const [name,body] of Object.entries(initial.files)){assert.ok(!/VALARM|DURATION:|example\.invalid|demo":true|架空サンプル|"favorite"|calendarPermission|deviceToken/.test(body),name);}
 for(const f of initial.manifest.feeds){assert.equal(C.hash(initial.files[f.id+'.ics']),f.sha256);assert.equal((initial.files[f.id+'.ics'].match(/BEGIN:VEVENT/g)||[]).length,f.count);}
 assert.ok(initial.manifest.feeds.reduce((n,f)=>n+f.omittedUnknownDate,0)>0);
});
test('stable UID, meaningful changes increment only once; check metadata does not increment',()=>{
 const d=changed(d=>{d.events[0].title+=' 更新';});const s=C.reconcile(d,initial.state,options),r=s.records.find(r=>r.key===first.key);
 assert.equal(r.uid,first.uid);assert.equal(r.sequence,first.sequence+1);assert.equal(r.created,first.created);
 assert.deepEqual(C.reconcile(d,s,options),s);
 const checked=changed(d=>{d.events[0].checkedAt=d.generatedAt;d.events[0].sources[0].checkedAt=d.generatedAt;});
 assert.equal(C.reconcile(checked,initial.state,options).records.find(r=>r.key===first.key).sequence,0);
});
test('omission retains facts; explicit missing is tentative, never cancellation',()=>{
 const d=changed(d=>{d.events.shift();});const s=C.reconcile(d,initial.state,options);
 assert.deepEqual(s.records.find(r=>r.key===first.key),first);
 const missing=changed(d=>{d.events[0].present=false;});
 const f=C.buildFeed(C.reconcile(missing,initial.state,options),'tokisen-all');assert.match(f.ics,/掲載消失/);assert.ok(!f.ics.includes('STATUS:CANCELLED'));
});
test('category movement emits old-feed tombstone and new-feed same identity',()=>{
 const d=changed(d=>{d.events[0].category='LIVE';});const s=C.reconcile(d,initial.state,options);
 const old=C.buildFeed(s,'tokisen-benefit').ics.replace(/\r\n /g,''),newFeed=C.buildFeed(s,'tokisen-live').ics.replace(/\r\n /g,'').replace(/\r\n /g,'');
 for(const ics of [old,newFeed])assert.ok(ics.includes('UID:'+first.uid));
 const extract=ics=>ics.split('BEGIN:VEVENT').find(v=>v.includes(first.uid));
 assert.match(extract(old),/STATUS:CANCELLED/);assert.match(extract(newFeed),/STATUS:TENTATIVE/);assert.match(extract(old),/SEQUENCE:1/);
});
test('explicit cancellation preserved; new unknown dates omitted; removed dates cancel old slot',()=>{
 const cancelled=changed(d=>{d.events[0].status='cancelled';});
 assert.match(C.buildFeed(C.reconcile(cancelled,initial.state,options),'tokisen-all').ics,/STATUS:CANCELLED/);
 const undated=initial.state.records.find(r=>!r.event.start);assert.ok(!C.buildFeed(initial.state,undated.event.artistId+'-all').ics.includes(undated.uid));
 const d=changed(d=>{d.events[0].start=null;d.events[0].end=null;});const f=C.buildFeed(C.reconcile(d,initial.state,options),'tokisen-all').ics.replace(/\r\n /g,'');
 assert.match(f.split('BEGIN:VEVENT').find(v=>v.includes(first.uid)),/STATUS:CANCELLED/);
});
test('date-only is clearly unknown time; timed unknown-end never invents duration',()=>{
 const ics=C.buildFeed(initial.state,'tokisen-all').ics.replace(/\r\n /g,'');
 const e=ics.split('BEGIN:VEVENT').find(v=>v.includes(first.uid));assert.match(e,/DTSTART;VALUE=DATE:20261111/);assert.match(e,/時刻未定/);assert.ok(!e.includes('DTEND'));
 const r=initial.state.records.find(r=>r.event.start?.includes('T')&&!r.event.end);const item=C.buildFeed(initial.state,r.event.artistId+'-all').ics.replace(/\r\n /g,'').split('BEGIN:VEVENT').find(v=>v.includes(r.uid));assert.ok(!item.includes('DTEND'));assert.match(item,/DTSTART:\d{8}T\d{6}Z/);
});
test('strict production boundary rejects unapproved data, duplicate, unknown/private fields and malformed values',()=>{
 assert.throws(()=>C.build(data,null,{}));
 for(const mutate of [d=>d.events.push(copy(d.events[0])),d=>d.events[0].favorite=true,d=>d.events[0].start='2026-02-30',d=>d.events[0].start='2026-11-11T30:00:00Z',d=>d.events[0].sources[0].url='javascript:alert(1)',d=>d.events[0].sourceUrl='https://localhost/a',d=>d.events[0].category='invalid',d=>d.events=[]]){
 const d=copy(data);mutate(d);assert.throws(()=>C.build(d,null,options));}
});
test('rejects state corruption, stale generation and conflicting snapshot version',()=>{
 const s=copy(initial.state);s.records[0].uid='fake';assert.throws(()=>C.build(data,s,options));
 const injected=copy(initial.state);injected.secret='no';assert.throws(()=>C.validateState(injected));
 assert.throws(()=>C.reconcile(changed(d=>{d.generatedAt='2026-11-10T00:00:00Z';}),initial.state,options));
 const conflict=copy(data);conflict.events[0].title+='!';assert.throws(()=>C.reconcile(conflict,initial.state,options));
 assert.throws(()=>C.reconcile(changed(d=>{d.events[0].title+='!';d.version=data.version;}),initial.state,options));
 const update=changed(d=>{d.events[0].title+='!';});assert.equal(update.events[0].revision,1);assert.equal(C.reconcile(update,initial.state,options).records.find(r=>r.key===first.key).sequence,1);
});
test('RFC5545 UTF-8 folding and escaping do not introduce event properties',()=>{
 const d=changed(d=>{d.events[0].title='日本語'.repeat(100)+'\nBEGIN:VEVENT,;\\';});const ics=C.build(d,initial.state,options).files['tokisen-all.ics'];
 for(const line of ics.split('\r\n'))assert.ok(Buffer.byteLength(line)<=75);
 assert.ok(!ics.includes('\r\nBEGIN:VEVENT,'));assert.match(ics.replace(/\r\n /g,''),/\\nBEGIN:VEVENT\\,\\;\\\\/);
});
test('CLI checks missing/stale artifacts and refuses accidental reset',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'public-feed-test-'));
 try {
 for(const name of ['production-feed-core.cjs','feature-core.js','generate-subscription-feeds.mjs','schedule-data.json'])fs.copyFileSync(new URL('./'+name,import.meta.url),path.join(dir,name));
 const run=(...args)=>spawnSync(process.execPath,['generate-subscription-feeds.mjs',...args],{cwd:dir,encoding:'utf8'});
 assert.notEqual(run('--check').status,0);assert.equal(run('--initialize').status,0);assert.equal(run('--check').status,0);assert.notEqual(run('--initialize').status,0);
 fs.writeFileSync(path.join(dir,'calendar-feeds','tokisen-all.ics'),'stale');assert.notEqual(run('--check').status,0);assert.equal(run().status,0);assert.equal(run('--check').status,0);
 fs.unlinkSync(path.join(dir,'calendar-feeds','re-ge-all.ics'));assert.notEqual(run('--check').status,0);
 }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
