import test from 'node:test';
import assert from 'node:assert/strict';
import C from './production-feed-core.cjs';

const options={production:true,publicSource:'schedule-data-v2.json'};
const primary='https://artist.example/news/z-event/',related='https://artist.example/news/a-condition/';
const copy=value=>structuredClone(value);
function fixture({primaryUrl=primary,start='2026-11-22T13:00:00+09:00'}={}) {
 const at='2026-11-11T00:00:00Z';
 return {schemaVersion:1,version:'primary-url-fixture-v1',generatedAt:at,coverage:{from:'2026-11-11',through:'2027-03-31'},events:[{
  id:'primary-url-fixture',source:'curated-calendar',artistId:'tokisen',title:'テスト予定',start,end:null,allDay:false,status:'confirmed',category:'BENEFIT',location:'テスト会場',note:'テスト用',evidence:'テスト出典',sourceUrl:primaryUrl,
  sources:[...new Set([primary,related,primaryUrl])].map(url=>({url,type:'artist_official_site',checkedAt:at})),checkedAt:at,timings:[],revision:1,present:true
 }]};
}
function next(d){return {...copy(d),version:d.version+'-next',generatedAt:'2026-11-16T00:00:00Z'};}
function signed(state){const {integritySha256,...body}=state;return {...body,integritySha256:C.hash(C.canonical(body))};}
function legacy(d){const state=copy(C.reconcile(d,null,options));for(const r of state.records)delete r.event.sourceUrl;return signed(state);}
function block(state,preset='tokisen-all'){return C.buildFeed(state,preset).ics.replace(/\r\n /g,'').split('BEGIN:VEVENT\r\n')[1]?.split('END:VEVENT')[0];}
const urlOf=body=>body.match(/^URL:(.+)$/m)?.[1].replace(/\r$/,'');

test('primary URL wins over alphabetically earlier related sources; all sources remain in DESCRIPTION',()=>{
 const d=fixture(),s=C.reconcile(d,null,options),b=block(s);
 assert.equal(urlOf(b),primary);assert.deepEqual(s.records[0].event.sourceUrls,[related,primary]);
 const description=b.match(/^DESCRIPTION:(.+)$/m)[1];for(const url of [related,primary])assert.ok(description.includes(url));
 assert.equal(urlOf(block(s,'tokisen-benefit')),primary);
});
test('old persisted state validates and renders its historically published fallback URL unchanged',()=>{
 const old=legacy(fixture()),snapshot=copy(old);assert.deepEqual(C.validateState(old),snapshot);
 assert.equal(urlOf(block(old)),related);assert.deepEqual(old,snapshot);
});
test('legacy URL repair preserves identity, timing, creation and sources, incrementing exactly once',()=>{
 const d=fixture(),old=legacy(d),out=C.build(next(d),old,options),a=old.records[0],b=out.state.records[0];
 for(const key of ['key','uid','created','lastTiming','memberships'])assert.deepEqual(b[key],a[key]);
 assert.deepEqual(b.event,{...a.event,sourceUrl:primary});assert.equal(b.sequence,a.sequence+1);assert.equal(b.modified,next(d).generatedAt);
 assert.equal(urlOf(block(out.state)),primary);assert.deepEqual(C.build(next(d),out.state,options),out);assert.equal(old.records[0].sequence,0);
});
test('legacy primary already matching fallback keeps complete persisted record and feed bytes unchanged',()=>{
 const d=fixture({primaryUrl:related}),old=legacy(d),out=C.build(next(d),old,options);
 assert.deepEqual(out.state.records,old.records);assert.equal(block(out.state),block(old));assert.equal(out.state.records[0].event.sourceUrl,undefined);
});
test('explicit default in a compatible state normalizes without revision or rendered changes',()=>{
 const d=fixture({primaryUrl:related}),old=legacy(d);old.records[0].event.sourceUrl=related;const previous=signed(old),out=C.reconcile(next(d),previous,options);
 assert.equal(out.records[0].sequence,0);assert.equal(out.records[0].modified,previous.records[0].modified);assert.equal(block(out),block(previous));
});
test('primary-only edits change URL and revision even when sorted related source list is identical',()=>{
 const d=fixture(),old=C.reconcile(d,null,options),updated=next(d);updated.events[0].sourceUrl=related;
 const out=C.reconcile(updated,old,options);assert.equal(urlOf(block(out)),related);assert.equal(out.records[0].sequence,1);
 assert.deepEqual(out.records[0].event.sourceUrls,old.records[0].event.sourceUrls);assert.deepEqual(C.reconcile(updated,out,options),out);
});
test('source ordering and check timestamps cannot change URL, revision, or feed bytes',()=>{
 const d=fixture(),old=C.reconcile(d,null,options),updated=next(d);updated.events[0].sources.reverse();updated.events[0].checkedAt=updated.generatedAt;for(const source of updated.events[0].sources)source.checkedAt=updated.generatedAt;
 const out=C.reconcile(updated,old,options);assert.deepEqual(out.records,old.records);assert.equal(block(out),block(old));
});
test('never-dated primary metadata migrates without revision or modified change; later date publishes correct URL',()=>{
 const d=fixture({start:null}),old=legacy(d),updated=next(d),out=C.reconcile(updated,old,options);
 assert.equal(out.records[0].event.sourceUrl,primary);assert.equal(out.records[0].sequence,0);assert.equal(out.records[0].modified,old.records[0].modified);assert.equal(block(out),undefined);
 const dated={...copy(updated),version:'fixture-dated',generatedAt:'2026-11-17T00:00:00Z'};dated.events[0].start='2026-11-22T13:00:00+09:00';
 const final=C.reconcile(dated,out,options);assert.equal(final.records[0].sequence,1);assert.equal(urlOf(block(final)),primary);
});
test('removed-date tombstone still has a URL and receives one repair revision',()=>{
 const d=fixture(),dated=legacy(d),undated=next(d);undated.events[0].start=null;let old=C.reconcile(undated,dated,options);
 // Model the historical pre-fix tombstone with no explicit primary source.
 old=copy(old);delete old.records[0].event.sourceUrl;old=signed(old);const repaired={...copy(undated),version:'fixture-tombstone-repair',generatedAt:'2026-11-17T00:00:00Z'};
 const out=C.reconcile(repaired,old,options);assert.equal(out.records[0].sequence,old.records[0].sequence+1);assert.equal(urlOf(block(out)),primary);assert.match(block(out),/STATUS:CANCELLED/);assert.deepEqual(out.records[0].lastTiming,old.records[0].lastTiming);
});
test('omitted legacy records retain historical URL/state rather than guessing a primary source',()=>{
 const d=fixture(),old=legacy(d),updated=next(d);updated.events[0].id='other-fixture';const out=C.reconcile(updated,old,options);
 assert.deepEqual(out.records.find(r=>r.key===old.records[0].key),old.records[0]);
});
test('input and persisted primary URLs must remain valid public HTTPS members of related sources',()=>{
 for(const bad of ['javascript:alert(1)','https://localhost/a','https://not-listed.example/event/','https://artist.example/a\nURL:evil',null]){
  const d=fixture();d.events[0].sourceUrl=bad;assert.throws(()=>C.reconcile(d,null,options));
  const state=legacy(fixture());state.records[0].event.sourceUrl=bad;assert.throws(()=>C.validateState(signed(state)));
 }
});
test('valid primary addition without updating stored checksum remains rejected',()=>{
 const state=legacy(fixture());state.records[0].event.sourceUrl=primary;assert.throws(()=>C.validateState(state),/integrity/);
});
test('long primary URLs fold safely and unfold to the exact destination with no duplicate URL property',()=>{
 const long='https://artist.example/news/'+('a'.repeat(160))+'/',d=fixture({primaryUrl:long}),s=C.reconcile(d,null,options),f=C.buildFeed(s,'tokisen-all').ics;
 assert.equal(urlOf(block(s)),long);assert.equal((block(s).match(/^URL:/gm)||[]).length,1);for(const line of f.split('\r\n'))assert.ok(Buffer.byteLength(line)<=75);
});
