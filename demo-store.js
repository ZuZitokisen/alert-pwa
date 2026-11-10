'use strict';
/* Synthetic, device-local demo. No network transport, permissions or real scheduling. */
(() => {
  const KEY='alert-pwa-static-v1';
  const FIELDS=['title','start','end','allDay','status','category','location','note','evidence'];
  const SOURCE='demo-calendar';
  const clone=value=>JSON.parse(JSON.stringify(value));
  const serialize=events=>JSON.stringify([...events].sort((a,b)=>a.id.localeCompare(b.id)).map(e=>[e.id,...FIELDS.map(f=>e[f]??null)]));
  const stamp=()=>new Date().toISOString();
  function initial(){const checked=stamp();return {version:1,events:clone(ALERT_DEMO_SNAPSHOTS.baseline).map(e=>({...e,source:SOURCE,revision:1,present:true})),changes:[],sources:[{id:SOURCE,checked,error:null}],outboxCount:0,pushConfigured:false,demo:true,mode:'static',snapshot:serialize(ALERT_DEMO_SNAPSHOTS.baseline),nextChangeId:1};}
  let state;
  try{const saved=JSON.parse(localStorage.getItem(KEY));state=saved?.version===1&&Array.isArray(saved.events)&&Array.isArray(saved.changes)?saved:initial();}catch{state=initial();}
  function persist(){try{localStorage.setItem(KEY,JSON.stringify(state));}catch{ /* Limited storage does not enable any external fallback. */ }}
  function apply(name){
    if(name==='failure'){state.sources[0].error='サンプルの取得に失敗しました。';persist();return {ok:false,value:{error:state.sources[0].error,state:clone(state)}};}
    const incoming=ALERT_DEMO_SNAPSHOTS[name];
    if(!incoming)return {ok:false,value:{error:'不明なサンプル操作です。'}};
    const digest=serialize(incoming),checked=stamp();
    if(digest===state.snapshot){state.sources[0]={id:SOURCE,checked,error:null};persist();return {ok:true,value:{newChanges:0,state:clone(state)}};}
    const previous=new Map(state.events.map(e=>[e.id,e]));
    const next=new Map(incoming.map(e=>[e.id,e]));
    let count=0;
    for(const id of [...new Set([...previous.keys(),...next.keys()])].sort()){
      const old=previous.get(id),after=next.get(id);
      if(!after&&!old?.present)continue;
      const before=old?Object.fromEntries(['id',...FIELDS].map(k=>[k,old[k]??null])):null;
      const changed=FIELDS.filter(k=>JSON.stringify(before?.[k]??null)!==JSON.stringify(after?.[k]??null));
      if(old?.present&&after&&!changed.length)continue;
      const revision=(old?.revision||0)+1;
      const kind=!old?'new':!after?'unavailable':!old.present?'restored':'updated';
      if(after)previous.set(id,{...clone(after),source:SOURCE,revision,present:true});
      else previous.set(id,{...old,revision,present:false});
      state.changes.unshift({id:state.nextChangeId++,source:SOURCE,eventId:id,kind,revision,before,after:after?clone(after):null,fields:changed,detected:checked});
      count++;
    }
    state.events=[...previous.values()];state.snapshot=digest;state.sources[0]={id:SOURCE,checked,error:null};state.outboxCount+=count;persist();
    return {ok:true,value:{newChanges:count,state:clone(state)}};
  }
  persist();
  globalThis.demoRequest=async(action,name)=>{
    const result=action==='state'?{ok:true,value:clone(state)}:action==='demo'?apply(name):{ok:false,value:{error:'Unknown action'}};
    return {ok:result.ok,json:async()=>clone(result.value)};
  };
})();
