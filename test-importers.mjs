import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseManifest, parseRdf, resolvePairName, interpolateRdf, importBrowserFiles } from './importers.mjs';
import { samplingQuality, shellMetrics, coordinationNumber } from './analysis.mjs';

const fixture = path => readFile(new URL(path, import.meta.url), 'utf8');
test('manifest validates schema, preserves run string, and derives bar from canonical Pa', async () => {
  const result=parseManifest(await fixture('./test/fixtures/collection/manifest.csv'));
  assert.equal(result.rows[0].run,'1_otherstuff'); assert.equal(result.rows[0].pressure_bar,23299.51811/100000);
});
test('manifest detects duplicate keys', async()=>{const text=await fixture('./test/fixtures/collection/manifest.csv');const row=text.trim().split('\n')[1];assert.match(parseManifest(`${text}${row}\n`).diagnostics[0].message,/Duplicate/)});
test('RDF retains finite noninteger histogram values and high g(r)', async()=>{const rdf=parseRdf(await fixture('./test/fixtures/collection/rdfs/RDF_CF3_sp3_O2.dat'));assert.equal(rdf.records[2].gR,18.5);assert.equal(rdf.records[2].unnormalizedDistanceHistogram,.125);assert.equal(rdf.histogramLabel,'unnormalized distance histogram')});
test('malformed RDF is rejected with actionable diagnostics',async()=>{const text=await fixture('./test/fixtures/malformed-rdf.dat');assert.throws(()=>parseRdf(text),error=>error.diagnostics.length>=2)});
test('pair resolution preserves pseudoatom underscores and numbered site',()=>assert.deepEqual(resolvePairName('RDF_CF3_sp3_O2.dat',['CF3_sp3','CF2_sp3','O2','O1']),['CF3_sp3','O2']));
test('interpolation is linear and does not extrapolate',()=>{const rows=[{distanceA:0,gR:0,unnormalizedDistanceHistogram:0},{distanceA:2,gR:4,unnormalizedDistanceHistogram:2}];const out=interpolateRdf(rows,[-1,1,3]);assert.equal(out[0],null);assert.equal(out[1].gR,2);assert.equal(out[2],null)});
test('sampling heuristic retains raw peak while flagging low weight',()=>{const records=[{gR:100,unnormalizedDistanceHistogram:.01}];const q=samplingQuality(records,{absoluteFloor:1});assert.equal(records[0].gR,100);assert.equal(q.valid,false);assert.match(q.reasons[0],/absolute floor/)});
test('shell metrics integrate known triangular excess',()=>{const m=shellMetrics([{distanceA:0,gR:1},{distanceA:1,gR:2},{distanceA:2,gR:1}],0,2);assert.equal(m.excessArea,1);assert.equal(m.excessWeightedCentroidA,1)});
test('coordination number uses supplied target density',()=>{const cn=coordinationNumber([{distanceA:0,gR:1},{distanceA:1,gR:1}],1,1);assert.ok(Math.abs(cn-2*Math.PI)<1e-12)});
test('partial browser collection remains browsable when one target is missing',async()=>{const manifest=await fixture('./test/fixtures/collection/manifest.csv');const rdf=await fixture('./test/fixtures/collection/rdfs/RDF_CF3_sp3_O2.dat');const extra=manifest+manifest.trim().split('\n')[1].replace('RDF_CF3_sp3_O2.dat','RDF_missing.dat').replace('rdfs/RDF_CF3_sp3_O2.dat','rdfs/RDF_missing.dat')+'\n';const result=await importBrowserFiles([{name:'manifest.csv',text:async()=>extra},{name:'RDF_CF3_sp3_O2.dat',webkitRelativePath:'rdfs/RDF_CF3_sp3_O2.dat',text:async()=>rdf}]);assert.equal(result.datasets.length,1);assert.ok(result.diagnostics.some(item=>/Missing manifest target/.test(item.message)))});
