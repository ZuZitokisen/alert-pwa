import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {mergeOfficialSchedules} from './merge.mjs';
import {collectOfficialSchedules,SOURCE_CONFIG} from './sources.mjs';

const args=process.argv.slice(2);
if(args.length>1||args.length&&args[0]!=='--apply')throw Error('Usage: node hourly/collect.mjs [--apply]');
const apply=args[0]==='--apply', now=new Date();
const snapshot=new URL('../schedule-data-v4.json',import.meta.url);
const base=JSON.parse(await fs.readFile(snapshot,'utf8'));
const jstDay=new Intl.DateTimeFormat('sv-SE',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
if(jstDay>base.coverage.through)throw Error('Schedule coverage has expired; extend it before monitoring');
const {events,diagnostics}=await collectOfficialSchedules({from:jstDay>base.coverage.from?jstDay:base.coverage.from,through:base.coverage.through,now:now.toISOString(),fetchImpl:globalThis.fetch,sourceIds:Object.keys(SOURCE_CONFIG)});
if(!Array.isArray(diagnostics)||!diagnostics.length)throw Error('Missing collection diagnostics');
const {next,notices,skipped}=mergeOfficialSchedules(base,events,now);
const mode=apply?'apply':'dry-run';
const success=diagnostics.some(d=>d.code==='source_ok');
if(apply&&success&&notices.length){
 const temporary=fileURLToPath(snapshot)+'.hourly-tmp';
 try{await fs.writeFile(temporary,JSON.stringify(next,null,2)+'\n',{flag:'wx'});await fs.rename(temporary,snapshot);}
 catch(e){if(e.code!=='EEXIST')await fs.rm(temporary,{force:true});throw e;}
}
console.log(JSON.stringify({mode,checkedAt:now.toISOString(),before:base.events.length,after:next.events.length,diagnostics,notices,skipped},null,2));
if(!success)process.exitCode=1;
