import test from 'node:test';
import assert from 'node:assert/strict';
import {parseIsothermSummary,logPlottableRecords,SUMMARY_LOADING_UNIT} from './isotherm-summary.mjs';
import {DirectoryCatalogScanner} from './directory-catalog.mjs';

test('parses comments, blanks, scientific notation and preserves source lines',()=>{const p=parseIsothermSummary('# header\n\n2e5 2.5e0 1e-2\n1e5 1.5 .2',{source:'C1/final_abs_pressure_up',xKind:'pressure'});assert.deepEqual(p.records.map(x=>x.x),[1e5,2e5]);assert.equal(p.records[1].lineNumber,3);assert.equal(p.loadingUnit,SUMMARY_LOADING_UNIT)});
test('rejects malformed, missing-uncertainty, and nonfinite rows individually',()=>{const p=parseIsothermSummary('1 2 0.1\n2 3\n3 nope .2\n4 5 .3');assert.deepEqual(p.records.map(x=>x.x),[1,4]);assert.equal(p.diagnostics.length,2)});
test('sorts unsorted values and reports duplicates',()=>{const p=parseIsothermSummary('3 1 .1\n1 2 .2\n1 3 .3');assert.deepEqual(p.records.map(x=>x.x),[1,1,3]);assert.deepEqual(p.duplicateX,[1])});
test('pressure and fugacity remain distinct',()=>{const pressure=parseIsothermSummary('1 2 .1',{xKind:'pressure'}),fugacity=parseIsothermSummary('1 2 .1',{xKind:'fugacity'});assert.equal(pressure.records[0].xKind,'pressure');assert.equal(fugacity.records[0].xKind,'fugacity')});
test('log plotting excludes nonpositive x with warning',()=>{const p=parseIsothermSummary('0 1 .1\n-1 2 .1\n2 3 .1'),v=logPlottableRecords(p.records);assert.deepEqual(v.included.map(x=>x.x),[2]);assert.match(v.warning,/2 nonpositive/)});

const file=(name,text,reads)=>({kind:'file',name,async getFile(){return {name,size:text.length,lastModified:1,async text(){reads.push(name);return text}}}}),dir=(name,children,opens)=>({kind:'directory',name,async *entries(){opens.push(name);for(const x of children)yield[x.name,x]}});
test('C1-C10 catalog indexes numbered runs without reading output bytes and handles missing summary types',async()=>{const reads=[],opens=[],chains=Array.from({length:10},(_,i)=>dir(`C${i+1}`,[file('final_abs_pressure_up','1 2 .1',reads),dir('1',[dir('Output',[dir('System_0',[file('output_x.data','large',reads)])],opens)],opens)],opens));const catalog=await new DirectoryCatalogScanner(dir('root',chains,opens)).scan();assert.equal(catalog.summaries.length,10);assert.equal(catalog.summaries.every(x=>x.xKind==='pressure'),true);assert.deepEqual(reads,[]);assert.equal(catalog.runs.length,10);assert.equal(opens.includes('1'),true);assert.equal(opens.includes('Output'),true)});
