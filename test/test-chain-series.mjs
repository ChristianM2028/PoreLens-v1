import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverChains, discoverPairs, filterPairs, matchRuns, parseEndToEndHistogram, plottedExport, exportCsv, buildChainCatalog, parseHistogramFilename, reconcileHistogramPressure, histogramIdentity, updateHistogramSelections, ParsedResultCache } from '../src/core/chain-series.mjs';

test('parses only validated histogram filename pressures',()=>{
  assert.deepEqual(parseHistogramFilename('Histogram_C10_0_Density_126896.dat'),{recognized:true,componentToken:'C10',componentIndex:0,filenamePressurePa:126896});
  assert.equal(parseHistogramFilename('Histogram_PFA10_2_Density_12.625.dat').filenamePressurePa,12.625);
  assert.equal(parseHistogramFilename('Histogram_C3_0_Density_1.2e+06.dat').filenamePressurePa,1.2e6);
  assert.deepEqual(parseHistogramFilename('notes_pressure_123.dat'),{recognized:false,componentToken:null,componentIndex:null,filenamePressurePa:null});
});

test('reconciles filename pressure without replacing simulation metadata',()=>{
  const metadata=parseHistogramFilename('Histogram_C10_0_Density_126896.dat');
  assert.equal(reconcileHistogramPressure(126896,metadata,'simulation.input').pressureConsistent,true);
  const conflict=reconcileHistogramPressure(125000,metadata,'simulation.input');
  assert.equal(conflict.pressurePa,125000);assert.equal(conflict.pressureSource,'simulation.input');assert.equal(conflict.pressureConsistent,false);assert.ok(conflict.pressureMismatchAbsolutePa>0);assert.match(conflict.pressureDiagnostic,/disagrees/);
  assert.equal(reconcileHistogramPressure(null,metadata).pressureSource,'histogram_filename_fallback');
});

test('per-chain histogram selections survive other changes and incremental additions',()=>{
  const entry=(chain,run,path,pressurePa)=>({datasetId:'d',component:chain,run,path,filename:path,pressurePa});
  const initial=[entry('C2','2','b.dat',200),entry('C2','1','a.dat',100),entry('C10','1','x.dat',100)];
  let state=updateHistogramSelections(new Map(),initial);state.set('d\0C2',histogramIdentity(initial[0]));
  state=updateHistogramSelections(state,[...initial,entry('C10','2','y.dat',200),entry('C3','1','z.dat',50)]);
  assert.equal(state.get('d\0C2'),histogramIdentity(initial[0]));assert.equal(state.get('d\0C10'),histogramIdentity(initial[2]));assert.ok(state.has('d\0C3'));
});

test('result cache lazily reads selected histogram files only',async()=>{let reads=0;const file=name=>({name,path:name,size:3,lastModified:1,text:async()=>{reads++;return '0 0\n1 1'}}),cache=new ParsedResultCache();const files=[file('a.dat'),file('b.dat'),file('c.dat')];await cache.get(files[1],'end_to_end');assert.equal(reads,1);await cache.get(files[1],'end_to_end');assert.equal(reads,1)});

test('discovers only immediate exact Cn directories in numeric order', () => {
  assert.deepEqual(discoverChains(['root/C10/1/a', 'root/C2/1/a', 'root/C1/1/a', 'root/C3_extra/1/a', 'root/x/C4/1/a']), [
    { component: 'C1', chainLength: 1 }, { component: 'C2', chainLength: 2 }, { component: 'C10', chainLength: 10 }
  ]);
});

test('discovers underscore-containing and reversed RDF pairs without losing source identity', () => {
  const pairs = discoverPairs([
    { filename: 'RDF_CF3_sp3_O2.dat', path: 'a' }, { filename: 'RDF_O2_CF3_sp3.dat', path: 'b' },
    { filename: 'RDF_CF2_sp3_Zn1.dat', path: 'c' }
  ], ['CF3_sp3', 'CF2_sp3', 'O2', 'Zn1']);
  assert.equal(pairs.length, 2); assert.equal(pairs.find(x => x.reversed).sources.length, 2);
  assert.equal(filterPairs(pairs, ['CF3_sp3'])[0].sources[1].path, 'b');
});

const runs = [
  { datasetId:'alkane',component:'C1',run:'1',pressurePa:100,loading:1 }, { datasetId:'alkane',component:'C1',run:'2',pressurePa:205,loading:2 },
  { datasetId:'alkane',component:'C2',run:'7',pressurePa:110,loading:1.05 }, { datasetId:'pfa',component:'C1',run:'1',pressurePa:101,loading:0.8 }
];
test('matches differing pressure grids exactly, nearest with tolerance, manually, and by loading', () => {
  assert.equal(matchRuns(runs,{mode:'exact',pressurePa:100}).matches.length,1);
  assert.equal(matchRuns(runs,{mode:'nearest',pressurePa:100,tolerancePa:11}).matches.length,3);
  assert.equal(matchRuns(runs,{mode:'nearest',pressurePa:100,tolerancePa:0}).unmatched.length,2);
  assert.deepEqual(matchRuns(runs,{mode:'manual',manual:{'alkane\0C2':'7'}}).matches.map(x=>x.run),['7']);
  assert.equal(matchRuns(runs,{mode:'loading',loading:1}).matches.find(x=>x.datasetId==='pfa').loading,.8);
});

test('histograms preserve probability-density semantics', () => {
  const parsed=parseEndToEndHistogram('# distance probability density\n1 0.2\n2 0.4');
  assert.equal(parsed.yUnit,'Å⁻¹'); assert.equal(parsed.normalization,'probability density');
});

test('exports exactly visible plotted data with isolated family provenance and optional annotations', () => {
  const curve=(family,visible=true)=>({visible,datasetId:family,family,component:'C1',chainLength:1,run:'1',pressurePa:100,type:'rdf',sourcePath:`${family}/x`,records:[{distanceA:1,gR:2}]});
  const out=plottedExport([curve('alkane'),curve('PFA'),curve('hidden',false)],{annotations:[{id:'optional'}]});
  assert.deepEqual(out.data.map(x=>x.family),['alkane','PFA']); assert.equal(out.configuration.annotations.length,1);
  assert.equal(exportCsv(out).split('\n').length,3);
});

test('catalogs RDF, recursive histograms, VTK and movies independently with simulation provenance',async()=>{const simulation=`Framework 0\nFrameworkName MOF-X\nUnitCells 2 1 1\nExternalTemperature 310\nExternalPressure 1234\nComponent 0 MoleculeName PFA5\n`;const file=(path,text='x')=>({name:path.split('/').at(-1),webkitRelativePath:path,text:async()=>text,size:text.length,lastModified:1});const catalog=await buildChainCatalog([file('root/C5/7/simulation.input',simulation),file('root/C5/7/RadialDistributionFunctions/RDF_A_B.dat','0 1 2 3\n1 2 3 4'),file('root/C5/7/EndToEndDistanceHistograms/System_1/nested/h.dat','0 0\n1 1'),file('root/C5/7/VTK/System_0/grid.vtk'),file('root/C5/7/Movies/System_1/movie.pdb')],{datasetId:'PFA'});assert.deepEqual([...new Set(catalog.results.map(x=>x.type))].sort(),['rdf','end_to_end','vtk','movie'].sort());const histogram=catalog.results.find(x=>x.type==='end_to_end');assert.equal(histogram.pressurePa,1234);assert.equal(histogram.temperatureK,310);assert.equal(histogram.framework,'MOF-X');assert.equal(histogram.provenance.simulationInput,'root/C5/7/simulation.input');assert.match(histogram.path,/System_1\/nested/);});

test('assembles pressure-sorted isotherms from all output files and preserves uncertainty provenance', async()=>{
  const {buildIsothermCurves,availableLoadingUnits}=await import('../src/core/chain-series.mjs');
  const point=(run,pressure,loading)=>({entry:{datasetId:'alkane',component:'C2',chainLength:2,run:String(run),path:`C2/${run}/Output/System_0/output.data`,pressurePa:pressure,temperatureK:300,framework:'MOF'},parsed:{pressurePa:pressure,temperatureK:300,component:'C2',loadings:{absolute:{'molecules/unit cell':{value:loading,uncertainty:.1}},excess:{}}}});
  const inputs=[point(2,200,2),point(1,100,1)];assert.deepEqual(availableLoadingUnits(inputs),['molecules/unit cell']);const built=buildIsothermCurves(inputs,{unit:'molecules/unit cell'});assert.deepEqual(built.curves[0].records.map(x=>x.pressurePa),[100,200]);assert.equal(built.curves[0].records[0].uncertainty,.1);assert.match(built.curves[0].records[0].sourcePath,/Output/);
});

test('catalogs output_ data files as RASPA outputs',async()=>{const file=(path,text='x')=>({name:path.split('/').at(-1),webkitRelativePath:path,text:async()=>text,size:text.length,lastModified:1});const sim='ExternalTemperature 300\nExternalPressure 100\n';const catalog=await buildChainCatalog([file('root/C1/1/simulation.input',sim),file('root/C1/1/Output/System_0/output_MOF_300_100.data','External temperature: 300 [K]\nExternal Pressure: 100 [Pa]\n')]);assert.equal(catalog.results[0].type,'raspa_output');});

test('valid six-line final loading block remains plottable beside malformed output',async()=>{
  const {readFile}=await import('node:fs/promises');
  const {parseRaspaOutput}=await import('../src/core/raspa-package.mjs');
  const {buildIsothermCurves,availableLoadingUnits}=await import('../src/core/chain-series.mjs');
  const fixture=name=>readFile(new URL(`./fixtures/raspa-output/${name}`,import.meta.url),'utf8');
  const valid=parseRaspaOutput(`External Pressure: 23299.5 [Pa]\n${await fixture('final-average-loading-six-lines.data')}`);
  const malformed=parseRaspaOutput(await fixture('malformed-loading.data'));
  const entry=(run,path)=>({datasetId:'PFA',component:'C10',chainLength:10,run,path});
  const outputs=[{entry:entry('1','valid.data'),parsed:valid},{entry:entry('2','malformed.data'),parsed:malformed}];
  assert.equal(valid.loadings.absolute['molecules/unit cell'].value,37.57272);
  assert.deepEqual(availableLoadingUnits(outputs),['molecules/unit cell','cm^3 (STP)/cm^3 framework','cm^3 (STP)/gr framework','milligram/gram framework','mol/kg framework','molecules/system']);
  const plotted=buildIsothermCurves(outputs);
  assert.equal(plotted.curves.length,1);
  assert.equal(plotted.curves[0].records.length,1);
  assert.equal(plotted.curves[0].records[0].sourcePath,'valid.data');
  assert.match(plotted.diagnostics.join(' '),/malformed\.data/);
});

test('catalog keeps several pressures and observables per chain with filename diagnostics',async()=>{const file=(path,text='0 0\n1 1')=>({name:path.split('/').at(-1),webkitRelativePath:path,text:async()=>text,size:text.length,lastModified:1}),files=[];for(const [chain,run,pressure] of [['C2','1',100],['C2','2',200],['C10','1',300],['C10','2',400]]){files.push(file(`root/${chain}/${run}/simulation.input`,`ExternalPressure ${pressure}\n`));files.push(file(`root/${chain}/${run}/EndToEndDistanceHistograms/System_0/Histogram_${chain}_0_Density_${pressure}.dat`));}files.push(file('root/C2/1/EndToEndDistanceHistograms/System_0/Histogram_C2_1_Density_999.dat'));const catalog=await buildChainCatalog(files,{datasetId:'fixture'}),histograms=catalog.results.filter(x=>x.type==='end_to_end');assert.equal(histograms.length,5);assert.deepEqual(histograms.filter(x=>x.component==='C10').map(x=>x.pressurePa),[300,400]);const conflict=histograms.find(x=>x.filenamePressurePa===999);assert.equal(conflict.pressurePa,100);assert.equal(conflict.pressureSource,'simulation.input');assert.equal(conflict.pressureConsistent,false);assert.ok(catalog.diagnostics.some(x=>x.code==='filename_pressure_mismatch'))});

test('end-to-end exports reproduce displayed records and complete pressure provenance',()=>{const curve={visible:true,datasetId:'fixture',family:'PFA',component:'C10',chainLength:10,run:'7',pressurePa:126896,pressureSource:'simulation.input',filenamePressurePa:126000,pressureConsistent:false,pressureMismatchAbsolutePa:896,pressureMismatchRelative:896/126896,type:'end_to_end',sourcePath:'C10/7/Histogram_C10_0_Density_126000.dat',normalizationMode:'probability',records:[{distanceA:1.25,probabilityDensityPerA:.42}]};const row=plottedExport([curve],{}).data[0];assert.equal(row.dataset,'fixture');assert.equal(row.pressure_pa,126896);assert.equal(row.filename_pressure_pa,126000);assert.equal(row.distance_a,1.25);assert.equal(row.value,.42);assert.equal(row.normalization,'probability')});

test('a malformed selected histogram does not prevent another chain from parsing',async()=>{const good=parseEndToEndHistogram('0 0\n1 1','good');assert.equal(good.records.length,2);assert.throws(()=>parseEndToEndHistogram('RASPA unfinished output','bad'),error=>error.code==='unsupported_layout');const selectable=[{component:'C2',status:'failed'},{component:'C3',status:'ready',records:good.records}];assert.deepEqual(selectable.map(x=>x.component),['C2','C3']);assert.equal(selectable[1].records.length,2)});
