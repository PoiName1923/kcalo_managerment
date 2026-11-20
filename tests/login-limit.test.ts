import assert from 'node:assert/strict';
import test from 'node:test';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {requireLoginProxy} from '../src/login-proxy.js';
import type {ApiRequest} from '../src/http.js';
import auth from '../api/auth.js';
import type {ServerResponse} from 'node:http';
const {lua,lauxlib,lualib,to_luastring,to_jsstring}=createRequire(import.meta.url)('fengari');

test('production login requires Nginx proof; local development stays usable',()=>{
  const request=(value?:string)=>({headers:{...(value?{'x-calo-login-proxy':value}:{})}} as ApiRequest);
  assert.throws(()=>requireLoginProxy(request(),undefined,true),/chưa được cấu hình/i);
  assert.throws(()=>requireLoginProxy(request(),'a'.repeat(32),true),/Nginx/i);
  assert.throws(()=>requireLoginProxy(request('forged'),'a'.repeat(32),true),/Nginx/i);
  assert.doesNotThrow(()=>requireLoginProxy(request('a'.repeat(32)),'a'.repeat(32),true));
  assert.doesNotThrow(()=>requireLoginProxy(request(),undefined,false));
});

test('login HTTP route rejects direct origin access before contacting Supabase',async()=>{
  const previous={...process.env},realFetch=globalThis.fetch;
  Object.assign(process.env,{NODE_ENV:'production',SUPABASE_URL:'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY:'test-service-role-key',SUPABASE_ANON_KEY:'test-anon-key',CRON_SECRET:'c'.repeat(32),
    APP_URL:'https://calo.test',LOGIN_PROXY_SECRET:'a'.repeat(32)});
  globalThis.fetch=async()=>{throw new Error('Should not contact Supabase');};
  const invoke=async(proof?:string)=>{
    let output='';const response={statusCode:200,setHeader(){},end(value:string){output=value;}};
    await auth({method:'POST',url:'/api/auth?action=login',body:{},headers:{origin:'https://calo.test',
      ...(proof?{'x-calo-login-proxy':proof}:{})}} as ApiRequest,response as unknown as ServerResponse);
    return {status:response.statusCode,body:JSON.parse(output)};
  };
  try{
    assert.equal((await invoke()).status,403);
    assert.equal((await invoke('forged')).status,403);
    assert.equal((await invoke('a'.repeat(32))).status,400,'valid proof proceeds to body validation');
    delete process.env.LOGIN_PROXY_SECRET;
    const unconfigured=await invoke();assert.equal(unconfigured.status,503);assert.match(unconfigured.body.error,/chưa được cấu hình/);
  }finally{globalThis.fetch=realFetch;for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);}
});

test('actual Lua limiter permits five in any 1800 seconds without extending rejected windows',async()=>{
  const source=await readFile(new URL('../infra/nginx/lua/login_window.lua',import.meta.url),'utf8');
  const L=lauxlib.luaL_newstate();lualib.luaL_openlibs(L);
  const script=`local limiter=(function() ${source}\nend)()
    local values={}
    local dict={get=function(_,key) return values[key] end,safe_set=function(_,key,value,ttl) assert(ttl==1800);values[key]=value;return true end}
    for i=1,5 do local ok,retry,remaining=limiter.check(dict,'a',100);assert(ok and retry==0 and remaining==5-i) end
    local ok,retry=limiter.check(dict,'a',100);assert(not ok and retry==1800)
    local ok,retry=limiter.check(dict,'a',1899.5);assert(not ok and retry==1)
    assert(limiter.check(dict,'other-ip',100))
    assert(limiter.check(dict,'a',1900))
    for _,t in ipairs({0,360,720,1080,1440}) do assert(limiter.check(dict,'spread',t)) end
    local ok,retry=limiter.check(dict,'spread',1799);assert(not ok and retry==1)
    assert(limiter.check(dict,'spread',1800))
    local ok,retry=limiter.check(dict,'spread',1800);assert(not ok and retry==360)
    local full={get=function()return nil end,safe_set=function()return nil,'no memory' end}
    local ok,_,_,err=limiter.check(full,'full',100);assert(not ok and err=='no memory')
  `;
  try{const status=lauxlib.luaL_dostring(L,to_luastring(script));assert.equal(status,lua.LUA_OK,lua.lua_tostring(L,-1)?to_jsstring(lua.lua_tostring(L,-1)):'Lua failed');}
  finally{lua.lua_close(L);}
});

test('actual Nginx Lua access gate counts only login, rejects ambiguous arguments and strips forged proof',async()=>{
  const limiter=await readFile(new URL('../infra/nginx/lua/login_window.lua',import.meta.url),'utf8');
  const access=await readFile(new URL('../infra/nginx/lua/access.lua',import.meta.url),'utf8');
  const L=lauxlib.luaL_newstate();lualib.luaL_openlibs(L);
  const script=`package.preload['login_window']=function() ${limiter}\nend
    package.preload['resty.lock']=function()return {new=function()return {lock=function()return 0 end,unlock=function()return true end} end}end
    os.getenv=function()return string.rep('a',32)end
    local entries={};local headers={};local method='POST';local args={action='login'};local argerr=nil;local status=nil
    ngx={header={},var={binary_remote_addr='ip-a'},shared={login_windows={get=function(_,k)return entries[k]end,safe_set=function(_,k,v)entries[k]=v;return true end}},
      req={clear_header=function(k)headers[k]=nil end,set_header=function(k,v)headers[k]=v end,get_method=function()return method end,
        get_uri_args=function()return args,argerr end},now=function()return 100 end,say=function()end,exit=function(code)status=code end}
    local function run()status=nil;ngx.header={};assert(load(${JSON.stringify(access)}))()end
    for i=1,5 do run();assert(status==nil and headers['X-Calo-Login-Proxy']==string.rep('a',32))end
    run();assert(status==429 and ngx.header['Retry-After']==1800 and headers['X-Calo-Login-Proxy']==nil)
    method='GET';headers['X-Calo-Login-Proxy']='spoofed';run();assert(status==nil and headers['X-Calo-Login-Proxy']==nil)
    method='POST';args={action='refresh'};run();assert(status==nil and headers['X-Calo-Login-Proxy']==nil)
    args={action={'refresh','login'}};run();assert(status==400)
    args={action='login'};argerr='truncated';run();assert(status==400)
  `;
  try{const status=lauxlib.luaL_dostring(L,to_luastring(script));assert.equal(status,lua.LUA_OK,lua.lua_tostring(L,-1)?to_jsstring(lua.lua_tostring(L,-1)):'Lua gate failed');}
  finally{lua.lua_close(L);}
});
