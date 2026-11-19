import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {mergeOfficialSchedules} from './merge.mjs';
const base=JSON.parse(fs.readFileSync(new URL('../schedule-data-v4.json',import.meta.url)));
test('verified Higashine source is aliased, with no duplicate or manual detail replacement',()=>{
 const e=structuredClone(base.events.find(e=>e.id==='tohokusan-higashine-20261122'));
 e.id='tohokusan-hourly-official-1127556';e.title='11月22日(日)「アリーナへ直行便！fromさくらんぼ東根 ワンマンキャンペーン」';e.location='山形・イオン東根店(2F特設会場)';
 const r=mergeOfficialSchedules(base,[e],new Date('2026-11-20T00:00:00Z'));
 assert.deepEqual(r.next,base);assert.equal(r.notices.length,0);
 assert.equal(r.skipped[0].reason,'covered by existing verified item');
});
test('third-party evidence cannot make a fifth-artist event confirmed',()=>{
 const e=structuredClone(base.events.find(e=>e.id==='tohokusan-higashine-20261122'));
 e.id='tohokusan-bad';e.sourceUrl='https://example.com/a';e.sources=[{url:e.sourceUrl,type:'artist_official',checkedAt:e.checkedAt}];
 const r=mergeOfficialSchedules(base,[e],new Date('2026-11-20T00:00:00Z'));
 assert.equal(r.notices.length,0);assert.deepEqual(r.next,base);assert.match(r.skipped[0].reason,/invalid/);
});
