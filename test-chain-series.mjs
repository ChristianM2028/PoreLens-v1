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
