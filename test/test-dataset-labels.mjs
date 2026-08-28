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
 assert.equal(conciseCurveLabel(curves[0],true),'Same label C5');
 const exported=plottedExport(curves,{});
 assert.deepEqual(exported.data.map(x=>x.dataset_id),['A','B']);
 assert.deepEqual(exported.data.map(x=>x.dataset_label),['Same label','Same label']);
 assert.deepEqual(exported.data.map(x=>x.dataset_fingerprint),['fp-A','fp-B']);
 const svg=buildLineSvg(curves.map(c=>({...c,records:[{x:1,y:2},{x:2,y:3}]})),{});
 assert.doesNotMatch(svg,/>Same label<\/text>/);assert.equal((svg.match(/>C5<\/text>/g)||[]).length,1);assert.equal((svg.match(/>Simulation<\/text>/g)||[]).length,1);
});

test('complete long display labels remain in SVG accessibility metadata',()=>{
 const labels=['Primary fluorinated adsorbate collection with a deliberately long provenance label','Reference hydrocarbon collection with an equally long descriptive label'];
 const curves=labels.map((datasetLabel,index)=>({datasetId:index?'B':'A',datasetLabel,legendLabel:datasetLabel,family:datasetLabel,component:'C10',chainLength:10,records:[{x:1,y:2},{x:2,y:3}]}));
 const svg=buildLineSvg(curves,{width:340,height:420});
 for(const label of labels)assert.doesNotMatch(svg,new RegExp(label));
 assert.match(svg,/role="img" aria-label="Chain identity is encoded by color/);assert.match(svg,/solid connected lines for simulation and individual hollow circles for literature/);
});

test('comparison UI resolves display labels while retaining slots only as internal keys',async()=>{
 const {readFile}=await import('node:fs/promises'),source=await readFile(new URL('../src/ui/app.js',import.meta.url),'utf8'),html=await readFile(new URL('../index.html',import.meta.url),'utf8');
 assert.match(source,/function datasetLabel\(slot\).*ws\.slots\[slot\]\?\.datasetLabel/);
 for(const id of ['heatmapHeadingA','heatmapHeadingB','mappingLegendA','mappingLegendB','rdfOverlayOption','rdfDifferenceOption','sharedColorOption','differenceMapLabel'])assert.match(html,new RegExp(`id="${id}"`));
 for(const visiblePlaceholder of ['A/B overlay','Shared across A/B','gB(r) − gA(r)','B − A','Dataset A heatmap','Dataset B heatmap'])assert.ok(!html.includes(visiblePlaceholder));
 assert.match(source,/editDatasetLabel[\s\S]*syncDatasetLabels\(\)/);assert.match(source,/datasetId:slot/);
});
