import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compatibleDispatch} from './dispatch-compat.mjs';
import {planNotifications} from './notifications.mjs';
test('only unsupported per-event reminders are deferred without mutation or relabeling',()=>{
 const planned=['tokisen','re-ge','straightangeli','oneloveoneheart','tohokusan','future'].map(artistId=>Object.freeze({artistId,id:artistId,kind:'reminder',revision:2}));
 const news=Object.freeze({id:'schedule-update-fixture',artistId:'tokisen',kind:'change'});
 const all=Object.freeze([news,...planned]);
 const result=compatibleDispatch(all);
 assert.deepEqual(result.records,[news,...planned.slice(0,4)]);
 assert.equal(result.deferredUnsupportedReminders,2);
 assert.equal(all.length,7);assert.equal(planned[4].artistId,'tohokusan');
 assert.ok(result.records.every(n=>all.includes(n)));
 assert.deepEqual(compatibleDispatch([]),{records:[],deferredUnsupportedReminders:0});
});
test('fifth-only publication keeps one shared News, old artist reminders remain dispatchable',()=>{
 const e=artistId=>({id:'fixture-'+artistId,artistId,present:true,status:'confirmed',start:'2026-11-19T15:00:00+09:00',title:'fixture'});
 const now=new Date('2026-11-18T22:00:00Z');
 for(const events of [[e('tohokusan')],[e('tohokusan'),e('tokisen')]]){
  const state={records:events.map(event=>({event,sequence:0,modified:'2026-11-18T12:00:00Z'}))};
  const options={now,activatedAt:'2026-11-18T07:00:00Z'};
  const out=compatibleDispatch(planNotifications({version:'v4-fixture',events},state,options));
  assert.equal(out.records.filter(n=>n.kind==='change').length,1);
  assert.equal(out.deferredUnsupportedReminders,2);
  assert.equal(out.records.filter(n=>n.kind==='reminder').length,events.length===1?0:2);
  assert.ok(!out.records.some(n=>n.artistId==='tohokusan'&&n.kind==='reminder'));
 }
});
test('compatibility filtering precedes send and retains activation/live-version/OIDC guards',()=>{
 const src=readFileSync(new URL('./dispatch.mjs',import.meta.url),'utf8');
 assert.match(src,/compatibleDispatch\(planned\)/);
 assert.ok(src.indexOf('compatibleDispatch(planned)')<src.indexOf('for(const value of records)'));
 assert.match(src,/if\(!send\)/);assert.match(src,/if\(!process.env.ALERT_PUSH_NOTIFY_AFTER\)/);
 assert.match(src,/token=await runtimeToken\(\)/);assert.match(src,/version!==snapshot.version/);
 assert.match(src,/schedule-data-v4.json/);assert.match(src,/deferredUnsupportedReminders,queued/);
});
