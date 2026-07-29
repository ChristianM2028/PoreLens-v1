import {parseMoleculeDefinition} from './raspa-physics.mjs?rev=porelens-20260729-simulation-shape-v2';
import {parseVtkCellParameters} from './spatial-registration.mjs?rev=porelens-20260729-simulation-shape-v2';

const finite=n=>Number.isFinite(n);
const cleanLines=text=>text.split(/\r?\n/).map((raw,index)=>({raw,trimmed:raw.trim(),line:index+1}));

/** Parse a two-column RASPA online end-to-end observable without guessing its normalization. */
export function parseEndToEndDistribution(text,source='end-to-end histogram'){
  const records=[],comments=[];
  for(const {raw,trimmed,line} of cleanLines(text)){
    if(!trimmed)continue;
    if(/^(#|!|;|@|%)/.test(trimmed)){comments.push(trimmed);continue;}
    const columns=trimmed.split(/\s+/).map(Number);
    if(columns.length<2||!columns.slice(0,2).every(finite))throw new Error(`${source}: malformed numeric row ${line}`);
    records.push({distanceA:columns[0],sourceValue:columns[1]});
  }
  if(records.length<2)throw new Error(`${source}: requires at least two numeric rows`);
  if(records.some((row,i)=>i&&row.distanceA<=records[i-1].distanceA))throw new Error(`${source}: distance grid must be strictly increasing`);
  if(records.some(row=>row.sourceValue<0))throw new Error(`${source}: distribution values must be non-negative`);
  const header=comments.join(' ').toLowerCase();
  const semantics=/probability\s*density|normalized\s*(?:density|histogram)/.test(header)?'probability_density':/raw|count|observation|frequency/.test(header)?'raw_weight':'stored_values';
  const integral=trapezoid(records.map(x=>x.distanceA),records.map(x=>x.sourceValue));
  return {records,comments,semantics,integral,normalizations:{stored:true,probability:integral>0,normalizedDensity:integral>0,rawDensity:semantics==='raw_weight'},source};
}

const trapezoid=(x,y)=>x.slice(1).reduce((sum,_,i)=>sum+(x[i+1]-x[i])*(y[i]+y[i+1])/2,0);
const quantile=(x,y,total,q)=>{let area=0,target=q*total;for(let i=0;i<x.length-1;i++){const dx=x[i+1]-x[i],a=dx*(y[i]+y[i+1])/2;if(area+a>=target){const fraction=a?Math.max(0,Math.min(1,(target-area)/a)):0;return x[i]+fraction*dx;}area+=a;}return x.at(-1)};

export function distributionView(parsed,mode='stored'){
  const denom=mode==='stored'?1:parsed.integral;
  if(!(denom>0))throw new Error('A zero-integral distribution cannot be normalized');
  if(mode==='raw_density'&&!parsed.normalizations.rawDensity)throw new Error('Raw density is unavailable because the source does not identify raw weights');
  return parsed.records.map(row=>({distanceA:row.distanceA,value:row.sourceValue/denom}));
}

/** Continuous, bin-center statistics. No uncertainty is invented. */
export function distributionStatistics(parsed){
  const x=parsed.records.map(r=>r.distanceA),y=parsed.records.map(r=>r.sourceValue),z=parsed.integral;
  if(!(z>0))return {valid:false,reason:'Distribution has zero integrated weight'};
  const mean=trapezoid(x,x.map((v,i)=>v*y[i]))/z,second=trapezoid(x,x.map((v,i)=>v*v*y[i]))/z;
  const qs=Object.fromEntries([.05,.25,.5,.75,.95].map(q=>[String(q),quantile(x,y,z,q)]));
  const maximum=Math.max(...y),modes=x.filter((_,i)=>y[i]===maximum);
  return {valid:true,mean,median:qs['0.5'],mode:modes.length===1?modes[0]:null,modeAmbiguous:modes.length!==1,standardDeviation:Math.sqrt(Math.max(0,second-mean*mean)),quantiles:qs,width:{interquartile:qs['0.75']-qs['0.25'],central90:qs['0.95']-qs['0.05']},uncertainty:null};
}

export function terminalPseudoatoms(definitionText){
  try{const topology=parseMoleculeDefinition(definitionText),sites=topology.sites;if(sites.length<2)return {valid:false,reason:'Topology has fewer than two ordered sites',terminals:[]};
    return {valid:true,terminals:[sites[0],sites.at(-1)],sitesPerMolecule:sites.length,warning:sites.length<=2?'C1/C2 terminal interpretation requires manual scientific validation.':null};
  }catch(error){return {valid:false,reason:error.message,terminals:[]};}
}

function tokens(text){return text.replace(/\r/g,'').split(/\s+/).filter(Boolean)}
/** Strict ASCII legacy STRUCTURED_POINTS / IMAGE_DATA reader; arrays are retained independently. */
export function parseLegacyVtk(text,source='VTK grid'){
  const lines=text.replace(/\r/g,'').split('\n');
  if(!/^# vtk DataFile Version/i.test(lines[0]||''))throw new Error(`${source}: not a legacy VTK file`);
  if(!lines.some(x=>/^\s*ASCII\s*$/i.test(x)))throw new Error(`${source}: only ASCII legacy VTK is supported`);
  const dataset=(lines.find(x=>/^\s*DATASET\s+/i.test(x))||'').trim().split(/\s+/)[1]?.toUpperCase();
  if(!['STRUCTURED_POINTS','IMAGE_DATA'].includes(dataset))throw new Error(`${source}: unsupported DATASET ${dataset||'(missing)'}`);
  const triple=name=>{const line=lines.find(x=>new RegExp(`^\\s*${name}\\s+`,'i').test(x));const values=line?.trim().split(/\s+/).slice(1).map(Number);if(values?.length!==3||!values.every(finite))throw new Error(`${source}: invalid ${name}`);return values};
  const dimensions=triple('DIMENSIONS').map(Number),origin=triple('ORIGIN'),spacing=triple('SPACING');
  if(dimensions.some(x=>!Number.isInteger(x)||x<1)||spacing.some(x=>!(x>0)))throw new Error(`${source}: invalid grid geometry`);
  const expected=dimensions.reduce((a,b)=>a*b,1),pointLine=lines.findIndex(x=>/^\s*POINT_DATA\s+/i.test(x));
  if(pointLine<0||Number(lines[pointLine].trim().split(/\s+/)[1])!==expected)throw new Error(`${source}: POINT_DATA does not match dimensions`);
  const arrays=[];let i=pointLine+1;
  while(i<lines.length){if(!/^\s*SCALARS\s+/i.test(lines[i])){i++;continue}const header=lines[i].trim().split(/\s+/),name=header[1],components=Number(header[3]||1);if(components!==1)throw new Error(`${source}: scalar ${name} has unsupported component count`);i++;if(/^\s*LOOKUP_TABLE/i.test(lines[i]||''))i++;const values=[];while(i<lines.length&&!/^\s*(?:SCALARS|VECTORS|FIELD)\s+/i.test(lines[i])){for(const token of tokens(lines[i])){const value=Number(token);if(!finite(value))throw new Error(`${source}: non-finite scalar ${name}`);values.push(value);}i++;}if(values.length!==expected)throw new Error(`${source}: scalar ${name} has ${values.length} values; expected ${expected}`);arrays.push({name,dataType:header[2]||'unknown',values});
  }
  if(!arrays.length)throw new Error(`${source}: no scalar arrays found`);
  return {format:'legacy-ascii-vtk',dataset,dimensions,origin,spacing,cellParameters:parseVtkCellParameters(text),arrays,source,pointCount:expected};
}

export const voxelIndex=(grid,x,y,z)=>x+grid.dimensions[0]*(y+grid.dimensions[1]*z);
export function vtkSlice(grid,arrayName,axis,index){const a=grid.arrays.find(x=>x.name===arrayName);if(!a)throw new Error(`Unknown scalar array ${arrayName}`);const ai={x:0,y:1,z:2}[axis];if(ai==null||index<0||index>=grid.dimensions[ai])throw new Error('Slice position is outside the grid');const values=[];for(let z=0;z<grid.dimensions[2];z++)for(let y=0;y<grid.dimensions[1];y++)for(let x=0;x<grid.dimensions[0];x++)if([x,y,z][ai]===index)values.push({x,y,z,value:a.values[voxelIndex(grid,x,y,z)]});return values;}
export function inspectVoxel(grid,arrayName,x,y,z){const array=grid.arrays.find(a=>a.name===arrayName);if(!array||[x,y,z].some((v,i)=>!Number.isInteger(v)||v<0||v>=grid.dimensions[i]))return null;return {index:[x,y,z],coordinateA:[x,y,z].map((v,i)=>grid.origin[i]+v*grid.spacing[i]),value:array.values[voxelIndex(grid,x,y,z)],arrayName};}
export function vtkCompatibility(a,b,arrayA,arrayB){const mismatch=[];for(const key of ['dimensions','origin','spacing'])if(a[key].length!==b[key].length||a[key].some((v,i)=>Math.abs(v-b[key][i])>1e-10))mismatch.push(key);const aa=a.arrays.find(x=>x.name===arrayA),bb=b.arrays.find(x=>x.name===arrayB);if(!aa||!bb)mismatch.push('scalar array');if(arrayA!==arrayB)mismatch.push('scalar meaning');return {compatible:!mismatch.length,mismatch};}
export function vtkDifference(a,b,arrayName){const check=vtkCompatibility(a,b,arrayName,arrayName);if(!check.compatible)throw new Error(`Incompatible grids: ${check.mismatch.join(', ')}`);const av=a.arrays.find(x=>x.name===arrayName),bv=b.arrays.find(x=>x.name===arrayName);return {...a,source:`difference(${a.source}, ${b.source})`,arrays:[{name:`${arrayName}_difference`,dataType:'double',values:av.values.map((v,i)=>v-bv.values[i])}]};}
export function displayValues(values,{normalizeToMaximum=false,log=false}={}){let out=[...values];if(normalizeToMaximum){const max=Math.max(...out.map(Math.abs));out=out.map(v=>max?v/max:0)}if(log){if(out.some(v=>!(v>0)))throw new Error('Logarithmic mapping requires strictly positive values');out=out.map(Math.log10)}return out;}

export const SPATIAL_CAPABILITY_LEVELS=Object.freeze(['context_only','identified_site_density','registered_framework_overlay','annotation_shell_overlay']);
/** Conservative VTK gating: each higher overlay requires every preceding identity/registration fact. */
export function spatialDensityCapability({scalarIdentity=null,cellMatches=false,frameworkExpanded=false,gridRegistered=false,annotation=null,pairDensityIdentity=false}={}){
  const missing=[];let level='context_only';
  if(!scalarIdentity)missing.push('explicit scalar identity');else level='identified_site_density';
  if(!(cellMatches&&frameworkExpanded&&gridRegistered))missing.push('matching cell, expanded framework, grid origin/spacing, replication, and coordinate registration');
  else if(scalarIdentity)level='registered_framework_overlay';
  if(annotation&&pairDensityIdentity&&level==='registered_framework_overlay')level='annotation_shell_overlay';
  else if(annotation)missing.push('validated annotated-pair scalar identity and registration');
  return {level,missing,sourceScalarValuesModified:false,annotationShellIsGeometricGuide:level==='annotation_shell_overlay'};
}

export function vtkVisualizationState({grid,arrayName,run,display={}}){
  if(!grid.arrays.some(x=>x.name===arrayName))throw new Error(`Unknown scalar array ${arrayName}`);
  return {schema:'porelens.spatial-density-state',version:1,datasetFingerprint:run.datasetFingerprint,chain:run.chain,run:String(run.run),pressurePa:Number(run.pressurePa),source:grid.source,arrayName,grid:{dimensions:grid.dimensions,origin:grid.origin,spacing:grid.spacing},display:{view:display.view||'xy',slice:Number(display.slice||0),threshold:Number(display.threshold||0),opacity:Number(display.opacity??.8),colorMapping:display.colorMapping||'linear',normalizeToMaximum:!!display.normalizeToMaximum},sourceScalarValuesModified:false};
}
