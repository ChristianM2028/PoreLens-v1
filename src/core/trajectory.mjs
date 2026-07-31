// Compatibility entry point: keep the historical import path while exposing
// the canonical typed representation, not a second divergent flat parser.
export {parseSimulationInput} from '../import/parsers/simulation_input.mjs?rev=gemc-literature-three-column';

export function parsePdbMovie(text,{sitesPerMolecule=null,siteTypes=null}={}){
  const frames=[]; let frame=null;
  for(const line of text.split(/\r?\n/)){
    const type=line.slice(0,6).trim();
    if(type==='MODEL') frame={model:Number(line.slice(6).trim()),atoms:[],cell:null};
    else if(type==='CRYST1'&&frame) frame.cell=[Number(line.slice(6,15)),Number(line.slice(15,24)),Number(line.slice(24,33))];
    else if((type==='ATOM'||type==='HETATM')&&frame) frame.atoms.push({serial:Number(line.slice(6,11)),atomName:line.slice(12,16).trim(),x:Number(line.slice(30,38)),y:Number(line.slice(38,46)),z:Number(line.slice(46,54)),element:line.slice(76,78).trim()});
    else if(type==='ENDMDL'&&frame){
      if(!frame.cell||frame.atoms.some(a=>![a.x,a.y,a.z].every(Number.isFinite))) throw new Error(`Malformed PDB model ${frame.model}`);
      if(sitesPerMolecule!==null){
        if(!Number.isInteger(sitesPerMolecule)||frame.atoms.length%sitesPerMolecule) throw new Error(`Model ${frame.model} atom count is incompatible with topology`);
        frame.atoms.forEach((atom,index)=>{atom.moleculeIndex=Math.floor(index/sitesPerMolecule);atom.siteIndex=index%sitesPerMolecule;atom.siteType=siteTypes?.[atom.siteIndex]??null;});
      }
      frames.push(frame); frame=null;
    }
  }
  if(frame) throw new Error('PDB model is missing ENDMDL');
  if(!frames.length) throw new Error('PDB movie contains no complete models');
  return {frames,lossyAtomLabels:new Set(frames.flatMap(f=>f.atoms.map(a=>a.atomName))).size===1,roleSpecificAnalysisEnabled:sitesPerMolecule!==null&&siteTypes?.length===sitesPerMolecule};
}

/** Build a deterministic selection of zero-based frames from equal trajectory intervals. */
export function analysisRange({totalFrames,intervalCount=1,firstInterval=1,lastInterval=intervalCount,stride=1}={}){
  for(const [name,value] of Object.entries({totalFrames,intervalCount,firstInterval,lastInterval,stride}))if(!Number.isInteger(value))throw new TypeError(`${name} must be an integer`);
  if(totalFrames<1)throw new RangeError('totalFrames must be positive');
  if(intervalCount<1)throw new RangeError('intervalCount must be positive');
  if(firstInterval<1||lastInterval>intervalCount||firstInterval>lastInterval)throw new RangeError(`Intervals must satisfy 1 <= firstInterval <= lastInterval <= ${intervalCount}`);
  if(stride<1)throw new RangeError('stride must be positive');
  const startFrame=Math.floor((firstInterval-1)*totalFrames/intervalCount),endFrame=Math.floor(lastInterval*totalFrames/intervalCount);
  const frameIndices=[];for(let index=startFrame;index<endFrame;index+=stride)frameIndices.push(index);
  return {totalFrames,intervalCount,firstInterval,lastInterval,stride,startFrame,endFrame,frameIndices,analyzedFrameCount:frameIndices.length,frameNumbering:'zero-based half-open'};
}

/** Validate the evidence needed to assign lossy PDB atoms by RASPA site order. */
export function validateMovieTopology({simulation,componentDefinitionName,topology,pseudoatoms,frameAtomCounts}){
  if(!simulation||!topology||!pseudoatoms)throw new Error('simulation.input, component .def, and pseudo_atoms.def are all required');
  if(simulation.components.length!==1)throw new Error(`All-components movie is ambiguous for ${simulation.components.length} adsorbate components; select a component-specific trajectory or explicit mapping`);
  const component=simulation.components[0],expected=`${component.name}.def`;
  if(componentDefinitionName?.split(/[\\/]/).at(-1)!==expected)throw new Error(`Component definition must be ${expected}, as referenced by simulation.input`);
  if(topology.sites.length!==topology.sitesPerMolecule||topology.sites.some((site,index)=>site.index!==index))throw new Error('Template indices must be unique and complete from 0 through N-1');
  for(const site of topology.sites)if(!pseudoatoms.has(site.type))throw new Error(`Required pseudoatom ${site.type} is missing from pseudo_atoms.def`);
  for(const bond of topology.bonds||[])if(bond.some(index=>index<0||index>=topology.sitesPerMolecule))throw new Error('A bond references an invalid template index');
  if(!(topology.bonds?.length))throw new Error('Bond connectivity is required for topology validation');
  if(!frameAtomCounts?.length||frameAtomCounts.some(count=>!Number.isInteger(count)||count%topology.sitesPerMolecule!==0))throw new Error('At least one parsed frame does not consist of whole contiguous molecule blocks');
  const degree=Array(topology.sitesPerMolecule).fill(0);for(const [a,b] of topology.bonds){degree[a]++;degree[b]++;}
  const counts=new Map();for(const site of topology.sites)counts.set(site.type,(counts.get(site.type)||0)+1);
  return {validated:true,siteMappingValidated:true,bondConnectivityValidated:true,bondCount:topology.bonds.length,componentName:component.name,sitesPerMolecule:topology.sitesPerMolecule,siteTypes:topology.sites.map(x=>x.type),siteRoles:degree.map(value=>value===1?'terminal':'internal'),typeCounts:Object.fromEntries(counts),moleculeCounts:frameAtomCounts.map(x=>x/topology.sitesPerMolecule)};
}

/** Byte/character ranges for complete PDB models; callers decode only the selected range. */
export function indexPdbFrames(text){
  const frames=[];let start=-1,model=null;const diagnostics=[];const re=/^(MODEL\s+([^\r\n]+)|ENDMDL)\s*$/gm;let match;
  while((match=re.exec(text))){if(match[1].startsWith('MODEL')){start=match.index;model=Number(match[2].trim())}else if(start>=0){frames.push({model:Number.isFinite(model)?model:frames.length+1,start,end:re.lastIndex});start=-1;}}
  if(start>=0)diagnostics.push({code:'incomplete_trailing_model',model:Number.isFinite(model)?model:null,message:'Skipped an incomplete trailing MODEL without a matching ENDMDL.'});
  if(!frames.length)throw new Error('PDB movie contains no complete models');
  // Arrays keep existing callers cheap while exposing non-fatal indexing diagnostics.
  Object.defineProperty(frames,'diagnostics',{value:diagnostics,enumerable:false});return frames;
}
export function decodeIndexedPdbFrame(text,indexEntry,options={}){return parsePdbMovie(text.slice(indexEntry.start,indexEntry.end),options).frames[0]}

const abortError=()=>new DOMException('Trajectory read cancelled','AbortError');
async function sourceText(source,signal){if(signal?.aborted)throw abortError();if(typeof source==='string')return source;if(typeof source?.text==='string')return source.text;if(typeof source?.text==='function'){const value=await source.text();if(signal?.aborted)throw abortError();return value;}throw new TypeError('Trajectory source must be a Blob, File, file-handle, string, or explicit text fixture');}
async function sourceBlob(source){if(source?.getFile)return source.getFile();return source;}

/** Scan complete models without constructing atom objects; byte offsets are retained for Blob sources. */
export async function indexPdbSource(source,{signal=null}={}){
  source=await sourceBlob(source);if(signal?.aborted)throw abortError();
  // Blob slicing keeps the trajectory lazy after this bounded line scan. Explicit text
  // fixtures use character offsets and remain useful in Node tests.
  if(typeof source?.slice==='function'&&Number.isFinite(source.size)){
    const decoder=new TextDecoder(),reader=source.stream().getReader(),frames=[],diagnostics=[];let pending='',consumed=0,start=null,model=null,atomCount=0;
    try{while(true){if(signal?.aborted){await reader.cancel();throw abortError()}const {done,value}=await reader.read();const chunk=decoder.decode(value||new Uint8Array(),{stream:!done});pending+=chunk;let newline;while((newline=pending.indexOf('\n'))>=0){const raw=pending.slice(0,newline+1),line=raw.replace(/[\r\n]+$/,'');const bytes=new TextEncoder().encode(raw).length,lineStart=consumed;consumed+=bytes;pending=pending.slice(newline+1);const type=line.slice(0,6).trim();if(type==='MODEL'){start=lineStart;model=Number(line.slice(6).trim());atomCount=0}else if((type==='ATOM'||type==='HETATM')&&start!==null)atomCount++;else if(type==='ENDMDL'&&start!==null){frames.push({model:Number.isFinite(model)?model:frames.length+1,start,end:consumed,atomCount});start=null}}if(done)break}
    }finally{reader.releaseLock()}if(start!==null)diagnostics.push({code:'incomplete_trailing_model',model:Number.isFinite(model)?model:null,message:'Skipped an incomplete trailing MODEL without a matching ENDMDL.'});if(!frames.length)throw new Error('PDB movie contains no complete models');return {frames,diagnostics,source,offsetUnit:'byte'};
  }
  const text=await sourceText(source,signal),frames=indexPdbFrames(text);return {frames:[...frames].map(entry=>({...entry,atomCount:(text.slice(entry.start,entry.end).match(/^(?:ATOM  |HETATM)/gm)||[]).length})),diagnostics:frames.diagnostics||[],source,text,offsetUnit:'character'};
}

export async function decodePdbSourceFrame(index,indexEntry,options={},signal=null){if(signal?.aborted)throw abortError();let text;if(index.offsetUnit==='byte'){const blob=index.source.slice(indexEntry.start,indexEntry.end);text=await blob.text()}else text=index.text.slice(indexEntry.start,indexEntry.end);if(signal?.aborted)throw abortError();return decodeIndexedPdbFrame(text,{...indexEntry,start:0,end:text.length},options)}

/** Decode selected frames one at a time so callers need retain only current coordinates. */
export async function* selectedPdbFrames(index,range,options={},signal=null){for(const frameIndex of range.frameIndices){if(signal?.aborted)throw abortError();const entry=index.frames[frameIndex];if(!entry)throw new RangeError(`Frame ${frameIndex} is outside the trajectory`);const frame=await decodePdbSourceFrame(index,entry,options,signal);yield {frameIndex,modelNumber:entry.model,frame};}}

/** One-at-a-time frame preparation with stale-result rejection and atomic commits. */
export class SerializedFrameScheduler{
  constructor({prepare,commit,onError=()=>{}}){this.prepare=prepare;this.commit=commit;this.onError=onError;this.generation=0;this.inFlight=false;this.pending=null;this.active=false;}
  cancel(){this.generation++;this.pending=null;this.active=false;}
  request(index){this.pending=index;const generation=this.generation;if(!this.inFlight)this.drain(generation);}
  async drain(generation){if(this.inFlight||this.pending==null)return;this.inFlight=true;const index=this.pending;this.pending=null;
    try{const prepared=await this.prepare(index,generation);if(generation===this.generation&&prepared!=null)this.commit(prepared,index);}
    catch(error){if(generation===this.generation)this.onError(error,index);}
    finally{this.inFlight=false;if(generation===this.generation&&this.pending!=null)this.drain(generation);}
  }
  play(next,delay){if(this.active)return;this.active=true;const generation=this.generation;const tick=()=>{if(!this.active||generation!==this.generation)return;this.request(next());setTimeout(tick,delay())};tick();}
  pause(){this.active=false;}
}

export function minimumImageDisplacement(a,b,cell){
  return [a.x-b.x,a.y-b.y,a.z-b.z].map((delta,i)=>delta-Math.round(delta/cell[i])*cell[i]);
}
export function minimumImageDistance(a,b,cell){return Math.hypot(...minimumImageDisplacement(a,b,cell));}

export function contactsInBand(left,right,cell,minA,maxA){
  const contacts=[];
  left.forEach((a,i)=>right.forEach((b,j)=>{const distanceA=minimumImageDistance(a,b,cell);if(distanceA>=minA&&distanceA<=maxA)contacts.push({leftIndex:i,rightIndex:j,distanceA});}));
  return contacts;
}
