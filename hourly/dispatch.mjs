import fs from 'node:fs/promises';
import {runtimeToken,backendOrigin} from './gh-oidc-client.mjs';
import {planNotifications} from './notifications.mjs';
import {compatibleDispatch} from './dispatch-compat.mjs';
const snapshot=JSON.parse(await fs.readFile(new URL('../schedule-data-v4.json',import.meta.url),'utf8'));
const state=JSON.parse(await fs.readFile(new URL('../calendar-feeds/state.json',import.meta.url),'utf8'));
const send=process.argv[2]==='--send';
if(process.argv.length!==2+(send?1:0))throw Error('Usage: node hourly/dispatch.mjs [--send]');
const planned=planNotifications(snapshot,state,{activatedAt:process.env.ALERT_PUSH_NOTIFY_AFTER||null});
const {records,deferredUnsupportedReminders}=compatibleDispatch(planned);
if(!send){console.log(JSON.stringify({dryRun:true,planned:planned.length,dispatchable:records.length,deferredUnsupportedReminders}));process.exit(0);}
if(!process.env.ALERT_PUSH_NOTIFY_AFTER)throw Error('Notification activation time not configured');
const base=backendOrigin(), token=await runtimeToken();
const publicOrigin=new URL('https://zuzitokisen.github.io/alert-pwa/schedule-data-v4.json');
const live=await fetch(publicOrigin,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
if(!live.ok||(await live.json()).version!==snapshot.version)throw Error('Wait for the exact schedule version to be public before dispatch');
let queued=0, batch=[];
const flush=async()=>{
 if(!batch.length)return;
 const response=await fetch(new URL('/v1/dispatch',base),{method:'POST',redirect:'error',signal:AbortSignal.timeout(15000),headers:{'Authorization':'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({events:batch})});
 if(response.status!==202)throw Error('Notification backend rejected dispatch: '+response.status);
 queued+=Number((await response.json()).queued)||0;batch=[];
};
for(const value of records){
 const candidate=[...batch,value];
 if(candidate.length>10||Buffer.byteLength(JSON.stringify({events:candidate}))>30000)await flush();
 batch.push(value);
}
await flush();
console.log(JSON.stringify({planned:planned.length,dispatchable:records.length,deferredUnsupportedReminders,queued}));
