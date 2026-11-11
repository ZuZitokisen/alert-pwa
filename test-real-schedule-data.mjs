import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
const require=createRequire(import.meta.url),F=require('./feature-core.js');
const data=JSON.parse(fs.readFileSync(new URL('./schedule-data.json',import.meta.url),'utf8'));
const events=data.events;
const byId=id=>events.find(e=>e.id===id);
test('curated schedule is real, separate from demonstration and bounded through March',()=>{
 assert.equal(data.coverage.from,'2026-11-11');assert.equal(data.coverage.through,'2027-03-31');assert.ok(events.length>200);
 assert.equal(new Set(events.map(e=>F.stableEventKey(e))).size,events.length);
 for(const e of events){assert.equal(e.source,'curated-calendar');assert.ok(!e.title.includes('架空'));assert.ok(e.sources.length);assert.equal(e.allDay,false);if(e.start)assert.ok(F.dateKey(e.start)>=data.coverage.from&&F.dateKey(e.start)<=data.coverage.through,e.id);}
});
test('all facts have individual HTTPS sources and checked time; no private URLs or contacts',()=>{
 for(const e of events){assert.ok(Number.isFinite(Date.parse(e.checkedAt)),e.id);assert.ok(e.sources.some(s=>s.url===e.sourceUrl));for(const s of e.sources){const u=new URL(s.url);assert.equal(u.protocol,'https:');assert.equal(u.username,'');assert.equal(u.password,'');assert.ok(!/chatgpt|localhost|127\.0\.0\.1/.test(u.hostname));assert.ok(Number.isFinite(Date.parse(s.checkedAt)));}}
});
test('source classification does not turn organizer-only discoveries into confirmed appearances',()=>{
 for(const e of events)if(e.status==='confirmed')assert.ok(e.sources.some(s=>s.type.startsWith('artist_official')),e.id);
 for(const e of events.filter(e=>e.id.includes('sdd-application')||e.id.startsWith('tokisen-jr-')))assert.equal(e.status,'possible',e.id);
});
test('Tokisen real benefit sessions keep event and check-in times separate',()=>{
 for(const day of ['2026-11-29','2026-12-19']){const e=byId('tokisen-real-'+day+'-part1');assert.equal(e.start,day+'T12:00:00+09:00');assert.equal(e.end,day+'T13:00:00+09:00');assert.equal(e.timings.find(t=>t.kind==='checkin_open').at,day+'T11:40:00+09:00');assert.equal(e.timings.find(t=>t.kind==='checkin_close').at,day+'T12:10:00+09:00');}
});
test('sales deadline differs from session date and early reservation differs from serial application',()=>{
 assert.equal(byId('tokisen-real-2026-11-29-firstcome-close').deadline,'2026-11-15T23:59:00+09:00');
 assert.equal(byId('tokisen-early-reservation-close-1116324').start,'2027-01-11');
 assert.equal(byId('tokisen-early-serial-close-1116324').deadline,'2027-01-18T23:59:00+09:00');
 assert.match(byId('tokisen-early-reservation-close-1116324').note,/閉店/);
});
test('undated artist announcements never acquire fabricated dates or notification times',()=>{
 const undated=events.filter(e=>!e.start);assert.ok(undated.length>=5);
 for(const e of undated){assert.equal(e.end,null);assert.equal(F.reminderTimes(e,{now:'2026-11-11T00:00:00Z'}).times.length,0);}
 assert.ok(undated.some(e=>e.title.includes('最後のワンマン')));
});
test('RE-GE confirmed ticket sale update retains exact official start and application deadline',()=>{
 const sales=events.filter(e=>e.groupId==='rege-anniversary-20270221');
 assert.ok(sales.some(e=>e.start==='2026-12-25T20:00:00+09:00'&&e.category==='REMIND'));
 const serial=events.filter(e=>e.groupId==='rege-2nd-single-serial-deadline-20261206');assert.equal(serial.length,1);assert.equal(serial[0].deadline,'2026-12-06T23:59:00+09:00');
});
test('midnight radio dates and unknown end times stay faithful',()=>{
 assert.equal(byId('tokisen-media-508342-2026-11-15').start,'2026-11-15T01:00:00+09:00');
 assert.equal(byId('rege-fmfuji-20261111').end,null);
 assert.ok(byId('rege-fmfuji-20261111').timings.some(t=>t.kind==='broadcast_end'&&t.status==='possible'));
});
test('same-day Music benefit does not inherit the CD event location or time',()=>{
 const e=byId('tokisen-rakuten-omisendoff-20261219');assert.equal(e.start,'2026-12-19');assert.ok(!e.location.includes('大手町'));assert.equal(e.end,null);
});
test('real notification preview does not label actual plans as fictional or send anything',()=>{
 const p=F.notificationPreview(events[0],{real:true});assert.ok(!p.title.includes('架空'));assert.ok(!p.body.includes('架空'));assert.equal(p.data.demo,false);assert.equal(p.data.previewOnly,true);assert.match(p.body,/実際の通知は送信しません/);
});
test('page does not load demo data or expose mutation controls',()=>{
 const h=fs.readFileSync(new URL('./index.html',import.meta.url),'utf8');assert.ok(h.includes('./schedule-store.js'));assert.ok(!h.includes('./demo-data.js'));assert.ok(!h.includes('./demo-store.js'));assert.ok(!h.includes('data-step='));assert.ok(!h.includes('すべて架空'));
});
