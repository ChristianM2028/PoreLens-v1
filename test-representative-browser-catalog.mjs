import test from 'node:test';
import assert from 'node:assert/strict';
import {readdir,readFile,stat} from 'node:fs/promises';
import {basename,join} from 'node:path';
import {DirectoryCatalogScanner} from './directory-catalog.mjs';
import {buildHandleCatalog} from './chain-series.mjs';

function fsFile(path){return {kind:'file',name:basename(path),async getFile(){const info=await stat(path);return {name:basename(path),size:info.size,lastModified:info.mtimeMs,text:()=>readFile(path,'utf8'),arrayBuffer:async()=>{const b=await readFile(path);return b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)}}}}}
function fsDirectory(path,name=basename(path)){return {kind:'directory',name,async *entries(){for(const entry of await readdir(path,{withFileTypes:true})){const target=join(path,entry.name);yield [entry.name,entry.isDirectory()?fsDirectory(target):fsFile(target)]}}}}
const fixture=join(process.cwd(),'test/fixtures/representative_dataset');

test('representative browser fixture becomes one normalized, lazily readable run',async()=>{
  const catalog=await new DirectoryCatalogScanner(fsDirectory(fixture,'representative_dataset'),{batchSize:10000}).scan();
  assert.deepEqual(catalog.runs.map(x=>x.id),['C10/40']);
  const run=catalog.runs[0];
  assert.equal(run.simulation.pressurePa,23299.51811);
  assert.equal(run.simulation.framework.name,'IRMOF-1');
  assert.deepEqual(run.simulation.settings.unitCells,[1,1,1]);
  assert.deepEqual(run.moleculeDefinitions.map(x=>x.component),['C10']);
  for(const type of ['raspa_output','rdf','end_to_end','movie','vtk'])assert.ok(run.outputs[type].length,`${type} associated`);
  const normalized=buildHandleCatalog(catalog,{datasetId:'A'}),rows=normalized.results.filter(x=>x.run==='40');
  assert.deepEqual(normalized.chains.map(x=>x.component),['C10']);
  assert.ok(rows.every(x=>x.normalizedRun===run&&x.pressurePa===23299.51811));
  const rdf=rows.find(x=>x.type==='rdf'),hist=rows.find(x=>x.type==='end_to_end'),movie=rows.find(x=>x.type==='movie'),vtk=rows.find(x=>x.type==='vtk');
  assert.match(await rdf.file.text(),/unnormalized distance histogram/i);
  assert.match(await hist.file.text(),/^\d+(?:\.\d+)?\s+[\deE+.-]+/m);
  assert.match((await movie.file.text()).slice(0,100),/MODEL|CRYST1/);
  assert.match((await vtk.file.text()).slice(0,100),/vtk/i);
});

test('nested arbitrary chains and nonconsecutive runs are discovered without code changes',async()=>{
  const file=(name,text)=>({kind:'file',name,async getFile(){return {name,size:text.length,lastModified:1,text:async()=>text,arrayBuffer:async()=>new TextEncoder().encode(text).buffer}}});
  const dir=(name,children)=>({kind:'directory',name,async *entries(){for(const child of children)yield[child.name,child]}});
  const sim=(name,p)=>`Framework 0\nFrameworkName IRMOF-1\nUnitCells 1 1 1\nExternalTemperature 310\nExternalPressure ${p}\nComponent 0 MoleculeName ${name}\nMoleculeDefinition local\n`;
  const root=dir('dataset',[dir('family',[dir('C10',[dir('50',[file('simulation.input',sim('C10',500))])]),dir('C9',[dir('3',[file('simulation.input',sim('guest_mix',30))]),dir('91',[file('simulation.input',sim('guest_mix',910))])])])]);
  const catalog=await new DirectoryCatalogScanner(root).scan();
  assert.deepEqual(catalog.runs.map(x=>x.id).sort(),['C10/50','C9/3','C9/91']);
  assert.deepEqual(buildHandleCatalog(catalog).chains.map(x=>x.component),['C9','C10']);
});

test('browser markup exposes one shared run selector and all run output tabs',async()=>{
  const html=await readFile(join(process.cwd(),'index.html'),'utf8');
  for(const type of ['raspa_output','rdf','end_to_end','movie','vtk'])assert.match(html,new RegExp(`role="tab" data-output-link="${type}"`));
  for(const id of ['outputDataset','outputChain','outputRun','outputFile','outputRunDiagnostics'])assert.match(html,new RegExp(`id="${id}"`));
});
