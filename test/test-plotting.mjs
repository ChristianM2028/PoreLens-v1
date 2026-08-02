import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRdf } from '../src/import/importers.mjs';
import { prepareRawLine, smoothDisplay, decimateMarkers, lineCommands, peakTrace } from '../src/ui/plotting.mjs';

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

test('plot-specific CSS selectors do not combine heatmap and RDF annotation roles',async()=>{const {readFile}=await import('node:fs/promises'),css=await readFile(new URL('../styles.css',import.meta.url),'utf8');assert.match(css,/\.heatmap-panel>\.heatmap-canvas/);assert.match(css,/\.rdf-panel>\.rdf-canvas/);assert.doesNotMatch(css,/\.heatmap-canvas\s*,\s*\.rdf-canvas/)});
test('hidden comparison heatmap does not reserve an empty grid row',async()=>{const {readFile}=await import('node:fs/promises'),css=await readFile(new URL('../styles.css',import.meta.url),'utf8');assert.match(css,/\.compare-plots>canvas\[hidden\]\{display:none\}/)});


test('representative parsed RDF maps one-for-one to raw line coordinates',async()=>{const {readFile}=await import('node:fs/promises'),rdf=parseRdf(await readFile(new URL('./fixtures/representative_run/RDF_CF3_sp3_C1.dat',import.meta.url),'utf8')),line=prepareRawLine(rdf.records);assert.deepEqual(line.map(x=>[x.distanceA,x.gR]),rdf.records.map(x=>[x.distanceA,x.gR]));assert.ok(line.every(x=>x.valid))});

import {PLOT_THEME, chainStyle, conciseCurveLabel, linearTicks, logTicks, markerIndices, buildLineSvg} from '../src/ui/plot-theme.mjs';
test('one shared publication theme supplies stable chain encodings and readable ticks',()=>{assert.equal(chainStyle(2).color,chainStyle(2).color);assert.notEqual(chainStyle(2).color,chainStyle(3).color);assert.equal(PLOT_THEME.axisTitlePx,17);assert.ok(linearTicks(0,4.8).length>=5);assert.deepEqual(markerIndices(50,10),[0,5,11,16,22,27,33,38,44,49]);assert.deepEqual(logTicks(1,1e4).major.map(x=>x.label),['10⁰','10¹','10²','10³','10⁴']);assert.equal(conciseCurveLabel({component:'C10'}),'C₁₀')});
test('publication SVG has numeric ticks, concise legend, and no interface or provenance text',()=>{const records=Array.from({length:50},(_,i)=>({x:10**(i/10),y:i/10,uncertainty:.02})),svg=buildLineSvg([{component:'C2',chainLength:2,family:'PFA',records}],{logX:true,xLabel:'Pressure, P (Pa)',yLabel:'Absolute loading (mol kg⁻¹ framework)'});assert.match(svg,/class="tick x-tick"/);assert.match(svg,/10⁰/);assert.match(svg,/C₂/);assert.match(svg,/Absolute loading \(mol kg⁻¹ framework\)/);assert.match(svg,/class="error-bar"/);for(const forbidden of ['Adsorption Isotherms','checkbox','final_abs_pressure_up','wheel to zoom','provenance'])assert.doesNotMatch(svg,new RegExp(forbidden,'i'))});

test('workspace curve renderer requires generic accessors and explicit axis metadata',async()=>{const {readFile}=await import('node:fs/promises'),source=await readFile(new URL('../src/ui/app.js',import.meta.url),'utf8'),draw=source.slice(source.indexOf('function drawCurve'),source.indexOf('function viridis'));assert.match(draw,/\{x,y,xLabel,xUnit,yLabel,yUnit,/);assert.match(draw,/missing: \$\{missing\.join/);assert.doesNotMatch(draw,/x\?\?r\.distanceA|y\?\?r\.gR/);assert.match(source,/yLabel:'Radial distribution function, g\(r\)',yUnit:'dimensionless'/);assert.match(source,/yLabel:'Δg\(r\)',yUnit:'dimensionless'/);assert.match(source,/yLabel:'Probability density',yUnit:'Å⁻¹'/)});

import {comparisonCurveLayout, comparisonHeatmapLayout, measuredLegendLayout, formatPressureTick} from '../src/ui/plot-theme.mjs';
const measuredText=text=>String(text).length*7;
test('comparison layouts preserve useful curve and heatmap regions at desktop and mobile sizes',()=>{
  for(const [width,height] of [[700,430],[320,400]]){
    const curve=comparisonCurveLayout({width,height,measure:measuredText,yTickLabels:['0','1.234567e8'],legendLabels:['A · C10 · CF2_sp3 ↔ Zn1','B · C10 · CF2_sp3 ↔ Zn1']});
    const heatmap=comparisonHeatmapLayout({width,height,measure:measuredText,pressureTickLabels:['1.0e2','2.3e8'],colorTickLabels:['0','123.4']});
    assert.ok(curve.plotW>=curve.minimum.width&&curve.plotH>=curve.minimum.height,`${width}px curve data region`);
    assert.ok(heatmap.plotW>=heatmap.minimum.width&&heatmap.plotH>=heatmap.minimum.height,`${width}px heatmap data region`);
    assert.ok(curve.legend.y+curve.legend.height<=curve.top,'legend ends before curve');
    assert.ok(heatmap.left+heatmap.plotW<=heatmap.colorBar.x,'map ends before color bar');
  }
});
test('comparison gutters respond to measured long values and pressure notation is concise',()=>{
  const short=comparisonCurveLayout({width:700,height:430,measure:measuredText,yTickLabels:['1'],legendLabels:['A']});
  const long=comparisonCurveLayout({width:700,height:430,measure:measuredText,yTickLabels:['1.234567e8'],legendLabels:['A']});
  assert.ok(long.left>short.left);
  assert.equal(formatPressureTick(23299.51811),'2.3e4');
  assert.equal(formatPressureTick(1e8),'1e8');
});
test('A/B legends are measured and wrap within their bounded region without collisions',()=>{
  const layout=comparisonCurveLayout({width:700,height:430,measure:measuredText,legendLabels:['A · C10 · CF2_sp3 ↔ Zn1','B · C10 · CF2_sp3 ↔ Zn1']});
  assert.equal(layout.legend.columns,2);assert.equal(layout.legend.rows,1);
  const mobile=comparisonCurveLayout({width:320,height:400,measure:measuredText,legendLabels:['A · C10 · CF2_sp3 ↔ Zn1','B · C10 · CF2_sp3 ↔ Zn1']});
  assert.equal(mobile.legend.columns,1);assert.equal(mobile.legend.rows,2);
});
test('inset comparison legends remain inside the plot at desktop and narrow widths without reducing its height',()=>{
  for(const [width,height] of [[700,430],[320,400]]){
    const labels=['Primary experimental dataset','Comparison simulation dataset'];
    const inset=comparisonCurveLayout({width,height,measure:measuredText,yTickLabels:['0','100'],legendLabels:labels,insetLegend:true});
    const flowing=comparisonCurveLayout({width,height,measure:measuredText,yTickLabels:['0','100'],legendLabels:labels});
    const box=inset.legend.background;
    assert.ok(inset.legend.inset);
    assert.ok(box.x>=inset.left&&box.y>=inset.top,`${width}px inset starts inside plot`);
    assert.ok(box.x+box.width<=inset.left+inset.plotW&&box.y+box.height<=inset.top+inset.plotH,`${width}px inset ends inside plot`);
    assert.ok(inset.legend.items.every(item=>item.x>=box.x&&item.x+item.width<=box.x+box.width));
    assert.ok(inset.plotH>flowing.plotH,'inset does not reserve vertical data space');
  }
});
test('end-to-end comparison uses dataset-only visible labels while retaining run and pressure provenance',async()=>{
  const {readFile}=await import('node:fs/promises'),source=await readFile(new URL('../src/ui/app.js',import.meta.url),'utf8');
  const render=source.slice(source.indexOf('async function renderComparisonHistograms'),source.indexOf('function renderActiveComparisonEvidence'));
  assert.match(render,/label:datasetLabel\(slot\)/);
  assert.doesNotMatch(render,/label:`[^`]*run|label:`[^`]*Pa/);
  assert.match(render,/description:`[^`]*run \$\{chosen\.run\}[^`]*\$\{chosen\.pressurePa\} Pa[^`]*\$\{chosen\.pressureSource/);
  assert.match(render,/messages\.push\(`[^`]*run \$\{chosen\.run\}[^`]*\$\{chosen\.pressurePa\} Pa \(\$\{chosen\.pressureSource/);
  assert.match(render,/insetLegend:true/);
});
test('measured legend items stay bounded, do not intersect, and add rows on narrow plots',()=>{
  const widths=[245,224,238],wide=measuredLegendLayout({availableWidth:760,labelWidths:widths,swatchSize:24,fontHeight:14,horizontalGap:7,verticalGap:5}),narrow=measuredLegendLayout({availableWidth:180,labelWidths:widths,swatchSize:24,fontHeight:14,horizontalGap:7,verticalGap:5});
  assert.ok(narrow.rows>wide.rows);assert.equal(narrow.columns,1);assert.equal(narrow.policy,'clip');
  for(const layout of [wide,narrow])for(const [i,a] of layout.items.entries()){
    assert.ok(a.x>=0&&a.x+a.width<=layout.width);assert.ok(a.y>=0&&a.y+a.height<=layout.height);
    for(const b of layout.items.slice(i+1))assert.ok(a.y+a.height<=b.y||b.y+b.height<=a.y||a.x+a.width<=b.x||b.x+b.width<=a.x);
  }
  assert.ok(narrow.items.every(item=>item.clipped),'oversized labels use the documented visual clipping policy');
});
test('workspace renderers expose one/multi-row, axes, color scale mode, and true maximum metadata',async()=>{
  const {readFile}=await import('node:fs/promises'),source=await readFile(new URL('../src/ui/app.js',import.meta.url),'utf8');
  const heat=source.slice(source.indexOf('function drawHeatmap'),source.indexOf('function heatmapClick'));
  for(const title of ['Distance, r (Å)','Pressure, P (Pa)','g(r)'])assert.match(heat,new RegExp(title.replace(/[()]/g,'\\$&')));
  assert.match(heat,/n===1\?`one pressure row/);assert.match(heat,/scaleMode/);assert.match(heat,/true maximum/);assert.match(heat,/clipped/);
  assert.match(source,/shared across \$\{datasetLabel\('A'\)\} and \$\{datasetLabel\('B'\)\}/);
  assert.match(source,/label:`\$\{datasetLabel\('A'\)\} · \$\{choiceA\.component\} · \$\{choiceA\.pair\}`/);
  assert.doesNotMatch(source,/j\*150/);
});

test('GEMC allocator overflows safely and canvas legend geometry supports interaction', async()=>{const {allocateGemcStyles,canvasPlotLayout,canvasPointer,moveNormalizedLegend,hitRect,GEMC_COLORS}=await import('../src/ui/plot-theme.mjs');const keys=Array.from({length:15},(_,i)=>`F | C${i}`),a=allocateGemcStyles(keys),b=allocateGemcStyles([...keys].reverse());assert.deepEqual(a,b);assert.equal(new Set(keys.slice(0,GEMC_COLORS.length).map(k=>a[k].color)).size,GEMC_COLORS.length);const g=canvasPlotLayout({width:300,height:220,measure:x=>x.length*9,labels:keys.map(x=>x.repeat(3)),position:{x:1,y:1},overlay:true});assert.ok(g.legend.items.length===15&&g.legend.items.some(x=>x.clipped)&&g.legend.items.at(-1).row>0);assert.ok(g.legend.x+g.legend.width<=300&&g.legend.y+g.legend.height<=220);const canvas={width:600,height:400,getBoundingClientRect:()=>({left:10,top:20,width:300,height:200})};assert.deepEqual(canvasPointer(canvas,{clientX:160,clientY:120}),{x:300,y:200});assert.ok(hitRect({x:g.legend.x,y:g.legend.y},g.legend));assert.deepEqual(moveNormalizedLegend({x:1,y:1},100,100,g),{x:0,y:1});const movable=canvasPlotLayout({width:800,height:400,measure:x=>x.length*7,labels:['A'],position:{x:1,y:1},overlay:true});assert.ok(moveNormalizedLegend({x:1,y:1},-5,0,movable).x<1)});
