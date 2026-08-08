export const SUMMARY_FILES={pressure:'final_abs_pressure_up',fugacity:'final_abs_fug_up'};
export const SUMMARY_LOADING_UNIT='mol/kg framework';
export const MIXTURE_SUMMARY_FILE='final_mix_abs_molkg';
/** Verified by reference_scripts/plot_report.py and representative-run metadata. */
export const MIXTURE_SUMMARY_CONTRACT={pressureUnit:'Pa',partialQuantity:'partial pressure',partialUnit:'Pa',loadingKind:'absolute',loadingUnit:SUMMARY_LOADING_UNIT,compositionQuantity:'loading-derived adsorbed composition (component absolute loading / summed component absolute loading)',compositionUnit:'dimensionless'};

export function mixtureComponentsFromSimulation(simulation,{source='simulation.input'}={}){
  const components=simulation?.components?.map((component,index)=>({index:Number(component.index??index),name:component.name,feedMoleFraction:Number(component.settings?.molfraction)}))??[];
  if(!components.length||components.some(component=>!component.name||!Number.isFinite(component.feedMoleFraction)))throw new Error(`${source}: mixture summary requires an explicit named component list with finite MolFraction values`);
  return components;
}

/** Parse total pressure, N partial pressures, N loadings, and N loading-derived adsorbed composition fractions. */
export function parseRepresentativeMixtureSummary(text,{source=MIXTURE_SUMMARY_FILE,components}={}){
  if(!Array.isArray(components)||!components.length)throw new Error(`${source}: an explicit component list from the matching simulation.input is required`);
  const normalized=components.map((component,index)=>({index:Number(component.index??index),name:component.name,feedMoleFraction:Number(component.feedMoleFraction)}));
  if(normalized.some(x=>!x.name||!Number.isFinite(x.feedMoleFraction)))throw new Error(`${source}: every component requires a name and finite feed mole fraction`);
  const expected=1+3*normalized.length,records=[],diagnostics=[];
  String(text).split(/\r?\n/).forEach((raw,index)=>{const lineNumber=index+1,line=raw.trim();if(!line||/^(?:#|;|!)/.test(line))return;const fields=line.split(/\s+/);if(fields.length!==expected){diagnostics.push({severity:'warning',code:'malformed_mixture_column_count',source,lineNumber,expected,actual:fields.length,message:`${source}:${lineNumber}: expected ${expected} columns (1 + 3 × ${normalized.length}); row rejected`});return}const values=fields.map(Number);if(values.some(x=>!Number.isFinite(x))){diagnostics.push({severity:'warning',code:'nonfinite_mixture_row',source,lineNumber,message:`${source}:${lineNumber}: columns must be finite numbers; row rejected`});return}const n=normalized.length;records.push({pressurePa:values[0],partialPressuresPa:values.slice(1,1+n),absoluteLoadingsMolKgFramework:values.slice(1+n,1+2*n),adsorbedMoleFractions:values.slice(1+2*n),sourcePath:source,lineNumber})});
  records.sort((a,b)=>a.pressurePa-b.pressurePa||a.lineNumber-b.lineNumber);const duplicatePressuresPa=[...new Set(records.filter((r,i)=>i&&r.pressurePa===records[i-1].pressurePa).map(r=>r.pressurePa))],nonpositivePressures=records.filter(r=>r.pressurePa<=0).map(r=>({pressurePa:r.pressurePa,lineNumber:r.lineNumber}));
  if(duplicatePressuresPa.length)diagnostics.push({severity:'warning',code:'duplicate_mixture_pressure',source,values:duplicatePressuresPa,message:`${source}: duplicate canonical pressure(s): ${duplicatePressuresPa.join(', ')} Pa`});
  if(nonpositivePressures.length)diagnostics.push({severity:'warning',code:'nonpositive_mixture_pressure',source,rows:nonpositivePressures,message:`${source}: ${nonpositivePressures.length} nonpositive canonical pressure row(s) retained but unavailable on a logarithmic axis`});
  return {source,kind:'representative_mixture_summary',contract:MIXTURE_SUMMARY_CONTRACT,components:normalized,records,duplicatePressuresPa,nonpositivePressures,diagnostics};
}

/** Parse a three-column RASPA adsorption summary while retaining valid rows and provenance. */
export function parseIsothermSummary(text,{source='summary',xKind='pressure'}={}){
  if(!Object.hasOwn(SUMMARY_FILES,xKind))throw new Error(`Unsupported isotherm x quantity: ${xKind}`);
  const records=[],diagnostics=[];
  String(text).split(/\r?\n/).forEach((raw,index)=>{
    const lineNumber=index+1,line=raw.trim();
    if(!line||/^(?:#|;|!)/.test(line))return;
    const fields=line.split(/\s+/);
    if(fields.length!==3){diagnostics.push({severity:'warning',code:'malformed_summary_row',source,lineNumber,message:`${source}:${lineNumber}: expected exactly 3 numeric columns; row rejected`});return}
    const values=fields.map(Number);
    if(values.some(value=>!Number.isFinite(value))){diagnostics.push({severity:'warning',code:'nonfinite_summary_row',source,lineNumber,message:`${source}:${lineNumber}: columns must be finite numbers; row rejected`});return}
    records.push({x:values[0],loading:values[1],uncertainty:values[2],xKind,loadingKind:'absolute',loadingUnit:SUMMARY_LOADING_UNIT,sourcePath:source,lineNumber});
  });
  records.sort((a,b)=>a.x-b.x||a.lineNumber-b.lineNumber);
  const duplicateX=[...new Set(records.filter((row,i)=>i&&row.x===records[i-1].x).map(row=>row.x))];
  if(duplicateX.length)diagnostics.push({severity:'warning',code:'duplicate_summary_x',source,values:duplicateX,message:`${source}: duplicate ${xKind} value(s): ${duplicateX.join(', ')}`});
  return {source,xKind,loadingKind:'absolute',loadingUnit:SUMMARY_LOADING_UNIT,records,duplicateX,diagnostics};
}

export function logPlottableRecords(records){const included=records.filter(row=>row.x>0),excluded=records.filter(row=>row.x<=0);return {included,excluded,warning:excluded.length?`${excluded.length} nonpositive ${records[0]?.xKind||'x'} value(s) excluded from the logarithmic axis.`:null};}

/** Canonical preparation used by the live isotherm canvas and its tests. */
export function prepareIsothermSeries(series,configuration={}){
  const pressureUnit=configuration.pressureUnit||'Pa',pressureScale=configuration.pressureScale||'linear',factors={Pa:1,kPa:1e3,MPa:1e6,bar:1e5};
  if(!factors[pressureUnit])throw new Error(`Unsupported pressure unit ${pressureUnit}`);
  return series.filter(curve=>curve.visible!==false).map(curve=>({...curve,records:curve.records.map(row=>{const canonicalPa=Number(row.pressurePa??row.x),displayPressure=canonicalPa/factors[pressureUnit];return {...row,canonicalPa,displayPressure,plotX:pressureScale==='log'?(displayPressure>0?Math.log10(displayPressure):null):displayPressure}}).filter(row=>Number.isFinite(row.plotX))}));
}
