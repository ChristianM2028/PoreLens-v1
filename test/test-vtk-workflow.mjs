import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir,stat} from 'node:fs/promises';
import {basename,join} from 'node:path';
import {indexVtk} from '../src/import/parsers/vtk.mjs';
import {parseLegacyVtk} from '../src/core/result-types.mjs';
import {indexPdbSource} from '../src/core/trajectory.mjs';
import {DirectoryCatalogScanner} from '../src/import/directory-catalog.mjs';
import {preferredSpatialRecordIndex,spatialWorkflowState} from '../src/ui/lj-ui.mjs';
import {parseSimulationInput} from '../src/import/parsers/simulation_input.mjs';
import {parseCif} from '../src/core/raspa-package.mjs';
import {buildSpatialRegistrationInput,parsePdbCryst1,validateSpatialRegistration} from '../src/core/spatial-registration.mjs';

const runRoot=join(process.cwd(),'test/fixtures/representative_dataset/nonideal_PFA/C10/40');
const vtkRoot=join(runRoot,'VTK/System_0');
const movieName='Movie_IRMOF-1_1.1.1_300.000000_23299.518110_allcomponents.pdb';
function fsFile(path){return {kind:'file',name:basename(path),async getFile(){const info=await stat(path),bytes=await readFile(path);return new File([bytes],basename(path),{lastModified:info.mtimeMs})}}}
function fsDirectory(path,name=basename(path)){return {kind:'directory',name,async *entries(){for(const entry of await readdir(path,{withFileTypes:true})){const target=join(path,entry.name);yield [entry.name,entry.isDirectory()?fsDirectory(target):fsFile(target)]}}}}

test('real RASPA VTK headers separate encoding, dataset, scalar-grid support, and context',async()=>{
  const record=async name=>indexVtk(name,(await readFile(join(vtkRoot,name),'utf8')).slice(0,8192));
  const atoms=await record('AdsorbateAtoms.vtk');
  assert.deepEqual([atoms.format,atoms.encoding,atoms.datasetType,atoms.supportedScalarGrid,atoms.contextualGeometry],['legacy','ascii','POLYDATA',false,true]);
  for(const name of ['DensityProfile_C10.vtk','COMDensityProfile_C10.vtk']){const grid=await record(name);assert.deepEqual([grid.format,grid.encoding,grid.datasetType,grid.supportedScalarGrid],['legacy','ascii','STRUCTURED_POINTS',true]);}
  const binary=indexVtk('binary.vtk','# vtk DataFile Version 3.0\nx\nBINARY\nDATASET STRUCTURED_POINTS\nSCALARS density float');
  const xml=indexVtk('grid.vti','<?xml version="1.0"?><VTKFile type="ImageData">');
  assert.equal(spatialWorkflowState({records:[binary],record:binary}).code,'unsupported_vtk_encoding');
  assert.equal(spatialWorkflowState({records:[xml],record:xml}).code,'unsupported_vtk_encoding');
  assert.equal(spatialWorkflowState({records:[atoms],record:atoms}).code,'contextual_vtk_geometry');
});

test('lazy VTK records preserve exact-run provenance and unmodified source bytes',async()=>{
  const root=join(process.cwd(),'test/fixtures/representative_dataset/nonideal_PFA');
  const catalog=await new DirectoryCatalogScanner(fsDirectory(root,'nonideal_PFA'),{batchSize:10000}).scan(),run=catalog.runs.find(x=>x.chain==='C10'&&x.run==='40'),record=run.outputs.vtk.find(x=>x.name==='DensityProfile_C10.vtk');
  assert.equal(record.path.includes('C10/40/VTK/System_0/'),true);assert.equal(record.grid,undefined,'directory discovery indexes only the header and does not parse the scalar grid');
  const source=await readFile(join(vtkRoot,record.name)),authorized=Buffer.from(await record.file.arrayBuffer());assert.deepEqual(authorized,source,'handoff bytes are exactly the authorized source bytes');
});

test('matched run prefers and parses a scalar grid while its movie is usable and validation stays mandatory',async()=>{
  const root=join(process.cwd(),'test/fixtures/representative_dataset/nonideal_PFA');
  const catalog=await new DirectoryCatalogScanner(fsDirectory(root,'nonideal_PFA'),{batchSize:10000}).scan();
  const run=catalog.runs.find(x=>x.chain==='C10'&&x.run==='40');assert.ok(run);
  const records=run.outputs.vtk;assert.equal(records[0].name,'AdsorbateAtoms.vtk');
  const selected=records[preferredSpatialRecordIndex(records)];assert.equal(selected.supportedScalarGrid,true);assert.match(selected.name,/DensityProfile_C10\.vtk/);
  const grid=parseLegacyVtk(await selected.file.text(),selected.path);assert.ok(grid.arrays.length);assert.equal(spatialWorkflowState({records,record:selected,grid}).code,'scalar_mapping_required');assert.equal(spatialWorkflowState({records,record:selected,grid,scalarIdentity:{arrayName:grid.arrays[0].name}}).code,'grid_only_visualization');
  const movie=run.outputs.movie.find(x=>x.path.endsWith(movieName));assert.ok(movie,'exact-run movie is authorized');
  const indexed=await indexPdbSource(movie.file);assert.equal(indexed.frames.length,1000);assert.equal(indexed.frames[0].atomCount,250);
  const identity={dataset:'representative',component:'C10',run:'40',pressurePa:23299.51811,systemDirectory:'System_0'},simulation=parseSimulationInput(await readFile(join(runRoot,'simulation.input'),'utf8')),movieCell=parsePdbCryst1((await readFile(join(runRoot,'Movies/System_0',movieName),'utf8')).slice(0,512)),cifCell=parseCif(await readFile(join(runRoot,'IRMOF-1.cif'),'utf8'));
  const registration=validateSpatialRegistration(buildSpatialRegistrationInput({grid,simulation,movieCell,cifCell,identity,vtkIdentity:identity,movieIdentity:identity,annotationIdentity:identity}));assert.equal(registration.validated,true,registration.reasons.join('; '));assert.equal(spatialWorkflowState({records,record:selected,grid,scalarIdentity:{arrayName:'scalars'},registration}).level,'registered_framework_overlay');
});
