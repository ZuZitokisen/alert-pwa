import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import C from './production-feed-core.cjs';
const require=createRequire(import.meta.url),F=require('./feature-core.js'),S=require('./calendar-subscriptions.js'),L=require('./fixtures/legacy/calendar-subscriptions.js');
const json=name=>JSON.parse(fs.readFileSync(new URL(name,import.meta.url),'utf8'));
const oldData=json('./fixtures/legacy/schedule-data.json'),oldState=json('./fixtures/legacy/state.json');
const currentScript=fs.readFileSync(new URL('./schedule-store.js',import.meta.url),'utf8');
const oldScript=fs.readFileSync(new URL('./fixtures/legacy/schedule-store.js',import.meta.url),'utf8');
const oldKey='alert-pwa-curated-calendar-v1',newKey='alert-pwa-curated-calendar-v2';
const options={production:true,publicSource:'schedule-data-v2.json'};
const copy=v=>structuredClone(v);
// Strictly test-only fixtures, never written to the authoritative schedule files.
const third=(id='straightangeli-fixture-1',overrides={})=>({...copy(oldData.events[0]),id,artistId:'straightangeli',title:'ローカル検証専用・実在予定ではない',start:'2026-11-20',end:null,category:'EVENT',allDay:false,sourceUrl:'https://example.com/test-only',sources:[{url:'https://example.com/test-only',type:'artist_official',checkedAt:'2026-11-12T13:00:00Z'}],timings:[],...overrides});
function expanded(events=[third()]){return {...copy(oldData),version:'compat-fixture-v2',generatedAt:'2026-11-12T13:00:00Z',events:[...copy(oldData.events),...events]};}
function store(script=currentScript,saved=new Map()){
 const reads=[],writes=[],queue=[];
 const c=vm.createContext({Date,URL,navigator:{onLine:true},localStorage:{getItem(k){reads.push(k);return saved.get(k)??null;},setItem(k,v){writes.push(k);saved.set(k,v);}},fetch:async()=>{const next=queue.shift();if(next instanceof Error)throw next;assert.ok(next);return {ok:true,redirected:false,headers:{get:()=>null},json:async()=>copy(next)};}});
 vm.runInContext(script,c);
 return {saved,reads,writes,async get(data){queue.push(data);const r=await c.scheduleRequest('state');return {ok:r.ok,state:JSON.parse(JSON.stringify(await r.json()))};}};
}
function tempRun(action){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'third-artist-compat-'));try{for(const n of ['production-feed-core.cjs','feature-core.js','generate-subscription-feeds.mjs','schedule-data-v2.json','schedule-data.json'])fs.copyFileSync(new URL('./'+n,import.meta.url),path.join(dir,n));fs.cpSync(new URL('./fixtures/legacy/calendar-feeds',import.meta.url),path.join(dir,'calendar-feeds'),{recursive:true});const run=(...args)=>spawnSync(process.execPath,['generate-subscription-feeds.mjs',...args],{cwd:dir,encoding:'utf8'});action(dir,run);}finally{fs.rmSync(dir,{recursive:true,force:true});}}

test('ten old URLs and legacy client remain unchanged; v2 has exactly fifteen allowlisted feeds',()=>{
 const result=C.build(expanded(),oldState,options);
 assert.equal(result.manifest.schemaVersion,2);assert.equal(result.manifest.feeds.length,15);
 assert.equal(result.legacyManifest.schemaVersion,1);assert.equal(result.legacyManifest.feeds.length,10);
 assert.equal(L.validateManifest(result.legacyManifest).feeds.length,10);
 assert.equal(S.validateManifest(result.manifest).feeds.length,15);
 assert.throws(()=>L.validateManifest(result.manifest));assert.throws(()=>S.validateManifest(result.legacyManifest));
 for(const p of L.PRESETS){assert.deepEqual(S.links(p.id),L.links(p.id));assert.equal(result.files[p.id+'.ics'],fs.readFileSync(new URL('./fixtures/legacy/calendar-feeds/'+p.id+'.ics',import.meta.url),'utf8'));}
});
test('old schema rejects third-artist data, but the exact generated two-artist projection is accepted',async()=>{
 const data=expanded(),result=C.build(data,oldState,options);
 assert.equal((await store(oldScript).get(data)).ok,false);
 const old=await store(oldScript).get(result.legacyData);assert.equal(old.ok,true);assert.equal(old.state.events.length,247);
 assert.deepEqual(result.legacyData.events,oldData.events);assert.equal(result.legacyData.version,data.version);assert.equal(result.legacyData.generatedAt,data.generatedAt);
 const current=await store().get(data);assert.equal(current.ok,true);assert.equal(current.state.events.length,248);
});
test('existing 247 records retain byte-equivalent records, UID, SEQUENCE, created and modified times',()=>{
 const result=C.build(expanded(),oldState,options),records=new Map(result.state.records.map(r=>[r.key,r]));
 for(const r of oldState.records)assert.deepEqual(records.get(r.key),r);
 assert.equal(result.state.records.length,248);assert.deepEqual(C.build(expanded(),result.state,options).files,result.files);
 const initial=C.build(copy(oldData),oldState,options);assert.deepEqual(initial.state,oldState);
 assert.equal(initial.files['manifest.json'],fs.readFileSync(new URL('./fixtures/legacy/manifest.json',import.meta.url),'utf8'));
});
test('favorites and selected-event keys retain source/id and cannot collide across artists',()=>{
 const e=oldData.events[0],favorites=new Set([F.stableEventKey(e)]),result=C.build(expanded(),oldState,options);
 const retained=result.state.records.find(r=>r.event.id===e.id).event;assert.equal(F.stableEventKey(retained),F.stableEventKey(e));assert.equal(F.isFavorite(retained,favorites),true);assert.equal(F.isFavorite(third(),favorites),false);
 const duplicate=expanded([]);duplicate.events.push({...copy(e),artistId:'re-ge'});assert.throws(()=>C.build(duplicate,oldState,options),/Duplicate client identity/);
 const moved=expanded([]);moved.events[0].artistId='re-ge';assert.throws(()=>C.build(moved,oldState,options),/cannot change artist/);
});
test('unknown artists, wrong prefixes, extra private fields and malformed data still fail closed',()=>{
 for(const e of [third('straightangeli-fixture-1',{artistId:'unknown'}),third('unscoped-id'),third('straightangeli-fixture-1',{favorite:true}),third('straightangeli-fixture-1',{start:'2026-02-30'})])assert.throws(()=>C.build(expanded([e]),oldState,options));
 const data=expanded();data.secret='private';assert.throws(()=>C.build(data,oldState,options));
 for(const mutate of [m=>m.schemaVersion=1,m=>m.feeds.pop(),m=>m.feeds.push(copy(m.feeds[0])),m=>m.feeds[0].artist='straightangeli',m=>m.feeds[0].path='calendar-feeds/fake.ics']){const m=C.build(expanded(),oldState,options).manifest;mutate(m);assert.throws(()=>S.validateManifest(m));}
});
test('third-artist known dates are date-only with explicit unknown time; unknown dates never invent a slot',()=>{
 const r=C.build(expanded([third(),third('straightangeli-fixture-undated',{start:null})]),oldState,options),feed=r.files['straightangeli-all.ics'].replace(/\r\n /g,'');
 assert.match(feed,/DTSTART;VALUE=DATE:20261120/);assert.match(feed,/時刻未定/);assert.ok(!feed.includes('DTEND'));assert.equal(r.manifest.feeds.find(f=>f.id==='straightangeli-all').count,1);assert.equal(r.manifest.feeds.find(f=>f.id==='straightangeli-all').omittedUnknownDate,1);
 assert.equal((feed.match(/BEGIN:VEVENT/g)||[]).length,1);
});
test('v1 cache migration retains change IDs, revisions and read threshold without touching v1 storage',async()=>{
 const old=store(oldScript),baseline={...copy(oldData),events:[copy(oldData.events[0])]};await old.get(baseline);
 const revised={...copy(baseline),version:'old-revised',generatedAt:'2026-11-12T10:00:00Z'};revised.events[0].title+=' fixture change';
 const oldResult=await old.get(revised),before=old.saved.get(oldKey),readThrough=oldResult.state.changes[0].id;
 assert.equal(readThrough,1);const current=store(currentScript,old.saved);
 const data={...copy(revised),version:'new-artist',generatedAt:'2026-11-12T13:00:00Z',events:[...revised.events,third()]};
 const migrated=await current.get(data);assert.equal(migrated.ok,true);assert.deepEqual(current.reads,[newKey,oldKey]);assert.deepEqual(current.writes,[newKey]);assert.equal(old.saved.get(oldKey),before);
 assert.equal(migrated.state.events[0].revision,2);assert.equal(migrated.state.newChanges,1);assert.equal(migrated.state.changes[0].id,2);assert.equal(migrated.state.changes[0].kind,'new');
 assert.deepEqual(migrated.state.changes[1],oldResult.state.changes[0]);assert.equal(migrated.state.changes.filter(c=>c.id>readThrough).length,1);
 const repeated=await current.get(data);assert.equal(repeated.state.newChanges,0);assert.equal(repeated.state.nextChangeId,3);
 const reload=store(currentScript,old.saved),again=await reload.get(data);assert.deepEqual(reload.reads,[newKey]);assert.equal(again.state.newChanges,0);assert.deepEqual(again.state.changes,migrated.state.changes);
});
test('v2 offline startup can use untouched v1 cache while keeping an error; does not fabricate new artist data',async()=>{
 const old=store(oldScript);await old.get(oldData);const before=old.saved.get(oldKey),current=store(currentScript,old.saved),r=await current.get(new Error('offline'));
 assert.equal(r.ok,false);assert.equal(r.state.events.length,247);assert.equal(r.state.baselineReady,true);assert.match(r.state.sources[0].error,/前回確認/);assert.equal(old.saved.get(oldKey),before);assert.deepEqual(current.writes,[]);
});
test('v2 cache wins over v1, preserving history even when an old tab subsequently rewrites v1',async()=>{
 const old=store(oldScript);await old.get(oldData);const current=store(currentScript,old.saved);const first=await current.get(expanded());
 await old.get({...copy(oldData),version:'old-tab-later',generatedAt:'2026-11-12T13:01:00Z'});
 const again=await store(currentScript,old.saved).get(expanded());assert.equal(again.ok,true);assert.deepEqual(again.state.changes,first.state.changes);assert.equal(again.state.events.length,248);
});
test('corrupt v2 cache never silently rolls back to v1',async()=>{
 const old=store(oldScript);await old.get(oldData);old.saved.set(newKey,'{bad');const current=store(currentScript,old.saved),r=await current.get(new Error('offline'));assert.deepEqual(current.reads,[newKey]);assert.equal(r.ok,false);assert.equal(r.state.events.length,0);assert.match(r.state.cacheError,/保存データ/);
});
test('client rejects cross-artist identity reassignment without partial cache/history changes',async()=>{
 const app=store();await app.get(oldData);const before=app.saved.get(newKey),data=expanded([]);data.events[0].artistId='re-ge';const r=await app.get(data);assert.equal(r.ok,false);assert.equal(app.saved.get(newKey),before);assert.equal(r.state.changes.length,0);
});
test('CLI creates both manifests and legacy schedule as one checked generation, preserving old ICS bytes',()=>tempRun((dir,run)=>{
 fs.writeFileSync(path.join(dir,'schedule-data-v2.json'),JSON.stringify(expanded(),null,2)+'\n');
 assert.notEqual(run('--check').status,0);assert.equal(run().status,0);assert.equal(run('--check').status,0);
 const legacy=JSON.parse(fs.readFileSync(path.join(dir,'schedule-data.json'),'utf8'));assert.deepEqual(legacy.events,oldData.events);
 for(const p of L.PRESETS)assert.equal(fs.readFileSync(path.join(dir,'calendar-feeds',p.id+'.ics'),'utf8'),fs.readFileSync(new URL('./fixtures/legacy/calendar-feeds/'+p.id+'.ics',import.meta.url),'utf8'));
 fs.writeFileSync(path.join(dir,'schedule-data.json'),'{}');assert.notEqual(run('--check').status,0);assert.equal(run().status,0);assert.equal(run('--check').status,0);
 assert.notEqual(run('--initialize').status,0);
}));
test('CLI validation failure leaves both previous legacy schedule and feed state untouched',()=>tempRun((dir,run)=>{
 const before=fs.readFileSync(path.join(dir,'schedule-data.json'),'utf8'),state=fs.readFileSync(path.join(dir,'calendar-feeds/state.json'),'utf8'),data=expanded();data.events[0].favorite=true;fs.writeFileSync(path.join(dir,'schedule-data-v2.json'),JSON.stringify(data));assert.notEqual(run().status,0);assert.equal(fs.readFileSync(path.join(dir,'schedule-data.json'),'utf8'),before);assert.equal(fs.readFileSync(path.join(dir,'calendar-feeds/state.json'),'utf8'),state);
}));
test('CLI rolls both targets back after an ordinary failure between their filesystem replacements',()=>tempRun((dir)=>{
 const before=fs.readFileSync(path.join(dir,'schedule-data.json'),'utf8'),state=fs.readFileSync(path.join(dir,'calendar-feeds/state.json'),'utf8');
 fs.writeFileSync(path.join(dir,'schedule-data-v2.json'),JSON.stringify(expanded(),null,2)+'\n');
 fs.writeFileSync(path.join(dir,'inject-failure.mjs'),`import fs from 'node:fs';const original=fs.renameSync;let thrown=false;fs.renameSync=function(from,to){if(!thrown&&from.includes('.calendar-feeds-stage-')&&from.endsWith('/schedule-data.json')){thrown=true;throw new Error('Injected ordinary rename failure');}return original.apply(this,arguments);};`);
 const run=spawnSync(process.execPath,['--import','./inject-failure.mjs','generate-subscription-feeds.mjs'],{cwd:dir,encoding:'utf8'});assert.notEqual(run.status,0);assert.match(run.stderr,/Injected ordinary rename failure/);assert.equal(fs.readFileSync(path.join(dir,'schedule-data.json'),'utf8'),before);assert.equal(fs.readFileSync(path.join(dir,'calendar-feeds/state.json'),'utf8'),state);assert.equal(fs.existsSync(path.join(dir,'.calendar-feeds.lock')),false);
}));
