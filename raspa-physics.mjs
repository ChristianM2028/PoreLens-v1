/** Pure parsers and pair physics for auditable RASPA movie reconstruction. */
const dataLines = text => text.split(/\r?\n/).map(x=>x.replace(/\/\/.*$/,'').trim()).filter(x=>x&&!x.startsWith('#'));

export function parsePseudoAtoms(text){
  const atoms=new Map();
  for(const line of dataLines(text)){const p=line.split(/\s+/);if(p.length>=8&&/^(yes|no)$/i.test(p[1])){if(atoms.has(p[0]))throw new Error(`Duplicate pseudoatom ${p[0]}`);atoms.set(p[0],{type:p[0],print:p[1].toLowerCase()==='yes',as:p[2],element:p[3],mass:Number(p[5]),charge:Number(p[6])});}}
  if(!atoms.size)throw new Error('No pseudoatom definitions found');
  for(const a of atoms.values())if(!Number.isFinite(a.mass)||!Number.isFinite(a.charge))throw new Error(`Invalid pseudoatom ${a.type}`);
  return atoms;
}

export function parseMixingRules(text){
  const lines=text.split(/\r?\n/), clean=dataLines(text), mode=(clean.find(x=>/^(truncated|shifted)$/i.test(x))||'').toLowerCase();
  if(!mode)throw new Error('Missing shifted versus truncated setting');
  const tail=(clean.find(x=>/^(yes|no)$/i.test(x))||'').toLowerCase();
  const rule=clean.find(x=>/lorentz|geometric/i.test(x)); if(!rule)throw new Error('Missing LJ mixing rule');
  const parameters=new Map();
  for(const line of clean){const p=line.split(/\s+/);if(p.length>=4&&/^lennard-jones$/i.test(p[1])){const epsilonK=Number(p[2]),sigmaA=Number(p[3]);if(!(epsilonK>=0&&sigmaA>0))throw new Error(`Invalid LJ parameters for ${p[0]}`);parameters.set(p[0],{epsilonK,sigmaA});}}
  if(!parameters.size)throw new Error('No LJ parameters found');
  return {potential:mode,tailCorrections:tail==='yes',mixingRule:/lorentz/i.test(rule)?'Lorentz-Berthelot':'geometric',parameters,sourceLines:lines.length};
}

export function parsePairOverrides(text){
  const overrides=new Map();
  for(const line of dataLines(text)){const p=line.split(/\s+/);if(p.length>=5&&/^lennard-jones$/i.test(p[2])){const epsilonK=Number(p[3]),sigmaA=Number(p[4]);if(!(epsilonK>=0&&sigmaA>0))throw new Error(`Invalid override ${p[0]} × ${p[1]}`);overrides.set(pairKey(p[0],p[1]),{epsilonK,sigmaA,override:true});}}
  return overrides;
}
export const pairKey=(a,b)=>[a,b].sort().join('\u0000');
export function mixPair(a,b,model){
  const override=model.overrides?.get(pairKey(a,b));if(override)return override;
  const x=model.parameters.get(a),y=model.parameters.get(b);if(!x||!y)throw new Error(`Missing LJ parameters for ${!x?a:b}`);
  if(model.mixingRule==='Lorentz-Berthelot')return {epsilonK:Math.sqrt(x.epsilonK*y.epsilonK),sigmaA:(x.sigmaA+y.sigmaA)/2,override:false};
  if(model.mixingRule==='geometric')return {epsilonK:Math.sqrt(x.epsilonK*y.epsilonK),sigmaA:Math.sqrt(x.sigmaA*y.sigmaA),override:false};
  throw new Error(`Unsupported mixing rule ${model.mixingRule}`);
}
export function lennardJonesK(rA,parameter,{cutoffA,potential}){
  if(!(rA>0)||!(cutoffA>0))throw new Error('LJ distance and cutoff must be positive');if(rA>=cutoffA)return 0;
  const raw=r=>{const q=(parameter.sigmaA/r)**6;return 4*parameter.epsilonK*(q*q-q)};
  return raw(rA)-(potential==='shifted'?raw(cutoffA):0);
}

export function parseMoleculeDefinition(text){
  const lines=text.split(/\r?\n/), atomMarker=lines.findIndex(x=>/# atomic positions/i.test(x));if(atomMarker<0)throw new Error('Molecule definition lacks atomic positions');
  const sites=[];for(let i=atomMarker+1;i<lines.length;i++){const p=lines[i].trim().split(/\s+/);if(!/^\d+$/.test(p[0]||''))break;sites.push({index:Number(p[0]),type:p[1]});}
  if(!sites.length||sites.some((x,i)=>x.index!==i||!x.type))throw new Error('Ambiguous molecule site ordering');
  const countMatch=text.match(/# Number Of Atoms\s*\r?\n\s*(\d+)/i);if(!countMatch||Number(countMatch[1])!==sites.length)throw new Error('Molecule atom count contradicts site list');
  const intra=[];const intraMarker=lines.findIndex(x=>/# Intra VDW:/i.test(x));if(intraMarker>=0)for(let i=intraMarker+1;i<lines.length;i++){const p=lines[i].trim().split(/\s+/);if(!/^\d+$/.test(p[0]||'')||!/^\d+$/.test(p[1]||''))break;intra.push([Number(p[0]),Number(p[1])]);}
  return {sites,intraVdwPairs:intra,sitesPerMolecule:sites.length};
}

export function cellMatrix(lengths,angles=[90,90,90]){const [a,b,c]=lengths,[al,be,ga]=angles.map(x=>x*Math.PI/180),cg=Math.cos(ga),sg=Math.sin(ga),cb=Math.cos(be),ca=Math.cos(al);if(!(a>0&&b>0&&c>0&&sg>1e-12))throw new Error('Invalid unit cell');return [[a,b*cg,c*cb],[0,b*sg,c*(ca-cb*cg)/sg],[0,0,Math.sqrt(Math.max(0,c*c-(c*cb)**2-(c*(ca-cb*cg)/sg)**2))]];}
const inv3=m=>{const [a,b,c]=m[0],[d,e,f]=m[1],[g,h,i]=m[2],det=a*(e*i-f*h)-b*(d*i-f*g)+c*(d*h-e*g);if(Math.abs(det)<1e-14)throw new Error('Singular cell');return [[(e*i-f*h)/det,(c*h-b*i)/det,(b*f-c*e)/det],[(f*g-d*i)/det,(a*i-c*g)/det,(c*d-a*f)/det],[(d*h-e*g)/det,(b*g-a*h)/det,(a*e-b*d)/det]]};
const mv=(m,v)=>m.map(r=>r[0]*v[0]+r[1]*v[1]+r[2]*v[2]);
export function minimumImageVector(a,b,matrix){const frac=mv(inv3(matrix),[a.x-b.x,a.y-b.y,a.z-b.z]).map(x=>x-Math.round(x));return mv(matrix,frac);}
export const periodicDistance=(a,b,matrix)=>Math.hypot(...minimumImageVector(a,b,matrix));

export async function physicsFingerprint(parts){
  const stable=v=>v instanceof Map?[...v].sort(([a],[b])=>a.localeCompare(b)).map(([k,x])=>[k,stable(x)]):Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
  const bytes=new TextEncoder().encode(JSON.stringify(stable(parts))),hash=await crypto.subtle.digest('SHA-256',bytes);return [...new Uint8Array(hash)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
