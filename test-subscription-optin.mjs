import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import C from './production-feed-core.cjs';

const read=name=>fs.readFileSync(new URL('./'+name,import.meta.url),'utf8');
const v5=JSON.parse(read('schedule-data-v5.json'));
const state=JSON.parse(read('calendar-feeds/state.json'));
const baseline=JSON.parse(read('calendar-feeds/manifest-v5.json'));
const alerts=JSON.parse(read('calendar-feeds/manifest-alerts-v5.json'));
const unfolded=text=>text.replace(/\r\n[ \t]/g,'');
const eventBlocks=ics=>[...unfolded(ics).matchAll(/BEGIN:VEVENT\r\n([\s\S]*?)END:VEVENT\r\n/g)].map(x=>x[1]);
const removeAlarms=text=>text.replace(/BEGIN:VALARM\r\n[\s\S]*?END:VALARM\r\n/g,'');
const removeName=text=>text.replace(/X-WR-CALNAME:[^\r]+(?:\r\n[ \t][^\r]+)*/,'X-WR-CALNAME:fixture');

test('all 30 alarm files are opt-in variants; all non-alarm event fields are identical',()=>{
 const result=C.build(v5,state,{production:true,publicSource:'schedule-data-v5.json'});
 assert.deepEqual(result.manifest,baseline);
 assert.equal(alerts.alertOffsetMinutes,60);
 assert.equal(alerts.feeds.length,30);
 let total=0,skipped=0;
 const byUid=new Map(state.records.map(r=>[r.uid,r]));
 for(let i=0;i<baseline.feeds.length;i++){
  const normal=baseline.feeds[i], optin=alerts.feeds[i], plainText=read(normal.path), alertText=read(optin.path);
  assert.equal(optin.path,`calendar-feeds/${normal.id}-alerts.ics`);
  const {path,sha256,...same}=optin;
  assert.deepEqual(same,Object.fromEntries(Object.entries(normal).filter(([key])=>!['path','sha256'].includes(key))));
  assert.equal(sha256,C.hash(alertText));assert.equal(normal.sha256,C.hash(plainText));
  assert.equal(C.hash(result.files[normal.id+'.ics']),normal.sha256);
  assert.equal(removeName(removeAlarms(alertText)),removeName(plainText));
  assert.ok(alertText.endsWith('\r\n'));assert.doesNotMatch(alertText,/(?<!\r)\n/);
  for(const line of alertText.split('\r\n')) assert.ok(Buffer.byteLength(line)<=75);
  for(const block of eventBlocks(alertText)){
   const record=byUid.get(block.match(/^UID:(.+)\r$/m)[1]);
   const should=record.event.status==='confirmed'&&!record.event.allDay && /^DTSTART:\d{8}T\d{6}Z\r$/m.test(block)&&/^STATUS:CONFIRMED\r$/m.test(block);
   if(should){
    total++;assert.equal([...block.matchAll(/BEGIN:VALARM/g)].length,1);
    assert.match(block,/BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT1H\r\nDESCRIPTION:.+\r\nEND:VALARM/);
   }else{skipped++;assert.doesNotMatch(block,/BEGIN:VALARM/);}
  }
 }
 assert.ok(total>0&&skipped>0);
});

test('client keeps original URLs by default and fails closed on incorrect alert manifests',async()=>{
 const ctx=vm.createContext({URL,AbortController,setTimeout,clearTimeout});
 vm.runInContext(read('artist-config.js'),ctx);vm.runInContext(read('calendar-subscriptions.js'),ctx);
 const api=ctx.AlertCalendarSubscriptions;
 assert.match(api.links('ebichu-all').webcal,/^webcal:.+\/ebichu-all\.ics$/);
 assert.match(api.links('ebichu-all',{alerts:true}).webcal,/^webcal:.+\/ebichu-all-alerts\.ics$/);
 assert.throws(()=>api.links('../secret',{alerts:true}),/Unknown preset/);
 assert.throws(()=>api.validateManifest(alerts),/Invalid/);
 assert.throws(()=>api.validateManifest(baseline,{alerts:true}),/Invalid/);
 const changed=structuredClone(alerts);changed.feeds[0].path='https://example.com/calendar.ics';
 assert.throws(()=>api.validateManifest(changed,{alerts:true}),/Invalid/);
 let url;
 const valid=await api.loadManifest(async input=>{url=input;return {ok:true,text:async()=>JSON.stringify(alerts)};},'https://zuzitokisen.github.io/alert-pwa/',100,{alerts:true});
 assert.match(url,/\/manifest-alerts-v5\.json$/);assert.equal(valid.feeds.length,30);
});

test('opt-in is reset per registration and warning is explicit',()=>{
 const app=read('app.js');
 assert.match(app,/function openSubscriptions[\s\S]+?subscriptionAlerts=false;/);
 assert.match(app,/check.checked=subscriptionAlerts/);
 assert.match(app,/通知あり・なしはどちらか一方だけ追加/);
 assert.match(app,/urls=S.links\(id,\{alerts:subscriptionAlerts\}\)/);
 assert.match(read('hourly/verify-live.mjs'),/manifest-alerts-v5\.json/);
 assert.match(read('.github/workflows/hourly-public-refresh.yml'),/for variant in \['', '-alerts'\]/);
});
