import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRdf } from './importers.mjs';
import { prepareRawLine, smoothDisplay, decimateMarkers, lineCommands, peakTrace } from './plotting.mjs';

test('raw plotted coordinates sort numerically while preserving r-g pairing',()=>{
  const raw=[{distanceA:'10',gR:'4'},{distanceA:'2',gR:'9'}], line=prepareRawLine(raw);
  assert.deepEqual(line.map(({distanceA,gR})=>[distanceA,gR]),[[2,9],[10,4]]);
  assert.deepEqual(lineCommands(line,x=>x,y=>y).map(x=>[x.command,x.x,x.y]),[['moveTo',2,9],['lineTo',10,4]]);
});
test('duplicates and non-finite values produce gaps rather than artificial triangles',()=>{
  const line=prepareRawLine([{distanceA:1,gR:2},{distanceA:1,gR:8},{distanceA:2,gR:NaN},{distanceA:3,gR:4}]);
  assert.deepEqual(lineCommands(line,x=>x,y=>y).map(x=>x.command),['moveTo','gap','gap','moveTo']);
  assert.ok(lineCommands(line,x=>x,y=>y).filter(x=>x.command!=='gap').every(x=>x.y!==0));
});
test('marker decimation cannot modify line data',()=>{const line=prepareRawLine(Array.from({length:100},(_,i)=>({distanceA:i,gR:i*i}))), copy=structuredClone(line);assert.ok(decimateMarkers(line,10).length<=11);assert.deepEqual(line,copy)});
test('line commands describe an open unfilled path',()=>{const commands=lineCommands(prepareRawLine([{distanceA:1,gR:2},{distanceA:2,gR:3}]),x=>x,y=>y);assert.ok(commands.every(x=>!['closePath','fill'].includes(x.command)))});
test('moving-average smoothing affects display only and does not cross a gap',()=>{const raw=[{distanceA:1,gR:0},{distanceA:2,gR:9},{distanceA:3,gR:0},{distanceA:4,gR:NaN},{distanceA:5,gR:8}], line=prepareRawLine(raw), smooth=smoothDisplay(line,3);assert.equal(smooth[1].gR,3);assert.equal(smooth[4].gR,8);assert.equal(raw[1].gR,9)});
test('peak annotations are absent when disabled and form one trace when enabled',()=>{const ann={byPressure:[{pressurePa:1,peaks:[{positionA:2,height:3}]},{pressurePa:2,peaks:[]},{pressurePa:3,peaks:[{positionA:2.2,height:4}]}]};assert.deepEqual(false?peakTrace(ann):[],[]);assert.deepEqual(peakTrace(ann),[{pressurePa:1,distanceA:2},null,{pressurePa:3,distanceA:2.2}])});
test('rescaling changes pixels but neither source coordinates nor selection',()=>{const line=prepareRawLine([{distanceA:1,gR:2},{distanceA:2,gR:4}]), a=lineCommands(line,x=>x*10,y=>y*10), b=lineCommands(line,x=>x*20,y=>y*20);assert.deepEqual(line.map(x=>[x.distanceA,x.gR]),[[1,2],[2,4]]);assert.ok(a.concat(b).every(x=>x.command==='gap'||Number.isFinite(x.x+x.y)))});

test('plot-specific CSS selectors do not combine heatmap and RDF annotation roles',async()=>{const {readFile}=await import('node:fs/promises'),css=await readFile(new URL('./styles.css',import.meta.url),'utf8');assert.match(css,/\.heatmap-panel>\.heatmap-canvas/);assert.match(css,/\.rdf-panel>\.rdf-canvas/);assert.doesNotMatch(css,/\.heatmap-canvas\s*,\s*\.rdf-canvas/)});
test('hidden comparison heatmap does not reserve an empty grid row',async()=>{const {readFile}=await import('node:fs/promises'),css=await readFile(new URL('./styles.css',import.meta.url),'utf8');assert.match(css,/\.compare-plots>canvas\[hidden\]\{display:none\}/)});


test('representative parsed RDF maps one-for-one to raw line coordinates',async()=>{const {readFile}=await import('node:fs/promises'),rdf=parseRdf(await readFile(new URL('./test/fixtures/representative_run/RDF_CF3_sp3_C1.dat',import.meta.url),'utf8')),line=prepareRawLine(rdf.records);assert.deepEqual(line.map(x=>[x.distanceA,x.gR]),rdf.records.map(x=>[x.distanceA,x.gR]));assert.ok(line.every(x=>x.valid))});

import {PLOT_THEME, chainStyle, conciseCurveLabel, linearTicks, logTicks, markerIndices, buildLineSvg} from './plot-theme.mjs';
test('one shared publication theme supplies stable chain encodings and readable ticks',()=>{assert.equal(chainStyle(2).color,chainStyle(2).color);assert.notEqual(chainStyle(2).color,chainStyle(3).color);assert.equal(PLOT_THEME.axisTitlePx,17);assert.ok(linearTicks(0,4.8).length>=5);assert.deepEqual(markerIndices(50,10),[0,5,11,16,22,27,33,38,44,49]);assert.deepEqual(logTicks(1,1e4).major.map(x=>x.label),['10⁰','10¹','10²','10³','10⁴']);assert.equal(conciseCurveLabel({component:'C10'}),'C₁₀')});
test('publication SVG has numeric ticks, concise legend, and no interface or provenance text',()=>{const records=Array.from({length:50},(_,i)=>({x:10**(i/10),y:i/10,uncertainty:.02})),svg=buildLineSvg([{component:'C2',chainLength:2,family:'PFA',records}],{logX:true,xLabel:'Pressure, P (Pa)',yLabel:'Absolute loading (mol kg⁻¹ framework)'});assert.match(svg,/class="tick x-tick"/);assert.match(svg,/10⁰/);assert.match(svg,/C₂/);assert.match(svg,/Absolute loading \(mol kg⁻¹ framework\)/);assert.match(svg,/class="error-bar"/);for(const forbidden of ['Adsorption Isotherms','checkbox','final_abs_pressure_up','wheel to zoom','provenance'])assert.doesNotMatch(svg,new RegExp(forbidden,'i'))});
