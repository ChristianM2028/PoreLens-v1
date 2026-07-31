import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';import {parseGemcOutput,pairGemcBoxes,aggregateGemcReplicates,criticalWorkflow} from '../src/core/gemc.mjs';import {parseHenryOutput,convertHenry,deduplicateHenry} from '../src/core/henry.mjs';import {IndependentWorkspaceStores} from '../src/core/independent-workspaces.mjs';
const gemc='test/fixtures/representative_run_GEMC/GEMC_ALK/C6/5_439.000/Output';
test('representative GEMC pair selects final complete cycles and classifies by density',async()=>{const boxes=[];for(const system of [0,1]){const file=`${gemc}/System_${system}/output_Box_1.1.1_439.000000_0.data`;const parsed=parseGemcOutput(await readFile(file,'utf8'),{sourcePath:file,system});parsed.runKey='C6/5_439.000';boxes.push(parsed)}const {records,diagnostics}=pairGemcBoxes(boxes);assert.equal(diagnostics.length,0);assert.equal(records.length,1);const r=records[0];assert.equal(r.temperatureK,439);assert.ok(r.vaporDensityKgM3<r.liquidDensityKgM3);assert.deepEqual(new Set([r.vaporSystem,r.liquidSystem]),new Set([0,1]));assert.equal(r.vaporCycle,14900);assert.equal(r.liquidCycle,14900);assert.ok(Number.isFinite(r.coexistencePressureKPa));assert.ok(r.vaporSourcePath.includes(`System_${r.vaporSystem}`))});
test('GEMC supports stress fallback, reversed boxes, partial pairing, replicates and fit skip',()=>{const base=`External temperature: 300 [K]\nCurrent cycle: 10 out of 20\nCurrent Stress: 0.3 0.6 0.9 [MPa]\nComponent 0 (X), density: 500 kg/m^3]`;const high=parseGemcOutput(base,{system:0}),low=parseGemcOutput(base.replace('500','5'),{system:1});high.runKey=low.runKey='r';const paired=pairGemcBoxes([high,low]);assert.equal(paired.records[0].vaporSystem,1);assert.ok(Math.abs(paired.records[0].vaporPressureKPa-600)<1e-9);assert.equal(pairGemcBoxes([high]).records.length,0);assert.equal(aggregateGemcReplicates([...paired.records,{...paired.records[0]}])[0].replicates,2);assert.equal(criticalWorkflow(aggregateGemcReplicates(paired.records)).status,'skipped')});
test('representative Henry final summary preserves values, uncertainty and units',async()=>{const file='test/fixtures/representative_run_Henry/IRMOF-1_alkanes_henry/alkanes/C10/Output/System_0/output_IRMOF-1_1.1.1_298.000000_0.data';const r=parseHenryOutput(await readFile(file,'utf8'),{sourcePath:file});assert.equal(r.component,'C10');assert.equal(r.temperatureK,298);assert.equal(r.henryCoefficient,0.73172);assert.equal(r.henryUncertainty,0.0104757);assert.equal(r.henryUnit,'mol/kg/Pa');assert.equal(r.adsorptionEnergyKJMol,-25.2689825949);assert.equal(r.adsorptionEnergyUncertaintyKJMol,0.0858609899);assert.equal(r.complete,true)});
test('Henry scientific notation, optional energy, conversion, malformed and duplicates',()=>{const text=`ExternalTemperature 3.00E2\n[X] Average Henry coefficient: 1.2E-3 +/- 2E-5 [mol/kg/kPa]\nSimulation finished, 1 warnings`;const r=parseHenryOutput(text);assert.equal(r.henryCoefficient,1.2e-3);assert.equal(r.adsorptionEnergyKJMol,null);assert.equal(convertHenry(r.henryCoefficient,r.henryUnit,'mol/kg/Pa'),1.2e-6);assert.equal(parseHenryOutput('[X] Average Henry coefficient: nope').status,'rejected');assert.equal(deduplicateHenry([r,{...r,sourcePath:'later'}]).records[0].sourcePath,'later')});
test('GCMC, GEMC and Henry stores are isolated and selections survive replacement elsewhere',()=>{const stores=new IndependentWorkspaceStores();stores.replace('gcmc',{records:[{id:'g'}],selection:{component:'C5'}});stores.replace('gemc',{records:[{id:'vle'}],selection:{temperatureK:300}});stores.replace('henry',{records:[{id:'kh'}],selection:{component:'C10'}});stores.reset('gemc');assert.deepEqual(stores.gcmc.records,[{id:'g'}]);assert.equal(stores.gcmc.selection.component,'C5');assert.deepEqual(stores.henry.records,[{id:'kh'}]);assert.equal(stores.henry.selection.component,'C10');assert.equal(stores.gemc.status,'empty')});

test('critical workflow recovers exact rectilinear-diameter fixed-beta coexistence data',()=>{
 const beta=.326,tc=500,rhoc=220,slope=.15,amplitude=45;
 const points=[430,440,450,460,470,480].map(temperatureK=>{const diameter=rhoc+slope*(temperatureK-tc),gap=amplitude*(tc-temperatureK)**beta;return {temperatureK,vaporDensityKgM3:diameter-gap,liquidDensityKgM3:diameter+gap}});
 const result=criticalWorkflow(points,{fitPointCount:5,beta});
 assert.equal(result.status,'available');assert.ok(Math.abs(result.critical.temperatureK-tc)<.02);assert.ok(Math.abs(result.critical.densityKgM3-rhoc)<.02);assert.equal(result.provenance.highestTemperaturePointCount,5);assert.equal(result.provenance.fixedBeta,beta);assert.equal(result.fitted.length,5);
});
test('critical workflow rejects insufficient and invalid inputs',()=>{assert.equal(criticalWorkflow([]).status,'skipped');assert.match(criticalWorkflow([{temperatureK:1,vaporDensityKgM3:2,liquidDensityKgM3:1}],{beta:-1}).reason,/positive/);assert.match(criticalWorkflow([],{fitPointCount:2}).reason,/at least three/)});
test('critical workflow prohibits pooled framework/component analysis',()=>{const points=[300,310,320].flatMap((temperatureK,i)=>['C4','C5'].map(component=>({framework:'F',component,temperatureK,vaporDensityKgM3:10+i,liquidDensityKgM3:100-i})));const result=criticalWorkflow(points);assert.equal(result.status,'skipped');assert.match(result.reason,/pooled multi-fluid analysis is prohibited/);assert.deepEqual(result.groups,['F | C4','F | C5'])});
test('Henry parser supports summary whitespace, unicode uncertainty, and final-block derivation',()=>{
 const formatted=`External temperature: 310\nFramework name: F\n[C7] Average Henry constant  : 2.0E-4 ± 1.0E-5 [ mol / kg / kPa ]\n[C7] Average adsorption energy <U_gh>_1 - <U_h>_0: -1200 ± 20 [K] (-9.977355 ± 0.166289 kJ/mol)\nSimulation finished, 0 warnings`;
 const parsed=parseHenryOutput(formatted);assert.equal(parsed.henryUnit,'mol/kg/kPa');assert.equal(parsed.adsorptionEnergySource,'final_summary');
 const blocks=`ExternalTemperature 300\nAverage Henry coefficient:\n[C4] Average Henry coefficient: 1 +/- .1 [mol/kg/Pa]\nAverage adsorption energy <U_gh>_1-<U_h>_0 obtained from Widom-insertion:\nBlock[0] -1000 [K]\nBlock[1] -1100 [K]\nBlock[2] -900 [K]\nSimulation finished, 0 warnings`;
 const derived=parseHenryOutput(blocks);assert.equal(derived.adsorptionEnergySource,'derived_final_blocks');assert.equal(derived.adsorptionEnergyK,-1000);assert.ok(Math.abs(derived.adsorptionEnergyUncertaintyK-57.735)<.01);assert.ok(derived.diagnostics.some(d=>d.code==='adsorption_energy_derived_from_final_blocks'));
});

test('Clausius–Clapeyron analysis separates groups and retains invalid raw observations',async()=>{
 const {clausiusClapeyronGroups}=await import('../src/core/gemc.mjs');
 const base={framework:'IRMOF-1',temperatureK:300,vaporPressureKPa:1,liquidPressureKPa:3,coexistencePressureKPa:2};
 const records=[{...base,component:'C4',runKey:'ok'},{...base,component:'C5',runKey:'zero',coexistencePressureKPa:0},{...base,component:'C5',runKey:'negative',coexistencePressureKPa:-1},{...base,component:'C5',runKey:'missing',coexistencePressureKPa:null},{...base,component:'C5',runKey:'nonfinite',coexistencePressureKPa:Infinity}];
 const groups=clausiusClapeyronGroups(records,{referencePressureKPa:1});
 assert.equal(groups.length,2);assert.deepEqual(groups.map(g=>g.component),['C4','C5']);assert.equal(groups[0].eligiblePoints.length,1);assert.equal(groups[1].excludedPoints.length,4);assert.equal(groups[1].records,undefined);assert.equal(groups[1].excludedPoints[0].record,records[1]);assert.match(groups[1].excludedPoints.flatMap(x=>x.reasons).join(' '),/greater than 0|missing|finite/);assert.equal(groups[0].pressureDefinition,'arithmetic mean of the paired vapor-box and liquid-box pressures');assert.deepEqual(groups[0].temperatureIntervalK,[300,300]);assert.equal(groups[0].eligiblePoints[0].logReducedPressure,Math.log(2));
});

test('Clausius–Clapeyron regression is explicit, group-local, and fully reports its model provenance',async()=>{
 const {clausiusClapeyronGroups,clausiusClapeyronRegression}=await import('../src/core/gemc.mjs');const records=[300,320,340].map((temperatureK,i)=>({framework:'F',component:'C6',temperatureK,coexistencePressureKPa:Math.exp(5-1000/temperatureK),runKey:String(i)}));const group=clausiusClapeyronGroups(records)[0];const fit=clausiusClapeyronRegression(group);assert.equal(fit.status,'available');assert.ok(Math.abs(fit.slope.value+1000)<1e-8);assert.ok(Math.abs(fit.intercept.value-5)<1e-8);assert.equal(fit.provenance.group,'F | C6');assert.equal(fit.enthalpyEstimate.label,'Clausius–Clapeyron model estimate');assert.equal(clausiusClapeyronRegression({eligiblePoints:[]}).status,'skipped');
});

test('group critical workflow isolates fluids, aggregates replicates, and exactly recovers analytic estimates',async()=>{
 const {gemcCriticalParametersByGroup}=await import('../src/core/gemc.mjs');
 const beta=.325,tc=500,rhoc=220,aSlope=.15,intercept=5,slope=-1000;
 const analytic=(framework,component,temperatureK,runKey)=>{const diameter=rhoc+aSlope*(temperatureK-tc),gap=45*(tc-temperatureK)**beta,pressure=Math.exp(intercept+slope/temperatureK);return {framework,component,temperatureK,runKey,vaporDensityKgM3:diameter-gap,liquidDensityKgM3:diameter+gap,coexistencePressureKPa:pressure,vaporSourcePath:`${runKey}/v`,liquidSourcePath:`${runKey}/l`}};
 const c4=[430,440,450,460,470,480].flatMap((t,i)=>[analytic('F1','C4',t,`a${i}`),analytic('F1','C4',t,`b${i}`)]),incomplete=[analytic('F2','C5',450,'only')];
 c4[1].coexistencePressureKPa=null;
 const results=gemcCriticalParametersByGroup([...c4,...incomplete],{fitPointCount:6,beta});
 assert.equal(results.length,2);const fit=results.find(x=>x.component==='C4'),skip=results.find(x=>x.component==='C5');
 assert.equal(fit.replicateAggregates[0].replicateCount,2);assert.equal(fit.replicateAggregates[0].pressureReplicateCount,1);assert.equal(fit.replicateAggregates[0].sourceRuns.length,2);
 assert.ok(Math.abs(fit.criticalTemperatureK-tc)<.02);assert.ok(Math.abs(fit.criticalDensityKgM3-rhoc)<.02);assert.ok(Math.abs(fit.criticalPressureKPa-Math.exp(intercept+slope/tc))<1e-5);
 assert.ok(Math.abs(fit.acentricFactor-(-Math.log10(fit.psatAt0_7TcKPa/fit.criticalPressureKPa)-1))<1e-12);assert.equal(fit.extrapolationFlags.psatAt0_7Tc,true);assert.match(fit.warnings.join(' '),/Prominent extrapolation warning/);
 assert.equal(skip.criticalPressureKPa,null);assert.match(skip.skipReasons.join(' '),/Density fit unavailable/);
});

test('group critical workflow retains Tc when pressure fit is unavailable and enforces pressure temperature rules',async()=>{
 const {gemcCriticalParametersByGroup}=await import('../src/core/gemc.mjs'),beta=.325,tc=400;
 const records=[330,350,370].map((temperatureK,i)=>{const d=180+.1*(temperatureK-tc),g=30*(tc-temperatureK)**beta;return {framework:'F',component:'X',temperatureK,runKey:String(i),vaporDensityKgM3:d-g,liquidDensityKgM3:d+g,coexistencePressureKPa:i?0:-1}});
 const result=gemcCriticalParametersByGroup(records,{fitPointCount:3,beta})[0];assert.ok(Number.isFinite(result.criticalTemperatureK));assert.ok(Number.isFinite(result.criticalDensityKgM3));assert.equal(result.criticalPressureKPa,null);assert.equal(result.acentricFactor,null);assert.match(result.skipReasons.join(' '),/Pressure fit unavailable/);
});

test('vapor-pressure fit matches trusted Python quadratic and linear branches',async()=>{
 const {fitVaporPressure}=await import('../src/core/gemc.mjs'),tc=500;
 const quadratic=[410,430,450,470].map(temperatureK=>({temperatureK,coexistencePressureKPa:Math.exp(2.5-1200/temperatureK+80000/temperatureK**2)}));
 const q=fitVaporPressure(quadratic,tc);assert.equal(q.degree,2);assert.ok(Math.abs(q.criticalPressureKPa-Math.exp(.42))<1e-12);assert.ok(Math.abs(q.coefficients[0]-80000)<1e-6);assert.ok(Math.abs(q.coefficients[1]+1200)<1e-8);assert.ok(Math.abs(q.coefficients[2]-2.5)<1e-11);assert.ok(q.rmseLogPressure<1e-14);assert.equal(q.residuals.length,4);
 const linear=[420,450,480].map(temperatureK=>({temperatureK,coexistencePressureKPa:Math.exp(5-1000/temperatureK)}));
 const l=fitVaporPressure(linear,tc);assert.equal(l.degree,1);assert.ok(Math.abs(l.criticalPressureKPa-Math.exp(3))<1e-12);assert.deepEqual(l.temperatureIntervalK,[420,480]);assert.ok(l.rmseLogPressure<1e-14);
});

test('Pc uses only pressures in the selected highest-temperature density window',async()=>{
 const {gemcCriticalParametersByGroup}=await import('../src/core/gemc.mjs'),beta=.325,tc=500;
 const make=(temperatureK,pressure)=>{const diameter=220+.15*(temperatureK-tc),gap=45*(tc-temperatureK)**beta;return {framework:'F',component:'C6',temperatureK,runKey:String(temperatureK),vaporDensityKgM3:diameter-gap,liquidDensityKgM3:diameter+gap,coexistencePressureKPa:pressure}};
 const high=[440,450,460,470,480].map(t=>make(t,Math.exp(4-900/t))),low=[390,400].map(t=>make(t,1e-9));
 const first=gemcCriticalParametersByGroup([...low,...high],{fitPointCount:5,beta})[0],changed=gemcCriticalParametersByGroup([...low.map(p=>({...p,coexistencePressureKPa:1e9})),...high],{fitPointCount:5,beta})[0];
 assert.equal(first.pressureFit.degree,2);assert.deepEqual(first.pressureFit.selectedPoints.map(p=>p.temperatureK),[440,450,460,470,480]);assert.equal(first.criticalPressureKPa,changed.criticalPressureKPa);assert.deepEqual(first.selectedTemperatureIntervals.pressureK,[440,480]);
});

test('reference-consistent alkane series naturally reproduces decreasing critical pressure',async()=>{
 const {gemcCriticalParametersByGroup}=await import('../src/core/gemc.mjs'),beta=.325;
 const fluids=[['C4',425,3800],['C5',470,3370],['C6',510,3030]],records=[];
 for(const [component,tc,pc] of fluids)for(const fraction of [.78,.82,.86,.9,.94]){const temperatureK=tc*fraction,diameter=220+.12*(temperatureK-tc),gap=40*(tc-temperatureK)**beta,logPressure=Math.log(pc)-1500*(1/temperatureK-1/tc);records.push({framework:'reference alkane series',component,temperatureK,runKey:String(fraction),vaporDensityKgM3:diameter-gap,liquidDensityKgM3:diameter+gap,coexistencePressureKPa:Math.exp(logPressure)})}
 const fitted=gemcCriticalParametersByGroup(records,{fitPointCount:5,beta}).sort((a,b)=>a.component.localeCompare(b.component,{numeric:true}));
 assert.ok(fitted.every(x=>x.pressureFit.degree===2));assert.ok(fitted[0].criticalPressureKPa>fitted[1].criticalPressureKPa&&fitted[1].criticalPressureKPa>fitted[2].criticalPressureKPa);assert.ok(Math.abs(fitted[2].criticalPressureKPa-3030)<1);
});

test('group-specific fit-point selections independently control each imported directory',async()=>{
 const {gemcCriticalParametersByGroup}=await import('../src/core/gemc.mjs'),beta=.325,records=[];
 for(const component of ['C4','C5'])for(const temperatureK of [430,440,450,460,470,480]){const tc=500,diameter=220+.1*(temperatureK-tc),gap=40*(tc-temperatureK)**beta;records.push({framework:'F',component,temperatureK,runKey:`${component}/${temperatureK}`,vaporDensityKgM3:diameter-gap,liquidDensityKgM3:diameter+gap,coexistencePressureKPa:Math.exp(4-900/temperatureK)})}
 const results=gemcCriticalParametersByGroup(records,{fitPointCountsByGroup:{'F | C4':3,'F | C5':5},beta});
 assert.equal(results.find(x=>x.component==='C4').fitPointCount,3);assert.equal(results.find(x=>x.component==='C4').densityFit.selected.length,3);assert.equal(results.find(x=>x.component==='C5').fitPointCount,5);assert.equal(results.find(x=>x.component==='C5').densityFit.selected.length,5);
});
