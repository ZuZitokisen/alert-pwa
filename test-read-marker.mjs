import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const app=fs.readFileSync(new URL('./app.js',import.meta.url),'utf8');
const functions=app.slice(app.indexOf('function readMarker('),app.indexOf('function presentEvent('));
function fixture(entries={}){const values=new Map(Object.entries(entries)),writes=[];const c={state:{},stored:(k,f)=>values.has(k)?values.get(k):f,save:(k,v)=>{values.set(k,v);writes.push([k,v]);}};vm.createContext(c);vm.runInContext(functions+';var readThrough=readMarker();',c);return {c,values,writes,run:s=>vm.runInContext(s,c)};}
test('existing valid read marker moves once to v2 without changing v1',()=>{const f=fixture({'alert-pwa-curated-read-v1':9});assert.equal(f.c.readThrough,9);assert.deepEqual(f.writes,[['alert-pwa-curated-read-v2',9]]);assert.equal(f.values.get('alert-pwa-curated-read-v1'),9);f.values.set('alert-pwa-curated-read-v1',100);assert.equal(f.run('readMarker()'),9);assert.equal(f.writes.length,1);});
test('v2 marker takes priority over an old tab and rejects invalid saved values',()=>{for(const bad of [-1,1.5,'3',null,Infinity]){const f=fixture({'alert-pwa-curated-read-v2':bad,'alert-pwa-curated-read-v1':4});assert.equal(f.c.readThrough,bad===null?4:0);}assert.equal(fixture({'alert-pwa-curated-read-v2':5,'alert-pwa-curated-read-v1':20}).c.readThrough,5);});
test('marker is capped when history was not restored, allowing later new items to be unread',()=>{const f=fixture({'alert-pwa-curated-read-v1':100});f.c.state={nextChangeId:1};f.run('reconcileReadMarker()');assert.equal(f.c.readThrough,0);f.c.state={nextChangeId:16};f.run('reconcileReadMarker()');assert.equal(f.c.readThrough,0);assert.equal(f.values.get('alert-pwa-curated-read-v1'),100);});
test('migrated marker retains prior read state while fifteen new artist items remain unread',()=>{const f=fixture({'alert-pwa-curated-read-v1':9});f.c.state={nextChangeId:25};f.run('reconcileReadMarker()');assert.equal(f.c.readThrough,9);assert.equal(f.writes.length,1);assert.match(app,/save\('alert-pwa-curated-read-v2',readThrough\)/);assert.ok(!app.includes("save('alert-pwa-curated-read-v1'"));});
