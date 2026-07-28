import {compileAnnotation,selectInteractionPairs,reconstructPairs,buildResult,resultCsv,summarize} from './movie-analysis.mjs';
import {expandFramework} from './raspa-package.mjs';

const mean=a=>a.length?a.reduce((x,y)=>x+y,0)/a.length:null;
function blockEstimate(values,blocks=5){if(values.length<2)return {blocks:values.length,standardError:null};const n=Math.min(blocks,values.length),means=[];for(let b=0;b<n;b++){const part=values.slice(Math.floor(b*values.length/n),Math.floor((b+1)*values.length/n));if(part.length)means.push(mean(part));}const m=mean(means),variance=means.reduce((s,x)=>s+(x-m)**2,0)/(means.length-1);return {blocks:means.length,standardError:Math.sqrt(variance/means.length)};}
function denominator(basis,counts){if(basis==='per_pair')return counts.pairs;if(basis==='per_site')return counts.sites;if(basis==='per_molecule')return counts.molecules;if(basis==='per_frame')return counts.frames;if(basis==='total')return 1;throw new Error(`Unsupported normalization ${basis}`);}
function normalize(total,basis,counts){const d=denominator(basis,counts);return d?total/d:null;}

/** Execute a compiled selection without putting scientific calculations in UI handlers. */
export function trajectoryCapabilities(audit){const parsed=audit?.parsed||{},geometric=!!(parsed.movie&&parsed.topology&&parsed.cif&&parsed.simulation&&audit?.capabilities?.frameworkExpansion!==false),energetic=geometric&&!!audit?.capabilities?.quantitativeLJ;return {geometricSelection:geometric,quantitativeLJ:energetic,missing:(audit?.diagnostics||[]).filter(x=>x.severity==='error').map(x=>x.message)}}
export async function analyzeMovieRun({audit,annotation,choices,runs,onProgress=()=>{},blockCount=5,signal=null}){
  if(!audit.capabilities.quantitativeLJ)throw new Error('Quantitative LJ analysis is unavailable: '+audit.diagnostics.map(x=>x.message).join(' '));
  const selection=compileAnnotation(annotation,choices,runs),topology=audit.parsed.topology,model=audit.parsed.forceField,cutoffA=audit.parsed.simulation.vdwCutoffA,expanded=expandFramework(audit.parsed.cif,audit.parsed.frameworkTypeMapping,audit.parsed.simulation.unitCells),frames=audit.parsed.movie.frames;
  const selected=[],reference=[],pressureRows=new Map(),frameSelected=[],frameReference=[];
  for(let fi=0;fi<frames.length;fi++){
    if(signal?.aborted)throw new DOMException('Trajectory analysis cancelled','AbortError');
    const frame=frames[fi],guests=frame.atoms.map((a,index)=>({...a,index,type:topology.sites[a.siteIndex].type})),matrix=expanded.matrix;
    const chosen=selectInteractionPairs({guests,framework:expanded.atoms,selection,matrix}),all=guests.flatMap(g=>expanded.atoms.map(f=>({g,f}))),selectedRows=reconstructPairs(chosen,{model,cutoffA,matrix}).map(x=>({...x,category:'guest-framework',frameIndex:fi}));
    let referencePairs=[];if(choices.reference.type==='same_pressure_unconditioned')referencePairs=all;else if(choices.reference.type==='outside_roi')referencePairs=all.filter(p=>!chosen.some(c=>c.g.index===p.g.index&&c.f.index===p.f.index));else if(choices.reference.type==='none')referencePairs=[];else throw new Error(`Reference ${choices.reference.type} requires a separately imported run in this milestone`);
    const refRows=reconstructPairs(referencePairs,{model,cutoffA,matrix}).map(x=>({...x,category:'guest-framework',frameIndex:fi}));
    // Guest–guest intermolecular terms. Intramolecular terms are deliberately excluded.
    const selectedMolecules=new Set(chosen.map(x=>x.g.moleculeIndex)),gg=[];if(['whole_ensemble','whole_molecule'].includes(selection.scope))for(let i=0;i<guests.length;i++)for(let j=i+1;j<guests.length;j++)if(guests[i].moleculeIndex!==guests[j].moleculeIndex&&(selection.scope==='whole_ensemble'||selectedMolecules.has(guests[i].moleculeIndex)||selectedMolecules.has(guests[j].moleculeIndex)))gg.push({g:guests[i],f:{...guests[j],label:guests[j].type}});
    selectedRows.push(...reconstructPairs(gg,{model,cutoffA,matrix}).map(x=>({...x,category:'guest-guest',frameIndex:fi})));
    selected.push(...selectedRows);reference.push(...refRows);frameSelected.push(selectedRows.reduce((s,x)=>s+x.energyKJMol,0));frameReference.push(refRows.reduce((s,x)=>s+x.energyKJMol,0));
    const pressure=selection.runs.find(x=>String(x.run)===String(annotation.run))?.pressurePa??selection.runs[0]?.pressurePa,entry=pressureRows.get(pressure)||{pressurePa:pressure,run:String(annotation.run),selected:[],reference:[]};entry.selected.push(...selectedRows);entry.reference.push(...refRows);pressureRows.set(pressure,entry);
    if(fi%10===0||fi===frames.length-1){onProgress({completed:fi+1,total:frames.length});await new Promise(resolve=>setTimeout(resolve,0));}
  }
  const molecules=new Set(selected.map(x=>`${x.frameIndex}:${x.moleculeIndex}`)).size,sites=new Set(selected.map(x=>`${x.frameIndex}:${x.moleculeIndex}:${x.siteIndex}`)).size,counts={frames:frames.length,molecules,sites,pairs:selected.length},basis=choices.normalization,selectedTotal=frameSelected.reduce((a,b)=>a+b,0),referenceTotal=frameReference.reduce((a,b)=>a+b,0),result=buildResult({selection,physicsFingerprint:audit.physicsFingerprint,selected,reference,diagnostics:audit.diagnostics});
  result.normalization={basis,counts,selectedEnergyKJMol:normalize(selectedTotal,basis,counts),referenceEnergyKJMol:normalize(referenceTotal,basis,{...counts,pairs:reference.length}),units:basis==='total'?'kJ/mol reconstructed total':`kJ/mol ${basis.replace('_',' ')}`};
  result.blockUncertainty={selected:blockEstimate(frameSelected,blockCount),reference:blockEstimate(frameReference,blockCount),blockCountRequested:blockCount};
  result.categories=Object.fromEntries(['guest-framework','guest-guest'].map(category=>[category,{selected:summarize(selected.filter(x=>x.category===category).map(x=>x.energyKJMol)),reference:summarize(reference.filter(x=>x.category===category).map(x=>x.energyKJMol))}]));
  const groupFramework=rows=>{const groups=new Map();for(const row of rows.filter(x=>x.category==='guest-framework')){const key=`${row.guestType} × ${row.frameworkType}`;if(!groups.has(key))groups.set(key,[]);groups.get(key).push(row.energyKJMol);}return [...groups].map(([pair,energies])=>({pair,pairCount:energies.length,energyKJMol:summarize(energies)}));};result.pairContributions={selected:groupFramework(selected),reference:groupFramework(reference)};
  result.pressureResolved=[...pressureRows.values()].map(x=>({pressurePa:x.pressurePa,run:x.run,physicsFingerprint:audit.physicsFingerprint,selectedPairs:x.selected.length,referencePairs:x.reference.length,selectedEnergyKJMol:summarize(x.selected.map(r=>r.energyKJMol)),referenceEnergyKJMol:summarize(x.reference.map(r=>r.energyKJMol))}));
  result.provenance={annotationId:annotation.id,annotationType:annotation.type,physicsFingerprint:audit.physicsFingerprint,files:audit.files,tailCorrectionsExcluded:!!model.tailCorrections,movieCoordinatePrecisionWarning:'PDB coordinates are rounded; steep repulsive contacts can be sensitive to rounding.',excludedInteractions:['intramolecular guest–guest LJ','tail corrections','electrostatics']};
  result.csv=resultCsv(result);return result;
}

/** Generation guard prevents a superseded asynchronous calculation committing stale results. */
export class AnalysisCoordinator{constructor(){this.generation=0;this.controller=null}cancel(){this.controller?.abort();this.generation++}async run(work,commit){this.controller?.abort();this.controller=new AbortController();const generation=++this.generation,result=await work(this.controller.signal);if(generation!==this.generation||this.controller.signal.aborted)return {committed:false,result};commit(result);return {committed:true,result}}}
