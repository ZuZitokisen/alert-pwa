import {runtimeToken,backendOrigin} from './gh-oidc-client.mjs';
const token=await runtimeToken();
let count=0;
for(let i=0;i<3;i++){
 const r=await fetch(new URL('/v1/drain',backendOrigin()),{redirect:'error',signal:AbortSignal.timeout(25000),method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({limit:5})});
 if(!r.ok)throw Error('Notification delivery queue request failed: '+r.status);
 const j=await r.json(); const got=Number(j.sent)||0;count+=got;
 if(got<5)break;
}
console.log(JSON.stringify({sent:count}));
