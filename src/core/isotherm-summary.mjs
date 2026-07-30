export const SUMMARY_FILES={pressure:'final_abs_pressure_up',fugacity:'final_abs_fug_up'};
export const SUMMARY_LOADING_UNIT='mol/kg framework';

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
