import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {readDispatchInput,verifyPublicDispatchInput} from './dispatch-snapshot.mjs';
import {compatibleDispatch} from './dispatch-compat.mjs';
import {planNotifications} from './notifications.mjs';

const generatedAt='2026-11-21T03:12:33Z';
const event={id:'fixture-ebichu',artistId:'ebichu',start:'2026-11-22T20:00:00+09:00',present:true,status:'confirmed',title:'Fixture'};
const fixture=(modified=generatedAt)=>{
 const snapshot={version:'fixture-v5',generatedAt,events:[event]};
 const state={dataVersion:snapshot.version,dataGeneratedAt:generatedAt,records:[{event,sequence:0,modified}]};
 const bytes=Buffer.from(JSON.stringify(snapshot));
 return {bytes,read:async u=>u.pathname.endsWith('/schedule-data-v5.json')?bytes:Buffer.from(JSON.stringify(state))};
};
const news=({snapshot,state},onlyCurrentGeneration)=>compatibleDispatch(planNotifications(snapshot,state,{
 now:new Date('2026-11-21T03:20:00Z'),activatedAt:'2026-11-21T03:00:00Z',onlyCurrentGeneration,
})).records;
test('both publishers yield the same single generic notice for an Ebichu-only generation',async()=>{
 const f=fixture(), candidate=await readDispatchInput(f);
 assert.equal(news(candidate,true).length,1);
 assert.deepEqual(news(candidate,true),news(candidate,false));
 assert.deepEqual(news(candidate,true),news(await readDispatchInput(f),true));
 assert.equal(news(candidate,true)[0].kind,'change');
 assert.deepEqual(news(await readDispatchInput(fixture('2026-11-21T03:10:00Z')),true),[]);
});
test('matching version does not permit old bytes or wrong expected generation',async()=>{
 const f=fixture(), c=await readDispatchInput(f);
 await verifyPublicDispatchInput(c,{expectedHash:c.hash,fetcher:async u=>{assert.match(u.pathname,/schedule-data-v5.json$/);return new Response(f.bytes);}});
 await assert.rejects(verifyPublicDispatchInput(c,{expectedHash:'f'.repeat(64),fetcher:async()=>assert.fail('unexpected fetch')}),/different schedule hash/);
 await assert.rejects(verifyPublicDispatchInput(c,{fetcher:async()=>Response.json({...c.snapshot,events:[]})}),/exact published/);
});
test('editorial handoff exists only on existing allowlisted workflow, not an automatic unconditional push',()=>{
 const yaml=readFileSync(new URL('../.github/workflows/hourly-public-refresh.yml',import.meta.url),'utf8').split('\n  notify-editorial:')[1];
 assert.match(yaml,/github.event_name == 'workflow_dispatch'.*inputs.mode == 'published-news'/);
 assert.match(yaml,/github.ref == 'refs\/heads\/main'/);
 assert.match(yaml,/dispatch.mjs --published-news "\$EXPECTED_SCHEDULE_SHA256"/);
 assert.doesNotMatch(yaml,/contents: write|pages: write/);
});
