import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {backupDecision} from './backup-gate.mjs';
const now=Date.parse('2026-11-19T08:47:00Z');
const run={id:42,event:'schedule',head_branch:'main',status:'completed',conclusion:'success',created_at:'2026-11-19T08:18:00Z',updated_at:'2026-11-19T08:25:00Z'};
const good=['inspect','publish'].map(name=>({name,status:'completed',conclusion:'success'}));
const base={event:'schedule',schedule:'47 * * * *',token:'fixture-secret',repository:'ZuZitokisen/alert-pwa',branch:'main',runId:'99',now};
async function check(runs=[run],jobs=good,extra={}) {let calls=[];const result=await backupDecision({...base,fetchImpl:async(url,init)=>{calls.push(url);assert.equal(init.redirect,'error');return Response.json(url.includes('/jobs?')?{jobs,total_count:jobs.length}:{workflow_runs:runs});},...extra});return {result,calls};}
test('primary and manual dry run do not read API',async()=>{for(const extra of [{schedule:'17 * * * *'},{event:'workflow_dispatch'}]){const r=await check([],[],extra);assert.equal(r.result.proceed,true);assert.equal(r.calls.length,0);}});
test('recent completed scheduled production suppresses backup',async()=>{const r=await check();assert.equal(r.result.proceed,false);assert.equal(r.result.runId,42);assert.equal(r.calls.length,2);});
test('manual, old, future, other branch, failed and active runs never suppress',async()=>{for(const patch of [{event:'workflow_dispatch'},{created_at:'2026-11-19T07:59:00Z'},{created_at:'2026-11-19T09:00:00Z'},{head_branch:'other'},{conclusion:'failure'},{status:'in_progress'},{id:99}])assert.equal((await check([{...run,...patch}])).result.proceed,true);});
test('skipped backup and dry-run publish cannot masquerade as production',async()=>{for(const jobs of [[],good.slice(0,1),[good[0],{...good[1],conclusion:'skipped'}]])assert.equal((await check([run],jobs)).result.proceed,true);});
test('lookup failure, incomplete or oversized data runs normal guards',async()=>{for(const fetchImpl of [async()=>{throw Error('network secret');},async()=>new Response('',{status:403}),async()=>Response.json({}),async()=>new Response('x'.repeat(1_000_001)),async url=>Response.json(url.includes('/jobs?')?{jobs:good,total_count:101}:{workflow_runs:[run]})]){const r=await backupDecision({...base,fetchImpl});assert.equal(r.proceed,true);assert.ok(!r.reason.includes('secret'));}});
test('bounded reads and job scan',async()=>{const r=await check(Array.from({length:20},(_,i)=>({...run,id:i+100})),[]);assert.equal(r.calls.length,6);assert.equal(r.result.proceed,true);});
test('workflow preserves production guard and gates inspect, ephemeral permission scoped',()=>{const s=readFileSync(new URL('../.github/workflows/hourly-public-refresh.yml',import.meta.url),'utf8');assert.match(s,/cron: '17 \* \* \* \*'/);assert.match(s,/cron: '47 \* \* \* \*'/);assert.match(s,/needs: backup-gate/);assert.match(s,/needs\.inspect\.result == 'success'/);assert.match(s,/vars.HOURLY_AUTO_PUBLISH == 'true'/);assert.equal((s.match(/actions: read/g)||[]).length,1);assert.match(s,/cancel-in-progress: false/);});

test('primary/manual skip gate job but inspect explicitly tolerates skipped prerequisite',()=>{
 const s=readFileSync(new URL('../.github/workflows/hourly-public-refresh.yml',import.meta.url),'utf8');
 assert.match(s,/backup-gate:\n    if: github.event_name == 'schedule' && github.event.schedule == '47 \* \* \* \*'/);
 assert.match(s,/if: \$\{\{ !cancelled\(\) && needs.backup-gate.outputs.proceed != 'false' && inputs.mode != 'published-news' \}\}/);
 for(const [event,schedule,gateOutput,cancelled,expected] of [
 ['schedule','17 * * * *','',false,true],['workflow_dispatch','', '',false,true],
 ['schedule','47 * * * *','false',false,false],['schedule','47 * * * *','true',false,true],
 ['schedule','47 * * * *','',false,true],['schedule','17 * * * *','',true,false]]){
   const gateRuns=event==='schedule'&&schedule==='47 * * * *';
   const output=gateRuns?gateOutput:'';
   assert.equal(!cancelled&&output!=='false',expected);
 }
 // Preserve both new shell assets in the deployed public artifact.
 assert.match(s,/'release-check.js','app-release.json'/);
});
