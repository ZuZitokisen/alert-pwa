import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import core from './production-feed-core.cjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2);
if(args.some(a=>!['--check','--initialize'].includes(a)) || args.includes('--check')&&args.includes('--initialize')) throw new Error('Usage: node generate-subscription-feeds.mjs [--check | --initialize]');
const target=path.join(root,'calendar-feeds'), statePath=path.join(target,'state.json');
const legacyPath=path.join(root,'schedule-data.json');
const lock=path.join(root,'.calendar-feeds.lock');let locked=false,stage,backup;
try {
 fs.mkdirSync(lock);locked=true;
 const exists=fs.existsSync(statePath);
 if(!exists&&!args.includes('--initialize'))throw new Error('Missing revision state: restore from Git. --initialize is only for first publication.');
 if(exists&&args.includes('--initialize'))throw new Error('State already exists; never reset published UIDs/revisions.');
 const publicSource=fs.existsSync(path.join(root,'schedule-data-v6.json'))?'schedule-data-v6.json':fs.existsSync(path.join(root,'schedule-data-v5.json'))?'schedule-data-v5.json':fs.existsSync(path.join(root,'schedule-data-v4.json'))?'schedule-data-v4.json':fs.existsSync(path.join(root,'schedule-data-v3.json'))?'schedule-data-v3.json':'schedule-data-v2.json';
 const data=JSON.parse(fs.readFileSync(path.join(root,publicSource),'utf8'));
 const previous=exists?JSON.parse(fs.readFileSync(statePath,'utf8')):null;
 const result=core.build(data,previous,{production:true,publicSource});
 const projections={'schedule-data.json':result.legacyDataJson,...(publicSource!=='schedule-data-v2.json'?{'schedule-data-v2.json':result.v2DataJson}:{}),...(['schedule-data-v4.json','schedule-data-v5.json','schedule-data-v6.json'].includes(publicSource)?{'schedule-data-v3.json':result.v3DataJson}:{}),...(['schedule-data-v5.json','schedule-data-v6.json'].includes(publicSource)?{'schedule-data-v4.json':result.v4DataJson}:{}),...(publicSource==='schedule-data-v6.json'?{'schedule-data-v5.json':result.v5DataJson}:{})};
 if(args.includes('--check')){
  for(const [name,bytes] of Object.entries(result.files))if(!fs.existsSync(path.join(target,name))||fs.readFileSync(path.join(target,name),'utf8')!==bytes)throw new Error(`Stale/missing generated file: ${name}`);
  const extra=fs.readdirSync(target).filter(n=>!Object.hasOwn(result.files,n));if(extra.length)throw new Error(`Unexpected feed files: ${extra.join(', ')}`);
  if(!fs.existsSync(legacyPath)||fs.readFileSync(legacyPath,'utf8')!==result.legacyDataJson)throw new Error('Stale/missing legacy projection: schedule-data.json');
  for(const [name,bytes] of Object.entries(projections))if(!fs.existsSync(path.join(root,name))||fs.readFileSync(path.join(root,name),'utf8')!==bytes)throw new Error(`Stale/missing schedule projection: ${name}`);
  console.log('Production subscription feeds, legacy projection and revision state are current.');
 } else {
  stage=fs.mkdtempSync(path.join(root,'.calendar-feeds-stage-'));
  fs.mkdirSync(path.join(stage,'calendar-feeds'));
  for(const [name,bytes] of Object.entries(result.files))fs.writeFileSync(path.join(stage,'calendar-feeds',name),bytes,{flag:'wx'});
  for(const [name,bytes] of Object.entries(projections))fs.writeFileSync(path.join(stage,name),bytes,{flag:'wx'});
  backup=fs.mkdtempSync(path.join(root,'.calendar-feeds-backup-'));
  const moved=[],installed=[],names=['calendar-feeds',...Object.keys(projections)];
  try {
   for(const name of names)if(fs.existsSync(path.join(root,name))){fs.renameSync(path.join(root,name),path.join(backup,name));moved.push(name);}
   for(const name of names){fs.renameSync(path.join(stage,name),path.join(root,name));installed.push(name);}
  } catch (e) {
   // Retain the backup if restoration itself fails.
   for(const name of installed.reverse())fs.rmSync(path.join(root,name),{recursive:true});
   for(const name of moved.reverse())fs.renameSync(path.join(backup,name),path.join(root,name));
   fs.rmSync(backup,{recursive:true});backup=null;
   throw e;
  }
  fs.rmSync(stage,{recursive:true});stage=null;
  fs.rmSync(backup,{recursive:true});backup=null;
  // This local multi-file switch is not a deployment transaction. Publish the
  // canonical schedule, compatibility projections and calendar-feeds in one commit/deploy.
  console.log(`Generated ${result.manifest.feeds.length} production feeds (${result.state.records.length} public records), ten-feed legacy manifest and legacy schedule projection.`);
 }
} finally {if(stage)fs.rmSync(stage,{recursive:true,force:true});if(locked)fs.rmdirSync(lock);}
