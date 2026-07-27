export function parseSimulationInput(text) {
  const values={},components=[]; let component=null;
  for(const original of text.split(/\r?\n/)){
    const line=original.trim(); if(!line||line.startsWith('#')) continue;
    const [key,...rest]=line.split(/\s+/); const value=rest.join(' ');
    if(key==='Component') {
      component={index:String(rest[0])};
      components.push(component);
      for(let i=1;i<rest.length-1;i+=2) if(['MoleculeName','MoleculeDefinition'].includes(rest[i])) component[rest[i]]=rest[i+1];
    }
    else if(component&&['MoleculeName','MoleculeDefinition'].includes(key)) component[key]=value;
    else values[key]=value;
  }
  const number=key=>values[key]===undefined?null:Number(values[key]);
  return {simulationType:values.SimulationType??null,productionCycles:number('NumberOfCycles'),initializationCycles:number('NumberOfInitializationCycles'),temperatureK:number('ExternalTemperature'),pressurePa:number('ExternalPressure'),unitCells:values.UnitCells?.split(/\s+/).map(Number)??null,movieWriteInterval:number('WriteMoviesEvery'),rdfWriteInterval:number('WriteRDFEvery'),vdwCutoffA:number('CutOffVDW'),useChargesFromCif:values.UseChargesFromCIFFile?.toLowerCase()==='yes',framework:values.FrameworkName??null,forceField:values.Forcefield??values.ForceField??null,components,component:components[0]??component};
}

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

/** Validate the evidence needed to assign lossy PDB atoms by RASPA site order. */
export function validateMovieTopology({simulation,componentDefinitionName,topology,pseudoatoms,frameAtomCounts}){
  if(!simulation||!topology||!pseudoatoms)throw new Error('simulation.input, component .def, and pseudo_atoms.def are all required');
  if(simulation.components.length!==1)throw new Error(`All-components movie is ambiguous for ${simulation.components.length} adsorbate components; select a component-specific trajectory or explicit mapping`);
  const component=simulation.components[0],expected=`${component.MoleculeName}.def`;
  if(componentDefinitionName?.split(/[\\/]/).at(-1)!==expected)throw new Error(`Component definition must be ${expected}, as referenced by simulation.input`);
  if(topology.sites.length!==topology.sitesPerMolecule||topology.sites.some((site,index)=>site.index!==index))throw new Error('Template indices must be unique and complete from 0 through N-1');
  for(const site of topology.sites)if(!pseudoatoms.has(site.type))throw new Error(`Required pseudoatom ${site.type} is missing from pseudo_atoms.def`);
  for(const bond of topology.bonds||[])if(bond.some(index=>index<0||index>=topology.sitesPerMolecule))throw new Error('A bond references an invalid template index');
  if(!(topology.bonds?.length))throw new Error('Bond connectivity is required for topology validation');
  if(!frameAtomCounts?.length||frameAtomCounts.some(count=>!Number.isInteger(count)||count%topology.sitesPerMolecule!==0))throw new Error('At least one parsed frame does not consist of whole contiguous molecule blocks');
  const degree=Array(topology.sitesPerMolecule).fill(0);for(const [a,b] of topology.bonds){degree[a]++;degree[b]++;}
  const counts=new Map();for(const site of topology.sites)counts.set(site.type,(counts.get(site.type)||0)+1);
  return {validated:true,componentName:component.MoleculeName,sitesPerMolecule:topology.sitesPerMolecule,siteTypes:topology.sites.map(x=>x.type),siteRoles:degree.map(value=>value===1?'terminal':'internal'),typeCounts:Object.fromEntries(counts),moleculeCounts:frameAtomCounts.map(x=>x/topology.sitesPerMolecule)};
}

/** Byte/character ranges for complete PDB models; callers decode only the selected range. */
export function indexPdbFrames(text){
  const frames=[];let start=-1,model=null;const re=/^(MODEL\s+([^\r\n]+)|ENDMDL)\s*$/gm;let match;
  while((match=re.exec(text))){if(match[1].startsWith('MODEL')){start=match.index;model=Number(match[2].trim())}else if(start>=0){frames.push({model:Number.isFinite(model)?model:frames.length+1,start,end:re.lastIndex});start=-1;}}
  if(start>=0)throw new Error('PDB movie is missing ENDMDL');if(!frames.length)throw new Error('PDB movie contains no complete models');return frames;
}
export function decodeIndexedPdbFrame(text,indexEntry,options={}){return parsePdbMovie(text.slice(indexEntry.start,indexEntry.end),options).frames[0]}

export function minimumImageDisplacement(a,b,cell){
  return [a.x-b.x,a.y-b.y,a.z-b.z].map((delta,i)=>delta-Math.round(delta/cell[i])*cell[i]);
}
export function minimumImageDistance(a,b,cell){return Math.hypot(...minimumImageDisplacement(a,b,cell));}

export function contactsInBand(left,right,cell,minA,maxA){
  const contacts=[];
  left.forEach((a,i)=>right.forEach((b,j)=>{const distanceA=minimumImageDistance(a,b,cell);if(distanceA>=minA&&distanceA<=maxA)contacts.push({leftIndex:i,rightIndex:j,distanceA});}));
  return contacts;
}
