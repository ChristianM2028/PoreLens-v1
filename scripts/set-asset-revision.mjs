#!/usr/bin/env node
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';

const revision=process.argv[2];
if(!revision||!/^[a-z0-9][a-z0-9._-]+$/i.test(revision)){
  console.error('Usage: npm run assets:revision -- <new-revision>');
  process.exit(2);
}
const sourcePath='asset-revision.mjs';
const source=await readFile(sourcePath,'utf8');
const previous=source.match(/ASSET_REVISION='([^']+)'/)?.[1];
if(!previous)throw new Error(`${sourcePath} does not declare ASSET_REVISION`);
if(previous===revision)throw new Error('Refusing to reuse the current immutable asset revision');

async function filesBelow(directory){
  const result=[];
  for(const entry of await readdir(directory,{withFileTypes:true})){
    const path=join(directory,entry.name);
    if(entry.isDirectory())result.push(...await filesBelow(path));
    else if(/\.(?:mjs|js)$/.test(entry.name))result.push(path);
  }
  return result;
}
const paths=['index.html',...await filesBelow('src')];
for(const path of paths){
  const text=await readFile(path,'utf8');
  const updated=text.replaceAll(`?rev=${previous}`,`?rev=${revision}`).replace(
    new RegExp(`(<meta name="porelens-revision" content=")${previous}("\\s*>)`),
    `$1${revision}$2`
  );
  if(updated!==text)await writeFile(path,updated);
}
await writeFile(sourcePath,source.replace(`ASSET_REVISION='${previous}'`,`ASSET_REVISION='${revision}'`));
console.log(`Updated browser asset graph from ${previous} to ${revision}`);
