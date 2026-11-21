import {runtimeToken,backendOrigin} from './gh-oidc-client.mjs';
import {planNotifications} from './notifications.mjs';
import {compatibleDispatch} from './dispatch-compat.mjs';
import {readDispatchInput,verifyPublicDispatchInput} from './dispatch-snapshot.mjs';
const input=await readDispatchInput();
const {snapshot,state}=input;
const args=process.argv.slice(2),mode=args[0]||'dry-run';
const send=mode==='--send'||mode==='--published-news',newsOnly=mode==='--published-news';
if(!['dry-run','--send','--published-news'].includes(mode)||args.length!==(newsOnly?2:send?1:0))throw Error('Unexpected notification dispatch arguments');
const planned=planNotifications(snapshot,state,{activatedAt:process.env.ALERT_PUSH_NOTIFY_AFTER||null,onlyCurrentGeneration:newsOnly});
const result=compatibleDispatch(planned);
const records=newsOnly?result.records.filter(r=>r.kind==='change'):result.records;
const {deferredUnsupportedReminders}=result;
if(!send){console.log(JSON.stringify({dryRun:true,planned:planned.length,dispatchable:records.length,deferredUnsupportedReminders}));process.exit(0);}
if(!process.env.ALERT_PUSH_NOTIFY_AFTER)throw Error('Notification activation time not configured');
await verifyPublicDispatchInput(input,{expectedHash:newsOnly?args[1]:undefined});
if(newsOnly&&!records.length){console.log(JSON.stringify({queued:0,reason:'no publishable change'}));process.exit(0);}
const base=backendOrigin(), token=await runtimeToken();
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
