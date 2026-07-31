/** @deprecated Compatibility facade. Browser discovery lives in poreview/ingestion. */
export * from './browser/file-list-discovery.mjs?rev=porelens-20260731-gemc-critical-v1';

/** Resolve annotations without pressure tolerances. Missing and ambiguous rows remain diagnostics. */
export function resolveAnnotationRuns(annotation,runs,{datasetFingerprint=annotation.datasetFingerprint}={}){
  const expected=annotation.type==='pressure_region'?(annotation.pressurePoints||[]):[{run:annotation.run,pressurePa:annotation.pressurePa}];
  const rows=expected.map(point=>{
    const matches=runs.filter(run=>(!datasetFingerprint||run.datasetFingerprint===datasetFingerprint)&&String(run.chain??run.component)===String(annotation.chainLength)&&String(run.run)===String(point.run)&&Number(run.pressurePa)===Number(point.pressurePa));
    if(matches.length===1)return {status:'resolved',run:matches[0],requested:{run:String(point.run),pressurePa:Number(point.pressurePa)}};
    return {status:matches.length?'ambiguous':'missing',run:null,requested:{run:String(point.run),pressurePa:Number(point.pressurePa)},reason:matches.length?'Multiple exact run packages match':'No exact run/pressure match; nearest-pressure substitution is forbidden'};
  });
  return {annotationId:annotation.id,rows,resolved:rows.filter(x=>x.status==='resolved').map(x=>x.run),complete:rows.every(x=>x.status==='resolved')};
}

export const comparablePressureSeries=runs=>{const groups=new Map();for(const run of runs){const key=run.physicsFingerprint||'unavailable';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(run)}return {compatible:groups.size===1&&!groups.has('unavailable'),groups:[...groups].map(([physicsFingerprint,items])=>({physicsFingerprint,runs:items}))};};
