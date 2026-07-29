import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';

const execFileAsync=promisify(execFile);
const revision='porelens-20260729-indexed-pdb-v1';

test('HTML and the complete browser module graph share one revision marker',async()=>{
  const {stdout}=await execFileAsync('rg',['--files','-g','*.mjs','-g','*.js']);
  const paths=stdout.trim().split('\n').filter(path=>!path.startsWith('test-')&&!path.startsWith('test/')&&path!=='serve.mjs'&&path!=='poreview/cli.mjs');
  const html=await readFile('index.html','utf8');
  assert.match(html,new RegExp(`<meta name="porelens-revision" content="${revision}">`));
  assert.match(html,new RegExp(`styles\\.css\\?rev=${revision}`));
  for(const path of paths){
    const source=await readFile(path,'utf8');
    const unversioned=[...source.matchAll(/['"](\.{1,2}\/[^'"?]+\.(?:mjs|js))['"]/g)].map(match=>match[1]);
    assert.deepEqual(unversioned,[],`${path} contains unversioned browser module URLs`);
  }
});

test('indexed PDB API is connected through the revisioned served graph',async()=>{
  const [packageSource,trajectorySource]=await Promise.all([readFile('raspa-package.mjs','utf8'),readFile('trajectory.mjs','utf8')]);
  assert.match(packageSource,new RegExp(`from './trajectory\\.mjs\\?rev=${revision}'`));
  assert.match(packageSource,/import \{parseSimulationInput,indexPdbSource,validateMovieTopology\}/);
  assert.match(trajectorySource,/export async function indexPdbSource/);
});
