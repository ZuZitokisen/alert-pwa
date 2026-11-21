'use strict';
/* Fixed public calendars only. Never reads browser storage or personal selections. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.AlertCalendarSubscriptions=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
 const BASE='https://zuzitokisen.github.io/alert-pwa/';
 const sixth=globalThis.ALERT_ARTISTS?.some(a=>a.id==='ebichu')===true;
 const fifth=globalThis.ALERT_ARTISTS?.some(a=>a.id==='tohokusan')===true;
 const extended=globalThis.ALERT_ARTISTS?.some(a=>a.id==='oneloveoneheart')===true;
 const version=sixth?5:fifth?4:extended?3:2;
 const ARTISTS=Object.freeze(['tokisen','re-ge','straightangeli',...(extended?['oneloveoneheart']:[]),...(fifth?['tohokusan']:[]),...(sixth?['ebichu']:[])]);
 const NAMES=Object.freeze({tokisen:'超ときめき♡宣伝部','re-ge':'RE-GE',straightangeli:'Straight Angeli',oneloveoneheart:'ONE LOVE ONE HEART',tohokusan:'いぎなり東北産',ebichu:'私立恵比寿中学'});
 const categories={all:'全予定',live:'ライブ・イベント',benefit:'特典会・応募',media:'メディア',other:'その他'};
 const PRESETS=Object.freeze(ARTISTS.flatMap(artist=>Object.entries(categories).map(([category,label])=>Object.freeze({id:artist+'-'+category,artist,category,label:NAMES[artist]+' / '+label}))));
 function planSelection(ids){if(!Array.isArray(ids))throw new TypeError('Preset list required.');const all=[...new Set(ids)];if(all.some(id=>!PRESETS.some(p=>p.id===id)))throw new TypeError('Unknown preset.');const removed=all.filter(id=>{const p=PRESETS.find(p=>p.id===id);return p.category!=='all'&&all.includes(p.artist+'-all');});return {selected:all.filter(id=>!removed.includes(id)),removed};}
 function links(id,{alerts=false}={}){if(alerts&&version!==5)throw new TypeError('Alert feeds are not supported.');if(!PRESETS.some(p=>p.id===id))throw new TypeError('Unknown preset.');const https=BASE+'calendar-feeds/'+id+(alerts?'-alerts':'')+'.ics';return {https,webcal:https.replace(/^https:/,'webcal:')};}
 function validateManifest(data,{alerts=false}={}){
  if(!data||(alerts?version!==5||data.alertOffsetMinutes!==60:data.alertOffsetMinutes!==undefined)||data.schemaVersion!==version||data.production!==true||typeof data.dataVersion!=='string'||!data.dataVersion||!Number.isFinite(Date.parse(data.dataGeneratedAt))||!Array.isArray(data.feeds)||data.feeds.length!==PRESETS.length)throw new TypeError('Invalid calendar manifest.');
  const seen=new Set(),feeds=data.feeds.map(f=>{const p=PRESETS.find(p=>p.id===f?.id);if(!p||seen.has(f.id)||f.artist!==p.artist||f.category!==p.category||f.path!=='calendar-feeds/'+p.id+(alerts?'-alerts':'')+'.ics'||!Number.isSafeInteger(f.count)||f.count<0||!Number.isSafeInteger(f.omittedUnknownDate)||f.omittedUnknownDate<0||! /^[a-f0-9]{64}$/.test(f.sha256))throw new TypeError('Invalid calendar feed.');seen.add(f.id);return {...p,path:f.path,count:f.count,omittedUnknownDate:f.omittedUnknownDate,sha256:f.sha256};});
  return {dataVersion:data.dataVersion,dataGeneratedAt:data.dataGeneratedAt,feeds};
 }
 async function loadManifest(fetcher=globalThis.fetch,base=globalThis.document?.baseURI,timeoutMs=10000,{alerts=false}={}){
  if(alerts&&version!==5)throw new TypeError('Alert feeds are not supported.');
  const url=new URL('./calendar-feeds/manifest'+(alerts?'-alerts':'')+'-v'+version+'.json',base),controller=new AbortController();let timer;
  try{return await Promise.race([(async()=>{const response=await fetcher(url.href,{cache:'no-store',credentials:'omit',redirect:'error',signal:controller.signal});if(!response.ok)throw new Error('Calendar feed unavailable.');const body=await response.text();if(body.length>100000)throw new Error('Calendar manifest too large.');return validateManifest(JSON.parse(body),{alerts});})(),new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('Calendar connection timed out.'));},timeoutMs);})]);}finally{clearTimeout(timer);}
 }
 return Object.freeze({ARTISTS,PRESETS,planSelection,links,validateManifest,loadManifest});
});
