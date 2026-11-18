import F from '../feature-core.js';

export const APP_URL='https://zuzitokisen.github.io/alert-pwa/#calendar';
const compact = (s,n) => Array.from(String(s||'').replace(/[\x00-\x1f\x7f]/g,' ').trim()).slice(0,n).join('').slice(0,n);
const jst=new Intl.DateTimeFormat('ja-JP',{timeZone:'Asia/Tokyo',month:'numeric',day:'numeric',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function when(v){
 if(!v)return '日時未定';
 if(v.length===10)return v.replaceAll('-','/')+'（時刻未定）';
 return jst.format(new Date(v))+' JST';
}
export function planNotifications(snapshot,feedState,{now=new Date(),activatedAt=null,appURL=APP_URL}={}){
 const records=new Map(feedState.records.map(r=>[r.event.id,r])), notices=[];
 const nowMs=+now, since=activatedAt===null?Number.POSITIVE_INFINITY:Date.parse(activatedAt), horizon=nowMs+48*3600000;
 if(!Number.isFinite(nowMs)||activatedAt!==null&&!Number.isFinite(since))throw Error('Invalid notification clock');
 for(const event of snapshot.events){
  if(!event.present||!['confirmed','possible','cancelled'].includes(event.status))continue;
  const row=records.get(event.id);
  if(!row||row.event.artistId!==event.artistId)throw Error('Notification source does not match the generated feed state');
  const item={id:event.id,revision:row.sequence+1,artistId:event.artistId,status:event.status,url:appURL};
  const detail=compact([when(event.start),event.location,event.status==='possible'?'かも？':event.status==='cancelled'?'中止':'確定'].filter(Boolean).join(' · '),400);
  const changed=Date.parse(row.modified);
  if(changed>since&&changed<=nowMs&&changed>nowMs-24*3600000){
   const kind=row.sequence===0&&event.status!=='cancelled'?'new':'change';
   notices.push({...item,kind,title:compact((kind==='new'?'新着：':'変更：')+event.title,140),body:detail});
  }
  if(event.status==='cancelled')continue;
  for(const schedule of F.reminderTimes(event,{now,morningTime:'08:00'}).times){
   if(schedule.timestamp>horizon)continue;
   notices.push({...item,kind:'reminder',at:schedule.at,title:compact('リマインド：'+event.title,140),body:compact(schedule.label+' · '+detail,550)});
  }
 }
 return notices;
}
