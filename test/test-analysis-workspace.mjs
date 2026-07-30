import test from 'node:test';import assert from 'node:assert/strict';
import { buildHeatmap, pairSamplingMask, nearestPressureIndex, matchNearestPressure, highRegions, mapAnnotations, compareRdfs } from '../src/core/analysis.mjs';
import {COMPARISON_VIEWS,createComparisonState} from '../src/core/comparison-state.mjs';
import { DatasetWorkspace } from '../src/core/workspace.mjs';
const records=(g,grid=[1,2,3,4])=>grid.map((distanceA,i)=>({distanceA,gR:g[i],unnormalizedDistanceHistogram:1,binIndex:i}));
const item=(pressure,g,run=String(pressure),grid)=>({manifest:{component:'C10',rdf_filename:'RDF_CF3_sp3_O2.dat',pressure_pa:pressure,run,collected_relative_path:`${run}/rdf.dat`},rdf:{records:records(g,grid)}});
test('loading Dataset B keeps Dataset A and each mapping independent',()=>{const w=new DatasetWorkspace(),a={datasets:[item(1,[0,1,0,0])]},b={datasets:[item(2,[0,2,0,0])]};w.load('A',a,'first');w.select('A','C10','pair',1);w.load('B',b,'second');assert.equal(w.slots.A.displayName,'first');assert.equal(w.slots.B.displayName,'second');assert.equal(w.selected('A','C10','pair'),1);w.remove('B');assert.ok(w.slots.A)});
test('heatmap matrix is pressure sorted and retains exact irregular pressures',()=>{const map=buildHeatmap([item(100,[0,2,0,0]),item(1,[0,1,0,0]),item(17,[0,3,0,0])],{jumpThresholdDecades:0});assert.deepEqual(map.pressuresPa,[1,17,100]);assert.deepEqual(map.values[1],[0,3,0,0]);assert.equal(nearestPressureIndex(map.pressuresPa,12),1)});
test('pressure synchronization stores menu selection and click nearest row deterministically',()=>{const w=new DatasetWorkspace();w.select('A','C10','pair',17);assert.equal(w.selected('A','C10','pair'),17);assert.equal(nearestPressureIndex([1,17,100],55),1)});
test('mask toggle changes display eligibility without removing RDF values',()=>{const mask=pairSamplingMask([1,10,100],[.001,10,20]);assert.deepEqual(mask.valid,[false,true,true]);const map=buildHeatmap([item(1,[100,0,0,0]),item(10,[2,0,0,0]),item(100,[1,0,0,0])]);assert.equal(map.values[0][0],100);assert.equal(map.valid[0],true)});
test('nearest pressure matching reports actual mismatch',()=>{assert.deepEqual(matchNearestPressure([10,30],22),{index:1,actualPa:30,differencePa:8,exact:false});assert.equal(matchNearestPressure([10,30],30).exact,true)});
test('peak and contiguous high-span annotations are deterministic',()=>{const rows=records([0,4,4,0]);assert.deepEqual(highRegions(rows,{mode:'absolute',threshold:3})[0],{startA:2,endA:3,widthA:1,peakPositionA:2,peakHeight:4,criterion:{mode:'absolute',threshold:3,limit:3}});const ann=mapAnnotations(buildHeatmap([item(10,[0,5,0,0]),item(20,[0,6,0,0])],{jumpThresholdDecades:0}),{mode:'absolute',threshold:4});assert.deepEqual(ann.global,{height:6,positionA:2,pressurePa:20});assert.equal(ann.persistence[0].pressureMinPa,10)});
test('incompatible grids disable subtraction with a visible reason',()=>{const result=compareRdfs(records([0,1,0,0]),records([0,1,0],[1,2,3]));assert.equal(result.compatible,false);assert.match(result.reason,/disabled/);assert.throws(()=>buildHeatmap([item(1,[0,1,0,0]),item(2,[0,1,0],'2',[1,2,3])]),/incompatible/)});
test('missing pressure runs do not prevent a heatmap from remaining browsable',()=>{const map=buildHeatmap([item(1,[0,1,0,0]),item(100,[0,2,0,0])],{jumpThresholdDecades:0});assert.deepEqual(map.pressuresPa,[1,100]);assert.equal(map.rows.length,2)});

test('comparison defaults and legacy isotherm persistence fall back to RDF curves',()=>{
  assert.deepEqual(COMPARISON_VIEWS,['rdf_curves','rdf_heatmaps','end_to_end','lj']);
  assert.equal(createComparisonState().activeView,'rdf_curves');
  assert.equal(createComparisonState({activeView:'isotherms'}).activeView,'rdf_curves');
});
