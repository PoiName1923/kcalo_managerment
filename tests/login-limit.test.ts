import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import type {ApiRequest} from '../src/http.js';
import {clientKey} from '../src/login-rate-limit.js';
import auth from '../api/auth.js';
import type {ServerResponse} from 'node:http';

async function limiterDb() {
  const db=new PGlite();
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await db.exec(await readFile(new URL('../supabase/migrations/004_login_rate_limit.sql',import.meta.url),'utf8'));
  return db;
}
async function consume(db:PGlite,key:string,limit=5,window=1800) {
  return (await db.query<any>('select consume_login_attempt($1,$2,$3) value',[key,limit,window])).rows[0].value;
}

test('Supabase limiter admits five attempts and returns rolling retry times',async()=>{
  const db=await limiterDb();
  try{
    const key='a'.repeat(64);
    for(let i=1;i<=5;i++)assert.deepEqual(await consume(db,key),{allowed:true,retry_after:0,remaining:5-i});
    const denied=await consume(db,key);
    assert.equal(denied.allowed,false);assert.equal(denied.remaining,0);
    assert.ok(denied.retry_after>=1&&denied.retry_after<=1800);
    assert.equal((await db.query<any>('select count(*)::int n from login_attempts where client_key=$1',[key])).rows[0].n,5,
      'denied attempts must not extend the rolling window');
  }finally{await db.close();}
});

test('Supabase limiter isolates client keys and releases a slot at the boundary',async()=>{
  const db=await limiterDb();
  try{
    const keyA='a'.repeat(64),keyB='b'.repeat(64);
    for(let i=0;i<5;i++)await consume(db,keyA);
    assert.equal((await consume(db,keyB)).allowed,true);
    await db.query("update login_attempts set attempted_at=clock_timestamp()-interval '1800 seconds' where client_key=$1 and id=(select min(id) from login_attempts where client_key=$1)",[keyA]);
    const released=await consume(db,keyA);
    assert.equal(released.allowed,true);assert.equal(released.remaining,0);
  }finally{await db.close();}
});

test('Supabase limiter rejects invalid bounds and hides attempts from non-service roles',async()=>{
  const db=await limiterDb();
  try{
    const key='a'.repeat(64);
    await assert.rejects(consume(db,key,0,1800),/invalid/i);
    await assert.rejects(consume(db,key,5,86401),/invalid/i);
    await db.exec('set role authenticated');
    await assert.rejects(db.query('select * from login_attempts'),/permission denied/i);
    await assert.rejects(consume(db,key),/permission denied/i);
  }finally{await db.close();}
});

test('Supabase limiter pruning removes expired attempts and keeps the active window',async()=>{
  const db=await limiterDb();
  try{
    const oldKey='a'.repeat(64),activeKey='b'.repeat(64);
    await consume(db,oldKey);await consume(db,activeKey);
    await db.query("update login_attempts set attempted_at=clock_timestamp()-interval '31 minutes' where client_key=$1",[oldKey]);
    await db.query('select prune_login_attempts()');
    const rows=(await db.query<any>('select client_key from login_attempts order by client_key')).rows;
    assert.deepEqual(rows,[{client_key:activeKey}]);
  }finally{await db.close();}
});

function request(headers:Record<string,string>={},remoteAddress='127.0.0.1') {
  return {headers,socket:{remoteAddress}} as unknown as ApiRequest;
}

test('clientKey trusts Vercel client IP only on Vercel and never returns the raw IP',()=>{
  const secret='s'.repeat(32),ip='203.0.113.10';
  const key=clientKey(request({'x-vercel-forwarded-for':ip,'x-forwarded-for':'198.51.100.9'},'127.0.0.1'),secret,true);
  assert.match(key,/^[a-f0-9]{64}$/);assert.equal(key.includes(ip),false);
  assert.equal(key,clientKey(request({'x-vercel-forwarded-for':ip},'192.0.2.1'),secret,true));
  assert.notEqual(key,clientKey(request({'x-vercel-forwarded-for':'203.0.113.11'}),secret,true));
  assert.notEqual(key,clientKey(request({'x-vercel-forwarded-for':ip}),'t'.repeat(32),true));
});

test('clientKey ignores forged forwarding headers in local development',()=>{
  const secret='s'.repeat(32);
  const first=clientKey(request({'x-forwarded-for':'198.51.100.1','x-real-ip':'198.51.100.2'},'127.0.0.1'),secret,false);
  const second=clientKey(request({'x-forwarded-for':'203.0.113.1','x-real-ip':'203.0.113.2'},'127.0.0.1'),secret,false);
  assert.equal(first,second);
});

test('clientKey accepts IPv4 and IPv6 but rejects missing or ambiguous Vercel identity',()=>{
  const secret='s'.repeat(32);
  assert.match(clientKey(request({},'::1'),secret,false),/^[a-f0-9]{64}$/);
  assert.throws(()=>clientKey(request({}),secret,true),/client ip/i);
  assert.throws(()=>clientKey(request({'x-vercel-forwarded-for':'203.0.113.1, 198.51.100.1'}),secret,true),/client ip/i);
  assert.throws(()=>clientKey(request({'x-vercel-forwarded-for':'not-an-ip'}),secret,true),/client ip/i);
});

async function invokeLogin(fetchImpl:typeof fetch,body:unknown={}) {
  const realFetch=globalThis.fetch,previous={...process.env};let output='',authCalls=0,rpcCalls=0;
  const headers:Record<string,string|string[]>={};
  Object.assign(process.env,{NODE_ENV:'production',VERCEL:'1',SUPABASE_URL:'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY:'service-role-key-long-enough',SUPABASE_ANON_KEY:'anon-key',CRON_SECRET:'c'.repeat(32),
    APP_URL:'https://calo.test',LOGIN_RATE_LIMIT_SECRET:'r'.repeat(32)});
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input));
    if(url.pathname.includes('/rpc/consume_login_attempt'))rpcCalls++;
    if(url.pathname.includes('/auth/v1/'))authCalls++;
    return fetchImpl(input,init);
  };
  const response={statusCode:200,setHeader(name:string,value:string|string[]){headers[name.toLowerCase()]=value;},end(value:string){output=value;}};
  try{
    await auth({method:'POST',url:'/api/auth?action=login',body,headers:{origin:'https://calo.test','x-vercel-forwarded-for':'203.0.113.10'},
      socket:{remoteAddress:'127.0.0.1'}} as unknown as ApiRequest,response as unknown as ServerResponse);
    return {status:response.statusCode,body:JSON.parse(output),headers,authCalls,rpcCalls};
  }finally{
    globalThis.fetch=realFetch;
    for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);
  }
}

test('login consumes Supabase quota before parsing credentials',async()=>{
  const result=await invokeLogin(async input=>{
    const url=new URL(String(input));
    if(url.pathname.includes('/rpc/consume_login_attempt'))return Response.json({allowed:true,retry_after:0,remaining:4});
    throw new Error('Supabase Auth must not receive malformed credentials');
  });
  assert.equal(result.status,400);assert.equal(result.rpcCalls,1);assert.equal(result.authCalls,0);
});

test('denied login returns 429 and Retry-After without contacting Supabase Auth',async()=>{
  const result=await invokeLogin(async input=>{
    const url=new URL(String(input));
    if(url.pathname.includes('/rpc/consume_login_attempt'))return Response.json({allowed:false,retry_after:321,remaining:0});
    throw new Error('Supabase Auth must not run after denial');
  },{email:'a@example.com',password:'wrong'});
  assert.equal(result.status,429);assert.equal(result.headers['retry-after'],'321');assert.equal(result.authCalls,0);
});

test('limiter errors return 503 without contacting Supabase Auth',async()=>{
  const result=await invokeLogin(async input=>{
    const url=new URL(String(input));
    if(url.pathname.includes('/rpc/consume_login_attempt'))return Response.json({message:'database unavailable'},{status:503});
    throw new Error('Supabase Auth must not run after limiter failure');
  },{email:'a@example.com',password:'wrong'});
  assert.equal(result.status,503);assert.equal(result.authCalls,0);
});
