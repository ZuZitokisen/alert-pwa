import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const paths=['schedule-data-v3.json','schedule-data-v2.json','schedule-data.json','calendar-feeds/manifest-v3.json','calendar-feeds/manifest-v2.json','calendar-feeds/manifest.json'];
const base='https://zuzitokisen.github.io/alert-pwa/';
const hash=x=>createHash('sha256').update(x).digest('hex');
const outcomes=await Promise.all(paths.map(async p=>{
 try{
  const local=await readFile(new URL('../'+p,import.meta.url));
  const r=await fetch(base+p,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(12000)});
  return r.ok&&hash(local)===hash(Buffer.from(await r.arrayBuffer()));
 }catch{return false;}
}));
if(!outcomes.every(Boolean)){console.error('Published schedule and manifest hashes do not match the candidate.');process.exitCode=1;}
else console.log('Published schedule and manifest hashes match.');
