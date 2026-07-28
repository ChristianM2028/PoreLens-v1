import {parseSimulationInput} from '../../../trajectory.mjs';

const CHAIN=/^C\d+$/, RUN=/^\d+$/;
const SUMMARIES=new Map([['final_abs_pressure_up','pressure'],['final_abs_fug_up','fugacity']]);
const OUTPUTS={RadialDistributionFunctions:['rdf',/\.dat$/i],EndToEndDistanceHistograms:['end_to_end',/\.(?:dat|txt)$/i],Movies:['movie',/\.pdb$/i],VTK:['vtk',/\.vtk$/i],Output:['raspa_output',/^output_.*\.data$/i]};
const pause=()=>new Promise(resolve=>setTimeout(resolve,0));
const pathFile=(handle,path)=>({name:handle.name,path,handle,size:null,lastModified:null,async text(){return (await handle.getFile()).text()},async arrayBuffer(){return (await handle.getFile()).arrayBuffer()}});

/** A resumable, contract-aware scanner. It never constructs a complete tree list. */
export class DirectoryCatalogScanner {
  constructor(root,{batchSize=100,onUpdate=()=>{},previous=null}={}){
    this.root=root;this.batchSize=batchSize;this.onUpdate=onUpdate;this.previous=previous;
    this.cancelled=false;this.initialized=false;this.cursor=0;this.queue=[];this.catalog={version:2,name:root.name,runs:[],summaries:[],manifest:null,startedAt:Date.now(),finished:false,stats:{chains:0,runs:0,summaries:0,outputs:0,ignored:0,filesRead:0,yields:0,warnings:0,failures:0}};
    this.worker=typeof Worker!=='undefined'?new Worker(new URL('../../../catalog-worker.mjs',import.meta.url),{type:'module'}):null;this.workerId=0;
  }
  async parseSimulation(text){if(!this.worker)return parseSimulationInput(text);const id=++this.workerId;return new Promise((resolve,reject)=>{const receive=event=>{if(event.data.id!==id)return;this.worker.removeEventListener('message',receive);event.data.error?reject(new Error(event.data.error)):resolve(event.data.value)};this.worker.addEventListener('message',receive);this.worker.postMessage({id,text})})}
  cancel(){this.cancelled=true;this.emit('cancelled')}
  async resume(){this.cancelled=false;return this.scan()}
  emit(state='scanning'){this.onUpdate(this.catalog,{state,elapsedMs:Date.now()-this.catalog.startedAt})}
  async yieldIfNeeded(force=false){if(force||++this.cursor%this.batchSize===0){this.catalog.stats.yields++;this.emit();await pause()}}
  async init(){
    this.initialized=true;
    for await(const [name,handle] of this.root.entries()){
      if(handle.kind==='file'&&/^manifest(?:\.csv)?$/i.test(name)&&!this.catalog.manifest){const file=await handle.getFile();this.catalog.manifest={path:name,handle,file:pathFile(handle,name),text:await file.text()};this.catalog.stats.filesRead++}
      else if(handle.kind==='directory'&&CHAIN.test(name)){this.catalog.stats.chains++;for await(const [childName,child] of handle.entries()){if(child.kind==='file'&&SUMMARIES.has(childName)){this.catalog.summaries.push({type:'isotherm_summary',xKind:SUMMARIES.get(childName),chain:name,chainLength:Number(name.slice(1)),name:childName,path:`${name}/${childName}`,file:pathFile(child,`${name}/${childName}`),handle:child});this.catalog.stats.summaries++}else this.catalog.stats.ignored++;await this.yieldIfNeeded();if(this.cancelled)return}}
      else this.catalog.stats.ignored++;
      await this.yieldIfNeeded();if(this.cancelled)return;
    }
  }
  async scan(){
    if(!this.initialized)await this.init();
    while(this.queue.length&&!this.cancelled){const item=this.queue.shift();await this.indexRun(item.chain,item.run,item.handle);await this.yieldIfNeeded(true)}
    if(!this.cancelled){this.catalog.finished=true;this.emit('complete')}return this.catalog;
  }
  async indexRun(chain,run,handle){
    const item={id:`${chain}/${run}`,chain,run,handle,simulation:null,simulationFile:null,dependencies:{},outputs:{raspa_output:[],rdf:[],end_to_end:[],movie:[],vtk:[]},diagnostics:[]};
    try{for await(const [name,child] of handle.entries()){
      if(child.kind==='file'&&name==='simulation.input'){const file=await child.getFile(),text=await file.text();this.catalog.stats.filesRead++;item.simulationFile=pathFile(child,`${item.id}/${name}`);item.simulation=await this.parseSimulation(text)}
      else if(child.kind==='file'&&(/\.cif$/i.test(name)||/^(?:pseudo_atoms|force_field(?:_mixing_rules)?)\.def$/i.test(name)||/\.def$/i.test(name)))item.dependencies[name]=pathFile(child,`${item.id}/${name}`);
      else if(child.kind==='directory'&&OUTPUTS[name])await this.enumerateOutput(child,`${item.id}/${name}`,OUTPUTS[name],item);
      else this.catalog.stats.ignored++;
    }}catch(error){item.diagnostics.push(error.message);this.catalog.stats.failures++}
    if(!item.simulation){item.diagnostics.push('simulation.input is missing or invalid');this.catalog.stats.warnings++}
    this.catalog.runs.push(item);this.catalog.stats.runs++;this.emit('run');
  }
  async enumerateOutput(directory,path,[type,accept],run){
    for await(const [name,handle] of directory.entries()){
      if(handle.kind==='directory')await this.enumerateOutput(handle,`${path}/${name}`,[type,accept],run);
      else if(accept.test(name)){run.outputs[type].push({type,name,path:`${path}/${name}`,file:pathFile(handle,`${path}/${name}`),handle});this.catalog.stats.outputs++}
      else this.catalog.stats.ignored++;
      await this.yieldIfNeeded();if(this.cancelled)return;
    }
  }
}

export function lightweightSnapshot(catalog){return {version:catalog.version,name:catalog.name,finished:catalog.finished,stats:catalog.stats,summaries:(catalog.summaries||[]).map(({chain,chainLength,name,path,type,xKind})=>({chain,chainLength,name,path,type,xKind})),runs:catalog.runs.map(r=>({id:r.id,chain:r.chain,run:r.run,simulation:r.simulation,outputs:Object.fromEntries(Object.entries(r.outputs).map(([k,v])=>[k,v.map(x=>({name:x.name,path:x.path,type:x.type}))])),diagnostics:r.diagnostics}))}}

export async function persistDirectoryCatalog(catalog,root){if(!globalThis.indexedDB)return false;return new Promise((resolve,reject)=>{const req=indexedDB.open('porelens-local-catalog',1);req.onupgradeneeded=()=>req.result.createObjectStore('datasets');req.onerror=()=>reject(req.error);req.onsuccess=()=>{const tx=req.result.transaction('datasets','readwrite');tx.objectStore('datasets').put({root,catalog:lightweightSnapshot(catalog),savedAt:Date.now()},root.name);tx.oncomplete=()=>resolve(true);tx.onerror=()=>reject(tx.error)}})}

export async function restoreDirectoryCatalog(name){if(!globalThis.indexedDB)return null;return new Promise((resolve,reject)=>{const req=indexedDB.open('porelens-local-catalog',1);req.onupgradeneeded=()=>req.result.createObjectStore('datasets');req.onerror=()=>reject(req.error);req.onsuccess=()=>{const get=req.result.transaction('datasets').objectStore('datasets').get(name);get.onsuccess=()=>resolve(get.result||null);get.onerror=()=>reject(get.error)}})}
