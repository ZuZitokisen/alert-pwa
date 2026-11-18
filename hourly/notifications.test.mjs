import test from 'node:test';
import assert from 'node:assert/strict';
import {planNotifications} from './notifications.mjs';
const now=new Date('2026-11-18T22:00:00Z');
const version='fixture-generation-a'; // 07:00 JST
const make=(id,more={})=>({id,artistId:'tokisen',start:'2026-11-19T15:00:00+09:00',location:'試験会場',present:true,status:'confirmed',title:'テスト '+id,...more});
const record=(event,sequence=0,modified='2026-11-18T12:00:00Z')=>({event,sequence,modified});
test('one shared update per generation; opt-in does not replay old updates',()=>{
 const a=make('one'),b=make('two',{status:'possible'});
 assert.equal(planNotifications({version,events:[a,b]},{records:[record(a),record(b)]},{now}).filter(x=>x.kind==='change').length,0);
 const planned=planNotifications({version,events:[a,b]},{records:[record(a),record(b)]},{now,activatedAt:'2026-11-18T07:00:00Z'});
 const updates=planned.filter(x=>x.kind==='change');assert.equal(updates.length,1);
 assert.equal(updates[0].title,'予定が更新されました');assert.match(updates[0].url,/#changes$/);
 assert.deepEqual(planned.filter(x=>x.kind==='reminder').map(x=>x.at),['2026-11-18T23:00:00.000Z','2026-11-19T05:00:00.000Z','2026-11-18T23:00:00.000Z','2026-11-19T05:00:00.000Z']);
});
test('deadline exception, missing time, cancellation and revisions remain distinct',()=>{
 const a=make('one',{deadline:'2026-11-19T23:59:00+09:00'}),b=make('two',{status:'cancelled'}), c=make('three',{start:'2026-11-19'});
 const o=planNotifications({version,events:[a,b,c]},{records:[record(a,2),record(b,4),record(c)]},{now,activatedAt:'2026-11-18T07:00:00Z'});
 assert.deepEqual(o.filter(x=>x.kind==='reminder').map(x=>[x.id,x.revision,x.at]),[['one',3,'2026-11-18T23:00:00.000Z'],['one',3,'2026-11-19T14:00:00.000Z']]);
 assert.equal(o.filter(x=>x.kind==='change').length,1);
 assert.ok(!o.some(x=>x.id==='two'&&x.kind==='reminder'));
});
