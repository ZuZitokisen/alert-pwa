import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const load = path => fs.readFileSync(new URL('./'+path,import.meta.url),'utf8');
const html=load('index.html'), css=load('style.css'), sw=load('sw.js');
const source=html.match(/<script id="furin-launch-script">([\s\S]*?)<\/script>/)[1];
function setup({hash='',reduced=false,reload=false,loaded=true,failed=false,silent=false}={}){
 const events={}, imageEvents={}, windowEvents={}, timers=new Map(), dispatched=[];
 const root={dataset:{theme:'dark'}}, shell={inert:false}, meta={content:'#17171d',setAttribute(_,v){this.content=v;}};
 const logo={complete:loaded,naturalWidth:loaded&&!failed?2048:0,addEventListener(k,fn){imageEvents[k]=fn;}};
 const intro={hidden:true,querySelector(){return logo;},addEventListener(k,fn){events[k]=fn;}};
 let focused=0, nextTimer=0, sounds=0;
 const audio={play(){sounds++;return silent?Promise.reject(Error('media unavailable')):Promise.resolve();}};
 const context={
  window:{matchMedia:()=>({matches:reduced}),addEventListener(k,fn){windowEvents[k]=fn;},dispatchEvent(e){dispatched.push(e.type);}},
  document:{documentElement:root,visibilityState:'visible',querySelector:k=>k==='.app-shell'?shell:meta,getElementById:k=>k==='furin-launch'?intro:k==='furin-launch-chime'?audio:{focus(){focused++;}}},
  location:{hash},sessionStorage:{getItem:()=>reload?Date.now():null},
  Event,setTimeout:fn=>{timers.set(++nextTimer,fn);return nextTimer;},clearTimeout:key=>timers.delete(key),
 };
 vm.runInNewContext(source,context);
 return {root,intro,events,imageEvents,windowEvents,meta,shell,timers,dispatched,focused:()=>focused,sounds:()=>sounds};
}
test('fresh entry waits on white for real activation, then fades once and focuses Schedule',()=>{
 const f=setup();assert.equal(f.intro.hidden,false);assert.equal(f.root.dataset.furinLaunch,'intro');assert.equal(f.meta.content,'#ffffff');assert.equal(f.timers.size,0);assert.equal(f.sounds(),0);
 f.events.click();f.events.click();assert.equal(f.sounds(),1);assert.equal(f.root.dataset.furinLaunch,'leaving');assert.equal(f.shell.inert,true);assert.equal(f.timers.size,1);
 f.events.transitionend({target:{},propertyName:'opacity'});assert.equal(f.intro.hidden,false);
 f.events.transitionend({target:f.intro,propertyName:'opacity'});
 assert.equal(f.intro.hidden,true);assert.equal(f.meta.content,'#17171d');assert.equal(f.shell.inert,false);assert.equal(f.focused(),1);assert.deepEqual(f.dispatched,['furin-launch-closed']);
});
test('deep links, app update reloads and a previously failed logo bypass the intro',()=>{
 for(const choice of [{hash:'#changes'},{hash:'#notification-changes'},{reload:true},{failed:true}]){
  const f=setup(choice);assert.equal(f.intro.hidden,true);assert.equal(f.root.dataset.furinLaunch,undefined);assert.equal(f.meta.content,'#17171d');
 }
});
test('reduced motion is immediate; stalled image, missed event and external route never trap access',()=>{
 const noMotion=setup({reduced:true});noMotion.events.click();assert.equal(noMotion.intro.hidden,true);assert.equal(noMotion.focused(),1);assert.equal(noMotion.timers.size,0);
 const bad=setup({loaded:false});assert.equal(bad.intro.hidden,false);[...bad.timers.values()][0]();assert.equal(bad.intro.hidden,true);assert.equal(bad.focused(),0);
 const late=setup();late.events.click();[...late.timers.values()][0]();assert.equal(late.intro.hidden,true);
 const route=setup();route.windowEvents.hashchange();assert.equal(route.intro.hidden,true);
});
test('launch uses the exact dedicated white backdrop, centered asset and independent shell cache',()=>{
 assert.match(html,/#furin-launch\{[^}]*background:#fff[^}]*place-items:center/);
 assert.match(html,/<button id="furin-launch" type="button" aria-label="[^"]+" hidden>/);
 assert.match(html,/prefers-reduced-motion:reduce/);
 assert.match(html,/#furin-launch-content\{[^}]*position:relative;top:calc\(0px - clamp\(28px,7vh,72px\)\);top:calc\(0px - clamp\(28px,7svh,72px\)\)/);
 assert.match(html,/@keyframes furin-launch-sway.*skewX/);
 assert.match(html,/#furin-launch\{opacity:0;pointer-events:none;transition-delay:1120ms\}/);
 assert.match(source,/setTimeout\(\(\)=>finish\(true\),1580\)/);
 assert.match(html,/<span id="furin-launch-cue">TAP TO START<\/span>/);
 assert.match(html,/furin-launch-logo\.png\?v=0\.7\.35/);
 assert.match(sw,/furin-launch-logo\.png\?v=0\.7\.35/);
 assert.equal(fs.readFileSync(new URL('./furin-launch-logo.png',import.meta.url)).subarray(1,4).toString(),'PNG');
 assert.match(css,/#view-title:focus\{outline:none\}/);
 assert.match(css,/button:focus-visible/);
});

test('install icons are opaque square app tiles with the matching PWA references',()=>{
 for (const size of [192,512]) {
  const bytes=fs.readFileSync(new URL('./icon-'+size+'.png',import.meta.url));
  assert.equal(bytes.readUInt32BE(16),size);assert.equal(bytes.readUInt32BE(20),size);
  assert.equal(bytes[25],2);
 }
 const m=JSON.parse(load('manifest.webmanifest'));
 assert.equal(m.icons[1].purpose,'any maskable');
 assert.match(load('icon.svg'),/href="data:image\/png;base64,/);
 assert.match(html,/aria-label="Furin"><img class="brand-mark brand-wordmark"/);
});

test('short glass chime is a cached WAV, and blocked playback does not block navigation',async()=>{
 const f=setup({reduced:true,silent:true});f.events.click();await Promise.resolve();
 assert.equal(f.intro.hidden,true);assert.equal(f.sounds(),1);
 const audio=fs.readFileSync(new URL('./furin-glass-chime.wav',import.meta.url));
 assert.equal(audio.subarray(0,4).toString(),'RIFF');
 assert.equal(audio.subarray(8,12).toString(),'WAVE');
 assert.equal(audio.readUInt16LE(22),1);assert.equal(audio.readUInt32LE(24),22050);
 assert.ok(audio.length>62000&&audio.length<80000);
 assert.match(html,/furin-glass-chime\.wav\?v=0\.7\.35/);
 assert.match(sw,/furin-glass-chime\.wav\?v=0\.7\.35/);
 assert.match(load('.github/workflows/hourly-public-refresh.yml'),/furin-glass-chime\.wav/);
 assert.match(html,/freesound.org\/people\/nlux\/sounds\/620967/);
 assert.match(html,/creativecommons.org\/licenses\/by\/4.0/);
});
