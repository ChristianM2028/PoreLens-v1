import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {dirname,join,normalize} from 'node:path';
import {pathToFileURL} from 'node:url';
import {ASSET_REVISION} from '../asset-revision.mjs';

async function filesBelow(directory){
  const result=[];
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const path=join(directory,entry.name);
    if(entry.isDirectory())result.push(...await filesBelow(path));
    else result.push(path);
  }
  return result;
}
const browserUrlPattern=/["'](\.{1,2}\/[^"']+\.(?:mjs|js)(?:\?rev=([^"']+))?)["']/g;
const references=source=>[...source.matchAll(browserUrlPattern)].map(match=>({url:match[1],revision:match[2]}));
const pathFor=(owner,url)=>normalize(join(dirname(owner),url.replace(/\?.*$/,'')));

test('published immutable asset manifest matches browser-served bytes for the entire module graph',async()=>{
  const published=JSON.parse(await readFile('test/fixtures/deployment/immutable-asset-manifest.json','utf8'));
  assert.equal(published.algorithm,'sha256');
  assert.equal(published.revision,ASSET_REVISION,'changed browser assets require a new published release revision');
  const html=await readFile('index.html','utf8'),pending=references(html).map(({url})=>pathFor('index.html',url));
  const graph=new Set(['index.html','styles.css']);
  while(pending.length){
    const path=pending.pop();
    if(graph.has(path))continue;
    graph.add(path);
    const source=await readFile(path,'utf8');
    for(const {url} of references(source))pending.push(pathFor(path,url));
  }
  assert.ok(graph.has('src/ui/phase-workspaces.mjs'),'lazy phase workspace is content-locked');
  assert.ok(graph.has('src/ui/plot-theme.mjs'),'transitive plot theme is content-locked');
  assert.deepEqual(Object.keys(published.assets).sort(),[...graph].sort(),'published manifest inventories the complete served graph');
  for(const path of graph){
    const digest=createHash('sha256').update(await readFile(path)).digest('hex');
    assert.equal(digest,published.assets[path],`${path} bytes changed without publishing a new immutable asset manifest and revision`);
  }
});

test('server, HTML, CSS, entry points, transitive modules, and workers use the release revision',async()=>{
  const paths=(await filesBelow('src')).filter(path=>/\.(?:mjs|js)$/.test(path)&&path!=='src/import/cli.mjs');
  const [html,server,...texts]=await Promise.all([readFile('index.html','utf8'),readFile('serve.mjs','utf8'),...paths.map(path=>readFile(path,'utf8'))]);
  assert.match(server,/import \{ASSET_REVISION\} from '\.\/asset-revision\.mjs'/);
  assert.doesNotMatch(server,/ASSET_REVISION\s*=\s*['"]/,'serve.mjs must not duplicate the release literal');
  assert.match(html,new RegExp(`<meta name="porelens-revision" content="${ASSET_REVISION}">`));
  assert.match(html,new RegExp(`styles\\.css\\?rev=${ASSET_REVISION}`));
  const sources=new Map(paths.map((path,index)=>[path,texts[index]]));
  const htmlEntries=references(html);
  assert.ok(htmlEntries.some(({url})=>url.includes('workspace-navigation-ui.mjs')),'HTML entry point is revisioned');
  const pending=htmlEntries.filter(({url})=>/\.(?:mjs|js)\?/.test(url)).map(({url})=>pathFor('index.html',url));
  const visited=new Set();
  while(pending.length){
    const path=pending.pop();
    if(visited.has(path))continue;
    visited.add(path);
    const source=sources.get(path);
    assert.ok(source,`deployment graph target exists: ${path}`);
    for(const reference of references(source)){
      assert.equal(reference.revision,ASSET_REVISION,`${path} -> ${reference.url} uses the release revision`);
      pending.push(pathFor(path,reference.url));
    }
  }
  assert.ok(visited.has('src/ui/app.js'),'lazy application entry point was traversed');
  assert.ok(visited.has('src/ui/chain-plotter-ui.mjs'),'isotherm entry point was traversed');
  assert.ok(visited.has('src/workers/catalog-worker.mjs'),'module worker was traversed');
  for(const [path,source] of sources){
    for(const reference of references(source))assert.equal(reference.revision,ASSET_REVISION,`${path} contains a mismatched browser URL`);
    assert.deepEqual([...source.matchAll(/["'](\.{1,2}\/[^"'?]+\.(?:mjs|js))["']/g)].map(match=>match[1]),[],`${path} contains an unversioned browser module URL`);
  }
});

test('a cleanup-boundary plotter cannot resolve against the stale immutable isotherm module',async()=>{
  const plotter=await readFile('src/ui/chain-plotter-ui.mjs','utf8');
  const importMatch=plotter.match(/import \{([^}]+)\} from '\.\.\/core\/isotherm-summary\.mjs\?rev=([^']+)'/);
  assert.ok(importMatch,'plotter has an explicit revisioned isotherm-summary import');
  const required=importMatch[1].split(',').map(name=>name.trim());
  assert.ok(required.includes('prepareIsothermSeries'));
  assert.equal(importMatch[2],ASSET_REVISION);
  const staleUrl=pathToFileURL(join(process.cwd(),'test/fixtures/deployment/isotherm-summary-before-cleanup.mjs')).href;
  const stale=await import(`${staleUrl}?case=stale`);
  const current=await import(`../src/core/isotherm-summary.mjs?case=${ASSET_REVISION}`);
  assert.ok(!('prepareIsothermSeries' in stale),'fixture represents the pre-cleanup export surface');
  assert.deepEqual(required.filter(name=>!(name in current)),[],'the published revision satisfies the plotter import');
  const resolveGraph=({plotterRevision,moduleRevision,module})=>{
    assert.equal(moduleRevision,plotterRevision,'immutable module graph revision mismatch');
    for(const name of required)assert.ok(name in module,`missing module export: ${name}`);
  };
  assert.throws(()=>resolveGraph({plotterRevision:ASSET_REVISION,moduleRevision:'porelens-before-cleanup',module:stale}),/revision mismatch/);
  assert.doesNotThrow(()=>resolveGraph({plotterRevision:ASSET_REVISION,moduleRevision:ASSET_REVISION,module:current}));
});

test('indexed PDB API is connected through the revisioned served graph',async()=>{
  const [packageSource,trajectorySource]=await Promise.all([readFile('src/core/raspa-package.mjs','utf8'),readFile('src/core/trajectory.mjs','utf8')]);
  assert.match(packageSource,new RegExp(`from './trajectory\\.mjs\\?rev=${ASSET_REVISION}'`));
  assert.match(packageSource,/import \{parseSimulationInput,indexPdbSource,validateMovieTopology\}/);
  assert.match(trajectorySource,/export async function indexPdbSource/);
});
