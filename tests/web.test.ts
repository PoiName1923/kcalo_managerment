import { gzipSync } from 'node:zlib';
import { checksum } from '../src/retention.js';
import assert from 'node:assert/strict';
import test from 'node:test';
import type { ServerResponse } from 'node:http';
import dashboard from '../api/dashboard.js';
import users from '../api/users.js';
import integrations from '../api/integrations.js';
import { cookies,sessionCookies } from '../src/web-auth.js';
import type { ApiRequest } from '../src/http.js';
import { getConfig } from '../src/config.js';

test('web API uses verified account scope, ignores metadata admin claims, blocks foreign settings',async()=>{
  const previous={...process.env},realFetch=globalThis.fetch;
  const owner='00000000-0000-4000-8000-000000000001',foreign='00000000-0000-4000-8000-000000000002';
  Object.assign(process.env,{SUPABASE_URL:'https://web-test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'service-role-test-key',
    CRON_SECRET:'x'.repeat(32),APP_URL:'https://calo.test',CREDENTIAL_ENCRYPTION_KEY:Buffer.alloc(32,3).toString('base64')});
  const archive=gzipSync(JSON.stringify({meals:[{id:'archived',owner_id:owner,created_at:'2026-11-20T18:00:00Z',estimate:{items:[]}},{id:'foreign',owner_id:foreign,created_at:'2026-11-20T18:00:00Z'},{id:'outside',owner_id:owner,created_at:'2026-11-21T17:00:00Z'}]}));
  const json=(data:unknown)=>new Response(JSON.stringify(data),{headers:{'content-type':'application/json'}});
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input));
    if(url.pathname==='/auth/v1/user')return json({id:owner,email:'a@example.com',app_metadata:{role:'admin'}});
    if(url.pathname==='/rest/v1/profiles')return json([{id:owner,email:'a@example.com',display_name:'An',role:'member',active:true}]);
    if(url.pathname==='/rest/v1/bot_integrations'){
      assert.equal(url.searchParams.get('owner_id'),`eq.${owner}`);
      return json([]);
    }
    if(url.pathname==='/rest/v1/rpc/dashboard_data'){
      const body=JSON.parse(String(init?.body));assert.equal(body.p_owner,owner);
      return json({daily:[],all_time:{meals:0,kcal:0},usage:{calls:0}});
    }
    if(url.pathname==='/rest/v1/archive_batches'){
      assert.equal(url.searchParams.get('owner_id'),`eq.${owner}`);
      assert.equal(url.searchParams.get('earliest_at'),'lt.2026-11-21T17:00:00.000Z');
      assert.equal(url.searchParams.get('latest_at'),'gte.2026-11-20T17:00:00.000Z');
      return json([{chat_id:1,status:'complete',object_path:'archive.gz',checksum:checksum(archive)}]);
    }
    if(url.pathname.includes('/storage/v1/object/'))return new Response(archive,{headers:{'content-type':'application/gzip'}});
    if(url.pathname==='/rest/v1/meals'){
      if(url.searchParams.has('created_at')){assert.equal(url.searchParams.get('created_at'),'gte.2026-11-20T17:00:00.000Z');assert.equal(url.searchParams.get('and'),null);assert.ok(url.search.includes('lt.2026-11-21T17'));}
      assert.equal(url.searchParams.get('owner_id'),`eq.${owner}`);return json([]);}
    throw new Error('Unexpected unscoped request');
  };
  const invoke=async(handler:typeof dashboard,method:string,url:string,body?:unknown,authenticated=true)=>{
    let output='';const response={statusCode:200,setHeader(){},end(data:string){output=data;}};
    await handler({method,url,headers:{origin:'https://calo.test',...(authenticated?{cookie:'calo_access=verified-token'}:{})},body} as ApiRequest,response as unknown as ServerResponse);
    return {status:response.statusCode,body:JSON.parse(output)};
  };
  try{
    assert.equal((await invoke(dashboard,'GET',`/api/dashboard?owner=${foreign}&days=30`)).status,200);
    const detail=await invoke(dashboard,'GET','/api/dashboard?day=2026-11-21');
    assert.equal(detail.status,200);assert.deepEqual(detail.body.meals.map((m:{id:string})=>m.id),['archived']);
    assert.equal((await invoke(dashboard,'GET','/api/dashboard?day=2026-02-30')).status,400);
    assert.equal((await invoke(dashboard,'GET','/api/dashboard',undefined,false)).status,401);
    assert.equal((await invoke(users,'GET','/api/users')).status,403);
    assert.equal((await invoke(integrations,'POST','/api/integrations?action=disable',{id:foreign})).status,404);
    const responseHeaders:Record<string,unknown>={};
    sessionCookies({setHeader(name:string,value:unknown){responseHeaders[name]=value;}} as unknown as ServerResponse,getConfig(),{access_token:'access',refresh_token:'refresh',expires_in:3600});
    const cookieHeaders=responseHeaders['Set-Cookie'] as string[];
    assert.ok(cookieHeaders.every(c=>c.includes('HttpOnly')&&c.includes('Secure')&&c.includes('SameSite=Lax')));
    assert.equal(cookies({headers:{cookie:'bad=%ZZ; calo_access=valid'}} as ApiRequest).calo_access,'valid');
  }finally{globalThis.fetch=realFetch;for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);}
});
