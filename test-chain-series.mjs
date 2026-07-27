import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverChains, discoverPairs, filterPairs, matchRuns, parseEndToEndHistogram, plottedExport, exportCsv, buildChainCatalog } from './chain-series.mjs';

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
  const {buildIsothermCurves,availableLoadingUnits}=await import('./chain-series.mjs');
  const point=(run,pressure,loading)=>({entry:{datasetId:'alkane',component:'C2',chainLength:2,run:String(run),path:`C2/${run}/Output/System_0/output.data`,pressurePa:pressure,temperatureK:300,framework:'MOF'},parsed:{pressurePa:pressure,temperatureK:300,component:'C2',loadings:{absolute:{'molecules/unit cell':{value:loading,uncertainty:.1}},excess:{}}}});
  const inputs=[point(2,200,2),point(1,100,1)];assert.deepEqual(availableLoadingUnits(inputs),['molecules/unit cell']);const built=buildIsothermCurves(inputs,{unit:'molecules/unit cell'});assert.deepEqual(built.curves[0].records.map(x=>x.pressurePa),[100,200]);assert.equal(built.curves[0].records[0].uncertainty,.1);assert.match(built.curves[0].records[0].sourcePath,/Output/);
});

test('catalogs output_ data files as RASPA outputs',async()=>{const file=(path,text='x')=>({name:path.split('/').at(-1),webkitRelativePath:path,text:async()=>text,size:text.length,lastModified:1});const sim='ExternalTemperature 300\nExternalPressure 100\n';const catalog=await buildChainCatalog([file('root/C1/1/simulation.input',sim),file('root/C1/1/Output/System_0/output_MOF_300_100.data','External temperature: 300 [K]\nExternal Pressure: 100 [Pa]\n')]);assert.equal(catalog.results[0].type,'raspa_output');});

test('valid six-line final loading block remains plottable beside malformed output',async()=>{
  const {readFile}=await import('node:fs/promises');
  const {parseRaspaOutput}=await import('./raspa-package.mjs');
  const {buildIsothermCurves,availableLoadingUnits}=await import('./chain-series.mjs');
  const fixture=name=>readFile(new URL(`./test/fixtures/raspa-output/${name}`,import.meta.url),'utf8');
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
