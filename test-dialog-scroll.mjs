import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
const dialogSource=source.slice(source.indexOf('let dialogScrollState=null;'),source.indexOf('function openEvent('));
const css=fs.readFileSync(new URL('./style.css',import.meta.url),'utf8');
function style(initial={}){
 const values=new Map(Object.entries(initial).map(([key,value])=>[key,Array.isArray(value)?value:[value,'']]));
 return {getPropertyValue:key=>values.get(key)?.[0]||'',getPropertyPriority:key=>values.get(key)?.[1]||'',setProperty(key,value,priority=''){values.set(key,[value,priority]);},removeProperty(key){values.delete(key);},snapshot:()=>Object.fromEntries(values)};
}
function fixture({x=0,y=460,gap=0,bodyStyle={},rootStyle={},hadClass=false,throwOnOpen=false}={}){
 const body={style:style(bodyStyle)},classes=new Set(hadClass?['dialog-scroll-locked']:[]),root={style:style(rootStyle),clientWidth:390-gap,classList:{contains:k=>classes.has(k),add:k=>classes.add(k),remove:k=>classes.delete(k)}};
 const detail={setAttribute(){},open:false,scrollTop:175,opens:0,closes:0,showModal(){this.opens++;if(throwOnOpen)throw Error('open failed');this.open=true;context.window.scrollX=0;context.window.scrollY=0;},close(){this.open=false;this.closes++;}};
 const calls=[],context={document:{body,documentElement:root},window:{scrollX:x,scrollY:y,innerWidth:390,scrollTo(a,b){calls.push([a,b]);this.scrollX=a;this.scrollY=b;}},getComputedStyle:()=>({paddingRight:body.style.getPropertyValue('padding-right')||'0px'}),$:(selector)=>{assert.equal(selector,'#detail');return detail;}};
 vm.createContext(context);vm.runInContext(dialogSource,context);
 return {context,body,root,classes,detail,calls,run:code=>vm.runInContext(code,context)};
}
test('opening fixes the page at its exact scroll position and keeps dialog scrollable',()=>{
 const f=fixture({x:2,y:460});f.run('openDialog()');assert.equal(f.detail.open,true);assert.equal(f.body.style.getPropertyValue('position'),'fixed');assert.equal(f.body.style.getPropertyValue('top'),'-460px');assert.equal(f.body.style.getPropertyValue('left'),'-2px');assert.ok(f.classes.has('dialog-scroll-locked'));assert.equal(f.detail.scrollTop,0);assert.match(css,/dialog\{overscroll-behavior:contain/);
});
test('dialog rerenders do not recapture the fixed page or reset internal scroll',()=>{
 const f=fixture();f.run('openDialog()');f.detail.scrollTop=240;f.run('openDialog()');assert.equal(f.detail.opens,1);assert.equal(f.detail.scrollTop,240);f.run('closeDialog()');assert.deepEqual(f.calls,[[0,460]]);
});
test('close restores scroll coordinates, inline values and their priorities',()=>{
 const bodyStyle={position:['relative','important'],'padding-right':['8px','important'],color:['red','']},rootStyle={'scroll-behavior':['smooth','important'],'--dialog-scroll-offset':['12px','important']};
 const f=fixture({y:825,gap:15,bodyStyle,rootStyle});const before=f.body.style.snapshot(),rootBefore=f.root.style.snapshot();f.run('openDialog()');assert.equal(f.body.style.getPropertyValue('padding-right'),'23px');f.run('closeDialog()');assert.deepEqual(f.body.style.snapshot(),before);assert.deepEqual(f.root.style.snapshot(),rootBefore);assert.deepEqual(f.calls,[[0,825]]);assert.equal(f.classes.has('dialog-scroll-locked'),false);
});
test('native Escape or direct dialog close releases the same lock',()=>{
 const f=fixture();f.run('openDialog()');f.detail.close();f.run('onDialogClosed()');assert.deepEqual(f.calls,[[0,460]]);assert.equal(f.body.style.getPropertyValue('position'),'');assert.match(source,/addEventListener\('close',onDialogClosed\)/);
});
test('delayed close event cannot unlock a dialog that has already reopened',()=>{
 const f=fixture();f.run('openDialog();closeDialog()');f.context.window.scrollY=720;f.run('openDialog();onDialogClosed()');assert.equal(f.body.style.getPropertyValue('position'),'fixed');assert.equal(f.body.style.getPropertyValue('top'),'-720px');f.run('closeDialog()');assert.deepEqual(f.calls,[[0,460],[0,720]]);
});
test('duplicate close and its later native event do not move the page again',()=>{
 const f=fixture();f.run('openDialog();closeDialog()');f.context.window.scrollY=0;f.run('onDialogClosed();closeDialog()');assert.deepEqual(f.calls,[[0,460]]);assert.equal(f.context.window.scrollY,0);
});
test('showModal failure rolls back the lock and leaves the page usable',()=>{
 const f=fixture({throwOnOpen:true});assert.throws(()=>f.run('openDialog()'),/open failed/);assert.equal(f.body.style.getPropertyValue('position'),'');assert.equal(f.classes.has('dialog-scroll-locked'),false);assert.deepEqual(f.calls,[[0,460]]);
});
test('preexisting lock class is not removed and no scrollbar gap adds no padding',()=>{
 const f=fixture({hadClass:true});f.run('openDialog()');assert.equal(f.body.style.getPropertyValue('padding-right'),'');f.run('closeDialog()');assert.ok(f.classes.has('dialog-scroll-locked'));
});
test('both overflowing dialog and non-scrolling backdrop contain scroll gestures',()=>{
 assert.match(css,/html\.dialog-scroll-locked\{overflow:hidden;overscroll-behavior:none\}/);assert.match(css,/dialog::backdrop\{overflow:hidden;overscroll-behavior:none;touch-action:none\}/);assert.ok(!/dialog\{[^}]*touch-action:none/.test(css));
});
test('card-wide hit area leaves the favorite independent and keeps scroll gestures native',()=>{
 assert.match(css,/\.event-card \.card-open::after\{content:"";position:absolute;inset:0/);
 assert.match(css,/\.event-card \.favorite-button,\.event-card \.select-label\{z-index:1;touch-action:manipulation\}/);
 assert.match(css,/\.event-card \.card-open:active:not\(:disabled\)\{transform:none\}/);
 assert.ok(!/addEventListener\(['"](?:touchstart|pointerdown)['"]/.test(source.slice(source.indexOf('function card('),source.indexOf('function appendSourcesAndTimes'))));
 assert.match(source,/addEventListener\('touchstart',[^\n]+\{passive:true\}\)/);
});
test('favorite focus restoration explicitly avoids scrolling the page',()=>{
 assert.match(source,/target\?\.focus\(\{preventScroll:true\}\)/);
 assert.match(source,/\$\('#detail-content \.favorite-button'\)\?\.focus\(\{preventScroll:true\}\)/);
});

test('card opening starts by its origin and dismisses immediately, while reduced motion and noncard dialogs stay still',()=>{
 const f=fixture(),calls=[];
 f.detail.getBoundingClientRect=()=>({left:50,top:120,width:400,height:500});
 f.detail.animate=(frames,options)=>{calls.push([frames,options]);return {cancel(){calls.push('cancel');}};};
 f.context.origin={left:70,top:220,width:320,height:140};
 f.run('openDialog(origin)');
 assert.match(calls[0][0][0].transform,/translate\(-20px,-80px\) scale\(0\.8,0\.84\)/);
 assert.equal(calls[0][0][1].transform,'none');
 assert.equal(f.detail.open,true);
 f.run('openDialog(origin)');assert.equal(calls.length,1);
 f.run('closeDialog()');assert.equal(calls.at(-1),'cancel');assert.equal(f.detail.open,false);
 f.context.window.matchMedia=()=>({matches:true});
 f.run('openDialog(origin);closeDialog()');assert.equal(calls.length,2);
 f.context.window.matchMedia=()=>({matches:false});
 f.run('openDialog()');assert.equal(calls.length,2);
});

test('expanded cards dismiss on a deliberate left swipe only, leaving vertical and other controls alone',()=>{
 const f=fixture(),handlers={};
 f.detail.addEventListener=(event,callback,opts)=>{assert.equal(opts.passive,true);handlers[event]=callback;};
 f.detail.open=true;f.context.panel='event';f.context.swipes=0;
 f.run('installCardSwipe($(\'#detail\'),()=>panel,()=>{swipes++;})');
 const type=(event,x,y,opts={})=>{
  const t={identifier:1,clientX:x,clientY:y};
  handlers[event]({touches:event==='touchend'?[]:[t],changedTouches:[t],target:{closest:()=>opts.interactive?{}:null},...opts});
 };
 const begin=()=>type('touchstart',200,100);
 const end=(x,y)=>type('touchend',x,y);
 begin();end(128,109);assert.equal(f.context.swipes,1);
 begin();type('touchmove',198,130);end(100,140);assert.equal(f.context.swipes,1);
 begin();end(280,100);begin();end(170,100);assert.equal(f.context.swipes,1);
 type('touchstart',200,100,{interactive:true});end(100,100);assert.equal(f.context.swipes,1);
 begin();type('touchcancel',188,105);end(100,100);assert.equal(f.context.swipes,1);
 begin();type('touchmove',188,101,{touches:[{identifier:1},{identifier:2}]});end(100,100);assert.equal(f.context.swipes,1);
 f.context.panel='app-release';begin();end(100,100);assert.equal(f.context.swipes,1);
 f.context.panel='change';begin();end(100,100);assert.equal(f.context.swipes,2);
});
