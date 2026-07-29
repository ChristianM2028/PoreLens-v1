import {parseSimulationInput,indexPdbSource,validateMovieTopology} from './trajectory.mjs?rev=porelens-20260729-spatial-registration-v1';
import {parsePseudoAtoms,parseMixingRules,parsePairOverrides,parseMoleculeDefinition,cellMatrix,physicsFingerprint} from './raspa-physics.mjs?rev=porelens-20260729-spatial-registration-v1';
import {isAllComponentsMovieBasename,parseAllComponentsMovieFilename} from '../import/movie-filename.mjs?rev=porelens-20260729-spatial-registration-v1';
import {parsePdbCryst1} from './spatial-registration.mjs?rev=porelens-20260729-spatial-registration-v1';

export function parseCif(text){
  const scalar=k=>{const m=text.match(new RegExp(`^\\s*${k}\\s+([^\\s#]+)`,'mi'));return m?Number(m[1].replace(/\([^)]*\)$/,'')):null;},lengths=['a','b','c'].map(x=>scalar(`_cell_length_${x}`)),angles=['alpha','beta','gamma'].map(x=>scalar(`_cell_angle_${x}`));
  if([...lengths,...angles].some(x=>!Number.isFinite(x)))throw new Error('CIF unit-cell geometry is incomplete');
  const lines=text.split(/\r?\n/),sites=[];
  for(let i=0;i<lines.length;i++)if(lines[i].trim()==='loop_'){const headers=[];let j=i+1;while(lines[j]?.trim().startsWith('_'))headers.push(lines[j++].trim());const label=headers.indexOf('_atom_site_label'),type=headers.indexOf('_atom_site_type_symbol'),x=headers.indexOf('_atom_site_fract_x'),y=headers.indexOf('_atom_site_fract_y'),z=headers.indexOf('_atom_site_fract_z'),charge=headers.indexOf('_atom_site_charge');if([label,type,x,y,z].every(n=>n>=0)){for(;j<lines.length;j++){const line=lines[j].trim();if(!line||line.startsWith('#'))continue;if(line==='loop_'||line.startsWith('_'))break;const p=line.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)||[];if(p.length<headers.length)break;sites.push({label:p[label],cifType:p[type],fractional:[Number(p[x]),Number(p[y]),Number(p[z])],charge:charge>=0?Number(p[charge]):null});}break;}}
  if(!sites.length)throw new Error('CIF framework atom mapping is absent');
  const operations=[];const marker=lines.findIndex(x=>['_symmetry_equiv_pos_as_xyz','_space_group_symop_operation_xyz'].includes(x.trim()));if(marker>=0)for(let i=marker+1;i<lines.length;i++){const v=lines[i].trim();if(!v)continue;if(v==='loop_'||v.startsWith('_'))break;if(/^['"]/.test(v))operations.push(v.replace(/^['"]|['"]$/g,''));}
  if(!operations.length)operations.push('x,y,z');
  return {lengthsA:lengths,anglesDeg:angles,matrix:cellMatrix(lengths,angles),asymmetricSites:sites,symmetryOperations:operations};
}

function symmetryValue(expression,xyz){const compact=expression.replace(/\s/g,'').replace(/-/g,'+-'),terms=compact.split('+').filter(Boolean);let value=0;for(const term of terms){const sign=term.startsWith('-')?-1:1,t=term.replace(/^-/,'');if(['x','y','z'].includes(t))value+=sign*xyz[['x','y','z'].indexOf(t)];else if(/^\d+(?:\.\d+)?(?:\/\d+(?:\.\d+)?)?$/.test(t)){const [a,b=1]=t.split('/').map(Number);value+=sign*a/b;}else throw new Error(`Unsupported CIF symmetry term ${expression}`);}return ((value%1)+1)%1;}
export function expandFramework(cif,typeMapping,unitCells=[1,1,1]){const atoms=[],seen=new Set(),base=cif.lengthsA;for(const site of cif.asymmetricSites)for(const op of cif.symmetryOperations){const parts=op.split(',');if(parts.length!==3)throw new Error(`Invalid CIF symmetry operation ${op}`);const frac=parts.map(x=>symmetryValue(x,site.fractional));const key=`${site.label}:${frac.map(x=>Math.round(x*1e8)).join(':')}`;if(seen.has(key))continue;seen.add(key);for(let ix=0;ix<unitCells[0];ix++)for(let iy=0;iy<unitCells[1];iy++)for(let iz=0;iz<unitCells[2];iz++)atoms.push({index:atoms.length,label:site.label,type:typeMapping.get(site.label),x:(frac[0]+ix)*base[0],y:(frac[1]+iy)*base[1],z:(frac[2]+iz)*base[2]});}const lengths=base.map((x,i)=>x*unitCells[i]);return {atoms,matrix:cellMatrix(lengths,cif.anglesDeg),lengthsA:lengths};}

export function parseRaspaOutput(text){
  const version=text.match(/RASPA\s+(?:version\s*)?([\d.]+)/i)?.[1]||null,completed=/Simulation finished|End of simulation|Finishing simulation/i.test(text),warnings=[...text.matchAll(/^.*warning.*$/gim)].map(x=>x[0].trim());
  const host=[...text.matchAll(/Host[- ]Adsorbate[^\n]*?(-?[\d.]+)\s*(?:\+\/-|\u00b1)\s*([\d.]+)/gi)].at(-1),guest=[...text.matchAll(/Adsorbate[- ]Adsorbate[^\n]*?(-?[\d.]+)\s*(?:\+\/-|\u00b1)\s*([\d.]+)/gi)].at(-1);
  const lastNumber=(pattern)=>{const match=[...text.matchAll(pattern)].at(-1);return match?Number(match[1]):null};
  const pressurePa=lastNumber(/^\s*External Pressure\s*:\s*([+\-\d.eE]+)\s*\[Pa\]/gim),temperatureK=lastNumber(/^\s*External temperature\s*:\s*([+\-\d.eE]+)\s*\[K\]/gim);
  const component=[...text.matchAll(/^Component\s+\d+\s*\[([^\]]+)\]/gim)].at(-1)?.[1]?.trim()||null;
  const framework=text.match(/^\s*FrameworkName\s+([^\s#]+)/mi)?.[1]||text.match(/^\s*Framework\s+\d+\s*\[([^\]]+)\]/mi)?.[1]||null;
  const loadings={absolute:{},excess:{}};
  for(const match of text.matchAll(/^\s*Average loading (absolute|excess)(?:\s*\[([^\]]+)\])?\s+([+\-\d.eE]+)\s*(?:\+\/-|\u00b1)\s*([+\-\d.eE]+)/gim)){
    const kind=match[1].toLowerCase(),unit=(match[2]||'molecules/system').trim(),value=Number(match[3]),uncertainty=Number(match[4]);
    if(Number.isFinite(value)&&Number.isFinite(uncertainty))loadings[kind][unit]={value,uncertainty};
  }
  return {version,completed,warnings,pressurePa,temperatureK,component,framework,loadings,energies:{hostAdsorbate:host?{mean:Number(host[1]),uncertainty:Number(host[2])}:null,adsorbateAdsorbate:guest?{mean:Number(guest[1]),uncertainty:Number(guest[2])}:null}};
}

const required={simulation:'simulation.input',pseudoatoms:'pseudo_atoms.def',mixing:'force_field_mixing_rules.def',cif:'.cif',molecule:'.def',movie:'.pdb'};
const find=(files,test)=>files.find(f=>test(f.name||f.path||''));
const javascriptType=value=>value===null?'null':Array.isArray(value)?'array':typeof value;

/** Resolve browser Files, lazy path-file facades, and explicit {name, text} fixtures. */
export async function normalizeRunPackageFile(file){
  const name=file?.name||file?.path||file?.webkitRelativePath||'(unnamed file)';
  const path=file?.path||file?.webkitRelativePath||file?.name||name;
  // Movie content is deliberately not resolved here. Large trajectories remain
  // local lazy sources and are scanned/decoded by trajectory.mjs.
  if(/\.pdb$/i.test(path))return {source:file,name,path,text:null,resolutionDiagnostic:null};
  try{
    const resolver=file?.text;
    const text=typeof resolver==='function'?await resolver.call(file):await resolver;
    if(typeof text!=='string')return {source:file,name,path,text:null,resolutionDiagnostic:{severity:'error',code:'invalid_file_content',stage:'content_resolution',file:path,message:`Cannot parse ${path}: content resolver returned JavaScript type ${javascriptType(text)}; expected a string from text() or the explicit {name, text} contract.`}};
    return {source:file,name,path,text,resolutionDiagnostic:null};
  }catch(error){
    return {source:file,name,path,text:null,resolutionDiagnostic:{severity:'error',code:'file_content_rejected',stage:'content_resolution',file:path,message:`Cannot read ${path} during content_resolution: ${error?.message||String(error)}; expected text() to resolve to a string.`}};
  }
}
/** Audit a set of {name,text} files without inventing missing model information. */
export async function importRunPackage(files,{annotationSidecar=null,manifestFingerprint=null,annotationPressurePa=null,manifestPressurePa=null}={}){
  files=await Promise.all([...files].map(normalizeRunPackageFile));
  const diagnostics=files.flatMap(file=>file.resolutionDiagnostic?[file.resolutionDiagnostic]:[]),get=test=>find(files,test),sim=get(n=>/simulation\.input$/i.test(n)),pseudo=get(n=>/pseudo_atoms\.def$/i.test(n)),mix=get(n=>/force_field_mixing_rules\.def$/i.test(n)),override=get(n=>/(^|\/)force_field\.def$/i.test(n)),cif=get(n=>/\.cif$/i.test(n)),movieCandidates=files.filter(file=>isAllComponentsMovieBasename(file.path||file.name)),output=get(n=>/\.data$/i.test(n));
  const molecule=get(n=>/\.def$/i.test(n)&&!/pseudo_atoms|mixing_rules|force_field/i.test(n));
  for(const [kind,name] of Object.entries(required))if(!({simulation:sim,pseudoatoms:pseudo,mixing:mix,cif,molecule,movie:movieCandidates[0]})[kind])diagnostics.push({severity:kind==='movie'?'warning':'error',code:`missing_${kind}`,message:`Missing ${name}; ${kind==='movie'?'trajectory-dependent analysis is unavailable':'quantitative LJ attribution is disabled'}.`});
  const parsed={overrides:new Map()};
  const parseFile=(key,file,stage,parser)=>{if(!file||file.resolutionDiagnostic)return null;try{return parsed[key]=parser(file.text);}catch(error){diagnostics.push({severity:'error',code:`invalid_${stage}`,stage,file:file.path,message:`Failed to parse ${file.path} during ${stage}: ${error.message}`});return null;}};
  parseFile('simulation',sim,'simulation_input',parseSimulationInput);
  // RASPA serializes these values as decimal text.  Half a typical final decimal
  // place plus a 1e-10 relative allowance accepts harmless formatting/rounding,
  // while (for example) a one-pascal change at 1e9 Pa remains a mismatch.
  const close=(a,b,absolute)=>Number.isFinite(a)&&Number.isFinite(b)&&Math.abs(a-b)<=Math.max(absolute,1e-10*Math.max(Math.abs(a),Math.abs(b)));
  const candidateMetadata=movieCandidates.map(file=>({file,metadata:parseAllComponentsMovieFilename(file.path||file.name),mismatches:[]}));
  for(const candidate of candidateMetadata){const m=candidate.metadata;if(!m.ok){candidate.mismatches.push({field:'filename',movieValue:m.code,runValue:'canonical numeric metadata'});continue}const checks=[['temperatureK',m.temperatureK,parsed.simulation?.temperatureK,(a,b)=>close(a,b,5e-6)],['pressurePa',m.pressurePa,parsed.simulation?.pressurePa,(a,b)=>close(a,b,5e-6)],['framework',m.framework,parsed.simulation?.framework,(a,b)=>a===b],['unitCells',m.unitCells,parsed.simulation?.unitCells,(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i])]];for(const [field,movieValue,runValue,equal] of checks)if(runValue!=null&&!equal(movieValue,runValue))candidate.mismatches.push({field,movieValue,runValue});}
  const matching=candidateMetadata.filter(candidate=>candidate.metadata.ok&&!candidate.mismatches.length);let movie=matching.length===1?matching[0].file:null;
  const publicCandidates=candidateMetadata.map(({file,metadata,mismatches})=>({path:file.path,metadata,mismatches}));
  if(matching.length===1&&candidateMetadata.length>1)diagnostics.push({severity:'info',code:'movie_candidates_ignored_metadata_mismatch',message:`Selected ${movie.path}; ignored movie candidates whose filename metadata contradicts simulation.input.`,selected:movie.path,candidates:publicCandidates.filter(x=>x.path!==movie.path)});
  if(movieCandidates.length&&matching.length!==1)diagnostics.push({severity:'error',blocking:true,code:matching.length?'ambiguous_movie':'movie_metadata_no_match',message:matching.length?'More than one movie candidate agrees with run metadata; movie-dependent analysis is disabled.':'No movie candidate agrees with run metadata; movie-dependent analysis is disabled.',candidates:publicCandidates});
  if(movie){for(const [source,value] of [['annotation',annotationPressurePa],['manifest',manifestPressurePa]])if(Number.isFinite(value)&&!close(parsed.simulation?.pressurePa,value,5e-6)){diagnostics.push({severity:'error',blocking:true,code:`movie_${source}_pressure_mismatch`,message:`Selected movie pressure ${matching[0].metadata.pressurePa} Pa and simulation.input pressure ${parsed.simulation?.pressurePa} Pa contradict ${source} pressure ${value} Pa; movie-dependent analysis is disabled.`,movie:matching[0].metadata,simulationPressurePa:parsed.simulation?.pressurePa,[`${source}PressurePa`]:value});movie=null;}}
  parseFile('pseudoatoms',pseudo,'pseudo_atoms',parsePseudoAtoms);
  parseFile('forceField',mix,'mixing_rules',parseMixingRules);
  if(override)parseFile('overrides',override,'pair_overrides',parsePairOverrides);
  parseFile('cif',cif,'cif',parseCif);
  parseFile('topology',molecule,'molecule_topology',parseMoleculeDefinition);
  parseFile('output',output,'raspa_output',parseRaspaOutput);
  if(parsed.forceField)parsed.forceField.overrides=parsed.overrides;
  if(movie&&!movie.resolutionDiagnostic)try{const source=movie.source?.getFile?await movie.source.getFile():movie.source;const prefix=typeof source?.slice==='function'?await source.slice(0,512).text():String(source?.text??'').slice(0,512);parsed.movieCell=parsePdbCryst1(prefix);parsed.movie=await indexPdbSource(movie.source);parsed.movie.roleSpecificAnalysisEnabled=!!parsed.topology;parsed.movie.totalFrames=parsed.movie.frames.length;}catch(error){diagnostics.push({severity:'error',code:'invalid_pdb_movie',stage:'pdb_movie_index',file:movie.path,message:`Failed to index ${movie.path} during pdb_movie_index: ${error.message}`});}
  if(parsed.movie&&parsed.topology)try{parsed.topologyValidation=validateMovieTopology({simulation:parsed.simulation,componentDefinitionName:molecule?.name,topology:parsed.topology,pseudoatoms:parsed.pseudoatoms,frameAtomCounts:parsed.movie.frames.map(frame=>frame.atomCount)});if(!parsed.movie.roleSpecificAnalysisEnabled)throw new Error('Movie-to-topology site ordering could not be validated');}catch(error){diagnostics.push({severity:'error',code:'movie_topology_mismatch',stage:'topology_validation',file:movie.path,message:`Failed to validate ${movie.path} during topology_validation: ${error.message}`});}
  if(parsed.cif&&parsed.forceField){parsed.frameworkTypeMapping=new Map();for(const site of parsed.cif.asymmetricSites){const candidates=[site.label,site.cifType,`${site.cifType}_`].filter(x=>parsed.forceField.parameters.has(x));if(candidates.length!==1)diagnostics.push({severity:'error',code:'framework_mapping_ambiguous',message:`Framework label ${site.label} resolves to ${candidates.length} force-field types (${candidates.join(', ')||'none'}).`});else parsed.frameworkTypeMapping.set(site.label,candidates[0]);}}
  if(parsed.topology&&parsed.forceField)for(const site of parsed.topology.sites)if(!parsed.forceField.parameters.has(site.type))diagnostics.push({severity:'error',code:'guest_parameter_missing',message:`No LJ parameters for guest site type ${site.type}.`});
  if(parsed.simulation&&!Number.isFinite(parsed.simulation.vdwCutoffA))diagnostics.push({severity:'error',code:'missing_cutoff',message:'CutOffVDW is required; no default was substituted.'});
  if(annotationSidecar&&manifestFingerprint){for(const [slot,d] of Object.entries(annotationSidecar.datasets||{}))if(d.manifestFingerprint!==manifestFingerprint)diagnostics.push({severity:'error',code:'annotation_manifest_mismatch',message:`Annotation dataset ${slot} does not match the imported manifest fingerprint.`});}
  if(parsed.cif&&parsed.frameworkTypeMapping&&parsed.simulation?.unitCells)try{parsed.expandedFramework=expandFramework(parsed.cif,parsed.frameworkTypeMapping,parsed.simulation.unitCells);}catch(error){diagnostics.push({severity:'error',code:'framework_expansion_unsupported',message:error.message});}
  const geometric=!!(parsed.movie&&parsed.topologyValidation?.validated&&parsed.expandedFramework);
  const essential=geometric&&!!(parsed.simulation&&parsed.pseudoatoms&&parsed.forceField&&Number.isFinite(parsed.simulation.vdwCutoffA));
  const fingerprint=parsed.forceField&&parsed.simulation&&parsed.cif&&parsed.topology?await physicsFingerprint({cutoffA:parsed.simulation.vdwCutoffA,useChargesFromCif:parsed.simulation.useChargesFromCif,unitCells:parsed.simulation.unitCells,forceField:parsed.forceField,cif:parsed.cif,topology:parsed.topology}):null;
  return {files:{simulation:sim?.path||null,pseudoatoms:pseudo?.path||null,mixing:mix?.path||null,override:override?.path||null,cif:cif?.path||null,molecule:molecule?.path||null,movie:movie?.path||null,output:output?.path||null},parsed,physicsFingerprint:fingerprint,capabilities:{rdfAndAnnotations:true,moviePlayback:!!parsed.movie,geometricSelection:geometric,quantitativeLJ:essential},diagnostics};
}
