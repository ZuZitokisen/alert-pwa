import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

export const canonicalSchedulePath='schedule-data-v5.json';
const root=new URL('../',import.meta.url);
const liveURL=new URL(canonicalSchedulePath,'https://zuzitokisen.github.io/alert-pwa/');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export async function readDispatchInput({read=readFile}={}){
 const [bytes,stateBytes]=await Promise.all([read(new URL(canonicalSchedulePath,root)),read(new URL('calendar-feeds/state.json',root))]);
 const snapshot=JSON.parse(bytes), state=JSON.parse(stateBytes);
 if(!snapshot.version||!Array.isArray(snapshot.events)||state.dataVersion!==snapshot.version||state.dataGeneratedAt!==snapshot.generatedAt||!Array.isArray(state.records)){
  throw Error('Canonical schedule and generated feed state do not match');
 }
 return {snapshot,state,hash:sha(bytes)};
}
export async function verifyPublicDispatchInput(input,{fetcher=fetch,expectedHash}={}){
 if(expectedHash!==undefined&&(!/^[a-f0-9]{64}$/.test(expectedHash)||input.hash!==expectedHash))throw Error('Selected commit has a different schedule hash');
 const response=await fetcher(liveURL,{cache:'no-store',redirect:'error',signal:AbortSignal.timeout(15000)});
 if(!response.ok||sha(Buffer.from(await response.arrayBuffer()))!==input.hash)throw Error('Wait for exact published schedule bytes before dispatch');
}
