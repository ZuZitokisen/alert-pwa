'use strict';
(function(root){
 const KEY='alert-pwa-push-device-v1';
 function endpoint(config,origin){
  if(!config?.backendUrl)return null;
  try{const u=new URL(config.backendUrl);if(u.protocol!=='https:'||u.username||u.password||u.search||u.hash||!(u.origin===origin||(config.allowedOrigins||[]).includes(u.origin)))return null;return u.href.replace(/\/$/,'');}catch{return null;}
 }
 function keyBytes(value){if(typeof value!=='string'||!/^[A-Za-z0-9_-]{87}$/.test(value))throw Error('通知サーバーの設定を確認できません。');const raw=atob(value.replace(/-/g,'+').replace(/_/g,'/'));const bytes=Uint8Array.from(raw,c=>c.charCodeAt(0));if(bytes.length!==65||bytes[0]!==4)throw Error('通知サーバーの設定を確認できません。');return bytes;}
 root.AlertPush={endpoint,keyBytes};
 if(typeof document==='undefined')return;
 const panel=document.querySelector('#push-settings');if(!panel)return;
 const status=panel.querySelector('[role=status]'),enable=panel.querySelector('[data-enable]'),disable=panel.querySelector('[data-disable]'),testPush=panel.querySelector('[data-test]');
 const base=endpoint(root.ALERT_PUSH_CONFIG,location.origin);let device=null,vapid=null,busy=false,registration=null;
 const say=text=>{status.textContent=text;};
 function store(value){if(value)localStorage.setItem(KEY,JSON.stringify(value));else localStorage.removeItem(KEY);}
 try{const value=JSON.parse(localStorage.getItem(KEY));if(value&&value.backend===base&&/^[A-Za-z0-9_-]{1,200}$/.test(value.deviceId)&&typeof value.deviceToken==='string'&&value.deviceToken.length<=512)device=value;}catch{say('端末の設定を保存できません。ブラウザの保存設定を確認してください。');}
 function controls(){enable.disabled=busy||!vapid||!!device;disable.disabled=busy||!device;testPush.hidden=!device;testPush.disabled=busy||!device||!vapid;}
 async function request(path,method='GET',body,token){const c=new AbortController(),timer=setTimeout(()=>c.abort(),12000);try{const response=await fetch(base+path,{method,mode:'cors',credentials:'omit',redirect:'error',cache:'no-store',signal:c.signal,headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});if(!response.ok)throw Error('通知サーバーと通信できません。設定は変更されていません。');if(response.status===204)return null;const raw=await response.text();if(raw.length>8192)throw Error('通知サーバーの応答を確認できません。');return JSON.parse(raw);}finally{clearTimeout(timer);}}
 async function run(action){if(busy)return;busy=true;controls();try{await action();}catch{say('通知設定を完了できませんでした。接続やブラウザの通知設定を確認して再試行してください。');}finally{busy=false;controls();}}
 enable.onclick=()=>run(async()=>{
  if(!vapid||!registration)return;
  // Verify persistence before asking permission. Never invoke this on page load.
  localStorage.setItem(KEY+'-check','1');localStorage.removeItem(KEY+'-check');
  const permission=await Notification.requestPermission();if(permission!=='granted'){say('通知はオフです。許可する場合はブラウザの設定から変更できます。');return;}
  let subscription=await registration.pushManager.getSubscription(),created=false;
  try{if(!subscription){subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:vapid});created=true;}
   const result=await request('/v1/devices','POST',{subscription:subscription.toJSON()});
   if(!result||!/^[A-Za-z0-9_-]{1,200}$/.test(result.deviceId)||typeof result.deviceToken!=='string'||result.deviceToken.length<16||result.deviceToken.length>512)throw Error('Invalid device response');
   device={backend:base,deviceId:result.deviceId,deviceToken:result.deviceToken};try{store(device);}catch(error){await request('/v1/devices/'+device.deviceId,'DELETE',undefined,device.deviceToken);device=null;throw error;}say('この端末の通知がオンになりました。');
  }catch(error){if(created&&subscription)await subscription.unsubscribe().catch(()=>{});throw error;}
 });
 testPush.onclick=()=>run(async()=>{if(!device||!vapid)return;await request('/v1/devices/'+device.deviceId+'/test','POST',{},device.deviceToken);say('テスト通知の送信をリクエストしました。端末に表示されるか確認してください。');});
 disable.onclick=()=>run(async()=>{await request('/v1/devices/'+device.deviceId,'DELETE',undefined,device.deviceToken);const sub=await registration?.pushManager.getSubscription();let removed=true;try{if(sub)removed=await sub.unsubscribe();}catch{removed=false;}store(null);device=null;say(removed?'この端末への通知を停止しました。':'配信は停止しました。ブラウザ側の通知許可は設定から解除できます。');});
 controls();
 (function prepare(){
  if(!base){say('通知は準備中です。');return;}
  if(!root.isSecureContext||!('Notification'in root)||!('PushManager'in root)||!navigator.serviceWorker){say('この環境では通知を利用できません。iPhoneはホーム画面に追加してから開いてください。');return;}
  const sw=navigator.serviceWorker;let preparing=false,disposed=false;
  say('通知機能を準備しています。');
  const timer=setTimeout(()=>{if(!registration&&!disposed)say('通知機能の準備に時間がかかっています。準備でき次第、操作できるようになります。');},12000);
  async function activate(candidate){
   if(disposed||preparing||vapid||!candidate?.active)return;
   const expected=new URL('./',location.href).href;
   if(candidate.scope&&candidate.scope!==expected)return;
   registration=candidate;preparing=true;clearTimeout(timer);
   try{const config=await request('/v1/config');if(disposed)return;vapid=keyBytes(config.vapidPublicKey);if(device){const sub=await registration.pushManager.getSubscription();say(Notification.permission==='granted'&&sub?'この端末の通知はオンです。':'端末の通知は無効です。いったん停止してから再登録してください。');}else say(Notification.permission==='denied'?'通知はブロックされています。ブラウザの設定で変更できます。':'通知はオフです。');}catch{if(!disposed)say('通知サーバーに接続できません。通知は新しく登録されていません。');}finally{preparing=false;controls();}
  }
  const check=()=>sw.getRegistration(new URL('./',location.href)).then(activate).catch(()=>{if(!disposed&&!registration)say('通知機能の準備を確認できません。再読み込みしてください。');});
  sw.addEventListener?.('controllerchange',check);
  // ready resolves on the first install even when getRegistration initially returns nothing.
  sw.ready?.then(activate).catch(()=>{});
  check();
  root.addEventListener?.('pagehide',()=>{disposed=true;clearTimeout(timer);sw.removeEventListener?.('controllerchange',check);},{once:true});
 })();
})(globalThis);
