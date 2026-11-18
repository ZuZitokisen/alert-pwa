export async function runtimeToken(){
 const manual=process.env.ALERT_PUSH_ADMIN_TOKEN;
 if(manual)return manual;
 const endpoint=process.env.ACTIONS_ID_TOKEN_REQUEST_URL, access=process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
 if(!endpoint||!access)throw Error('No notification service credential configured');
 const u=new URL(endpoint);
 if(u.protocol!=='https:'||u.username||u.password||!u.hostname.endsWith('.actions.githubusercontent.com'))throw Error('Invalid GitHub OIDC token endpoint');
 u.searchParams.set('audience','alert-pwa-push-v1');
 const r=await fetch(u,{headers:{Authorization:'Bearer '+access},redirect:'error',signal:AbortSignal.timeout(10000)});
 if(!r.ok)throw Error('GitHub OIDC credential unavailable');
 const d=await r.json();
 if(typeof d.value!=='string'||d.value.length>12000||!d.value.includes('.'))throw Error('Invalid OIDC response');
 return d.value;
}
export function backendOrigin(){
 const u=new URL(process.env.ALERT_PUSH_BACKEND_ORIGIN||'');
 if(u.origin!=='https://artist-alert-push.hellopipi0831.chatgpt.site'||u.href!==u.origin+'/')throw Error('Invalid notification service origin');
 return u;
}
