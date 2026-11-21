import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import C from './production-feed-core.cjs';
import F from './feature-core.js';

const read=name=>fs.readFileSync(new URL('./'+name,import.meta.url),'utf8');
const v5=JSON.parse(read('schedule-data-v5.json'));
const state=JSON.parse(read('calendar-feeds/state.json'));
const baseline=JSON.parse(read('calendar-feeds/manifest-v5.json'));
const alerts=JSON.parse(read('calendar-feeds/manifest-alerts-v5.json'));
const unfolded=text=>text.replace(/\r\n[ \t]/g,'');
const eventBlocks=ics=>[...unfolded(ics).matchAll(/BEGIN:VEVENT\r\n([\s\S]*?)END:VEVENT\r\n/g)].map(x=>x[1]);
const removeAlarms=text=>text.replace(/BEGIN:VALARM\r\n[\s\S]*?END:VALARM\r\n/g,'');
const triggers=block=>[...block.matchAll(/BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:(-?PT(?:\d+H)?(?:\d+M)?(?:\d+S)?)\r\nDESCRIPTION:.+\r\nEND:VALARM/g)].map(m=>m[1]);
const triggerTimes=block=>{
 const [,date] = /^DTSTART:(\d{8}T\d{6}Z)\r$/m.exec(block);
 const base=Date.parse(date.replace(/^(....)(..)(..)T(..)(..)(..)Z$/,'$1-$2-$3T$4:$5:$6Z'));
 return triggers(block).map(t=>{
  const [,neg,h=0,m=0,s=0]=/^(-?)PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(t);
  return new Date(base+(neg?-1:1)*(h*3600+m*60+Number(s))*1000).toISOString();
 });
};
const removeName=text=>text.replace(/X-WR-CALNAME:[^\r]+(?:\r\n[ \t][^\r]+)*/,'X-WR-CALNAME:fixture');

test('all 30 alarm files are opt-in variants; all non-alarm event fields are identical',()=>{
 const result=C.build(v5,state,{production:true,publicSource:'schedule-data-v5.json'});
 assert.deepEqual(result.manifest,baseline);
 assert.equal(alerts.alertOffsetMinutes,60);
 assert.equal(alerts.feeds.length,30);
 let total=0,skipped=0;
 const sourceByKey=new Map(v5.events.map(e=>[C.identity(e),e]));
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
   const source=sourceByKey.get(record.key);
   if(should&&source){
    total++;
    const expected=F.reminderTimes(source,{now:0}).times.map(x=>x.at);
    assert.deepEqual(triggerTimes(block),expected);
    assert.equal([...block.matchAll(/BEGIN:VALARM/g)].length,expected.length);
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
 assert.match(app,/function openSubscriptions[\s\S]+?subscriptionAlertChoices=new Set\(\)/);
 assert.match(app,/input.disabled=notice&&!subscriptionChoices.has/);
 assert.match(app,/先に本体側の古い登録を解除/);
 assert.match(app,/urls=S.links\(id,\{alerts\}\)/);
 assert.match(read('hourly/verify-live.mjs'),/manifest-alerts-v5\.json/);
 assert.match(read('.github/workflows/hourly-public-refresh.yml'),/for variant in \['', '-alerts'\]/);
});

test('JST event and deadline timing is converted to RFC 5545 relative alarms, without snapshot-clock churn',()=>{
 const source=v5.events.find(e=>e.artistId==='tokisen'&&e.status==='confirmed'&&e.start?.includes('T'));
 const day='2026-11-21';
 const fixture=[
  ['normal','17:00',['2026-11-20T23:00:00.000Z','2026-11-21T07:00:00.000Z']],
  ['early','07:00',['2026-11-20T21:00:00.000Z']],
  ['at-morning','08:00',['2026-11-20T22:00:00.000Z']],
  ['duplicate','09:00',['2026-11-20T23:00:00.000Z']],
  ['not-deadline','23:59',['2026-11-20T23:00:00.000Z','2026-11-21T13:59:00.000Z']],
  ['deadline','23:59',['2026-11-20T23:00:00.000Z','2026-11-21T14:00:00.000Z'], '23:59'],
  ['different-deadline','18:30',['2026-11-20T23:00:00.000Z','2026-11-21T14:00:00.000Z'],'23:59'],
 ];
 const events=fixture.map(([id,time,,deadline])=>({...source,id,title:id,status:'confirmed',present:true,allDay:false,
  start:`${day}T${time}:00+09:00`,end:null,deadline:deadline?`${day}T${deadline}:00+09:00`:null}));
 const options={production:true,publicSource:'schedule-data-v5.json'};
 const a=C.build({...v5,events},null,options);
 const b=C.build({...v5,events,version:v5.version+'-next',generatedAt:'2026-11-22T00:00:00Z'},a.state,options);
 assert.equal(a.files['tokisen-all-alerts.ics'],b.files['tokisen-all-alerts.ics']);
 const byId = new Map(eventBlocks(a.files['tokisen-all-alerts.ics']).map(block=>[block.match(/^SUMMARY:(.+)\r$/m)[1],block]));
 for(const [id,,expected] of fixture) assert.deepEqual(triggerTimes(byId.get(id)),expected,id);
 assert.deepEqual(triggers(byId.get('deadline')),['-PT15H59M','-PT59M']);
});
