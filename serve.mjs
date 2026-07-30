#!/usr/bin/env node
import {createReadStream,statSync} from 'node:fs';
import {createServer} from 'node:http';
import {extname,resolve,sep} from 'node:path';
import {ASSET_REVISION} from './asset-revision.mjs';

const root=resolve(process.cwd());
const port=Number(process.env.PORT||4173);
const types={'.css':'text/css; charset=utf-8','.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};

createServer((request,response)=>{
  const url=new URL(request.url,'http://localhost');
  const relative=decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname);
  const file=resolve(root,`.${relative}`);
  if(file!==root&&!file.startsWith(`${root}${sep}`)){response.writeHead(403);response.end('Forbidden');return}
  let details;
  try{details=statSync(file)}catch{response.writeHead(404);response.end('Not found');return}
  if(!details.isFile()){response.writeHead(404);response.end('Not found');return}
  const revision=url.searchParams.get('rev');
  if(revision&&revision!==ASSET_REVISION){response.writeHead(404,{'Cache-Control':'no-store'});response.end('Unknown asset revision');return}
  const immutable=revision===ASSET_REVISION;
  response.writeHead(200,{
    'Content-Type':types[extname(file)]||'application/octet-stream',
    'Content-Length':details.size,
    'Last-Modified':details.mtime.toUTCString(),
    'Cache-Control':immutable?'public, max-age=31536000, immutable':'no-cache, must-revalidate',
    'X-PoreLens-Revision':ASSET_REVISION,
    'X-Content-Type-Options':'nosniff'
  });
  if(request.method==='HEAD')response.end();else createReadStream(file).pipe(response);
}).listen(port,'127.0.0.1',()=>console.log(`PoreLens ${ASSET_REVISION} serving ${root} at http://127.0.0.1:${port}`));
