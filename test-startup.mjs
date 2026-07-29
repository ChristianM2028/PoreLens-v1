import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {runStartup} from './startup.mjs';

function fixtureDocument(){
  const controls=Array.from({length:5},()=>({disabled:false}));
  return {readyState:'complete',controls,querySelectorAll:()=>controls,addEventListener(){throw new Error('already ready')}};
}
const ok=()=>({ok:true});

test('startup awaits every consumer before enabling imports and calls each initializer once',async()=>{
  const documentRef=fixtureDocument(),calls=[];let release;
  const delayed=new Promise(resolve=>{release=resolve});
  const stages=[['consumer-a',async()=>{calls.push('a');return ok()}],['consumer-b',async()=>{calls.push('b');await delayed;return ok()}],['importer',async()=>{calls.push('importer');return ok()}]];
  const running=runStartup({documentRef,stages,state:{}});
  await new Promise(resolve=>setTimeout(resolve));
  assert.deepEqual(calls,['a','b']);
  assert.ok(documentRef.controls.every(x=>x.disabled));
  release();const state=await running;
  assert.equal(state.status,'ready');assert.deepEqual(calls,['a','b','importer']);
  assert.ok(documentRef.controls.every(x=>!x.disabled));
});

test('each required initializer rejection is terminal and keeps imports disabled',async()=>{
  for(const failed of [0,1,2]){
    const documentRef=fixtureDocument(),original=new Error(`failure-${failed}`),calls=[];
    const stages=['consumer-a','consumer-b','importer'].map((name,index)=>[name,async()=>{calls.push(name);if(index===failed)throw original;return ok()}]);
    const state={};
    await assert.rejects(runStartup({documentRef,stages,state}),error=>error===original);
    assert.equal(state.status,'failed');assert.equal(state.stage,stages[failed][0]);assert.equal(state.error,original);
    assert.equal(calls.length,failed+1);assert.ok(documentRef.controls.every(x=>x.disabled));
  }
});

test('dataset dispatch is impossible until consumers are ready and startup reaches ready',async()=>{
  const documentRef=fixtureDocument(),events=[];let selectDataset,release;
  const delayed=new Promise(resolve=>{release=resolve});
  const state={};
  const running=runStartup({documentRef,state,stages:[
    ['consumer',async()=>{await delayed;events.push('consumer-ready');return ok()}],
    ['importer',async()=>{selectDataset=()=>{assert.equal(state.status,'ready');events.push('dataset-loaded')};return ok()}]
  ]});
  await new Promise(resolve=>setTimeout(resolve));assert.equal(selectDataset,undefined);
  release();await running;selectDataset();assert.deepEqual(events,['consumer-ready','dataset-loaded']);
});

test('entry-module imports alone have no DOM, listener, scan, or parsing side effects',()=>{
  const source=`globalThis.document=new Proxy({}, {get(){throw new Error('document touched')}});globalThis.window=new Proxy({}, {get(){throw new Error('window touched')}});Promise.all(${JSON.stringify(['app.js','chain-plotter-ui.mjs','result-browser-ui.mjs','directory-import-ui.mjs','workspace-navigation-ui.mjs'])}.map(x=>import('./'+x))).then(()=>process.stdout.write('ok'))`;
  const result=spawnSync(process.execPath,['--input-type=module','--eval',source],{cwd:process.cwd(),encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'ok');
});
