import test from 'node:test';
import assert from 'node:assert/strict';
import {DatasetWorkspace} from '../src/core/workspace.mjs';
import {buildSummaryIsothermCurves,plottedExport} from '../src/core/chain-series.mjs';
import {conciseCurveLabel,buildLineSvg} from '../src/ui/plot-theme.mjs';

test('slot labels are mutable without changing stable identity and reset on replacement/removal',()=>{
  const ws=new DatasetWorkspace();
  ws.load('A',{datasets:[]},'catalog-one');
  assert.equal(ws.slots.A.datasetId,'A');
  assert.equal(ws.label('A','Lab sample'),'Lab sample');
  assert.equal(ws.slots.A.datasetId,'A');
  ws.load('A',{datasets:[]},'replacement');
  assert.equal(ws.slots.A.datasetLabel,'replacement');
  ws.remove('A');
  assert.equal(ws.slots.A,null);
});

test('identical labels do not merge identities and reach legends and exports',()=>{
 const parsed={records:[{x:1,loading:2,xKind:'pressure',sourcePath:'a',lineNumber:1}],diagnostics:[],xKind:'pressure'};
 const entries=['A','B'].map(datasetId=>({entry:{datasetId,datasetLabel:'Same label',datasetFingerprint:`fp-${datasetId}`,component:'C5',chainLength:5,path:`${datasetId}.dat`},parsed}));
 const curves=buildSummaryIsothermCurves(entries).curves;
 assert.equal(conciseCurveLabel(curves[0],true),'Same label C₅');
 const exported=plottedExport(curves,{});
 assert.deepEqual(exported.data.map(x=>x.dataset_id),['A','B']);
 assert.deepEqual(exported.data.map(x=>x.dataset_label),['Same label','Same label']);
 assert.deepEqual(exported.data.map(x=>x.dataset_fingerprint),['fp-A','fp-B']);
 const svg=buildLineSvg(curves.map(c=>({...c,records:[{x:1,y:2},{x:2,y:3}]})),{});
 assert.match(svg,/Same label C₅/);
});
