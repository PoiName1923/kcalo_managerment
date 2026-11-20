import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve,extname } from 'node:path';
import auth from '../api/auth.js';
import dashboard from '../api/dashboard.js';
import integrations from '../api/integrations.js';
import users from '../api/users.js';
import health from '../api/health.js';
const handlers:Record<string,any>={'/api/auth':auth,'/api/dashboard':dashboard,'/api/integrations':integrations,'/api/users':users,'/api/health':health};
const publicRoot=resolve('public');
const types:Record<string,string>={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.woff2':'font/woff2'};
createServer(async(req,res)=>{
  try{
    const path=new URL(req.url??'/','http://localhost').pathname;
    if(handlers[path]){await handlers[path](req,res);return;}
    const file=resolve(publicRoot,'.'+(['/','/login','/dashboard','/integrations','/users','/account'].includes(path)?'/index.html':decodeURIComponent(path)));
    if(!file.startsWith(publicRoot+'\\') && !file.startsWith(publicRoot+'/')){res.writeHead(403).end();return;}
    const content=await readFile(file);res.setHeader('Content-Type',types[extname(file)]??'application/octet-stream');res.end(content);
  }catch{res.writeHead(404).end('Not found');}
}).listen(Number(process.env.PORT??4173),'127.0.0.1',()=>console.log(`Local preview: http://127.0.0.1:${process.env.PORT??4173}`));
