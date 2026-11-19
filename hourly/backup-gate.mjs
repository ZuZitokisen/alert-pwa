// Optimization only: uncertainty always runs the normal validation/publish pipeline.
import {appendFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const REPO='ZuZitokisen/alert-pwa';
const WINDOW_MS=45*60*1000;
export async function backupDecision({event,schedule,token,repository,branch,runId,now=Date.now(),fetchImpl=fetch}) {
  if(event!=='schedule'||schedule!=='47 * * * *') return {proceed:true,reason:'primary or manual run'};
  if(!token||repository!==REPO||!branch) return {proceed:true,reason:'lookup configuration unavailable'};
  let requests=0;
  async function read(path) {
    if(++requests>6) throw Error('request cap');
    const response=await fetchImpl(`https://api.github.com/repos/${REPO}/${path}`,{headers:{Accept:'application/vnd.github+json',Authorization:`Bearer ${token}`,'X-GitHub-Api-Version':'2022-11-28'},redirect:'error',signal:AbortSignal.timeout(8000)});
    if(!response.ok) throw Error('lookup failed');
    const chunks=[];let size=0;
    for await(const chunk of response.body){size+=chunk.length;if(size>1_000_000)throw Error('response cap');chunks.push(chunk);}
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  try {
    const result=await read(`actions/workflows/hourly-public-refresh.yml/runs?branch=${encodeURIComponent(branch)}&event=schedule&status=success&per_page=20`);
    if(!Array.isArray(result.workflow_runs))throw Error('invalid runs');
    const candidates=result.workflow_runs.filter(r=>r.id!==Number(runId)&&Number.isSafeInteger(r.id)&&r.event==='schedule'&&r.head_branch===branch&&r.status==='completed'&&r.conclusion==='success'&&Date.parse(r.created_at)>=now-WINDOW_MS&&Date.parse(r.created_at)<=now&&Date.parse(r.updated_at)<=now).slice(0,5);
    for(const run of candidates){
      const result=await read(`actions/runs/${run.id}/jobs?filter=latest&per_page=100`);
      if(!Array.isArray(result.jobs)||result.total_count!==result.jobs.length)throw Error('incomplete jobs');
      const success=name=>result.jobs.filter(j=>j.name===name&&j.status==='completed'&&j.conclusion==='success').length===1;
      // A green dry run or a green skipped backup is not production success.
      if(success('inspect')&&success('publish'))return {proceed:false,reason:`recent complete scheduled production run ${run.id}`,runId:run.id};
    }
    return {proceed:true,reason:'no recent complete scheduled production run'};
  } catch { return {proceed:true,reason:'lookup unavailable; normal guards retained'}; }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const result=await backupDecision({event:process.env.GITHUB_EVENT_NAME,schedule:process.env.TRIGGER_SCHEDULE,token:process.env.GH_TOKEN,repository:process.env.GITHUB_REPOSITORY,branch:process.env.DEFAULT_BRANCH,runId:process.env.GITHUB_RUN_ID});
 console.log(`Backup gate: ${result.proceed?'RUN':'SKIP'}: ${result.reason}`);
 if(process.env.GITHUB_OUTPUT)appendFileSync(process.env.GITHUB_OUTPUT,`proceed=${result.proceed}\n`);
 if(process.env.GITHUB_STEP_SUMMARY)appendFileSync(process.env.GITHUB_STEP_SUMMARY,`### Hourly backup gate\n${result.proceed?'RUN normal pipeline':'SKIP redundant collection'}: ${result.reason}\n`);
}
