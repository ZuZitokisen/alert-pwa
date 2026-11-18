import test from 'node:test';
import assert from 'node:assert/strict';
import {planNotifications} from './notifications.mjs';
const now=new Date('2026-11-18T22:00:00Z'); // 07:00 JST
const make=(id,more={})=>({id,artistId:'tokisen',start:'2026-11-19T15:00:00+09:00',location:'試験会場',present:true,status:'confirmed',title:'テスト '+id,...more});
const record=(event,sequence=0,modified='2026-11-18T12:00:00Z')=>({event,sequence,modified});
test('same-day distinct items notify, and first activation never replays old new events',()=>{
 const a=make('one'),b=make('two',{status:'possible'});
 assert.equal(planNotifications({events:[a,b]},{records:[record(a),record(b)]},{now}).filter(x=>x.kind==='new').length,0);
 const planned=planNotifications({events:[a,b]},{records:[record(a),record(b)]},{now,activatedAt:'2026-11-18T07:00:00Z'});
 assert.deepEqual(planned.filter(x=>x.kind==='new').map(x=>[x.id,x.status]),[['one','confirmed'],['two','possible']]);
 assert.ok(planned.find(x=>x.kind==='new').body.includes('11/19 15:00'));
 assert.deepEqual(planned.filter(x=>x.kind==='reminder').map(x=>x.at),['2026-11-18T23:00:00.000Z','2026-11-19T05:00:00.000Z','2026-11-18T23:00:00.000Z','2026-11-19T05:00:00.000Z']);
});
test('deadline exception, missing time, cancellation and revisions remain distinct',()=>{
 const a=make('one',{deadline:'2026-11-19T23:59:00+09:00'}),b=make('two',{status:'cancelled'}), c=make('three',{start:'2026-11-19'});
 const o=planNotifications({events:[a,b,c]},{records:[record(a,2),record(b,4),record(c)]},{now,activatedAt:'2026-11-18T07:00:00Z'});
 assert.deepEqual(o.filter(x=>x.kind==='reminder').map(x=>[x.id,x.revision,x.at]),[['one',3,'2026-11-18T23:00:00.000Z'],['one',3,'2026-11-19T14:00:00.000Z']]);
 assert.equal(o.find(x=>x.id==='two').kind,'change');
});
