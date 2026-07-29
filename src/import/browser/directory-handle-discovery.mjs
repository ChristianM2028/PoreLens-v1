import {parseSimulationInput,parseMixingRules,parsePseudoAtoms,parseMoleculeDefinition} from '../parsers/index.mjs?rev=porelens-20260729-indexed-pdb-v1';
import {isAllComponentsMovieBasename} from '../movie-filename.mjs?rev=porelens-20260729-indexed-pdb-v1';
import {indexVtk,readVtkHeaderPrefix} from '../parsers/vtk.mjs?rev=porelens-20260729-indexed-pdb-v1';

const CHAIN=/^C\d+$/i, RUN=/^\d+(?:_|$)/;
const SUMMARIES=new Map([['final_abs_pressure_up','pressure'],['final_abs_fug_up','fugacity']]);
const OUTPUTS={RadialDistributionFunctions:['rdf',/\.(?:dat|txt|data)$/i],EndToEndDistanceHistograms:['end_to_end',/\.(?:dat|txt|data)$/i],Movies:['movie',isAllComponentsMovieBasename],VTK:['vtk',/\.(?:vtk|vti)$/i],Output:['raspa_output',/\.data$/i]};
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
const extension=name=>{const match=name.match(/(\.[^.]+)$/);return match?match[1].toLowerCase():''};
const pathFile=(handle,path)=>({name:handle.name,path,handle,size:null,lastModified:null,async text(){return (await handle.getFile()).text()},async arrayBuffer(){return (await handle.getFile()).arrayBuffer()}});

function stats(){return {chains:0,runs:0,summaries:0,outputs:0,rdfs:0,endToEnd:0,vtk:0,simulationInputs:0,moleculeDefinitions:0,ignored:0,filesRead:0,yields:0,warnings:0,failures:0}}

/** Authoritative browser discovery for directory handles. Output bytes stay lazy. */
export class DirectoryCatalogScanner {
  constructor(root,{batchSize=100,onUpdate=()=>{},previous=null}={}){
    this.root=root;this.batchSize=batchSize;this.onUpdate=onUpdate;this.previous=previous;
    this.cancelled=false;this.initialized=false;this.cursor=0;this.queue=[];this.catalog={version:3,name:root.name,runs:[],summaries:[],ignoredFiles:[],diagnostics:[],manifest:null,startedAt:Date.now(),finished:false,authorized:true,stats:stats()};
    this.worker=typeof Worker!=='undefined'?new Worker(new URL('../../workers/catalog-worker.mjs?rev=porelens-20260729-indexed-pdb-v1',import.meta.url),{type:'module'}):null;this.workerId=0;
  }
  async parseSimulation(text){if(!this.worker)return parseSimulationInput(text);const id=++this.workerId;return new Promise((resolve,reject)=>{const receive=event=>{if(event.data.id!==id)return;this.worker.removeEventListener('message',receive);event.data.error?reject(new Error(event.data.error)):resolve(event.data.value)};this.worker.addEventListener('message',receive);this.worker.postMessage({id,text})})}
  ignored(path,reason,parentOutputDirectory=null){const name=path.split('/').at(-1);this.catalog.ignoredFiles.push({relativePath:path,filename:name,extension:extension(name),parentOutputDirectory,reason});this.catalog.stats.ignored++}
  diagnostic(severity,code,message,path=null){this.catalog.diagnostics.push({severity,code,message,path});if(severity==='error')this.catalog.stats.failures++;else this.catalog.stats.warnings++}
  cancel(){this.cancelled=true;this.emit('cancelled')}
  async resume(){this.cancelled=false;return this.scan()}
  emit(state='scanning'){this.onUpdate(this.catalog,{state,elapsedMs:Date.now()-this.catalog.startedAt})}
  async yieldIfNeeded(force=false){if(force||++this.cursor%this.batchSize===0){this.catalog.stats.yields++;this.emit();await pause()}}
  async init(){
    this.initialized=true;
    await this.discoverRoot(this.root,'');
  }
  async discoverRoot(directory,prefix){
    for await(const [name,handle] of directory.entries()){
      const rootPath=prefix?`${prefix}/${name}`:name;
      if(handle.kind==='file'&&/^manifest(?:\.csv)?$/i.test(name)&&!this.catalog.manifest){const file=await handle.getFile();this.catalog.manifest={path:name,handle,file:pathFile(handle,name),text:await file.text()};this.catalog.stats.filesRead++}
      else if(handle.kind==='directory'&&CHAIN.test(name)){this.catalog.stats.chains++;for await(const [childName,child] of handle.entries()){
        const path=`${rootPath}/${childName}`;
        if(child.kind==='file'&&SUMMARIES.has(childName)){this.catalog.summaries.push({type:'isotherm_summary',xKind:SUMMARIES.get(childName),chain:name,chainLength:Number(name.slice(1)),name:childName,path,file:pathFile(child,path),handle:child});this.catalog.stats.summaries++}
        else if(child.kind==='directory'&&RUN.test(childName))this.queue.push({chain:name,run:childName,handle:child,prefix:rootPath});
        else this.ignored(path,child.kind==='directory'?'directory is not a numbered simulation run':'unrecognized chain-level file');
        await this.yieldIfNeeded();if(this.cancelled)return;
      }} else if(handle.kind==='directory')await this.discoverRoot(handle,rootPath);
      else this.ignored(rootPath,'unrecognized dataset-root file');
      await this.yieldIfNeeded();if(this.cancelled)return;
    }
  }
  async scan(){
    if(!this.initialized)await this.init();
    while(this.queue.length&&!this.cancelled){const item=this.queue.shift();await this.indexRun(item.chain,item.run,item.handle,item.prefix);await this.yieldIfNeeded(true)}
    if(!this.cancelled){const rdfDirectories=this.catalog.runs.filter(r=>r.rdfDirectories>0).length;if(rdfDirectories&&!this.catalog.stats.rdfs)this.diagnostic('error','rdf_directories_empty','RadialDistributionFunctions directories were found, but no RDF files were indexed.');if(this.catalog.stats.ignored&&!this.catalog.stats.rdfs)this.diagnostic('error','no_rdf_selector_records',`${this.catalog.stats.ignored} files were ignored and no RDF records can reach the selector model.`);this.catalog.finished=true;this.emit(this.catalog.stats.failures?'complete-with-errors':'complete')}return this.catalog;
  }
  async indexRun(chain,run,handle,prefix=chain){
    const item={id:`${chain}/${run}`,rootRelativePath:`${prefix}/${run}`,chain,run,handle,simulation:null,simulationFile:null,dependencies:{},pseudoAtoms:null,forceFieldParameters:null,moleculeDefinitions:[],outputs:{raspa_output:[],rdf:[],end_to_end:[],movie:[],vtk:[]},rdfDirectories:0,diagnostics:[]};
    try{await this.walkRun(handle,item.rootRelativePath,item)}catch(error){item.diagnostics.push(error.message);this.diagnostic('error','run_scan_failed',error.message,item.id)}
    if(!item.simulation){item.diagnostics.push('simulation.input is missing or invalid');this.diagnostic('warning','missing_simulation_input','simulation.input is missing or invalid',item.id)}
    else await this.parseRunDefinitions(item);
    this.catalog.runs.push(item);this.catalog.stats.runs++;this.emit('run');
  }
  async parseRunDefinitions(item){
    const dependency=name=>Object.values(item.dependencies).find(file=>file.name.toLowerCase()===name.toLowerCase());
    const read=async file=>{this.catalog.stats.filesRead++;return file.text()};
    try{const pseudo=dependency('pseudo_atoms.def');if(pseudo)item.pseudoAtoms=parsePseudoAtoms(await read(pseudo),pseudo.path)}catch(error){item.diagnostics.push(`pseudo_atoms.def: ${error.message}`)}
    try{const mixing=dependency('force_field_mixing_rules.def');if(mixing)item.forceFieldParameters=parseMixingRules(await read(mixing),mixing.path)}catch(error){item.diagnostics.push(`force_field_mixing_rules.def: ${error.message}`)}
    for(const component of item.simulation.components||[]){
      const candidates=[`${component.name}.def`,component.moleculeDefinition].filter(x=>x&&/\.def$/i.test(x));
      const file=candidates.map(dependency).find(Boolean);
      if(!file){item.diagnostics.push(`molecule definition missing for component ${component.name}`);continue}
      try{item.moleculeDefinitions.push({component:component.name,path:file.path,file,parsed:parseMoleculeDefinition(await read(file),file.path)})}catch(error){item.diagnostics.push(`${file.name}: ${error.message}`)}
    }
  }
  async walkRun(directory,base,item){for await(const [name,child] of directory.entries()){
      const path=`${base}/${name}`;
      if(child.kind==='file'&&name.toLowerCase()==='simulation.input'){const file=await child.getFile(),text=await file.text();this.catalog.stats.filesRead++;this.catalog.stats.simulationInputs++;item.simulationFile=pathFile(child,path);item.simulation=await this.parseSimulation(text)}
      else if(child.kind==='file'&&(/\.cif$/i.test(name)||/\.def$/i.test(name))){item.dependencies[name]=pathFile(child,path);if(/\.def$/i.test(name))this.catalog.stats.moleculeDefinitions++}
      else if(child.kind==='directory'&&Object.keys(OUTPUTS).find(key=>key.toLowerCase()===name.toLowerCase())){const outputName=Object.keys(OUTPUTS).find(key=>key.toLowerCase()===name.toLowerCase());if(outputName==='RadialDistributionFunctions')item.rdfDirectories++;await this.enumerateOutput(child,path,OUTPUTS[outputName],item,outputName)}
      else if(child.kind==='directory')await this.walkRun(child,path,item);
      else this.ignored(path,'unrecognized file beneath simulation run');
      await this.yieldIfNeeded();if(this.cancelled)return;
    }
  }
  async enumerateOutput(directory,path,[type,accept],run,parentOutputDirectory){
    for await(const [name,handle] of directory.entries()){
      const childPath=`${path}/${name}`;
      if(handle.kind==='directory')await this.enumerateOutput(handle,childPath,[type,accept],run,parentOutputDirectory);
      else if(typeof accept==='function'?accept(name):accept.test(name)){const file=pathFile(handle,childPath),metadata=type==='vtk'?indexVtk(childPath,await readVtkHeaderPrefix(file),{componentNames:run.simulation?.components?.map(x=>x.name??x.MoleculeName).filter(Boolean)||[]}):{};run.outputs[type].push({type,name,path:childPath,file,handle,...metadata});this.catalog.stats.outputs++;if(type==='rdf')this.catalog.stats.rdfs++;else if(type==='end_to_end')this.catalog.stats.endToEnd++;else if(type==='vtk')this.catalog.stats.vtk++}
      else this.ignored(childPath,`unsupported file for ${parentOutputDirectory}`,parentOutputDirectory);
      await this.yieldIfNeeded();if(this.cancelled)return;
    }
  }
}

export function lightweightSnapshot(catalog){return {version:catalog.version,name:catalog.name,finished:catalog.finished,authorized:false,stats:catalog.stats,ignoredFiles:catalog.ignoredFiles,diagnostics:catalog.diagnostics,summaries:(catalog.summaries||[]).map(({chain,chainLength,name,path,type,xKind})=>({chain,chainLength,name,path,type,xKind})),runs:catalog.runs.map(r=>({id:r.id,chain:r.chain,run:r.run,simulation:r.simulation,rdfDirectories:r.rdfDirectories,outputs:Object.fromEntries(Object.entries(r.outputs).map(([k,v])=>[k,v.map(x=>({name:x.name,path:x.path,type:x.type}))])),diagnostics:r.diagnostics}))}}
export async function persistDirectoryCatalog(catalog,root){if(!globalThis.indexedDB)return false;return new Promise((resolve,reject)=>{const req=indexedDB.open('porelens-local-catalog',1);req.onupgradeneeded=()=>req.result.createObjectStore('datasets');req.onerror=()=>reject(req.error);req.onsuccess=()=>{const tx=req.result.transaction('datasets','readwrite');tx.objectStore('datasets').put({root,catalog:lightweightSnapshot(catalog),savedAt:Date.now()},root.name);tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error)}})}
export async function restoreDirectoryCatalog(name){if(!globalThis.indexedDB)return null;return new Promise((resolve,reject)=>{const req=indexedDB.open('porelens-local-catalog',1);req.onupgradeneeded=()=>req.result.createObjectStore('datasets');req.onerror=()=>reject(req.error);req.onsuccess=()=>{const get=req.result.transaction('datasets').objectStore('datasets').get(name);get.onsuccess=()=>resolve(get.result||null);get.onerror=()=>reject(get.error)}})}
