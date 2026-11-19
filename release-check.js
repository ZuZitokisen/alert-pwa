/* App-code release discovery only. Never reads or changes schedule or push state. */
(function(root){
 'use strict';
 function version(value){return typeof value==='string'&&/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(value)?value.split('.').map(Number):null;}
 function newer(candidate,current){const a=version(candidate),b=version(current);if(!a||!b)return false;for(let i=0;i<3;i++){if(a[i]!==b[i])return a[i]>b[i];}return false;}
 function parse(value){
  if(!value||value.schema!==1||!version(value.version)||!Array.isArray(value.notes)||value.notes.length<1||value.notes.length>6||value.notes.some(n=>typeof n!=='string'||!n.trim()||n.length>200))return null;
  return {version:value.version,notes:[...value.notes]};
 }
 async function check(current,{fetchImpl=root.fetch,url='./app-release.json'}={}){
  try{const response=await fetchImpl(url,{cache:'no-store',credentials:'same-origin',mode:'same-origin',redirect:'error',signal:AbortSignal.timeout(10000)});if(!response.ok)return null;const raw=await response.text();if(raw.length>4096)return null;const release=parse(JSON.parse(raw));return release&&newer(release.version,current)?release:null;}catch{return null;}
 }
 root.AlertAppReleases={newer,parse,check};
})(globalThis);
