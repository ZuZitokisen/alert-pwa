import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const app=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
const source=app.slice(app.indexOf('function appendSourcesAndTimes(area,e){'),app.indexOf('\n// Safari can scroll'));
class Element {
 constructor(tag,text='',className=''){this.tag=tag;this.text=text;this.className=className;this.children=[];}
 append(...children){this.children.push(...children);}
 get textContent(){return this.text+this.children.map(c=>typeof c==='string'?c:c.textContent).join('');}
}
function render(type,status){
 const context=vm.createContext({URL,el:(...args)=>new Element(...args),document:{createTextNode:text=>text},prettyDate:value=>value});
 vm.runInContext(source,context);
 const area=new Element('div'),event={timings:[{label:'放送開始候補',at:'2026-11-20T16:40:00+09:00',status,note:'個別回未確認'}],sources:[{url:'https://example.com/schedule',type,checkedAt:'2026-11-12T13:54:39+09:00'}]};
 context.appendSourcesAndTimes(area,event);return {times:area.children.find(c=>c.className==='event-timings').textContent,sources:area.children.find(c=>c.className==='event-sources').textContent};
}
for(const type of ['artist_official_recurring','broadcaster_official'])test(`${type} possible timing has source-neutral certainty label and separate source identity`,()=>{
 const result=render(type,'possible');assert.match(result.times,/（かも？）/);assert.ok(!result.times.includes('外部情報'));assert.match(result.times,/個別回未確認/);assert.match(result.sources,type.startsWith('artist_official')?/本人公式/:/外部情報/);assert.match(result.sources,/2026-11-12T13:54:39/);
});
test('confirmed timing has no possible marker and still displays source identity',()=>{const result=render('artist_official','confirmed');assert.ok(!result.times.includes('かも'));assert.match(result.sources,/本人公式/);});
test('unmarked timing does not infer certainty or source category',()=>{const result=render('organizer',undefined);assert.ok(!result.times.includes('かも'));const result2=render('organizer','unknown');assert.ok(!result2.times.includes('かも'));assert.match(result2.sources,/外部情報/);assert.ok(!app.includes('（外部情報・かも？）'));});
