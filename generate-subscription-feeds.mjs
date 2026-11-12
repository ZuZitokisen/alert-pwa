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
 const data=JSON.parse(fs.readFileSync(path.join(root,'schedule-data-v2.json'),'utf8'));
 const previous=exists?JSON.parse(fs.readFileSync(statePath,'utf8')):null;
 const result=core.build(data,previous,{production:true,publicSource:'schedule-data-v2.json'});
 if(args.includes('--check')){
  for(const [name,bytes] of Object.entries(result.files))if(!fs.existsSync(path.join(target,name))||fs.readFileSync(path.join(target,name),'utf8')!==bytes)throw new Error(`Stale/missing generated file: ${name}`);
  const extra=fs.readdirSync(target).filter(n=>!Object.hasOwn(result.files,n));if(extra.length)throw new Error(`Unexpected feed files: ${extra.join(', ')}`);
  if(!fs.existsSync(legacyPath)||fs.readFileSync(legacyPath,'utf8')!==result.legacyDataJson)throw new Error('Stale/missing legacy projection: schedule-data.json');
  console.log('Production subscription feeds, legacy projection and revision state are current.');
 } else {
  stage=fs.mkdtempSync(path.join(root,'.calendar-feeds-stage-'));
  fs.mkdirSync(path.join(stage,'calendar-feeds'));
  for(const [name,bytes] of Object.entries(result.files))fs.writeFileSync(path.join(stage,'calendar-feeds',name),bytes,{flag:'wx'});
  fs.writeFileSync(path.join(stage,'schedule-data.json'),result.legacyDataJson,{flag:'wx'});
  backup=fs.mkdtempSync(path.join(root,'.calendar-feeds-backup-'));
  let movedFeeds=false,movedLegacy=false,installedFeeds=false,installedLegacy=false;
  try {
   if(fs.existsSync(target)){fs.renameSync(target,path.join(backup,'calendar-feeds'));movedFeeds=true;}
   if(fs.existsSync(legacyPath)){fs.renameSync(legacyPath,path.join(backup,'schedule-data.json'));movedLegacy=true;}
   fs.renameSync(path.join(stage,'calendar-feeds'),target);installedFeeds=true;
   fs.renameSync(path.join(stage,'schedule-data.json'),legacyPath);installedLegacy=true;
  } catch (e) {
   // Roll back ordinary failures. Do not delete backups if rollback itself fails.
   if(installedFeeds)fs.rmSync(target,{recursive:true});
   if(installedLegacy)fs.rmSync(legacyPath);
   if(movedFeeds)fs.renameSync(path.join(backup,'calendar-feeds'),target);
   if(movedLegacy)fs.renameSync(path.join(backup,'schedule-data.json'),legacyPath);
   fs.rmSync(backup,{recursive:true});backup=null;
   throw e;
  }
  fs.rmSync(stage,{recursive:true});stage=null;
  fs.rmSync(backup,{recursive:true});backup=null;
  // This local multi-file switch is not a deployment transaction. Publish both
  // schedule JSONs and the entire calendar-feeds directory in one commit/deploy.
  console.log(`Generated ${result.manifest.feeds.length} production feeds (${result.state.records.length} public records), ten-feed legacy manifest and legacy schedule projection.`);
 }
} finally {if(stage)fs.rmSync(stage,{recursive:true,force:true});if(locked)fs.rmdirSync(lock);}
