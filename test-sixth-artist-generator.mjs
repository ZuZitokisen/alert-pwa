import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import C from './production-feed-core.cjs';
import {mergeOfficialSchedules} from './hourly/merge.mjs';

const read=name=>JSON.parse(fs.readFileSync(new URL('./'+name,import.meta.url),'utf8'));
const v5=read('schedule-data-v5.json'), v4=read('schedule-data-v4.json');
const opts={production:true,publicSource:'schedule-data-v5.json'};
const legacy=C.build({...v4,version:v4.version+'-before-v5-fixture',generatedAt:new Date(Date.parse(v4.generatedAt)-1000).toISOString()},null,{production:true,publicSource:'schedule-data-v4.json'});

test('v5 preserves all v4 events and all four compatible subscription cohorts',()=>{
 const result=C.build(v5,legacy.state,opts);
 assert.deepEqual(result.v4Data,v4);
 assert.deepEqual([result.manifest,result.v4Manifest,result.v3Manifest,result.v2Manifest,result.legacyManifest].map(x=>x.feeds.length),[30,25,20,15,10]);
 assert.equal(result.manifest.schemaVersion,5);
 assert.equal(result.v4Manifest.schemaVersion,4);
 assert.equal(result.v4Manifest.inputSha256,C.hash(C.canonical(v4)));
 const byKey=new Map(result.state.records.map(x=>[x.key,x]));
 for(const old of legacy.state.records) assert.deepEqual(byKey.get(old.key),old);
 for(const [n,bytes] of Object.entries(legacy.files)) if(n.endsWith('.ics')) assert.equal(result.files[n],bytes);
 assert.throws(()=>C.build(v4,result.state,{production:true,publicSource:'schedule-data-v4.json'}),/Cannot downgrade/);
 assert.throws(()=>C.build(v5,legacy.state,{production:true,publicSource:'schedule-data-v4.json'}),/not supported/);
 assert.deepEqual(C.build(v5,result.state,opts).files,result.files);
});

test('hourly data applies existing artist changes without erasing curated Ebichu rows',()=>{
 const seed=v5.events.filter(e=>e.artistId==='ebichu');
 const now=new Date('2026-11-21T04:00:00Z');
 const candidate={...structuredClone(v5.events.find(e=>e.artistId==='tokisen')),id:'tokisen-hourly-sixth-projection-fixture',start:'2026-12-01T12:34:00+09:00',end:null,title:'互換性テスト専用の予定',location:'テスト会場',sourceUrl:'https://toki-sen.com/contents/1234',sources:[{type:'artist_official',url:'https://toki-sen.com/contents/1234',checkedAt:now.toISOString()}],checkedAt:now.toISOString(),status:'confirmed',present:true,allDay:false,revision:1};
 const {next,notices}=mergeOfficialSchedules(v5,[candidate],now);
 assert.equal(notices.length,1);
 assert.deepEqual(next.events.filter(e=>e.artistId==='ebichu'),seed);
 assert.equal(C.build(next,null,opts).v4Data.events.some(e=>e.id===candidate.id),true);
});

test('current client reads v5 and restores the v4 cache before first network response',async()=>{
 const {createContext,runInContext}=await import('node:vm');
 const js=n=>fs.readFileSync(new URL('./'+n,import.meta.url),'utf8');
 const saved=new Map(),calls=[];
 let payload=v4;
 const c=createContext({Date,URL,AbortController,setTimeout,clearTimeout,navigator:{onLine:true},localStorage:{getItem:k=>saved.get(k)??null,setItem:(k,v)=>saved.set(k,v)},fetch:async url=>{calls.push(url);return {ok:true,redirected:false,headers:{get:()=> 'application/json'},json:async()=>structuredClone(payload)};},ALERT_ARTISTS:[{id:'oneloveoneheart'},{id:'tohokusan'}]});
 runInContext(js('schedule-store.js'),c);
 assert.equal((await c.scheduleRequest('state')).ok,true);
 assert.equal(calls.at(-1),'./schedule-data-v4.json');
 const old=saved.get('alert-pwa-curated-calendar-v4');
 payload=v5;
 runInContext(js('artist-config.js'),c);c.ALERT_ARTISTS=c.ALERT_ARTISTS.filter(a=>a.id!=='batten');runInContext(js('schedule-store.js'),c);runInContext(js('calendar-subscriptions.js'),c);
 const response=await c.scheduleRequest('state'),state=await response.json();
 assert.equal(response.ok,true);
 assert.equal(calls.at(-1),'./schedule-data-v5.json');
 assert.equal(saved.get('alert-pwa-curated-calendar-v4'),old);
 assert.ok(saved.get('alert-pwa-curated-calendar-v5'));
 assert.equal(state.events.filter(e=>e.artistId==='ebichu').length,v5.events.filter(e=>e.artistId==='ebichu').length);
 assert.equal(state.changes.filter(e=>e.after?.artistId==='ebichu').length,v5.events.filter(e=>e.artistId==='ebichu').length);
 assert.equal(c.AlertCalendarSubscriptions.validateManifest(read('calendar-feeds/manifest-v5.json')).feeds.length,30);
});
