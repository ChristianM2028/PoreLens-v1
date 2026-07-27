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
