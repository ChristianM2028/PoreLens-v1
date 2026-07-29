export const ANNOTATION_FORMAT = 'porelens.annotations';
export const ANNOTATION_VERSION = 1;
export const TRAJECTORY_ANNOTATION_TYPES=Object.freeze(['span','region','ridge','pressure_point','pressure_region']);
export const SELECTION_SCOPES=Object.freeze(['pair_only','anchor_site','whole_molecule']);
export const PAIR_CRITERIA=Object.freeze(['any','nearest','all']);

const canonical = value => JSON.stringify(value, Object.keys(value).sort());
export function normalizedManifest(rows) {
  const fields=['n_value','component','run','pressure_pa','pressure_bar','rdf_filename','source_relative_path','collected_relative_path','size_bytes','sha256'];
  return [...rows].map(row=>Object.fromEntries(fields.map(k=>[k,String(row[k]??'')]))).sort((a,b)=>canonical(a).localeCompare(canonical(b)));
}
export async function sha256Text(text) {
  const bytes=new TextEncoder().encode(text), hash=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
export const manifestFingerprint = rows => sha256Text(JSON.stringify(normalizedManifest(rows)));
export function nearestIndex(values,target){let best=0;for(let i=1;i<values.length;i++)if(Math.abs(values[i]-target)<Math.abs(values[best]-target))best=i;return best;}
export function snapRdf(records,distanceA){const i=nearestIndex(records.map(r=>r.distanceA),distanceA),r=records[i];return {binIndex:r.binIndex,distanceA:r.distanceA,gR:r.gR};}
export function snapPressure(items,pressurePa){const i=nearestIndex(items.map(x=>Number(x.manifest.pressure_pa)),Number(pressurePa));return items[i];}

export class AnnotationStore {
  constructor(clock=()=>new Date().toISOString()){this.items=[];this.dirty=false;this.clock=clock;}
  create(context,geometry,fields={}) {
    const now=this.clock(), item={id:fields.id||crypto.randomUUID(),datasetSlot:context.datasetSlot,datasetFingerprint:context.datasetFingerprint,chainLength:context.chainLength,atomPair:Array.isArray(context.atomPair)?[...context.atomPair]:context.atomPair,rdfFilename:context.rdfFilename||null,run:String(geometry.run??context.run),pressurePa:Number(geometry.pressurePa??context.pressurePa),rdfRelativePath:context.rdfRelativePath,rdfFingerprint:context.rdfFingerprint||null,type:geometry.type,distanceA:geometry.distanceA??null,startA:geometry.startA??null,endA:geometry.endA??null,pressureMinPa:geometry.pressureMinPa??Number(context.pressurePa),pressureMaxPa:geometry.pressureMaxPa??Number(context.pressurePa),pressurePoints:geometry.pressurePoints||null,ridge:geometry.ridge||null,gR:geometry.gR??null,scope:fields.scope||null,pairCriterion:fields.pairCriterion||null,reference:fields.reference||null,normalization:fields.normalization||null,label:fields.label||'',note:fields.note||'',category:fields.category||'feature',color:fields.color||null,provenance:fields.provenance||'manual',status:fields.status||'active',visible:fields.visible!==false,linkedId:fields.linkedId||null,createdAt:now,updatedAt:now};
    this.items.push(item);this.dirty=true;return item;
  }
  update(id,patch){const item=this.items.find(x=>x.id===id);if(!item)return null;Object.assign(item,patch,{id:item.id,createdAt:item.createdAt,updatedAt:this.clock()});this.dirty=true;return item;}
  remove(id){const n=this.items.length;this.items=this.items.filter(x=>x.id!==id);if(this.items.length!==n)this.dirty=true;return this.items.length!==n;}
  forView(query){const samePair=x=>query.pairLabel?Array.isArray(x.atomPair)&&x.atomPair.join(' ↔ ')===query.pairLabel:JSON.stringify(x.atomPair)===JSON.stringify(query.atomPair);return this.items.filter(x=>x.datasetSlot===query.datasetSlot&&x.chainLength===query.chainLength&&samePair(x)&&(!query.pressurePa||(Number(query.pressurePa)>=(x.pressureMinPa??x.pressurePa)&&Number(query.pressurePa)<=(x.pressureMaxPa??x.pressurePa)))&&x.visible&&x.status!=='rejected');}
  export(datasets){return {format:ANNOTATION_FORMAT,version:ANNOTATION_VERSION,exportedAt:this.clock(),datasets,annotations:this.items.map(x=>({...x}))};}
  import(sidecar,currentDatasets,{reconcile=false}={}){if(sidecar?.format!==ANNOTATION_FORMAT||sidecar.version!==ANNOTATION_VERSION)throw new Error('Unsupported annotation sidecar format or version.');const mismatches=[];for(const [slot,saved] of Object.entries(sidecar.datasets||{})){const current=currentDatasets[slot];if(!current||current.manifestFingerprint!==saved.manifestFingerprint)mismatches.push({slot,kind:'manifest',expected:saved.manifestFingerprint,actual:current?.manifestFingerprint||null});}for(const item of sidecar.annotations||[]){const actual=currentDatasets[item.datasetSlot]?.rdfFingerprints?.[item.rdfRelativePath]||null;if(item.rdfFingerprint&&actual!==item.rdfFingerprint)mismatches.push({slot:item.datasetSlot,kind:'rdf',path:item.rdfRelativePath,expected:item.rdfFingerprint,actual});}if(mismatches.length&&!reconcile)return {attached:0,mismatches,requiresReconciliation:true};this.items=sidecar.annotations.map(x=>reconcileLegacyPair({...x},currentDatasets[x.datasetSlot]));this.dirty=false;return {attached:this.items.length,mismatches,requiresReconciliation:false};}
  markSaved(){this.dirty=false;}
}

/** Reconcile old filename/display atomPair values only against catalog evidence. */
export function reconcileLegacyPair(item,dataset){
  if(Array.isArray(item.atomPair))return item;
  const records=dataset?.datasets||dataset?.rdfRecords||[];
  const candidates=records.filter(r=>r.relativePath===item.rdfRelativePath||r.manifest?.collected_relative_path===item.rdfRelativePath||r.manifest?.rdf_filename===item.atomPair||r.pairLabel===item.atomPair||r.pairKey===item.atomPair);
  const pairs=[...new Map(candidates.filter(r=>Array.isArray(r.pair)&&r.pair.length===2).map(r=>[JSON.stringify(r.pair),r.pair])).values()];
  if(pairs.length===1){item.rdfFilename=item.rdfFilename||candidates[0].manifest?.rdf_filename||null;item.atomPair=[...pairs[0]];}
  return item;
}

export function pressurePointGeometry(run,pressurePa){if(!run||!(Number(pressurePa)>0))throw new Error('Pressure point requires an exact run and positive simulated pressure');return {type:'pressure_point',run:String(run),pressurePa:Number(pressurePa),pressureMinPa:Number(pressurePa),pressureMaxPa:Number(pressurePa)};}
export function pressureRegionGeometry(points){if(!Array.isArray(points)||!points.length||points.some(x=>!x.run||!(Number(x.pressurePa)>0)))throw new Error('Pressure region requires exact simulated run/pressure points');const sorted=[...points].sort((a,b)=>a.pressurePa-b.pressurePa);return {type:'pressure_region',pressurePoints:sorted.map(x=>({run:String(x.run),pressurePa:Number(x.pressurePa)})),pressureMinPa:Number(sorted[0].pressurePa),pressureMaxPa:Number(sorted.at(-1).pressurePa)};}
