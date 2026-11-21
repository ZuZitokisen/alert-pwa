import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
const paths=['schedule-data-v5.json','schedule-data-v4.json','schedule-data-v3.json','schedule-data-v2.json','schedule-data.json','calendar-feeds/manifest-v5.json','calendar-feeds/manifest-v4.json','calendar-feeds/manifest-v3.json','calendar-feeds/manifest-v2.json','calendar-feeds/manifest.json'];
const manifestPath='calendar-feeds/manifest-alerts-v5.json';
const manifest=JSON.parse(await readFile(new URL('../'+manifestPath,import.meta.url)));
const artistIds=['tokisen','re-ge','straightangeli','oneloveoneheart','tohokusan','ebichu'];
const categories=['all','live','benefit','media','other'];
const alarmPaths=artistIds.flatMap(artist=>categories.map(category=>`calendar-feeds/${artist}-${category}-alerts.ics`));
if(manifest.alertOffsetMinutes!==60||manifest.feeds.length!==alarmPaths.length||new Set(manifest.feeds.map(f=>f.path)).size!==alarmPaths.length||alarmPaths.some(path=>!manifest.feeds.some(f=>f.path===path)))throw Error('Invalid notification subscription manifest');
paths.push(manifestPath,'calendar-feeds/combined-v1.json',...alarmPaths);
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
