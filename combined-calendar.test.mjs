import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import C from './production-feed-core.cjs';import {createCalendarHandler} from './combined-calendar.mjs';
const state=JSON.parse(fs.readFileSync(new URL('calendar-feeds/state.json',import.meta.url)));
const published=fs.readFileSync(new URL('calendar-feeds/combined-v1.json',import.meta.url),'utf8');
const request=(ids,opts)=>new Request('https://calendar.example/v1/calendar/'+ids+'.ics',opts);
test('all 30 existing feeds and newly published index remain consistent with canonical state',async()=>{
 const route=createCalendarHandler({fetcher:async()=>new Response(published)});
 for(const {id} of C.PRESETS.filter(item=>item.artist!=='batten')){
  const legacy=fs.readFileSync(new URL('calendar-feeds/'+id+'.ics',import.meta.url),'utf8');
  assert.equal(C.buildFeed(state,id).ics,legacy);
  const response=await route(request(id));assert.equal(response.status,200);assert.equal(await response.text(),C.buildCombinedFeed(state,[id]).ics);
 }
 assert.deepEqual(JSON.parse(published),C.buildCombinedIndex(state,{legacy:true}));
});
test('calendar union works without cookies, shares a cached lookup and emits conditional results',async()=>{
 let calls=0,time=0;
 const route=createCalendarHandler({now:()=>time,fetcher:async (url,options)=>{calls++;assert.equal(url,'https://zuzitokisen.github.io/alert-pwa/calendar-feeds/combined-v1.json');assert.equal(options.redirect,'error');return new Response(published);}});
 const ids='tokisen-all,ebichu-media';
 const a=await route(request(ids)),b=await route(request(ids,{method:'HEAD'}));assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(calls,1);
 const ics=await a.text();assert.equal(ics,C.buildCombinedFeed(state,ids.split(',')).ics);assert.ok(!ics.includes('VALARM'));assert.equal(await b.text(),'');
 assert.equal((await route(request(ids,{headers:{'If-None-Match':a.headers.get('etag')}}))).status,304);
 time=120001;await route(request(ids));assert.equal(calls,2);
 assert.equal((await route(request('ebichu-media,tokisen-live,tokisen-all'))).headers.get('Location'),'/v1/calendar/'+ids+'.ics');
 assert.equal((await route(request('tokisen-other,unknown-live'))).status,400);
 assert.equal((await route(request(ids,{method:'POST'}))).status,405);
 assert.equal((await route(new Request(request(ids).url+'?anything=1'))).status,404);
});
test('bad publication is retried later and never becomes an empty successful calendar',async()=>{
 let good=false;
 const route=createCalendarHandler({fetcher:async()=>new Response(good?published:'<html>not available</html>')});
 assert.equal((await route(request('tokisen-all,ebichu-live'))).status,503);
 good=true;assert.equal((await route(request('tokisen-all,ebichu-live'))).status,200);
});
