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

export function aggregateGemcReplicates(records){const groups=new Map();for(const r of records){const key=[r.framework??'',r.component??r.components?.join('+')??'',r.temperatureK].join('|');if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r)}const mean=(xs,key)=>xs.reduce((s,x)=>s+x[key],0)/xs.length;return [...groups.values()].sort((a,b)=>a[0].temperatureK-b[0].temperatureK).map(xs=>({framework:xs[0].framework??null,component:xs[0].component??xs[0].components?.[0]??null,temperatureK:xs[0].temperatureK,replicates:xs.length,vaporDensityKgM3:mean(xs,'vaporDensityKgM3'),liquidDensityKgM3:mean(xs,'liquidDensityKgM3'),coexistencePressureKPa:xs.every(x=>x.coexistencePressureKPa!==null)?mean(xs,'coexistencePressureKPa'):null,sourceRuns:xs.map(x=>x.runKey)}))}

export function criticalWorkflow(points,{fitPointCount=5,beta=0.326}={}){
  const settings={fitPointCount,beta};
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
