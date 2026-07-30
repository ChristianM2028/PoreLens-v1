import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const cases=JSON.parse(await readFile(new URL('./fixtures/isotherm/comparison-pressure-cases.json',import.meta.url),'utf8'));
const uiUrl=new URL('../src/ui/chain-plotter-ui.mjs',import.meta.url),uiSource=await readFile(uiUrl,'utf8'),pureSource=uiSource.slice(0,uiSource.indexOf('\nconst $')).replace(/from '([^']+?)(?:\?[^']*)?'/g,(_,relative)=>`from '${new URL(relative,uiUrl).href}'`),{isothermPressureEvidence,createIsothermPlotController}=await import(`data:text/javascript;base64,${Buffer.from(pureSource).toString('base64')}`);
const curves=value=>Object.entries(value).map(([datasetId,points])=>({datasetId,component:'C10',records:points.map(([run,pressurePa],index)=>({run,pressurePa,loading:index+1,uncertainty:.1}))}));

test('fixture-backed A/B capability requires two distinct positive pressures in every curve',()=>{
  for(const name of ['one_each','one_vs_several','duplicate_pressure_runs'])assert.equal(isothermPressureEvidence(curves(cases[name])).every(item=>item.valid),false,name);
  const duplicate=isothermPressureEvidence(curves(cases.duplicate_pressure_runs));
  assert.deepEqual(duplicate.map(item=>item.pressures.length),[1,1]);
  assert.equal(isothermPressureEvidence(curves(cases.valid_multi_pressure)).every(item=>item.valid),true);
});

test('single loading-point view pads its domain and never repeats formatted axis labels',()=>{
  const labels=[],context=new Proxy({fillText(label){labels.push(String(label))},measureText(){return {width:10}}},{get(target,key){if(key in target)return target[key];if(['beginPath','moveTo','lineTo','stroke','fill','arc','rect','closePath','clearRect','fillRect'].includes(key))return ()=>{};return target[key]},set(target,key,value){target[key]=value;return true}}),canvas={width:1200,height:420,getContext:()=>context};
  createIsothermPlotController(canvas).render(curves(cases.one_each).slice(0,1),{pressureScale:'linear',pressureUnit:'Pa',showLines:false});
  assert.ok(canvas._isothermDomain.xmax>canvas._isothermDomain.xmin);
  assert.equal(new Set(canvas._isothermTicks).size,canvas._isothermTicks.length);
});

test('comparison runtime calls an overlay only after its fixture-backed capability check',async()=>{
  const source=await readFile(new URL('../src/ui/app.js',import.meta.url),'utf8'),body=source.slice(source.indexOf('async function renderComparisonIsotherms'),source.indexOf('async function renderComparisonHistograms'));
  assert.match(body,/isothermPressureEvidence\(built\.curves\)/);
  assert.match(body,/A\/B isotherm overlay disabled/);
  assert.match(body,/A\/B isotherm curves \(\$\{pointCount\} loading points\) are overlaid/);
  assert.match(body,/runs \$\{item\.runs/);
});
