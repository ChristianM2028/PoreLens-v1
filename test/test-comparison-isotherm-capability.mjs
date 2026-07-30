import test from 'node:test';
import assert from 'node:assert/strict';
import {buildSummaryIsothermCurves,plottedExport,exportCsv} from '../src/core/chain-series.mjs';
import {parseIsothermSummary} from '../src/core/isotherm-summary.mjs';

const file=(datasetId,component,xKind,text)=>({entry:{datasetId,component,chainLength:Number(component.slice(1)),xKind,path:`${datasetId}/${component}/final_abs_${xKind}_up.data`,filename:`final_abs_${xKind}_up.data`},parsed:parseIsothermSummary(text,{xKind,source:`${datasetId}/${component}/final_abs_${xKind}_up.data`})});
const pressure='1 0.1 0.01\n10 0.4 0.02\n';
const fugacity='2 0.2 0.01\n20 0.5 0.03\n';

test('standalone selections support A-only, B-only, and A+B with identical chain names',()=>{
  const inputs=[file('A','C10','pressure',pressure),file('B','C10','pressure',pressure)];
  for(const datasets of [['A'],['B'],['A','B']]){const built=buildSummaryIsothermCurves(inputs.filter(x=>datasets.includes(x.entry.datasetId)),{xKind:'pressure'});assert.deepEqual(new Set(built.curves.map(x=>x.datasetId)),new Set(datasets));assert.ok(built.curves.every(x=>x.component==='C10'))}
});

test('standalone builder never substitutes pressure and fugacity and retains actionable parse diagnostics',()=>{
  const pressureBuilt=buildSummaryIsothermCurves([file('A','C8','pressure',pressure),file('B','C8','fugacity',fugacity)],{xKind:'pressure'});
  assert.deepEqual(pressureBuilt.curves.map(x=>x.datasetId),['A']);
  assert.ok(pressureBuilt.curves.every(x=>x.xKind==='pressure'));
  const malformed=file('B','C8','pressure','1 0.1\n');
  assert.ok(malformed.parsed.diagnostics.length);
});

test('standalone persisted selection and exports preserve A/B styling and provenance',()=>{
  const built=buildSummaryIsothermCurves([file('A','C10','pressure',pressure),file('B','C10','pressure',pressure)],{xKind:'pressure'});
  const configuration={datasets:['A','B'],datasetStyles:{A:{stroke:'solid'},B:{stroke:'dashed'}},xKind:'pressure',pressureScale:'log',pressureDisplayUnit:'bar',loadingKind:'absolute',loadingUnit:'mol/kg framework',errorBars:true};
  const output=plottedExport(built.curves,configuration),csv=exportCsv(output),persisted=JSON.parse(JSON.stringify(output.configuration));
  assert.deepEqual(persisted.datasets,['A','B']);assert.equal(persisted.datasetStyles.B.stroke,'dashed');
  assert.deepEqual(new Set(output.data.map(x=>x.dataset)),new Set(['A','B']));
  assert.ok(output.data.every(x=>x.source_file&&Number.isFinite(x.uncertainty)&&x.loading_unit==='mol/kg framework'&&x.x_kind==='pressure'));
  assert.match(csv,/source_file/);assert.match(csv,/A\/C10/);assert.match(csv,/B\/C10/);
});

test('live isotherm preparation preserves canonical pressure, converts units, and filters invalid log points',async()=>{const {prepareIsothermSeries}=await import('../src/core/isotherm-summary.mjs');const [curve]=prepareIsothermSeries([{datasetId:'A',visible:true,records:[{pressurePa:100000,x:7,loading:1},{pressurePa:0,x:0,loading:2}]}],{pressureUnit:'bar',pressureScale:'log'});assert.equal(curve.records.length,1);assert.equal(curve.records[0].canonicalPa,100000);assert.equal(curve.records[0].displayPressure,1);assert.equal(curve.records[0].plotX,0)});
