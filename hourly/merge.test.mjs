import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {mergeOfficialSchedules as merge} from './merge.mjs';
const base=JSON.parse(readFileSync(new URL('../schedule-data-v3.json',import.meta.url)));
const now=new Date('2026-11-18T09:00:00Z');
const candidate=(suffix='mock-a',extra={})=>{
 const url='https://oneloveoneheart.jp/live/live-12345/';
 return {id:'oneloveoneheart-hourly-'+suffix,source:'curated-calendar',artistId:'oneloveoneheart',title:'公開データ検証用新規予定',start:'2026-12-07T19:00:00+09:00',end:null,allDay:false,status:'confirmed',category:'LIVE',location:'',note:'',evidence:'',sourceUrl:url,sources:[{url,type:'artist_official',checkedAt:now.toISOString()}],checkedAt:now.toISOString(),timings:[],revision:1,present:true,...extra};
};
test('no observation never drops a retained public row nor changes published generation',()=>assert.equal(merge(base,[],now).next,base));
test('new, unchanged retry and a material update produce exactly their respective notices',()=>{
 const a=candidate(),b=candidate('mock-b',{title:'別の検証用予定',start:'2026-12-07T22:00:00+09:00'});
 const applied=merge(base,[a,b],now);assert.deepEqual(applied.next.events.slice(0,base.events.length),base.events);
 assert.deepEqual(applied.notices.map(x=>[x.eventId,x.kind]),[[a.id,'new'],[b.id,'new']]);
 const nextNow=new Date('2026-11-18T10:00:00Z');
 assert.equal(merge(applied.next,[a,b],nextNow).next,applied.next);
 const changed=merge(applied.next,[{...a,location:'検証会場'}],nextNow);
 assert.deepEqual(changed.notices.map(x=>[x.eventId,x.kind,x.fields]),[[a.id,'updated',['location']]]);
 assert.equal(changed.next.events.length,applied.next.events.length);
});
test('official alias never replaces more complete existing slots or emits duplicates',()=>{
 const id='oneloveoneheart-hourly-fc-1dedb9bd-55e6-44e4-89a5-e58d4ec7d486';
 const a={...candidate(),id,title:'ONE LOVE ONE HEART Winter Oneman Live 2027＠東京',start:'2027-01-11'};
 const result=merge(base,[a],now);assert.equal(result.next,base);assert.equal(result.skipped[0].reason,'covered by existing verified item');
});
test('outside scope, invalid hosts, conflicts and downgraded precision never publish',()=>{
 const a=candidate(),badHost='https://other.example/event';
 assert.equal(merge(base,[a,{...a,start:'2026-12-08'}],now).next,base);
 assert.equal(merge(base,[{...a,start:'2027-04-01'},{...a,id:'oneloveoneheart-hourly-b',sourceUrl:badHost,sources:[{url:badHost,type:'artist_official',checkedAt:a.checkedAt}]}],now).next,base);
 const saved=merge(base,[a],now).next;
 assert.equal(merge(saved,[{...a,start:'2026-12-07'}],new Date('2026-11-18T10:00:00Z')).next,saved);
});
