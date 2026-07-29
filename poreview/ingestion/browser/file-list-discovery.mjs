import {parseSimulationInput} from '../../../trajectory.mjs?rev=porelens-20260729-indexed-pdb-v1';
import {parseCif} from '../../../raspa-package.mjs?rev=porelens-20260729-indexed-pdb-v1';
import {parseMoleculeDefinition,parseMixingRules,parsePseudoAtoms} from '../../../raspa-physics.mjs?rev=porelens-20260729-indexed-pdb-v1';
import {isAllComponentsMovieBasename} from '../../../movie-filename.mjs?rev=porelens-20260729-indexed-pdb-v1';

const pathOf=file=>(file.webkitRelativePath||file.name||file.path||'').replace(/^\.\//,'').replace(/\\/g,'/');
const base=path=>path.split('/').at(-1);
const dirname=path=>path.split('/').slice(0,-1).join('/');
const numericEqual=(a,b)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=Math.max(1e-8,Math.abs(a),Math.abs(b))*1e-9;
async function textOf(file){return file.text!==undefined?(typeof file.text==='function'?file.text():file.text):'';}
async function digest(text){if(globalThis.crypto?.subtle){const bytes=new TextEncoder().encode(text),hash=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');}let h=2166136261;for(const c of text)h=Math.imul(h^c.charCodeAt(0),16777619);return `fnv32-${(h>>>0).toString(16)}`;}

/** Parse metadata rather than constructing one exact decimal-formatted filename. */
export function parseAllComponentsMovieFilename(filename){
  const match=base(filename).match(/^Movie_(.+)_([0-9]+)\.([0-9]+)\.([0-9]+)_([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?)_([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?)_allcomponents\.pdb$/i);
  return match?{framework:match[1],unitCells:match.slice(2,5).map(Number),temperatureK:Number(match[5]),pressurePa:Number(match[6])}:null;
}
export function movieMatchesSimulation(movie,sim){return !!movie&&movie.framework===sim.framework&&movie.unitCells.every((n,i)=>n===sim.unitCells?.[i])&&numericEqual(movie.temperatureK,sim.temperatureK)&&numericEqual(movie.pressurePa,sim.pressurePa);}

function manifestIndex(rows=[]){const map=new Map();for(const row of rows){const component=String(row.component||`C${row.n_value||''}`),run=String(row.run);if(!map.has(`${component}/${run}`))map.set(`${component}/${run}`,row);}return map;}
function scopesFor(runPath,root){const out=[runPath];let cursor=dirname(runPath);while(cursor&&cursor!==dirname(root)){out.push(cursor);if(cursor===root)break;cursor=dirname(cursor);}return out;}
async function validatedCandidates(files,test,parse){const rows=[];for(const file of files.filter(x=>test(pathOf(x))))try{const text=await textOf(file);parse(text,pathOf(file));rows.push({file,path:pathOf(file),fingerprint:await digest(text)});}catch{}return rows;}
function resolve(rows,kind,diagnostics){if(!rows.length){diagnostics.push({severity:'error',code:`missing_${kind}`,message:`No content-valid ${kind} was discovered in the run, dataset ancestors, common_inputs, or manifest paths.`});return null;}const fingerprints=new Set(rows.map(x=>x.fingerprint));if(fingerprints.size>1){diagnostics.push({severity:'error',code:`ambiguous_${kind}`,message:`Multiple content-distinct ${kind} candidates require explicit resolution: ${rows.map(x=>x.path).join(', ')}`,candidates:rows.map(x=>x.path)});return null;}if(rows.length>1)diagnostics.push({severity:'info',code:`duplicate_${kind}_identical`,message:`Equivalent ${kind} copies were fingerprinted; using nearest ${rows[0].path}.`,candidates:rows.map(x=>x.path)});return rows[0];}

/** Build a cached, lazy trajectory inventory from browser-selected relative paths. */
export async function discoverChainSeries(files,{manifestRows=[],datasetName=null}={}){
  const all=[...files],paths=all.map(pathOf),first=paths.find(p=>/^(?:[^/]+\/)?C\d+\/\d+\/simulation\.input$/i.test(p));
  const root=first?first.replace(/\/C\d+\/\d+\/simulation\.input$/i,''):'';
  const runPattern=new RegExp(`^${root?root.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'/':''}(C\\d+)\/(\\d+)\/simulation\\.input$`,'i'),runs=[],manifest=manifestIndex(manifestRows);
  for(const simFile of all){const simPath=pathOf(simFile),match=simPath.match(runPattern),single=!first&&simPath.match(/^(\d+)\/simulation\.input$/i);if(!match&&!single)continue;const run=match?.[2]||single[1],runPath=dirname(simPath),diagnostics=[];let simulation;
    try{simulation=parseSimulationInput(await textOf(simFile));}catch(error){diagnostics.push({severity:'error',code:'invalid_simulation_input',message:error.message});continue;}const chain=match?.[1]||(/C\d+/i.test(simulation.component?.MoleculeName||'')?simulation.component.MoleculeName:'C?');
    const movieCandidates=all.filter(f=>pathOf(f).startsWith(`${runPath}/Movies/`)&&isAllComponentsMovieBasename(pathOf(f))).map(file=>({file,path:pathOf(file),metadata:parseAllComponentsMovieFilename(pathOf(file))}));
    const matchingMovies=movieCandidates.filter(x=>movieMatchesSimulation(x.metadata,simulation));let movie=null;if(matchingMovies.length===1)movie=matchingMovies[0];else diagnostics.push({severity:matchingMovies.length?'error':'warning',code:matchingMovies.length?'duplicate_movies':'missing_movie',message:matchingMovies.length?`Multiple numerically matching movies require selection: ${matchingMovies.map(x=>x.path).join(', ')}`:`No movie matches simulation.input. Candidates: ${movieCandidates.map(x=>x.path).join(', ')||'none'}.`,candidates:movieCandidates.map(x=>x.path)});
    for(const candidate of movieCandidates.filter(x=>!movieMatchesSimulation(x.metadata,simulation)))diagnostics.push({severity:'warning',code:'movie_metadata_mismatch',message:`${candidate.path} contradicts simulation.input metadata.`});
    const scopes=scopesFor(runPath,root),eligible=all.filter(f=>{const p=pathOf(f);return scopes.some(s=>p.startsWith(`${s}/`))||/(^|\/)common_inputs(\/|$)/i.test(p)||manifestRows.some(r=>[r.source_relative_path,r.collected_relative_path].some(v=>v&&p.endsWith(v)));}).sort((a,b)=>{const pa=pathOf(a),pb=pathOf(b);return (pa.startsWith(runPath)?0:1)-(pb.startsWith(runPath)?0:1)||pa.length-pb.length;});
    const framework=resolve(await validatedCandidates(eligible,p=>base(p).toLowerCase()===`${simulation.framework}.cif`.toLowerCase(),text=>parseCif(text)),'framework CIF',diagnostics),molecules={};
    for(const component of simulation.components){const name=component.MoleculeName; molecules[name]=resolve(await validatedCandidates(eligible,p=>base(p).toLowerCase()===`${name}.def`.toLowerCase(),text=>parseMoleculeDefinition(text)) ,`${name} molecule definition`,diagnostics);}
    const pseudoatoms=resolve(await validatedCandidates(eligible,p=>/^pseudo_atoms\.def$/i.test(base(p)),text=>parsePseudoAtoms(text)),'pseudo_atoms.def',diagnostics),mixing=resolve(await validatedCandidates(eligible,p=>/^force_field_mixing_rules\.def$/i.test(base(p)),text=>parseMixingRules(text)),'force_field_mixing_rules.def',diagnostics),overrides=eligible.filter(f=>/^force_field\.def$/i.test(base(pathOf(f)))).map(file=>({file,path:pathOf(file)}));
    const outputFiles={rdf:all.filter(f=>pathOf(f).startsWith(`${runPath}/RadialDistributionFunctions/`)&&/\.dat$/i.test(pathOf(f))).map(file=>({file,path:pathOf(file)})),endToEnd:all.filter(f=>pathOf(f).startsWith(`${runPath}/EndToEndDistanceHistograms/`)&&/\.(?:dat|txt)$/i.test(pathOf(f))).map(file=>({file,path:pathOf(file)})),vtk:all.filter(f=>pathOf(f).startsWith(`${runPath}/VTK/`)&&/\.vtk$/i.test(pathOf(f))).map(file=>({file,path:pathOf(file)})),movies:movieCandidates};
    for(const [kind,items] of Object.entries(outputFiles))if(!items.length)diagnostics.push({severity:'info',code:`missing_output_${kind}`,message:`No ${kind} output is available; only that feature is disabled for this run.`});
    const m=manifest.get(`${chain}/${run}`),manifestPressure=m?Number(m.pressure_pa):null;if(m&&Number.isFinite(manifestPressure)&&!numericEqual(manifestPressure,simulation.pressurePa))diagnostics.push({severity:'error',code:'manifest_pressure_mismatch',message:`Manifest pressure ${manifestPressure} Pa contradicts simulation.input ${simulation.pressurePa} Pa; run identity was not remapped.`});
    const dependencies={framework,molecules,pseudoatoms,mixing,overrides};const physicsReady=!!(framework&&Object.values(molecules).every(Boolean)&&pseudoatoms&&mixing)&&!diagnostics.some(x=>x.severity==='error'&&x.code!=='duplicate_movies');runs.push({id:`${chain}/${run}`,family:simulation.components.map(x=>x.MoleculeName).join('+')||chain,chain,chainLength:Number(chain.slice(1)),run,pressurePa:Number.isFinite(manifestPressure)?manifestPressure:simulation.pressurePa,simulationPressurePa:simulation.pressurePa,framework:simulation.framework,temperatureK:simulation.temperatureK,unitCells:simulation.unitCells,forceField:simulation.forceField,simulationPath:simPath,simulationFile:simFile,movie,movieCandidates,outputs:outputFiles,dependencies,annotations:{run,pressurePa:Number.isFinite(manifestPressure)?manifestPressure:simulation.pressurePa,simulationPressurePa:simulation.pressurePa,framework:simulation.framework,temperatureK:simulation.temperatureK,unitCells:simulation.unitCells,componentNames:simulation.components.map(x=>x.MoleculeName),physicsFiles:{framework:framework?.path||null,molecules:Object.fromEntries(Object.entries(molecules).map(([k,v])=>[k,v?.path||null])),pseudoatoms:pseudoatoms?.path||null,mixing:mixing?.path||null,overrides:overrides.map(x=>x.path)}},ready:{rdf:!!outputFiles.rdf.length,endToEnd:!!outputFiles.endToEnd.length,vtk:!!outputFiles.vtk.length,movie:!!movie,physics:physicsReady,analysis:!!movie&&physicsReady},diagnostics});
  }
  runs.sort((a,b)=>a.chainLength-b.chainLength||Number(a.run)-Number(b.run));return {dataset:datasetName||root||'Selected dataset',root,runs,createdAt:new Date().toISOString()};
}

export function filesForCatalogRun(entry){
  const dependencies=entry.dependencies||{}, outputs=Object.values(entry.outputs||{}).flat();
  // Both directory-handle catalogs and compatibility-file catalogs expose the
  // same authorized File facade, but their dependency indexes have different
  // shapes.  Keep the facade lazy and never ask the user to authorize again.
  const dependencyFiles=dependencies.molecules
    ? [dependencies.framework?.file,...Object.values(dependencies.molecules).map(x=>x?.file),dependencies.pseudoatoms?.file,dependencies.mixing?.file,...(dependencies.overrides||[]).map(x=>x?.file)]
    : Object.values(dependencies).map(x=>x?.file||x);
  return [entry.simulationFile,...outputs.map(x=>x?.file||x),...dependencyFiles].filter(Boolean);
}

const canonicalChainIdentity=chain=>{
  if(typeof chain==='number'&&Number.isFinite(chain))return `C${chain}`;
  if(typeof chain==='string'&&chain.length)return /^\d+$/.test(chain)?`C${chain}`:chain;
  return null;
};
const identityCandidate=entry=>({id:entry.id??null,rootRelativePath:entry.rootRelativePath??null,chain:entry.chain??null,run:entry.run??null,pressurePa:Number(entry.pressurePa??entry.simulation?.pressurePa)});

/** Resolve the full dataset + chain/component + string-run + canonical-pressure identity without fallbacks. */
export function exactAuthorizedCatalogRun(catalog,{datasetFingerprint,currentDatasetFingerprint,chain,run,pressurePa}){
  const diagnostics=[];
  if(!datasetFingerprint||datasetFingerprint!==currentDatasetFingerprint)return {run:null,files:[],diagnostics:[{severity:'error',code:'dataset_identity_mismatch',message:'The annotation belongs to a different dataset identity. Re-select or reconcile that annotation; no run was substituted.'}]};
  const annotatedChain=canonicalChainIdentity(chain);
  if(!annotatedChain)return {run:null,files:[],diagnostics:[{severity:'error',code:'chain_identity_missing',message:'The annotation has no chain/component identity. No run from another chain was substituted.'}]};
  if(typeof run!=='string')return {run:null,files:[],diagnostics:[{severity:'error',code:'run_identity_not_string',message:'The annotation run identity must be a string; no numeric coercion or alternate run was used.'}]};
  if(!Number.isFinite(pressurePa))return {run:null,files:[],diagnostics:[{severity:'error',code:'invalid_canonical_pressure',message:'The annotation has no finite canonical pressurePa.'}]};
  const chainMatches=(catalog?.runs||[]).filter(x=>canonicalChainIdentity(x.chain)===annotatedChain);
  if(!chainMatches.length)return {run:null,files:[],diagnostics:[{severity:'error',code:'exact_chain_missing',message:`Authorized dataset does not contain chain/component “${annotatedChain}”. No run from another chain was substituted.`}]};
  const runMatches=chainMatches.filter(x=>String(x.run)===run);
  if(!runMatches.length)return {run:null,files:[],diagnostics:[{severity:'error',code:'exact_run_missing',message:`Authorized chain/component “${annotatedChain}” does not contain exact run “${run}”. No neighboring run was substituted.`}]};
  const exact=runMatches.filter(x=>Number(x.pressurePa??x.simulation?.pressurePa)===pressurePa);
  if(exact.length!==1)return {run:null,files:[],diagnostics:[{severity:'error',code:exact.length?'ambiguous_exact_run':'exact_pressure_mismatch',message:exact.length?`More than one authorized run has the full chain/component “${annotatedChain}”, string run “${run}”, and canonical pressure ${pressurePa} Pa identity. Resolve the duplicate before analysis.`:`Run “${run}” in chain/component “${annotatedChain}” does not have canonical pressure ${pressurePa} Pa. No nearest pressure was substituted.`,...(exact.length?{candidates:exact.map(identityCandidate)}:{})}]};
  const files=filesForCatalogRun(exact[0]);
  if(!files.length)diagnostics.push({severity:'error',code:'authorized_files_missing',message:'The exact run is indexed, but its authorized file handles are unavailable. Reauthorize the original dataset folder.'});
  return {run:exact[0],files,diagnostics};
}
