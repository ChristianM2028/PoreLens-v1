const FLOAT='[-+]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[Ee][-+]?\\d+)?';
const number=value=>{const n=Number(value);return Number.isFinite(n)?n:null};

export function parseGemcOutput(text,{sourcePath='',system=null,temperatureK=null}={}){
  const cycles=[...text.matchAll(new RegExp(`(?:^|\\n)\\s*(?:\\[[^\\]]+\\]\\s*)?Current\\s+cycle:\\s*(\\d+)\\s+out\\s+of\\s+(\\d+)`,'gi'))];
  const observations=[];
  for(let i=0;i<cycles.length;i++){
    const block=text.slice(cycles[i].index,cycles[i+1]?.index??text.length);
    const density=[...block.matchAll(new RegExp(`Component\\s+(\\d+)\\s+\\(([^)]+)\\)[^\\n]*?density:\\s*(${FLOAT})(?:\\s+\\(average\\s+(${FLOAT})\\))?\\s*(?:\\[?kg/m\\^3)?`,'gi'))].at(-1);
    if(!density)continue;
    const average=block.match(new RegExp(`Average\\s+pressure:\\s*(${FLOAT})\\s*\\[kPa\\]`,'i'));
    let pressure=number(average?.[1]),pressureSource=pressure===null?null:'average_pressure';
    if(pressure===null){const stress=block.match(new RegExp(`Current\\s+Stress:\\s*(${FLOAT})\\s+(${FLOAT})\\s+(${FLOAT})\\s*\\[MPa\\]`,'i'));if(stress){pressure=(number(stress[1])+number(stress[2])+number(stress[3]))*1000/3;pressureSource='instantaneous_stress_trace'}}
    observations.push({cycle:Number(cycles[i][1]),requestedCycles:Number(cycles[i][2]),densityKgM3:number(density[4]??density[3]),instantaneousDensityKgM3:number(density[3]),pressureKPa:pressure,pressureSource,componentIndex:Number(density[1]),component:density[2].trim()});
  }
  const temp=temperatureK??number(text.match(new RegExp(`(?:External\\s+temperature\\s*:|ExternalTemperature)\\s*(${FLOAT})`,'i'))?.[1]);
  const warnings=number(text.match(/Simulation finished,\s*(\d+)\s+warnings?/i)?.[1]);
  const final=observations.at(-1)??null;
  const framework=text.match(/Framework name\s*:\s*([^\n\r]+)/i)?.[1]?.trim()??text.match(/FrameworkName\s+(\S+)/i)?.[1]??null;
  return {sourcePath,system,framework,temperatureK:temp,observations,final,firstCycle:observations[0]?.cycle??null,complete:/Simulation finished/i.test(text),warnings,status:!final?'rejected':/Simulation finished/i.test(text)?(warnings?'warning':'complete'):'incomplete',diagnostics:final?[]:[{code:'no_complete_observation',severity:'error',message:'No cycle block contained a finite component density.'}]};
}

export function pairGemcBoxes(boxes){
  const diagnostics=[],groups=new Map();
  for(const box of boxes){const key=`${box.runKey??'.'}|${box.temperatureK}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(box)}
  const records=[];
  for(const [key,items] of groups){const bySystem=new Map();for(const item of items){if(bySystem.has(item.system))diagnostics.push({severity:'warning',code:'duplicate_box',message:`${key}: multiple outputs for System_${item.system}; latest complete observation was selected.`});const old=bySystem.get(item.system);if(!old||(item.final?.cycle??-1)>(old.final?.cycle??-1))bySystem.set(item.system,item)}
    const usable=[...bySystem.values()].filter(x=>x.final);if(usable.length!==2){diagnostics.push({severity:'error',code:'missing_box_partner',message:`${key}: expected two distinct usable boxes; found ${usable.length}.`});continue}
    const sorted=usable.sort((a,b)=>a.final.densityKgM3-b.final.densityKgM3),[vapor,liquid]=sorted;const vp=vapor.final.pressureKPa,lp=liquid.final.pressureKPa;const coexistence=vp===null||lp===null?null:(vp+lp)/2;const mismatch=coexistence===null||coexistence===0?null:Math.abs(lp-vp)/Math.abs(coexistence)*100;
    records.push({runKey:vapor.runKey??'.',framework:vapor.framework??liquid.framework??null,component:vapor.final.component,temperatureK:vapor.temperatureK,vaporSystem:vapor.system,liquidSystem:liquid.system,vaporDensityKgM3:vapor.final.densityKgM3,liquidDensityKgM3:liquid.final.densityKgM3,vaporPressureKPa:vp,liquidPressureKPa:lp,coexistencePressureKPa:coexistence,pressureMismatchPct:mismatch,vaporCycle:vapor.final.cycle,liquidCycle:liquid.final.cycle,vaporPressureSource:vapor.final.pressureSource,liquidPressureSource:liquid.final.pressureSource,vaporSourcePath:vapor.sourcePath,liquidSourcePath:liquid.sourcePath,components:[...new Set([vapor.final.component,liquid.final.component])],status:vapor.complete&&liquid.complete?'complete':'partial'});
  }return {records,diagnostics};
}

export function aggregateGemcReplicates(records){const groups=new Map();for(const r of records){const key=[r.framework??'',r.component??r.components?.join('+')??'',r.temperatureK].join('|');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r)}const finiteMean=(xs,key)=>{const values=xs.map(x=>x[key]).filter(v=>v!==null&&v!==undefined&&v!=='').map(Number).filter(Number.isFinite);return values.length?values.reduce((a,b)=>a+b,0)/values.length:null};return [...groups.values()].sort((a,b)=>a[0].temperatureK-b[0].temperatureK).map(xs=>{const finitePressures=xs.filter(x=>x.coexistencePressureKPa!==null&&x.coexistencePressureKPa!==undefined&&x.coexistencePressureKPa!==''&&Number.isFinite(Number(x.coexistencePressureKPa)));return {framework:xs[0].framework??null,component:xs[0].component??xs[0].components?.[0]??null,temperatureK:Number(xs[0].temperatureK),replicates:xs.length,replicateCount:xs.length,vaporDensityKgM3:finiteMean(xs,'vaporDensityKgM3'),liquidDensityKgM3:finiteMean(xs,'liquidDensityKgM3'),coexistencePressureKPa:finiteMean(xs,'coexistencePressureKPa'),pressureReplicateCount:finitePressures.length,excludedPressureReplicateCount:xs.length-finitePressures.length,pressureAverageRule:'arithmetic mean of finite replicate coexistence pressures; missing and nonfinite pressures are excluded and counted',sourceRuns:xs.map(x=>x.runKey),sourceRunProvenance:xs.map(x=>({runKey:x.runKey,vaporSourcePath:x.vaporSourcePath??null,liquidSourcePath:x.liquidSourcePath??null}))}})}

export const GEMC_PRESSURE_DEFINITION='arithmetic mean of the paired vapor-box and liquid-box pressures';
export function gemcGroupKey(record){return `${record.framework??'unknown framework'} | ${record.component??record.components?.[0]??'unknown component'}`}
export function groupGemcRecords(records){const groups=new Map();for(const record of records){const key=gemcGroupKey(record);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(record)}return [...groups].sort(([a],[b])=>a.localeCompare(b,undefined,{numeric:true})).map(([key,items])=>({key,framework:items[0].framework??null,component:items[0].component??items[0].components?.[0]??null,records:[...items].sort((a,b)=>a.temperatureK-b.temperatureK)}))}

/** Build derived Clausius–Clapeyron coordinates without dropping the source records. */
export function clausiusClapeyronGroups(records,{referencePressureKPa=1}={}){
 const units={temperature:'K',reciprocalTemperature:'K^-1',pressure:'kPa',logPressure:'dimensionless'};
 return groupGemcRecords(records).map(group=>{const eligiblePoints=[],excludedPoints=[];for(const record of group.records){const reasons=[],temperature=Number(record.temperatureK),pressure=Number(record.coexistencePressureKPa);if(!Number.isFinite(temperature)||temperature<=0)reasons.push('Temperature must be finite and greater than 0 K.');if(record.coexistencePressureKPa===null||record.coexistencePressureKPa===undefined||record.coexistencePressureKPa==='')reasons.push('Arithmetic coexistence pressure is missing; inspect both box pressures.');else if(!Number.isFinite(pressure))reasons.push('Arithmetic coexistence pressure must be finite.');else if(pressure<=0)reasons.push('Arithmetic coexistence pressure must be greater than 0 kPa for a logarithm.');if(!Number.isFinite(referencePressureKPa)||referencePressureKPa<=0)reasons.push('Reference pressure must be finite and greater than 0 kPa.');const base={record,temperatureK:temperature,coexistencePressureKPa:pressure};if(reasons.length)excludedPoints.push({...base,reasons});else eligiblePoints.push({...base,reciprocalTemperatureKInv:1/temperature,logReducedPressure:Math.log(pressure/referencePressureKPa)})}
  const temperatures=eligiblePoints.map(p=>p.temperatureK);return {key:group.key,framework:group.framework,component:group.component,eligiblePoints,excludedPoints,temperatureIntervalK:temperatures.length?[Math.min(...temperatures),Math.max(...temperatures)]:null,pressureDefinition:GEMC_PRESSURE_DEFINITION,referencePressure:{value:referencePressureKPa,unit:'kPa'},units};})
}

export function clausiusClapeyronRegression(group,{gasConstantJMolK=8.31446261815324}={}){const points=group?.eligiblePoints??[];if(points.length<2)return {status:'skipped',reason:'At least two eligible Clausius–Clapeyron points are required.'};const xs=points.map(p=>p.reciprocalTemperatureKInv),ys=points.map(p=>p.logReducedPressure),xm=xs.reduce((a,b)=>a+b,0)/xs.length,ym=ys.reduce((a,b)=>a+b,0)/ys.length,den=xs.reduce((s,x)=>s+(x-xm)**2,0);if(!den)return {status:'skipped',reason:'At least two distinct temperatures are required.'};const slope=xs.reduce((s,x,i)=>s+(x-xm)*(ys[i]-ym),0)/den,intercept=ym-slope*xm,residuals=points.map((p,i)=>({temperatureK:p.temperatureK,residual:ys[i]-(intercept+slope*xs[i])})),residualSumSquares=residuals.reduce((s,r)=>s+r.residual**2,0);return {status:'available',model:'linear Clausius–Clapeyron regression requested by the user',slope:{value:slope,unit:'K'},intercept:{value:intercept,unit:'dimensionless'},residuals,residualSumSquares,selectedIntervalK:group.temperatureIntervalK,enthalpyEstimate:{value:-gasConstantJMolK*slope/1000,unit:'kJ/mol',label:'Clausius–Clapeyron model estimate'},gasConstant:{value:gasConstantJMolK,unit:'J/(mol K)'},provenance:{group:group.key,pressureDefinition:group.pressureDefinition,referencePressure:group.referencePressure,pointCount:points.length}}}

export function criticalWorkflow(points,{fitPointCount=6,beta=0.325}={}){
  const settings={fitPointCount,beta};
  const identities=new Set(points.map(gemcGroupKey));
  if(identities.size>1)return {status:'skipped',reason:'Critical estimation requires one individually identified framework/component group; pooled multi-fluid analysis is prohibited.',settings,groups:[...identities]};
  if(!Number.isInteger(fitPointCount)||fitPointCount<3)return {status:'skipped',reason:'Fit-point count must be an integer of at least three.',settings};
  if(!Number.isFinite(beta)||beta<=0)return {status:'skipped',reason:'The fixed critical exponent β must be finite and positive.',settings};
  const valid=points.filter(p=>Number.isFinite(p.temperatureK)&&p.temperatureK>0&&Number.isFinite(p.vaporDensityKgM3)&&Number.isFinite(p.liquidDensityKgM3)&&p.vaporDensityKgM3>=0&&p.liquidDensityKgM3>p.vaporDensityKgM3);
  const selected=valid.sort((a,b)=>a.temperatureK-b.temperatureK).slice(-fitPointCount);
  if(selected.length<3||new Set(selected.map(p=>p.temperatureK)).size<3)return {status:'skipped',reason:'At least three complete, distinct temperatures with liquid density greater than vapor density are required.',settings};
  const linear=(xs,ys)=>{const xm=xs.reduce((a,b)=>a+b,0)/xs.length,ym=ys.reduce((a,b)=>a+b,0)/ys.length,den=xs.reduce((s,x)=>s+(x-xm)**2,0);if(!den)return null;const slope=xs.reduce((s,x,i)=>s+(x-xm)*(ys[i]-ym),0)/den;return {slope,intercept:ym-slope*xm}};
  const temperatures=selected.map(p=>p.temperatureK),diameters=selected.map(p=>(p.liquidDensityKgM3+p.vaporDensityKgM3)/2),halfGaps=selected.map(p=>(p.liquidDensityKgM3-p.vaporDensityKgM3)/2),diameterFit=linear(temperatures,diameters);
  const objective=tc=>{if(!(tc>Math.max(...temperatures)))return {sse:Infinity};const x=temperatures.map(t=>(tc-t)**beta),den=x.reduce((s,v)=>s+v*v,0),amplitude=x.reduce((s,v,i)=>s+v*halfGaps[i],0)/den,rhoC=diameterFit.intercept+diameterFit.slope*tc;const sse=selected.reduce((s,p,i)=>{const d=diameterFit.intercept+diameterFit.slope*p.temperatureK,g=amplitude*x[i];return s+(diameters[i]-d)**2+(halfGaps[i]-g)**2},0);return {sse,amplitude,rhoC}};
  const top=Math.max(...temperatures),span=Math.max(1,top-Math.min(...temperatures));let lo=top+span*1e-6,hi=top+span*10,phi=(Math.sqrt(5)-1)/2,c=hi-phi*(hi-lo),d=lo+phi*(hi-lo);
  for(let i=0;i<160;i++){if(objective(c).sse<objective(d).sse){hi=d;d=c;c=hi-phi*(hi-lo)}else{lo=c;c=d;d=lo+phi*(hi-lo)}}
  const criticalTemperatureK=(lo+hi)/2,fit=objective(criticalTemperatureK);if(!Number.isFinite(fit.sse+fit.rhoC+fit.amplitude)||fit.rhoC<0||fit.amplitude<=0)return {status:'skipped',reason:'The coexistence fit did not produce physically valid finite parameters.',settings,selected};
  const fitted=selected.map(p=>{const diameter=diameterFit.intercept+diameterFit.slope*p.temperatureK,gap=fit.amplitude*(criticalTemperatureK-p.temperatureK)**beta;return {temperatureK:p.temperatureK,vaporDensityKgM3:diameter-gap,liquidDensityKgM3:diameter+gap}});
  return {status:'available',settings,provenance:{selection:'highest_temperature',highestTemperaturePointCount:fitPointCount,fixedBeta:beta,method:'simultaneous least squares: linear rectilinear diameter and fixed-beta coexistence half-density'},selected,fitted,critical:{temperatureK:criticalTemperatureK,densityKgM3:fit.rhoC},parameters:{diameterInterceptKgM3:diameterFit.intercept,diameterSlopeKgM3K:diameterFit.slope,coexistenceAmplitude:fit.amplitude,residualSumSquares:fit.sse},assumptions:['highest-temperature fit-point selection','fixed critical exponent beta','rectilinear diameter and coexistence-density scaling'],note:'Fitted quantities are model-derived, not measured values.'};
}

/** Pure, group-local model workflow. Literature overlays and UI selections are not inputs. */
export function gemcCriticalParametersByGroup(records,{fitPointCount=6,beta=0.325,referencePressureKPa=1}={}){
 const assumptions=['replicates are aggregated at equal temperature before fitting','highest-temperature eligible density points are selected','rectilinear diameter and fixed-beta coexistence-density scaling','linear Clausius–Clapeyron relation in 1/T','model-derived estimates; no uncertainty interval is implied'];
 return groupGemcRecords(records).map(group=>{
  const aggregated=aggregateGemcReplicates(group.records),density=criticalWorkflow(aggregated,{fitPointCount,beta});
  const pressureGroup=clausiusClapeyronGroups(aggregated,{referencePressureKPa})[0];
  const pressure=clausiusClapeyronRegression(pressureGroup);
  const tc=density.status==='available'?density.critical.temperatureK:null,rhoc=density.status==='available'?density.critical.densityKgM3:null;
  const relationAt=temperatureK=>referencePressureKPa*Math.exp(pressure.intercept.value+pressure.slope.value/temperatureK);
  const pc=tc!==null&&pressure.status==='available'?relationAt(tc):null,target=tc===null?null:.7*tc,psat=target!==null&&pressure.status==='available'?relationAt(target):null;
  const acentric=pc>0&&psat>0?-Math.log10(psat/pc)-1:null,interval=pressureGroup?.temperatureIntervalK??null;
  const position=t=>t===null||!interval?null:t<interval[0]||t>interval[1]?'extrapolated':'interpolated';
  const tcPressurePosition=position(tc),psatPressurePosition=position(target),warnings=[];
  if(psatPressurePosition==='extrapolated')warnings.push(`Prominent extrapolation warning: 0.7 Tc (${target} K) lies outside the fitted pressure interval ${interval[0]}–${interval[1]} K; Psat and acentric factor may be unreliable.`);
  const reasons=[];if(density.status!=='available')reasons.push(`Density fit unavailable: ${density.reason}`);if(pressure.status!=='available')reasons.push(`Pressure fit unavailable: ${pressure.reason}`);
  const pressureRmse=pressure.status==='available'?Math.sqrt(pressure.residualSumSquares/pressure.provenance.pointCount):null;
  const status=density.status==='available'&&pressure.status==='available'?'available':density.status==='available'||pressure.status==='available'?'partial':'skipped';
  return {key:group.key,framework:group.framework,component:group.component,status,skipReasons:reasons,warnings,fitPointCount,beta,pressureDefinition:GEMC_PRESSURE_DEFINITION,units:{temperature:'K',density:'kg/m^3',pressure:'kPa',acentricFactor:'dimensionless'},criticalTemperatureK:tc,criticalDensityKgM3:rhoc,criticalPressureKPa:pc,psatAt0_7TcKPa:psat,acentricFactor:acentric,tcPressurePosition,psatAt0_7TcPressurePosition:psatPressurePosition,extrapolationFlags:{tc:tcPressurePosition==='extrapolated',psatAt0_7Tc:psatPressurePosition==='extrapolated'},densityFit:{...density,selectedTemperatureIntervalK:density.selected?.length?[density.selected[0].temperatureK,density.selected.at(-1).temperatureK]:null},pressureFit:{...pressure,eligiblePoints:pressureGroup?.eligiblePoints??[],excludedPoints:pressureGroup?.excludedPoints??[],rmseLogPressure:pressureRmse},selectedTemperatureIntervals:{densityK:density.selected?.length?[density.selected[0].temperatureK,density.selected.at(-1).temperatureK]:null,pressureK:interval},selectedPoints:{density:density.selected??[],pressure:pressureGroup?.eligiblePoints??[]},assumptions,replicateAggregates:aggregated,sourceRunProvenance:aggregated.flatMap(x=>x.sourceRunProvenance)};
 });
}
