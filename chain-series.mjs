import { parseManifest, parseRdf, resolvePairName } from './importers.mjs';
import { parseSimulationInput } from './trajectory.mjs';
import { parseEndToEndDistribution } from './result-types.mjs';
import { parseRaspaOutput } from './raspa-package.mjs';
import {parseIsothermSummary,SUMMARY_FILES,SUMMARY_LOADING_UNIT} from './isotherm-summary.mjs';

const CHAIN_RE = /^C(\d+)$/;
const RUN_RE = /^(\d+)(?:_|$)/;

export function discoverChains(paths) {
  const found = new Map();
  for (const raw of paths) {
    const parts = String(raw).replaceAll('\\', '/').split('/').filter(Boolean);
    const rootOffset = parts.length > 1 && !CHAIN_RE.test(parts[0]) ? 1 : 0;
    const match = parts[rootOffset]?.match(CHAIN_RE);
    if (match) found.set(parts[rootOffset], Number(match[1]));
  }
  return [...found].map(([component, chainLength]) => ({ component, chainLength }))
    .sort((a, b) => a.chainLength - b.chainLength);
}

export function canonicalPair(pair) {
  if (!pair?.length || pair.length !== 2) return null;
  return [...pair].sort((a, b) => a.localeCompare(b)).join(' ↔ ');
}

export function discoverPairs(entries, pseudoatoms) {
  const result = new Map();
  for (const entry of entries) {
    if (!/^RDF_.*\.dat$/i.test(entry.filename || '')) continue;
    const pair = resolvePairName(entry.filename, pseudoatoms);
    const key = canonicalPair(pair);
    if (!key) continue;
    const item = result.get(key) || { key, pair, sources: [], reversed: false };
    item.reversed ||= item.sources.some(source => source.pair[0] === pair[1] && source.pair[1] === pair[0]);
    item.sources.push({ path: entry.path, filename: entry.filename, pair });
    result.set(key, item);
  }
  return [...result.values()].sort((a, b) => a.key.localeCompare(b.key));
}

export function filterPairs(pairs, labels) {
  const wanted = labels.map(String).filter(Boolean);
  return pairs.filter(item => wanted.every(label => item.pair.includes(label)));
}

export function parseEndToEndHistogram(text, source = 'end-to-end histogram') {
  const parsed=parseEndToEndDistribution(text,source);
  return {...parsed,records:parsed.records.map(row=>({...row,probabilityDensityPerA:parsed.integral>0?row.sourceValue/parsed.integral:row.sourceValue})),xUnit:'Å',yUnit:parsed.integral>0?'Å⁻¹':'stored units',normalization:parsed.semantics==='probability_density'?'probability density':'display-normalized density'};
}

export function matchRuns(runs, { mode, pressurePa, tolerancePa = 0, manual = {}, loading = null } = {}) {
  const groups = new Map(), matches = [], unmatched = [];
  for (const run of runs) { const key = `${run.datasetId}\0${run.component}`; groups.set(key, [...(groups.get(key) || []), run]); }
  for (const [group, candidates] of groups) {
    let selected = null;
    if (mode === 'manual') selected = candidates.find(run => String(run.run) === String(manual[group]));
    else if (mode === 'loading') selected = candidates.filter(run => Number.isFinite(run.loading)).sort((a, b) => Math.abs(a.loading - loading) - Math.abs(b.loading - loading))[0];
    else if (mode === 'exact') selected = candidates.find(run => run.pressurePa === pressurePa);
    else if (mode === 'nearest') {
      const nearest = candidates.filter(run => Number.isFinite(run.pressurePa)).sort((a, b) => Math.abs(a.pressurePa - pressurePa) - Math.abs(b.pressurePa - pressurePa))[0];
      if (nearest && Math.abs(nearest.pressurePa - pressurePa) <= tolerancePa) selected = nearest;
    }
    (selected ? matches : unmatched).push(selected || { group, reason: mode === 'loading' ? 'No valid loading available' : 'No run satisfies the pressure rule' });
  }
  return { matches, unmatched };
}

export function availableLoadingUnits(parsedOutputs,kind='absolute'){
  const units=new Set();
  for(const output of parsedOutputs)for(const unit of Object.keys(output.parsed.loadings?.[kind]||{}))units.add(unit);
  return [...units].sort((a,b)=>a==='molecules/unit cell'?-1:b==='molecules/unit cell'?1:a.localeCompare(b));
}

/** Assemble every valid output file into pressure-sorted chain curves without pressure matching. */
export function buildIsothermCurves(outputs,{kind='absolute',unit='molecules/unit cell'}={}){
  const groups=new Map(),diagnostics=[];
  for(const item of outputs){const p=item.parsed,loading=p.loadings?.[kind]?.[unit];if(!Number.isFinite(p.pressurePa)||!loading){diagnostics.push(`${item.entry.path}: missing ${kind} loading in ${unit} or pressure`);continue}const e=item.entry,key=`${e.datasetId}\0${e.component}`;if(!groups.has(key))groups.set(key,{...e,type:'isotherm',family:e.datasetId,sourcePath:null,visible:true,records:[]});groups.get(key).records.push({pressurePa:p.pressurePa,loading:loading.value,uncertainty:loading.uncertainty,loadingKind:kind,loadingUnit:unit,run:e.run,temperatureK:p.temperatureK??e.temperatureK,framework:p.framework??e.framework,componentName:p.component,sourcePath:e.path,pressureMismatch:Number.isFinite(e.pressurePa)&&Math.abs(e.pressurePa-p.pressurePa)>Math.max(1,Math.abs(p.pressurePa)*1e-6),temperatureMismatch:Number.isFinite(e.temperatureK)&&Number.isFinite(p.temperatureK)&&Math.abs(e.temperatureK-p.temperatureK)>1e-6});}
  for(const curve of groups.values())curve.records.sort((a,b)=>a.pressurePa-b.pressurePa);
  return {curves:[...groups.values()].sort((a,b)=>a.chainLength-b.chainLength),diagnostics};
}

export class ParsedResultCache {
  constructor({maxBytes=64*1024*1024,maxEntries=16}={}){ this.values = new Map();this.maxBytes=maxBytes;this.maxEntries=maxEntries;this.bytes=0; }
  async get(file, type) {
    const current=file.handle?await file.handle.getFile():file,key = `${file.path||file.webkitRelativePath || file.name}\0${current.size}\0${current.lastModified}\0${type}`;
    if(this.values.has(key)){const hit=this.values.get(key);this.values.delete(key);this.values.set(key,hit);return hit.value}
    const text=await current.text(),value=type === 'rdf' ? parseRdf(text,file.name) : type==='raspa_output'?parseRaspaOutput(text):type==='isotherm_summary'?parseIsothermSummary(text,{source:file.path||file.webkitRelativePath||file.name,xKind:file.xKind}):parseEndToEndHistogram(text,file.name),bytes=Math.max(current.size||0,JSON.stringify(value).length*2);this.values.set(key,{value,bytes});this.bytes+=bytes;
    while(this.values.size>this.maxEntries||this.bytes>this.maxBytes){const oldest=this.values.keys().next().value,entry=this.values.get(oldest);this.values.delete(oldest);this.bytes-=entry.bytes}
    return value;
  }
  clear(){ this.values.clear();this.bytes=0; }
}

export async function buildChainCatalog(files, { datasetId = 'dataset' } = {}) {
  const list = [...files], paths = list.map(file => file.webkitRelativePath || file.name), chains = discoverChains(paths);
  const manifestFile = list.find(file => file.name === 'manifest.csv');
  const manifest = manifestFile ? parseManifest(await manifestFile.text()) : { rows: [], diagnostics: [{ severity: 'warning', message: 'No manifest: run metadata are inferred from paths and simulation.input where available.' }] };
  const rowsByPath = new Map(manifest.rows.map(row => [row.collected_relative_path.replaceAll('\\', '/'), row]));
  const results = [], diagnostics = [...manifest.diagnostics],runMetadata=new Map();
  for(const file of list){const path=(file.webkitRelativePath||file.name).replaceAll('\\','/'),parts=path.split('/').filter(Boolean),name=parts.at(-1),component=parts.at(-2);if(!CHAIN_RE.test(component||'')||!Object.values(SUMMARY_FILES).includes(name))continue;const xKind=Object.entries(SUMMARY_FILES).find(([,filename])=>filename===name)[0];file.xKind=xKind;results.push({datasetId,family:datasetId,component,chainLength:Number(component.slice(1)),type:'isotherm_summary',xKind,filename:name,path:parts.slice(-2).join('/'),file,provenance:{datasetId,path:parts.slice(-2).join('/')}})}
  for(const file of list){const path=(file.webkitRelativePath||file.name).replaceAll('\\','/');if(!/(^|\/)C\d+\/\d+\/simulation\.input$/i.test(path))continue;try{runMetadata.set(path.replace(/\/simulation\.input$/i,''),parseSimulationInput(await file.text()));}catch(error){diagnostics.push({severity:'warning',message:`Cannot parse ${path}: ${error.message}`});}}
  for (const file of list) {
    const path = (file.webkitRelativePath || file.name).replaceAll('\\', '/'), relative = path.split('/').slice(1).join('/');
    const parts = relative.split('/'), component = parts.find(part => CHAIN_RE.test(part));
    if (!component) continue;
    const run = parts[parts.indexOf(component) + 1];
    if (!RUN_RE.test(run || '')) continue;
    const manifestRow = rowsByPath.get(relative) || manifest.rows.find(row => relative.endsWith(row.collected_relative_path.replaceAll('\\', '/')));
    const isRdf=/\/RadialDistributionFunctions\//i.test(path)&&/\.dat$/i.test(file.name),isHistogram=/\/EndToEndDistanceHistograms\//i.test(path)&&/\.(dat|txt)$/i.test(file.name),isVtk=/\/VTK\//i.test(path)&&/\.vtk$/i.test(file.name),isMovie=/\/Movies\//i.test(path)&&/\.pdb$/i.test(file.name),isOutput=/\/Output\//i.test(path)&&/^output_.*\.data$/i.test(file.name);
    if (!isRdf && !isHistogram&&!isVtk&&!isMovie&&!isOutput) continue;
    const componentIndex=path.split('/').indexOf(component),runRoot=path.split('/').slice(0,componentIndex+2).join('/'),sim=runMetadata.get(runRoot);
    const definition=list.find(candidate=>{const p=(candidate.webkitRelativePath||candidate.name).replaceAll('\\','/');return p.startsWith(`${runRoot}/`)&&sim?.components?.some(c=>p.endsWith(`/${c.MoleculeName}.def`))});
    const simulationFile=list.find(candidate=>(candidate.webkitRelativePath||candidate.name).replaceAll('\\','/')===`${runRoot}/simulation.input`),pseudoatomsFile=list.find(candidate=>(candidate.webkitRelativePath||candidate.name).replaceAll('\\','/').startsWith(`${runRoot}/`)&&candidate.name==='pseudo_atoms.def');
    results.push({ datasetId, family:sim?.components?.map(x=>x.MoleculeName).join('+')||datasetId,component,componentNames:sim?.components?.map(x=>x.MoleculeName)||[],chainLength:Number(component.slice(1)),run:String(manifestRow?.run??run),pressurePa:manifestRow?.pressure_pa??sim?.pressurePa??null,temperatureK:sim?.temperatureK??null,framework:sim?.framework??null,unitCells:sim?.unitCells??null,type:isRdf?'rdf':isHistogram?'end_to_end':isVtk?'vtk':isMovie?'movie':'raspa_output',filename:file.name,path:relative,file,simulationFile,componentDefinition:definition||null,pseudoatomsFile:pseudoatomsFile||null,manifest:manifestRow||null,provenance:{datasetId,path:relative,manifestRow:manifestRow||null,simulationInput:sim?`${runRoot}/simulation.input`:null,componentDefinition:definition?(definition.webkitRelativePath||definition.name):null}});
  }
  for (const row of manifest.rows) if (!results.some(item => item.manifest === row)) diagnostics.push({ severity: 'warning', message: `Manifest target is not available to the plot catalog: ${row.collected_relative_path}` });
  results.sort((a,b)=>a.chainLength-b.chainLength||Number(a.run)-Number(b.run)||a.path.localeCompare(b.path));
  return { datasetId, chains, results, diagnostics, manifestPrimary: !!manifestFile };
}

/** Adapt the incremental handle catalog without reading an output file. */
export function buildHandleCatalog(catalog,{datasetId='dataset'}={}){const results=(catalog.summaries||[]).map(item=>{item.file.xKind=item.xKind;return {datasetId,family:datasetId,component:item.chain,chainLength:item.chainLength,type:item.type,xKind:item.xKind,filename:item.name,path:item.path,file:item.file,provenance:{datasetId,path:item.path}}});return {datasetId,chains:[...new Set((catalog.summaries||[]).map(r=>r.chain))].map(component=>({component,chainLength:Number(component.slice(1))})),results,diagnostics:[],manifestPrimary:!!catalog.manifest}}

export function buildSummaryIsothermCurves(parsedSummaries,{xKind='pressure'}={}){const curves=[],diagnostics=[];for(const {entry,parsed} of parsedSummaries){diagnostics.push(...parsed.diagnostics.map(x=>x.message));if(parsed.xKind!==xKind)continue;curves.push({...entry,type:'isotherm',family:entry.datasetId,sourcePath:entry.path,visible:true,loadingUnit:SUMMARY_LOADING_UNIT,xKind,records:parsed.records.map(row=>({...row,pressurePa:xKind==='pressure'?row.x:null,fugacityPa:xKind==='fugacity'?row.x:null}))})}curves.sort((a,b)=>a.chainLength-b.chainLength);return {curves,diagnostics}}

export function plottedExport(curves, configuration) {
  const data = curves.filter(curve => curve.visible !== false).flatMap(curve => curve.records.map(row => curve.type==='isotherm'?({dataset:curve.datasetId,family:curve.family,chain:curve.component,chain_length:curve.chainLength,x_kind:row.xKind,x_pa:row.x,pressure_pa:row.xKind==='pressure'?row.x:null,fugacity_pa:row.xKind==='fugacity'?row.x:null,loading_kind:row.loadingKind,loading_unit:row.loadingUnit,loading:row.loading,uncertainty:row.uncertainty,source_file:row.sourcePath,source_line:row.lineNumber}):({ dataset: curve.datasetId, family: curve.family, chain: curve.component, chain_length: curve.chainLength, run: curve.run, pressure_pa: curve.pressurePa, temperature_k:curve.temperatureK??null, framework:curve.framework??null, loading: curve.loading ?? null, source_file: curve.sourcePath, manifest_provenance:curve.manifest||null, result_type: curve.type, normalization:curve.normalizationMode??'native', x: row.distanceA, y: curve.type === 'rdf' ? row.gR : row.probabilityDensityPerA, x_unit: 'Å', y_unit: curve.type === 'rdf' ? 'dimensionless' : curve.normalizationMode==='stored'?'stored source units':'Å^-1' })));
  return { schema: 'porelens-chain-series/v1', configuration, data };
}

export function exportCsv(exported) {
  const columns = Object.keys(exported.data[0] || {}), quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return [columns.join(','), ...exported.data.map(row => columns.map(column => quote(row[column])).join(','))].join('\n');
}
