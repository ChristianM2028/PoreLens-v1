import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseManifest, parseRdf, resolvePairName, interpolateRdf, importBrowserFiles } from '../src/import/importers.mjs';
import { samplingQuality, assessSamplingSeries, pressureSensitivity, findPeaks, trackPeak, shellMetrics, coordinationNumber } from '../src/core/analysis.mjs';
import { parseSimulationInput, parsePdbMovie, minimumImageDistance, contactsInBand } from '../src/core/trajectory.mjs';

const fixture = path => readFile(new URL(path, import.meta.url), 'utf8');
test('manifest validates schema, preserves run string, and derives bar from canonical Pa', async () => {
  const result=parseManifest(await fixture('./fixtures/collection/manifest.csv'));
  assert.equal(result.rows[0].run,'1_otherstuff'); assert.equal(result.rows[0].pressure_bar,23299.51811/100000);
});
test('manifest detects duplicate keys', async()=>{const text=await fixture('./fixtures/collection/manifest.csv');const row=text.trim().split('\n')[1];assert.match(parseManifest(`${text}${row}\n`).diagnostics[0].message,/Duplicate/)});
test('RDF retains finite noninteger histogram values and high g(r)', async()=>{const rdf=parseRdf(await fixture('./fixtures/collection/rdfs/RDF_CF3_sp3_O2.dat'));assert.equal(rdf.records[2].gR,18.5);assert.equal(rdf.records[2].unnormalizedDistanceHistogram,.125);assert.equal(rdf.histogramLabel,'unnormalized distance histogram')});
test('malformed RDF is rejected with actionable diagnostics',async()=>{const text=await fixture('./fixtures/malformed-rdf.dat');assert.throws(()=>parseRdf(text),error=>error.diagnostics.length>=2)});
test('pair resolution preserves pseudoatom underscores and numbered site',()=>assert.deepEqual(resolvePairName('RDF_CF3_sp3_O2.dat',['CF3_sp3','CF2_sp3','O2','O1']),['CF3_sp3','O2']));
test('interpolation is linear and does not extrapolate',()=>{const rows=[{distanceA:0,gR:0,unnormalizedDistanceHistogram:0},{distanceA:2,gR:4,unnormalizedDistanceHistogram:2}];const out=interpolateRdf(rows,[-1,1,3]);assert.equal(out[0],null);assert.equal(out[1].gR,2);assert.equal(out[2],null)});
test('sampling heuristic retains raw peak while flagging low weight',()=>{const records=[{gR:100,unnormalizedDistanceHistogram:.01}];const q=samplingQuality(records,{absoluteFloor:1});assert.equal(records[0].gR,100);assert.equal(q.valid,false);assert.match(q.reasons[0],/absolute floor/)});
test('shell metrics integrate known triangular excess',()=>{const m=shellMetrics([{distanceA:0,gR:1},{distanceA:1,gR:2},{distanceA:2,gR:1}],0,2);assert.equal(m.excessArea,1);assert.equal(m.excessWeightedCentroidA,1)});
test('coordination number uses supplied target density',()=>{const cn=coordinationNumber([{distanceA:0,gR:1},{distanceA:1,gR:1}],1,1);assert.ok(Math.abs(cn-2*Math.PI)<1e-12)});
test('partial browser collection remains browsable when one target is missing',async()=>{const manifest=await fixture('./fixtures/collection/manifest.csv');const rdf=await fixture('./fixtures/collection/rdfs/RDF_CF3_sp3_O2.dat');const extra=manifest+manifest.trim().split('\n')[1].replace('RDF_CF3_sp3_O2.dat','RDF_missing.dat').replace('rdfs/RDF_CF3_sp3_O2.dat','rdfs/RDF_missing.dat')+'\n';const result=await importBrowserFiles([{name:'manifest.csv',text:async()=>extra},{name:'RDF_CF3_sp3_O2.dat',webkitRelativePath:'rdfs/RDF_CF3_sp3_O2.dat',text:async()=>rdf}]);assert.equal(result.datasets.length,1);assert.ok(result.diagnostics.some(item=>/Missing manifest target/.test(item.message)))});

test('centered pressure regression returns analytic slope and missing edges',()=>{const pressures=[1,10,100,1000,10000],matrix=pressures.map(p=>[2*Math.log10(p)+3]);const result=pressureSensitivity(pressures,matrix,3);assert.equal(result[0][0],null);assert.equal(result[2][0],2);assert.equal(result[4][0],null)});
test('pair sampling thresholds and early jump are explicit',()=>{const row=w=>[{unnormalizedDistanceHistogram:w}];const q=assessSamplingSeries([row(.01),row(10),row(20)],{fractionOfMaximum:.1,earlyJumpLog10:2});assert.equal(q[0].valid,false);assert.ok(q[0].reasons.some(reason=>/jumps/.test(reason)))});
test('peak tracking leaves a gap instead of switching to a distant shoulder',()=>{const row=positions=>positions.map(positionA=>({positionA,height:2,prominence:1}));assert.deepEqual(trackPeak([row([2]),row([2.1]),row([5])],.3).map(p=>p?.positionA??null),[2,2.1,null]);const peaks=findPeaks([{distanceA:1,gR:1},{distanceA:2,gR:4},{distanceA:3,gR:1}],1,3,2);assert.equal(peaks[0].positionA,2)});
test('representative simulation settings are preserved rather than normalized',async()=>{const input=parseSimulationInput(await fixture('./fixtures/representative_run/simulation.input'));assert.deepEqual({cycles:input.settings.productionCycles,initialization:input.settings.initializationCycles,pressure:input.pressurePa,cutoff:input.settings.cutoffA,component:input.components[0].name},{cycles:100000,initialization:50000,pressure:23299.51811,cutoff:12.9,component:'C10'})});
test('representative lossy PDB reconstructs molecules only with explicit topology',async()=>{const movie=parsePdbMovie(await fixture('./fixtures/representative_run/Movie_IRMOF-1_1.1.1_300.000000_23299.518110_allcomponents.pdb'),{sitesPerMolecule:10,siteTypes:['CF3_sp3',...Array(8).fill('CF2_sp3'),'CF3_sp3']});assert.equal(movie.frames.length,1000);assert.equal(movie.lossyAtomLabels,true);assert.equal(movie.roleSpecificAnalysisEnabled,true);assert.ok([25,26].includes(movie.frames[0].atoms.length/10));assert.equal(movie.frames[0].atoms[9].siteType,'CF3_sp3');assert.ok(movie.frames.some(frame=>frame.atoms.some(atom=>atom.x<0||atom.x>frame.cell[0]))) });
test('minimum-image distances and contact bands handle out-of-cell coordinates',()=>{const a={x:26,y:0,z:0},b={x:1,y:0,z:0},cell=[25.832,25.832,25.832];assert.ok(Math.abs(minimumImageDistance(a,b,cell)-.832)<1e-12);assert.equal(contactsInBand([a],[b],cell,.8,.9).length,1)});

test('validates referenced PFA topology, pseudoatoms, bonds, and changing complete blocks',async()=>{
  const {validateMovieTopology}=await import('../src/core/trajectory.mjs');
  const {parseMoleculeDefinition,parsePseudoAtoms}=await import('../src/core/raspa-physics.mjs');
  const simulation=parseSimulationInput('Component 0 MoleculeName C10_PFA\n MoleculeDefinition local');
  const atoms=['CF3_sp3',...Array(8).fill('CF2_sp3'),'CF3_sp3'];
  const definition=`# Number Of Atoms\n10\n# atomic positions\n${atoms.map((x,i)=>`${i} ${x}`).join('\n')}\n# Bond stretch: atom n1-n2, type, parameters\n${Array.from({length:9},(_,i)=>`${i} ${i+1} FIXED_BOND 1.5`).join('\n')}\n# end`;
  const pseudo=parsePseudoAtoms('CF3_sp3 yes C C 0 69 0 0\nCF2_sp3 yes C C 0 50 0 0');
  const result=validateMovieTopology({simulation,componentDefinitionName:'C10_PFA.def',topology:parseMoleculeDefinition(definition),pseudoatoms:pseudo,frameAtomCounts:[250,260]});
  assert.deepEqual(result.typeCounts,{CF3_sp3:2,CF2_sp3:8});assert.deepEqual(result.moleculeCounts,[25,26]);assert.equal(result.siteRoles[0],'terminal');assert.equal(result.siteRoles[5],'internal');
  assert.throws(()=>validateMovieTopology({simulation:{...simulation,components:[...simulation.components,{name:'other'}]},componentDefinitionName:'C10_PFA.def',topology:parseMoleculeDefinition(definition),pseudoatoms:pseudo,frameAtomCounts:[250]}),/ambiguous/);
  assert.throws(()=>validateMovieTopology({simulation,componentDefinitionName:'wrong.def',topology:parseMoleculeDefinition(definition),pseudoatoms:pseudo,frameAtomCounts:[250]}),/referenced/);
  assert.throws(()=>validateMovieTopology({simulation,componentDefinitionName:'C10_PFA.def',topology:parseMoleculeDefinition(definition),pseudoatoms:pseudo,frameAtomCounts:[251]}),/whole contiguous/);
});
