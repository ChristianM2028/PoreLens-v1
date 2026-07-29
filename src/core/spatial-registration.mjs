/** Registration of RASPA 2 orthogonal STRUCTURED_POINTS density grids.
 *
 * RASPA writes grid points at origin (0,0,0), with spacing L/N.  Only that
 * convention is supported: triclinic/monoclinic mappings must not be inferred.
 */
export const RASPA_ORTHOGONAL_VTK_CONVENTION='raspa2-orthogonal-structured-points-origin-zero-cell-over-n';
export const SPATIAL_REGISTRATION_TOLERANCES=Object.freeze({cellA:1e-3,spacingA:1e-6,originA:1e-9,pressurePa:5e-6,angleDeg:1e-3});

const finite3=value=>Array.isArray(value)&&value.length===3&&value.every(Number.isFinite);
const identityString=value=>value==null?null:String(value);
const same=(a,b,tolerance=0)=>finite3(a)&&finite3(b)&&a.every((x,i)=>Math.abs(x-b[i])<=tolerance);
const check=(code,label,observed,expected,tolerance,evidenceSource,result,requiredFile=null)=>({code,label,observed,expected,tolerance,evidenceSource,result,requiredFile});
const cellGeometry=cell=>cell&&finite3(cell.lengthsA)&&finite3(cell.anglesDeg)?cell:null;
const orthogonal=cell=>cellGeometry(cell)&&cell.anglesDeg.every(x=>Math.abs(x-90)<=SPATIAL_REGISTRATION_TOLERANCES.angleDeg);

export function parseVtkCellParameters(text){
  const match=String(text).match(/^\s*CELL_PARAMETERS\s+([^\n\r]+)/mi);if(!match)return null;
  const values=match[1].trim().split(/\s+/).map(Number);if(values.length<6||!values.slice(0,6).every(Number.isFinite))return null;
  return {lengthsA:values.slice(0,3),anglesDeg:values.slice(3,6),source:'VTK CELL_PARAMETERS'};
}
export function parsePdbCryst1(text){
  const line=String(text).split(/\r?\n/).find(x=>x.startsWith('CRYST1'));if(!line)return null;
  const values=[line.slice(6,15),line.slice(15,24),line.slice(24,33),line.slice(33,40),line.slice(40,47),line.slice(47,54)].map(Number);
  return values.every(Number.isFinite)?{lengthsA:values.slice(0,3),anglesDeg:values.slice(3),source:'movie CRYST1'}:null;
}

/** Build independent expected values and exact-run provenance; never copies grid geometry into expectations. */
export function buildSpatialRegistrationInput({grid,simulation=null,vtkCell=null,movieCell=null,cifCell=null,identity={},vtkIdentity={},movieIdentity={},annotationIdentity={},convention=RASPA_ORTHOGONAL_VTK_CONVENTION,files={}}={}){
  vtkCell??=grid?.cellParameters??null;
  const dimensions=simulation?.settings?.vtk?.gridPoints??null;
  const replication=simulation?.settings?.unitCells??null;
  const baseCif=cellGeometry(cifCell),expandedCif=baseCif&&finite3(replication)?{lengthsA:baseCif.lengthsA.map((x,i)=>x*replication[i]),anglesDeg:[...baseCif.anglesDeg],source:'validated CIF × simulation UnitCells'}:null;
  const referenceCell=cellGeometry(movieCell)??expandedCif;
  const expectedSpacing=referenceCell&&finite3(dimensions)?referenceCell.lengthsA.map((x,i)=>x/dimensions[i]):null;
  return {schema:'porelens.spatial-registration-input',version:1,convention,tolerances:{...SPATIAL_REGISTRATION_TOLERANCES},observed:{dimensions:grid?.dimensions??null,origin:grid?.origin??null,spacing:grid?.spacing??null,vtkCell:cellGeometry(vtkCell)},expected:{dimensions,origin:convention===RASPA_ORTHOGONAL_VTK_CONVENTION?[0,0,0]:null,spacing:expectedSpacing,simulationCell:referenceCell},evidence:{simulation:{gridPoints:dimensions,unitCells:replication,source:files.simulation??null},movie:{cell:cellGeometry(movieCell),identity:movieIdentity,source:files.movie??null},cif:{cell:expandedCif,source:files.cif??null},vtk:{cell:cellGeometry(vtkCell),identity:vtkIdentity,source:files.vtk??grid?.source??null},authorizedIdentity:{...identity},annotationIdentity:{...annotationIdentity}},provenance:{dataset:identity.dataset??null,component:identity.component??null,run:identityString(identity.run),pressurePa:Number(identity.pressurePa),systemDirectory:identity.systemDirectory??null}};
}

export function validateSpatialRegistration(model){
  const {observed:o={},expected:e={},evidence:v={},tolerances:t=SPATIAL_REGISTRATION_TOLERANCES}=model||{},checks=[];
  const missing=(code,label,requiredFile,source)=>checks.push(check(code,label,null,null,null,source,'missing',requiredFile));
  if(!finite3(e.dimensions))missing('missing_grid_points','Requested grid dimensions','simulation.input','simulation.input: DensityProfile3DVTKGridPoints');
  else checks.push(check('dimensions', 'Grid dimensions',o.dimensions,e.dimensions,0,'VTK DIMENSIONS vs simulation.input DensityProfile3DVTKGridPoints',same(o.dimensions,e.dimensions,0)?'pass':'fail'));
  const vtkCell=cellGeometry(o.vtkCell),reference=cellGeometry(e.simulationCell);
  if(!vtkCell)missing('missing_vtk_cell','VTK cell','DensityProfile*.vtk with CELL_PARAMETERS','VTK header');
  if(!reference)missing('missing_reference_cell','Independent simulation cell','matching movie with CRYST1 or validated CIF','movie/CIF');
  if(vtkCell&&reference)checks.push(check('cell','Simulation cell',{lengthsA:vtkCell.lengthsA,anglesDeg:vtkCell.anglesDeg},{lengthsA:reference.lengthsA,anglesDeg:reference.anglesDeg},{lengthA:t.cellA,angleDeg:t.angleDeg},`${vtkCell.source}; ${reference.source}`,same(vtkCell.lengthsA,reference.lengthsA,t.cellA)&&same(vtkCell.anglesDeg,reference.anglesDeg,t.angleDeg)?'pass':'fail'));
  const movie=cellGeometry(v.movie?.cell),cif=cellGeometry(v.cif?.cell);
  if(movie&&cif)checks.push(check('independent_cells','Movie/CIF simulation-cell agreement',{lengthsA:movie.lengthsA,anglesDeg:movie.anglesDeg},{lengthsA:cif.lengthsA,anglesDeg:cif.anglesDeg},{lengthA:t.cellA,angleDeg:t.angleDeg},'movie CRYST1 vs validated CIF × simulation UnitCells',same(movie.lengthsA,cif.lengthsA,t.cellA)&&same(movie.anglesDeg,cif.anglesDeg,t.angleDeg)?'pass':'fail'));
  const geometry=[vtkCell,reference].filter(Boolean).find(cell=>!orthogonal(cell));
  checks.push(check('coordinate_convention','Coordinate convention',model?.convention,RASPA_ORTHOGONAL_VTK_CONVENTION,null,'implemented PoreLens/RASPA mapping',model?.convention!==RASPA_ORTHOGONAL_VTK_CONVENTION?'unsupported':geometry?'unsupported':'pass'));
  if(finite3(e.spacing))checks.push(check('spacing','Grid spacing',o.spacing,e.spacing,t.spacingA,'VTK SPACING vs independent simulation-cell lengths / simulation.input grid points',same(o.spacing,e.spacing,t.spacingA)?'pass':'fail'));else missing('missing_spacing_expectation','Expected spacing','simulation.input plus matching movie/CIF','independent cell and grid-points evidence');
  checks.push(check('origin','Grid origin',o.origin,e.origin,t.originA,`VTK ORIGIN vs ${RASPA_ORTHOGONAL_VTK_CONVENTION}`,same(o.origin,e.origin,t.originA)?'pass':'fail'));
  const fields=['dataset','component','run','pressurePa','systemDirectory'];
  for(const field of fields){const sources=[['VTK',v.vtk?.identity?.[field]],['movie',v.movie?.identity?.[field]],['authorized run',v.authorizedIdentity?.[field]],['annotation',v.annotationIdentity?.[field]]].filter(([,x])=>x!=null);const normalized=sources.map(([,x])=>field==='pressurePa'?Number(x):String(x));const tolerance=field==='pressurePa'?t.pressurePa:0;const pass=sources.length>=3&&normalized.every(x=>field==='pressurePa'?Math.abs(x-normalized[0])<=tolerance:x===normalized[0]);checks.push(check(`identity_${field}`,`Exact-run ${field}`,Object.fromEntries(sources),sources[0]?.[1]??null,tolerance,sources.map(x=>x[0]).join(', ')||'none',sources.length<3?'missing':pass?'pass':'fail',sources.length<3?'matching VTK, movie/run metadata, and annotation provenance':null));}
  const reasons=checks.filter(x=>x.result!=='pass').map(x=>x.result==='missing'?`${x.label}: missing evidence (${x.requiredFile})`:x.result==='unsupported'?`${x.label}: unsupported geometry or convention`: `${x.label}: mismatch`);
  return {...model,checks,reasons,validated:checks.length>0&&checks.every(x=>x.result==='pass'),hasNumericalMismatch:checks.some(x=>x.result==='fail'),unsupported:checks.some(x=>x.result==='unsupported')};
}
