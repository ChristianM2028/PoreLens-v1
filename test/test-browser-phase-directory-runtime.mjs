import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {mkdtemp,readFile,rm,stat} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {extname,join,normalize} from 'node:path';
import {ASSET_REVISION} from '../asset-revision.mjs';

const browser=['chromium','chromium-browser','google-chrome'].find(command=>spawnSync('sh',['-c',`command -v ${command}`]).status===0);

test('revisioned browser graph runs both representative phase directory change handlers',{skip:browser?false:'Chromium is not installed in this environment'},async()=>{
  const root=process.cwd(),requests=[];
  const server=createServer(async(request,response)=>{try{
    const pathname=normalize(decodeURIComponent(request.url.split('?')[0])).replace(/^\/+/,''),file=join(root,pathname||'index.html');
    await stat(file);requests.push(request.url);
    response.setHeader('content-type',extname(file)==='.mjs'||extname(file)==='.js'?'text/javascript':extname(file)==='.html'?'text/html':extname(file)==='.css'?'text/css':'application/octet-stream');
    response.end(await readFile(file));
  }catch{response.statusCode=404;response.end('not found')}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}/test/browser/phase-directory-runtime.html`;
  const child=spawn(browser,['--headless','--no-sandbox','--disable-gpu','--virtual-time-budget=20000','--dump-dom',url]);
  let output='',errors='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>errors+=chunk);
  const code=await new Promise(resolve=>child.on('close',resolve));server.close();assert.equal(code,0,errors);
  const match=output.match(/<pre id="result">([^<]+)<\/pre>/);assert.ok(match,`browser result missing: ${output.slice(-1600)}`);
  const report=JSON.parse(match[1].replaceAll('&quot;','"').replaceAll('&amp;','&').replaceAll('&#39;',"'"));
  assert.equal(report.ok,true,report.error);assert.equal(report.revision,ASSET_REVISION);assert.deepEqual(report.linkingErrors,[]);
  for(const kind of ['gemc','henry']){assert.ok(['ready','partial-success'].includes(report[kind].status),`${kind} status`);assert.ok(report[kind].records>0,`${kind} usable records`);assert.equal(report.transitions[kind][0],'empty');}
  assert.ok(requests.some(url=>url.includes(`/src/ui/phase-workspaces.mjs?rev=${ASSET_REVISION}`)),'lazy phase workspace used the release URL');
  assert.ok(requests.some(url=>url.includes(`/src/ui/plot-theme.mjs?rev=${ASSET_REVISION}`)),'transitive plot theme used the release URL');
});

test('a profile with the prior immutable graph recovers on a normal reload',{skip:browser?false:'Chromium is not installed in this environment'},async()=>{
  const root=process.cwd(),profile=await mkdtemp(join(tmpdir(),'porelens-cache-profile-')),oldRevision='porelens-20260730-isotherm-export-v3',requests=[];
  let publishOld=true;
  const server=createServer(async(request,response)=>{try{
    const pathname=normalize(decodeURIComponent(request.url.split('?')[0])).replace(/^\/+/,''),file=join(root,pathname||'index.html');
    await stat(file);requests.push(request.url);let body=await readFile(file);
    const textual=['.mjs','.js','.html','.css'].includes(extname(file));
    if(publishOld&&textual)body=Buffer.from(body.toString().replaceAll(ASSET_REVISION,oldRevision));
    const requestedRevision=new URL(request.url,'http://localhost').searchParams.get('rev');
    response.setHeader('cache-control',requestedRevision?'public, max-age=31536000, immutable':'no-cache, must-revalidate');
    response.setHeader('content-type',extname(file)==='.mjs'||extname(file)==='.js'?'text/javascript':extname(file)==='.html'?'text/html':extname(file)==='.css'?'text/css':'application/octet-stream');response.end(body);
  }catch{response.statusCode=404;response.end('not found')}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  try{
    const run=url=>new Promise(resolve=>{const child=spawn(browser,['--headless','--no-sandbox','--disable-gpu',`--user-data-dir=${profile}`,'--virtual-time-budget=20000','--dump-dom',url]);let stdout='',stderr='';child.stdout.on('data',chunk=>stdout+=chunk);child.stderr.on('data',chunk=>stderr+=chunk);child.on('close',status=>resolve({status,stdout,stderr}))});
    const prime=await run(`${origin}/index.html#gemc-workspace`);
    assert.equal(prime.status,0,prime.stderr);assert.ok(requests.some(url=>url.includes(`phase-workspaces.mjs?rev=${oldRevision}`)),'prior lazy module was cached');
    publishOld=false;requests.length=0;
    const reload=await run(`${origin}/test/browser/phase-directory-runtime.html`);
    assert.equal(reload.status,0,reload.stderr);const match=reload.stdout.match(/<pre id="result">([^<]+)<\/pre>/);assert.ok(match,'reload browser result missing');
    const report=JSON.parse(match[1].replaceAll('&quot;','"').replaceAll('&amp;','&').replaceAll('&#39;',"'"));assert.equal(report.ok,true,report.error);assert.equal(report.revision,ASSET_REVISION);assert.deepEqual(report.linkingErrors,[]);
    assert.ok(requests.some(url=>url.includes(`phase-workspaces.mjs?rev=${ASSET_REVISION}`)),'reload fetched the new lazy module URL');assert.ok(requests.some(url=>url.includes(`plot-theme.mjs?rev=${ASSET_REVISION}`)),'reload fetched its new transitive dependency URL');
  }finally{server.close();await rm(profile,{recursive:true,force:true})}
});
