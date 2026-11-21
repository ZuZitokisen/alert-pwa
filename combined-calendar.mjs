// Standalone public, read-only handler. It neither reads nor writes notification data.
const PREFIX='/v1/calendar/';
const INDEX='https://zuzitokisen.github.io/alert-pwa/calendar-feeds/combined-v1.json';
const artists=['tokisen','re-ge','straightangeli','oneloveoneheart','tohokusan','ebichu'];
const groups=artists.flatMap(a=>['all','live','benefit','media','other'].map(c=>a+'-'+c));
const known=new Set(groups);
const TTL=120_000,LIMIT=8_000_000;
export const isCalendarRoute=pathname=>pathname.startsWith(PREFIX);
const intersects=(a,b)=>a.some(id=>b.has(id));
const header='BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Alert PWA//Public Calendar Subscription//JA\r\nCALSCALE:GREGORIAN\r\nX-WR-CALNAME:Furin / 選択した予定\r\n';
const validGroupList=a=>Array.isArray(a)&&a.length>0&&a.length<=5&&a.every(id=>known.has(id));
const validBlock=s=>typeof s==='string'&&s.startsWith('BEGIN:VEVENT\r\nUID:public-v1-')&&s.endsWith('\r\nEND:VEVENT\r\n')&&!/\r\n(?:BEGIN|END):/i.test(s.slice(14,-14));
async function boundedText(response){
 const reader=response.body?.getReader();if(!reader)throw Error('Missing calendar index');
 const decoder=new TextDecoder('utf-8',{fatal:true}),parts=[];let size=0;
 try{for(;;){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>LIMIT){await reader.cancel();throw Error('Oversize calendar index');}parts.push(decoder.decode(value,{stream:true}));}parts.push(decoder.decode());}
 finally{reader.releaseLock();}
 return parts.join('');
}
export function createCalendarHandler({fetcher=globalThis.fetch,now=()=>Date.now()}={}){
 let cached,expires=0;
 async function load(){
  if(cached&&now()<expires)return cached;
   const response=await fetcher(INDEX,{redirect:'error',signal:AbortSignal.timeout(8000),cf:{cacheEverything:true,cacheTtlByStatus:{'200-299':120,'400-599':0}}});
   if(!response.ok)throw Error('Missing calendar index');
   const {schema,generation,records}=JSON.parse(await boundedText(response));
   if(schema!==1||typeof generation!=='string'||! /^[a-f0-9]{64}$/.test(generation)||!Array.isArray(records)||!records.length||records.length>10000)throw Error('Invalid calendar index');
   const uids=new Set();
   for(const r of records){
    if(!validGroupList(r.current)||!validGroupList(r.history)||!r.current.every(id=>r.history.includes(id))||!validBlock(r.event)||
       (r.history.some(id=>!r.current.includes(id))?!validBlock(r.withdrawn)||!r.withdrawn.includes('\r\nSTATUS:CANCELLED\r\n'):r.withdrawn!==undefined))throw Error('Invalid calendar event');
    const uid=r.event.split('\r\n',3)[1];
    if(uids.has(uid)||(r.withdrawn&&!r.withdrawn.startsWith('BEGIN:VEVENT\r\n'+uid+'\r\n')))throw Error('Duplicate or mismatched UID');
    uids.add(uid);
   }
   cached=records;expires=now()+TTL;return cached;
 }
 return async request=>{
  if(!['GET','HEAD'].includes(request.method))return new Response(null,{status:405,headers:{Allow:'GET, HEAD'}});
  const url=new URL(request.url);
  if(url.search||!isCalendarRoute(url.pathname)||!url.pathname.endsWith('.ics'))return new Response(null,{status:404});
  const token=url.pathname.slice(PREFIX.length,-4);
  if(!/^[a-z0-9,-]{5,500}$/.test(token))return new Response(null,{status:400});
  const parts=token.split(','),ids=new Set(parts);
  if(parts.length>groups.length||[...ids].some(id=>!known.has(id)))return new Response(null,{status:400});
  const normalized=groups.filter(id=>ids.has(id)&&(id.endsWith('-all')||!ids.has(id.slice(0,id.lastIndexOf('-'))+'-all'))).join(',');
  if(normalized!==token)return new Response(null,{status:308,headers:{Location:PREFIX+normalized+'.ics'}});
  try{
   const records=await load(),lines=[header];
   for(const r of records)if(intersects(r.history,ids))lines.push(intersects(r.current,ids)?r.event:r.withdrawn);
   lines.push('END:VCALENDAR\r\n');
   const ics=lines.join(''),hash=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(ics)));
   const etag='"'+Array.from(hash,b=>b.toString(16).padStart(2,'0')).join('')+'"';
   const headers={'Content-Type':'text/calendar; charset=utf-8','Cache-Control':'public, max-age=120','X-Content-Type-Options':'nosniff',ETag:etag};
   if(request.headers.get('If-None-Match')?.split(',').some(t=>['*',etag].includes(t.trim().replace(/^W\//,''))))return new Response(null,{status:304,headers});
   return new Response(request.method==='HEAD'?null:ics,{headers});
  }catch{return new Response(null,{status:503,headers:{'Cache-Control':'no-store','Retry-After':'60'}});}
 };
}
