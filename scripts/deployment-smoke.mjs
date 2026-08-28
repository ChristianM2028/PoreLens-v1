#!/usr/bin/env node
import {ASSET_REVISION} from '../asset-revision.mjs';
const base=(process.argv[2]||'http://127.0.0.1:4173').replace(/\/$/,'');
const expected=process.argv[3]||ASSET_REVISION;
const entry=await fetch(`${base}/index.html`,{cache:'no-store'}),html=await entry.text();
if(!entry.ok)throw new Error(`Entry page returned ${entry.status}`);
if(entry.headers.get('cache-control')!=='no-store')throw new Error(`index.html must be no-store, received ${entry.headers.get('cache-control')}`);
if(entry.headers.get('x-porelens-revision')!==expected||!html.includes(`name="porelens-revision" content="${expected}"`))throw new Error(`Entry page does not advertise revision ${expected}`);
const module=await fetch(`${base}/src/ui/chain-plotter-ui.mjs?rev=${encodeURIComponent(expected)}`),source=await module.text();
if(!module.ok)throw new Error(`Chain plotter returned ${module.status}`);
if(module.headers.get('x-porelens-revision')!==expected||!source.includes(`plot-theme.mjs?rev=${expected}`))throw new Error(`Chain plotter module graph does not use revision ${expected}`);
if(!/immutable/.test(module.headers.get('cache-control')||''))throw new Error('Revisioned chain plotter module is not immutable');
console.log(`Deployment smoke passed for ${base} at renderer revision ${expected}`);
