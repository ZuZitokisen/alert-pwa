import test from 'node:test';
import assert from 'node:assert/strict';
import {collectTohokusan,parseTohokusanArchive,parseTohokusanDetail} from './tohokusan-source.mjs';

// Reduced structure reconstructed from the public schedule index and article
// /contents/1127556. Fixtures contain only title, date, time, place and markup.
const O='https://madeintohoku.com', S=O+'/contents/schedule';
const U=O+'/contents/1127556', D='2026-11-22';
const T='11月22日(日)「アリーナへ直行便！fromさくらんぼ東根 ワンマンキャンペーン」';
const N='2026-11-19T08:00:00Z';
const rowHtml=(href='/contents/1127556',date=D,category='EVENT')=>'<div class="contents-list-item fadein"><a href="'+href+'" target="_self"><div class="meta"><time class="time event-date" datetime="'+date+'"></time><span class="tag">'+category+'</span></div><h3 class="contents-list-title title">'+T+'</h3></a></div>';
const list=(rows=rowHtml(),paging='')=>'<title>SCHEDULE | いぎなり東北産オフィシャルサイト</title><div id="js-contents-list" class="contents-list fadein">'+rows+'</div><div class="paging hide">'+paging+'</div>';
const dateText='11月22日(日)12：00スタート';
const body=(when=dateText)=>'<p>❏開催日時<br />'+when+'<br />※観覧条件あり。<br />❏会場<br />山形・イオン東根店(2F特設会場)<br />※9:00～入場可</p>';
const article=(p=body())=>'<meta property="og:url" content="'+U+'"><section class="details-wrapper schedule corner"><article class="details"><div class="title"><h3>'+T+'</h3></div><div><time class="time event-date" datetime="'+D+'"></time><span class="tag">EVENT</span></div><div class="body">'+p+'</div></article></section>';
const row=()=>parseTohokusanArchive(list()).rows[0];
const parse=html=>parseTohokusanDetail(html,row(),N);
const args={from:'2026-11-19',through:'2027-01-01',now:N};
const http=s=>new Response(s,{headers:{'content-type':'text/html; charset=utf-8'}});

test('exact official article fields, canonical URL, JST start, no inference',()=>{
 const {events,diagnostics}=parse(article());
 assert.equal(events.length,1);assert.deepEqual(diagnostics,[]);
 const [e]=events;assert.equal(e.id,'tohokusan-hourly-official-1127556');assert.equal(e.start,D+'T12:00:00+09:00');
 assert.equal(e.end,null);assert.equal(e.status,'confirmed');assert.equal(e.artistId,'tohokusan');assert.equal(e.category,'EVENT');
 assert.equal(e.sourceUrl,U);assert.equal(e.location,'山形・イオン東根店(2F特設会場)');assert.deepEqual(e.timings,[]);
});
test('only allowlisted LIVE/EVENT articles; external/special/media excluded',()=>{
 const a=parseTohokusanArchive(list(rowHtml()+rowHtml('https://example.com/contents/7')+rowHtml('/pages/iginari-arena')+rowHtml('/contents/3',D,'TV')+rowHtml('/contents/4?tag=all')));
 assert.equal(a.rows.length,1);assert.equal(a.diagnostics.length,4);
});
test('duplicate article rows suppressed even when the day differs',()=>{
 const a=parseTohokusanArchive(list(rowHtml()+rowHtml('/contents/1127556','2026-11-23')));
 assert.deepEqual(a.rows,[]);assert.equal(a.diagnostics.at(-1).code,'unsupported_event_shape');
});
test('archive structure changes fail closed; pagination is reported',()=>{
 for(const html of ['<html>login</html>',list(''),list().replace('target="_self"','')])assert.throws(()=>parseTohokusanArchive(html));
 assert.equal(parseTohokusanArchive(list(rowHtml(),'<a href="/page/2">next</a>')).diagnostics[0].code,'page_limit');
});
test('identity / title / article day / category mismatch are rejected',()=>{
 for(const html of [article().replace(U,O+'/contents/9999'),article().replace(T,T+'変更'),article().replace(D,'2026-11-23'),article().replace('>EVENT<','>LIVE<')])assert.deepEqual(parse(html).events,[]);
});
test('invalid time, no explicit start, weekday/date/year disagreement are rejected',()=>{
 for(const date of ['11月22日(日)24:00スタート','11月22日(日)12:00','11月22日(月)12:00スタート','11月23日(月)12:00スタート','2027年11月22日(日)12:00スタート','11月22日(日)12:00～14:30'])assert.deepEqual(parse(article(body(date))).events,[],date);
});
test('multi-start, cancellation, postponement and missing venue are rejected',()=>{
 for(const p of [body().replace('※観覧条件あり。','13:30スタート'),body().replace('※9:00～入場可','第2部'),body()+'<p>開催中止</p>',body()+'<p>開催延期</p>',body().replace('山形・イオン東根店(2F特設会場)',''),body()+'<p>❏会場</p>'])assert.deepEqual(parse(article(p)).events,[],p);
});
test('collector uses explicit public URL, transparent UA, rejects redirects',async()=>{
 const called=[];
 const r=await collectTohokusan({...args,fetchImpl:async(url,options)=>{called.push(url);assert.ok(options.headers['User-Agent'].startsWith('AlertPWA-'));assert.equal(options.redirect,'manual');return url===S?http(list()):new Response('',{status:302,headers:{location:'https://example.com/'}});}});
 assert.deepEqual(called,[S,U]);assert.deepEqual(r.events,[]);assert.equal(r.complete,false);assert.equal(r.diagnostics[0].code,'detail_failed');
});
test('archive errors do not claim source success',async()=>{
 for(const bad of [new Response('blocked',{status:403}),new Response('text'),http('<html>login</html>')]){
  const r=await collectTohokusan({...args,fetchImpl:async()=>bad});
  assert.deepEqual(r.events,[]);assert.equal(r.diagnostics[0].code,'archive_failed');assert.equal(r.complete,false);
 }
});
test('bounded coverage and ready result',async()=>{
 await assert.rejects(()=>collectTohokusan({...args,from:'2026-02-30'}),/Invalid bounds/);
 const r=await collectTohokusan({...args,fetchImpl:async url=>url===S?http(list()):http(article())});
 assert.equal(r.events.length,1);assert.equal(r.complete,true);assert.equal(r.diagnostics[0].count,1);
 const limited=await collectTohokusan({...args,through:'2026-11-21',fetchImpl:async url=>{assert.equal(url,S);return http(list());}});
 assert.deepEqual(limited.events,[]);
});
