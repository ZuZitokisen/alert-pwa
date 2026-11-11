import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import core from './production-feed-core.cjs';
const root=path.dirname(fileURLToPath(import.meta.url));
const args=process.argv.slice(2);
if(args.some(a=>!['--check','--initialize'].includes(a)) || args.includes('--check')&&args.includes('--initialize')) throw new Error('Usage: node generate-subscription-feeds.mjs [--check | --initialize]');
const target=path.join(root,'calendar-feeds'), statePath=path.join(target,'state.json');
const lock=path.join(root,'.calendar-feeds.lock');let locked=false,stage,backup;
try {
 fs.mkdirSync(lock);locked=true;
 const exists=fs.existsSync(statePath);
 if(!exists&&!args.includes('--initialize'))throw new Error('Missing revision state: restore from Git. --initialize is only for first publication.');
 if(exists&&args.includes('--initialize'))throw new Error('State already exists; never reset published UIDs/revisions.');
 const data=JSON.parse(fs.readFileSync(path.join(root,'schedule-data.json'),'utf8'));
 const previous=exists?JSON.parse(fs.readFileSync(statePath,'utf8')):null;
 const result=core.build(data,previous,{production:true,publicSource:'schedule-data.json'});
 if(args.includes('--check')){
  for(const [name,bytes] of Object.entries(result.files))if(!fs.existsSync(path.join(target,name))||fs.readFileSync(path.join(target,name),'utf8')!==bytes)throw new Error(`Stale/missing generated file: ${name}`);
  const extra=fs.readdirSync(target).filter(n=>!Object.hasOwn(result.files,n));if(extra.length)throw new Error(`Unexpected feed files: ${extra.join(', ')}`);
  console.log('Production subscription feeds and revision state are current.');
 } else {
  stage=fs.mkdtempSync(path.join(root,'.calendar-feeds-stage-'));
  for(const [name,bytes] of Object.entries(result.files))fs.writeFileSync(path.join(stage,name),bytes,{flag:'wx'});
  // Stage the complete generation before switching. Roll back on ordinary errors.
  // Publishing uses one Git commit/deployment, never a live copy of this directory.
  if(fs.existsSync(target)){backup=path.join(root,`.calendar-feeds-backup-${process.pid}`);fs.renameSync(target,backup);}
  try{fs.renameSync(stage,target);stage=null;}catch(e){if(backup){fs.renameSync(backup,target);backup=null;}throw e;}
  if(backup){fs.rmSync(backup,{recursive:true});backup=null;}
  console.log(`Generated ${result.manifest.feeds.length} production feeds (${result.state.records.length} public records).`);
 }
} finally {if(stage)fs.rmSync(stage,{recursive:true,force:true});if(locked)fs.rmdirSync(lock);}
