import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const read=n=>fs.readFileSync(new URL(n,import.meta.url),'utf8');
const json=n=>JSON.parse(read(n)), data=json('./schedule-data-v4.json');
const own=data.events.filter(e=>e.artistId==='oneloveoneheart');
const app=()=>{const c=vm.createContext({URL,AbortController,setTimeout,clearTimeout,localStorage:{getItem:()=>null,setItem(){}},fetch:async url=>{assert.equal(url,'./schedule-data-v4.json');return {ok:true,json:async()=>data}}});for(const f of ['artist-config.js','schedule-store.js','calendar-subscriptions.js'])vm.runInContext(read('./'+f),c);return c;};
test('the shipped fourth-artist data and subscriptions load in the current client',async()=>{
 const c=app();const s=await c.scheduleRequest('state');assert.equal(s.ok,true);const v=await s.json();assert.equal(v.events.filter(e=>e.artistId==='oneloveoneheart').length,own.length);
 const S=c.AlertCalendarSubscriptions;assert.equal(S.PRESETS.length,25);const manifest=json('./calendar-feeds/manifest-v4.json');
 assert.equal(S.validateManifest(manifest).feeds.find(f=>f.id==='oneloveoneheart-all').count,own.length);
 assert.deepEqual(Array.from(S.planSelection(['oneloveoneheart-all','oneloveoneheart-media','tokisen-live']).selected),['oneloveoneheart-all','tokisen-live']);
 assert.equal(S.links('oneloveoneheart-all').webcal,'webcal://zuzitokisen.github.io/alert-pwa/calendar-feeds/oneloveoneheart-all.ics');
});
test('old schedules retain existing records and new cards have unique IDs and first-party sources',()=>{
 assert.deepEqual(json('./schedule-data-v2.json').events,data.events.filter(e=>!['oneloveoneheart','tohokusan'].includes(e.artistId)));
 assert.equal(new Set(data.events.map(e=>e.id)).size,data.events.length);
 for(const e of own){assert.equal(e.status,'confirmed');assert.match(e.id,/^oneloveoneheart-/);assert.ok(e.sources.some(x=>x.url===e.sourceUrl&&x.type==='artist_official'));}
 assert.equal(own.find(e=>e.id==='oneloveoneheart-monitoring-20261119').start,'2026-11-19T19:00:00+09:00');
 assert.equal(own.find(e=>e.id==='oneloveoneheart-release-kawasaki-20261122-start').start,'2026-11-21T19:00:00+09:00');
 assert.equal(own.find(e=>e.id==='oneloveoneheart-release-kawasaki-20261122-benefit').start,'2026-11-22T17:10:00+09:00');
});
