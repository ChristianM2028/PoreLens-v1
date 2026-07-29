#!/usr/bin/env node
import {createServer} from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {extname,join,normalize} from 'node:path';

const host=process.env.HOST||'127.0.0.1',port=Number(process.env.PORT||process.argv[2]||8000),root=process.cwd();
const types={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8'};
const server=createServer(async(request,response)=>{try{const pathname=normalize(decodeURIComponent(new URL(request.url,'http://localhost').pathname)).replace(/^(?:\.\.(?:\/|\\|$))+|^[\/\\]+/g,''),file=join(root,pathname||'index.html');await stat(file);response.setHeader('Content-Type',types[extname(file)]||'application/octet-stream');
  // Unbundled transitive imports do not inherit a parent's query string. Revalidation
  // for all source modules therefore keeps the complete graph on one revision.
  if(/\.(?:html|mjs|js)$/i.test(file))response.setHeader('Cache-Control','no-cache');else response.setHeader('Cache-Control','public, max-age=300');response.end(await readFile(file));
}catch{response.statusCode=404;response.setHeader('Cache-Control','no-store');response.end('Not found')}});
server.listen(port,host,()=>console.log(`PoreLens development server: http://${host}:${port}`));
