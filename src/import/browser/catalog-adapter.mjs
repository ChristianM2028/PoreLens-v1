import {parseRdf} from '../importers.mjs?rev=histogram-inset-legend';
const LEGACY_STANDALONE_LABELS=['CH3_sp3','CH2_sp3','CF3_sp3','CF2_sp3','Zn1','O1','O2','C1','C2','C3','H1'];

/** Resolve only complete known labels; never split each underscore. */
export function resolveCatalogPair(filename,knownSites=LEGACY_STANDALONE_LABELS){
  const stem=String(filename||'').split('/').at(-1).replace(/^RDF[_-]?/i,'').replace(/\.(?:dat|txt|data)$/i,'');
  const matches=[];
  for(const left of knownSites)for(const right of knownSites)if(`${left}_${right}`===stem)matches.push([left,right]);
  return matches.length===1?matches[0]:[stem,null];
}

const labelOf=x=>typeof x==='string'?x:x?.name??x?.label??x?.type??x?.pseudoAtomType;
const recordsOf=value=>Array.isArray(value)?value:Array.isArray(value?.records)?value.records:value instanceof Set?[...value]:value instanceof Map?[...value.values()]:[];
const labelsFromExplicit=value=>{
  const records=recordsOf(value),items=records.length?records:value&&typeof value==='object'?[...Object.values(value)]:[];
  return items.reduce((labels,item)=>{
  if(Array.isArray(item))return labels.concat(item);
  if(item&&typeof item==='object'&&Array.isArray(item.pair))return labels.concat(item.pair);
  return labels.concat(item);
},[])};
/** Assemble labels only from evidence belonging to this run. */
export function runSpecificSiteLabels(record={}){
  const run=record.normalizedRun||record.runRecord||record.run||{};
  const explicit=labelsFromExplicit(first(record,['pairMetadata','pair_metadata','knownSiteLabels','known_site_labels']));
  const pseudo=[...recordsOf(run.pseudoAtoms),...recordsOf(run.pseudoatoms),...recordsOf(record.pseudoAtoms)];
  const definitions=[...recordsOf(run.moleculeDefinitions),...recordsOf(record.moleculeDefinitions)];
  const moleculeSites=[];
  for(const definition of definitions)moleculeSites.push(...recordsOf(definition?.parsed?.atoms),...recordsOf(definition?.atoms),...recordsOf(definition?.parsed?.sites),...recordsOf(definition?.sites));
  const framework=[...recordsOf(run.frameworkAtoms),...recordsOf(run.cifLabels),...recordsOf(run.frameworkLabels),...recordsOf(run.frameworkCif?.asymmetricSites),...recordsOf(record.frameworkLabels),...recordsOf(record.cifLabels)];
  return [...new Set([...explicit,...pseudo,...moleculeSites,...framework].map(labelOf).filter(Boolean).map(String))].sort((a,b)=>b.length-a.length||a.localeCompare(b));
}

export function resolveCatalogPairDetailed(filename,knownSites=[]){const pair=resolveCatalogPair(filename,knownSites),resolved=!!pair[1],mappingRequired=!resolved;return {pair,resolved,mappingRequired,diagnostic:resolved?null:{severity:'warning',code:knownSites.length?'rdf_pair_ambiguous_or_unknown':'rdf_pair_dependencies_missing',message:`Cannot resolve the complete RDF pair in ${String(filename).split('/').at(-1)} from this run's labels. The RDF remains indexed; supply an explicit two-label pair mapping${knownSites.length?' or correct the run metadata':', or import pseudo_atoms.def, the matching molecule definition, and framework CIF'}.`,mappingRequired:true,candidates:knownSites}}}

const first=(record,names)=>names.map(name=>record?.[name]).find(value=>value!==undefined&&value!==null&&value!=='');
const rdfType=record=>String(first(record,['type','kind','resultType'])??'rdf').toLowerCase().replaceAll('-','_');
const isRdf=record=>['rdf','radial_distribution_function','radialdistributionfunction'].includes(rdfType(record));

function pairIdentity(record,path,labels=runSpecificSiteLabels(record)){
  const supplied=first(record,['pairKey','pair_key','pairLabel','pair_label','pair']);
  if(Array.isArray(supplied)&&supplied.length===2&&supplied.every(Boolean))return supplied.join(' ↔ ');
  if(typeof supplied==='string'&&supplied.trim())return supplied.trim();
  const resolved=resolveCatalogPair(first(record,['filename','name','relativePath','relative_path','path'])||path,labels);
  return resolved[1]?resolved.join(' ↔ '):null;
}
function sourceFilename(record,path){return String(first(record,['filename','name','rdfFilename','rdf_filename'])??String(path).split('/').at(-1)??'');}

function readableFile(record){
  const lookup=first(record,['fileHandleLookup','file_handle_lookup','lookup']);
  return first(record,['file','sourceFile'])||lookup?.file||null;
}

/**
 * The one compatibility boundary between ingestion catalogs and RDF analysis.
 * UI code must consume this shape rather than interpreting source records.
 */
export function normalizeRdfForUi(rdfRecord,datasetSlot){
  if(!rdfRecord||!isRdf(rdfRecord))return null;
  const path=String(first(rdfRecord,['relativePath','relative_path','collectedRelativePath','collected_relative_path','path'])??'');
  const chainKey=String(first(rdfRecord,['chainKey','chain_key','chain','chainId','chain_id','seriesName','series_name','componentName','component_name','component'])??'').trim()||null;
  const labels=runSpecificSiteLabels(rdfRecord),filename=sourceFilename(rdfRecord,path),resolution=resolveCatalogPairDetailed(filename||path,labels),pairKey=pairIdentity(rdfRecord,path,labels);
  const pressurePa=Number(first(rdfRecord,['pressurePa','pressure_pa','pressure']));
  const runId=String(first(rdfRecord,['runId','run_id','run'])??'');
  const file=readableFile(rdfRecord),lookup=first(rdfRecord,['fileHandleLookup','file_handle_lookup','lookup'])||{rootRelativePath:path,fileHandle:rdfRecord.handle??null};
  const pair=Array.isArray(rdfRecord.pair)&&rdfRecord.pair.length===2?[...rdfRecord.pair]:resolution.pair;
  const normalized={datasetId:String(datasetSlot),chainKey,chainLabel:String(first(rdfRecord,['chainLabel','chain_label'])??chainKey??''),pairKey,pairLabel:String(first(rdfRecord,['pairLabel','pair_label'])??pairKey??filename),pair,pairResolution:resolution,pressurePa,temperatureK:Number(first(rdfRecord,['temperatureK','temperature_k'])),runId,relativePath:path,fileHandleLookup:lookup,sourceRecord:rdfRecord,resultType:'rdf',rdf:null};
  normalized.manifest={n_value:Number(String(chainKey||'').replace(/^C/i,'')),component:chainKey,run:runId,pressure_pa:pressurePa,pressure_bar:pressurePa/100000,rdf_filename:filename,source_relative_path:path,collected_relative_path:path,size_bytes:null,sha256:''};
  normalized.lookup=lookup;normalized.path=path;
  normalized.loadRdf=async()=>{if(normalized.rdf)return normalized.rdf;let source=file;if(!source&&typeof lookup==='function')source=await lookup(path);if(!source&&typeof lookup?.getFile==='function')source=lookup;if(!source&&lookup?.fileHandle)source=lookup.fileHandle;if(source?.getFile)source=await source.getFile();if(!source?.text)throw new Error(`Directory authorization is unavailable for ${path}`);normalized.rdf=parseRdf(await source.text(),path);return normalized.rdf};
  return normalized;
}

/** Accept both the typed top-level catalog and the older run/output catalog. */
export function catalogRdfRecords(catalog){
  const top=first(catalog,['rdfRecords','rdf_records','rdfs']);
  if(Array.isArray(top))return top;
  return (catalog.runs||[]).flatMap(run=>(run.outputs?.rdf||[]).map(output=>({...output,normalizedRun:run,chainKey:run.chain,seriesName:run.simulation?.components?.[0]?.name,runId:run.run,pressurePa:run.simulation?.pressurePa,temperatureK:run.simulation?.temperatureK,framework:run.simulation?.framework?.name})));
}

export function deriveRdfSelectorState(records,{datasetId,chainKey=null,pairKey=null}={}){
  const raw=records||[],assigned=datasetId==null?raw:raw.filter(x=>String(x.datasetId)===String(datasetId)),typed=assigned.filter(x=>x.resultType==='rdf'),withChain=typed.filter(x=>x.chainKey),chains=[...new Set(withChain.map(x=>x.chainKey))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true})),selectedChain=withChain.filter(x=>!chainKey||x.chainKey===chainKey),pairs=[...new Set(selectedChain.map(x=>x.pairKey).filter(Boolean))].sort(),selectedPair=selectedChain.filter(x=>!pairKey||x.pairKey===pairKey),finitePressure=selectedPair.filter(x=>Number.isFinite(x.pressurePa)),pressures=[...new Set(finitePressure.map(x=>x.pressurePa))].sort((a,b)=>a-b);
  return {rawRdfRecords:raw.length,afterDatasetFilter:assigned.length,afterTypeFilter:typed.length,withChainKey:withChain.length,chains,selectedChainRdfs:selectedChain.length,pairs,missingPair:selectedChain.filter(x=>!x.pairKey).length,selectedPairRdfs:selectedPair.length,pressures,missingPressure:selectedPair.length-finitePressure.length};
}

export function normalizedCatalogToBrowserResult(catalog,{datasetId=catalog.name}={}){
  const diagnostics=[...(catalog.diagnostics||[])],raw=catalogRdfRecords(catalog),datasets=[];
  for(const record of raw){const entry=normalizeRdfForUi(record,datasetId);if(entry){datasets.push(entry);if(!entry.pairKey)diagnostics.push({...entry.pairResolution.diagnostic,source:entry.path})}}
  datasets.sort((a,b)=>(Number.isFinite(a.pressurePa)?a.pressurePa:Infinity)-(Number.isFinite(b.pressurePa)?b.pressurePa:Infinity)||a.path.localeCompare(b.path));
  const trace=deriveRdfSelectorState(datasets,{datasetId});
  const indexedCount=Number(catalog.rdfCount??catalog.stats?.rdfs??raw.length);
  if(indexedCount>0&&!trace.chains.length)diagnostics.push({severity:'error',code:'rdf_chain_mapping_empty',message:'RDF records were indexed but none could be mapped to a chain.'});
  return {rows:datasets.map(x=>x.manifest),datasets,diagnostics,catalog,rdfSelectorTrace:trace};
}

export async function hydrateRdfSeries(result,component,pair){
  const selected=result.datasets.filter(x=>x.chainKey===component&&x.pairKey===pair&&Number.isFinite(x.pressurePa));
  const settled=await Promise.allSettled(selected.map(x=>x.loadRdf()));
  settled.forEach((state,index)=>{if(state.status==='rejected')result.diagnostics.push({severity:'error',source:selected[index].path,message:state.reason.message})});
  return selected.filter(x=>x.rdf);
}
