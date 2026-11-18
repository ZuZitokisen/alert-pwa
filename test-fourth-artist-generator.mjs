import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import C from './production-feed-core.cjs';
const root=path.dirname(new URL(import.meta.url).pathname);
const data=JSON.parse(fs.readFileSync(path.join(root,'fixtures/legacy/schedule-data.json')));
const v2={production:true,publicSource:'schedule-data-v2.json'},v3={production:true,publicSource:'schedule-data-v3.json'};
const previous=C.build(data,null,v2);
const expanded={...structuredClone(data),version:data.version+'-fourth-generator-test',generatedAt:'2026-11-19T00:00:00Z'};
expanded.events.push({...structuredClone(data.events[0]),id:'oneloveoneheart-fixture',artistId:'oneloveoneheart'});
test('v3 creates twenty feeds and matching 15/10 feed manifests, preserving old records and ICS bytes',()=>{
 const r=C.build(expanded,previous.state,v3);
 assert.equal(r.manifest.schemaVersion,3);assert.equal(r.manifest.feeds.length,20);
 assert.equal(r.v2Manifest.feeds.length,15);assert.equal(r.v2Manifest.schemaVersion,2);
 assert.equal(r.legacyManifest.feeds.length,10);assert.equal(r.legacyManifest.schemaVersion,1);
 assert.deepEqual(r.v2Data.events,data.events);assert.deepEqual(r.legacyData.events,data.events);
 for(const old of previous.state.records)assert.deepEqual(r.state.records.find(x=>x.key===old.key),old);
 for(const [name,bytes] of Object.entries(previous.files))if(name.endsWith('.ics'))assert.equal(r.files[name],bytes);
 assert.deepEqual(C.build(expanded,r.state,v3).files,r.files);
 assert.equal(r.v2Manifest.inputSha256,C.hash(C.canonical(r.v2Data)));
 assert.throws(()=>C.build(expanded,previous.state,v2),/not supported/);
 assert.throws(()=>C.build(data,r.state,v2),/Cannot downgrade/);
 const bad=structuredClone(expanded);bad.events.at(-1).id='wrong-prefix';assert.throws(()=>C.build(bad,previous.state,v3),/prefix/);
});
test('CLI v3 generation checks both projections and rolls all targets back on failure',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'fourth-generator-'));
 try {
  for(const n of ['generate-subscription-feeds.mjs','production-feed-core.cjs','feature-core.js'])fs.copyFileSync(path.join(root,n),path.join(dir,n));
  fs.mkdirSync(path.join(dir,'calendar-feeds'));
  for(const [n,b] of Object.entries(previous.files))fs.writeFileSync(path.join(dir,'calendar-feeds',n),b);
  fs.writeFileSync(path.join(dir,'schedule-data.json'),previous.legacyDataJson);
  fs.writeFileSync(path.join(dir,'schedule-data-v2.json'),JSON.stringify(data));
  fs.writeFileSync(path.join(dir,'schedule-data-v3.json'),JSON.stringify(expanded));
  const run=(...args)=>spawnSync(process.execPath,args,{cwd:dir,encoding:'utf8'});
  const oldV2=fs.readFileSync(path.join(dir,'schedule-data-v2.json'),'utf8');
  fs.writeFileSync(path.join(dir,'fail.mjs'),`import fs from 'node:fs';const original=fs.renameSync;let fail=true;fs.renameSync=function(a,b){if(fail&&a.includes('.calendar-feeds-stage-')&&a.endsWith('/schedule-data-v2.json')){fail=false;throw Error('injected');}return original.apply(this,arguments);};`);
  assert.notEqual(run('--import','./fail.mjs','generate-subscription-feeds.mjs').status,0);
  assert.equal(fs.readFileSync(path.join(dir,'schedule-data-v2.json'),'utf8'),oldV2);
  assert.equal(fs.readFileSync(path.join(dir,'calendar-feeds/state.json'),'utf8'),previous.files['state.json']);
  assert.equal(fs.readFileSync(path.join(dir,'schedule-data.json'),'utf8'),previous.legacyDataJson);
  let result=run('generate-subscription-feeds.mjs');assert.equal(result.status,0,result.stderr);
  result=run('generate-subscription-feeds.mjs','--check');assert.equal(result.status,0,result.stderr);
  fs.writeFileSync(path.join(dir,'schedule-data-v2.json'),'{}');assert.notEqual(run('generate-subscription-feeds.mjs','--check').status,0);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
