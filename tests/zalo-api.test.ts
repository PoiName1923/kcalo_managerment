import assert from 'node:assert/strict';
import test from 'node:test';
import type {ServerResponse} from 'node:http';
import integrations from '../api/integrations.js';
import webhook from '../api/webhook.js';
import type {ApiRequest} from '../src/http.js';
import {decryptSecret} from '../src/credentials.js';

test('Zalo settings verify token, preserve IDs, configure webhook and authenticate its own header',async()=>{
  const previous={...process.env},realFetch=globalThis.fetch,master=Buffer.alloc(32,4).toString('base64');
  const owner='00000000-0000-4000-8000-000000000001',sender='6ede9afa66b88fe6d6a9';
  const externalId='1459232241454765289';let stored:any;let queued:any;let webhookBody:any;let verification=true;
  Object.assign(process.env,{SUPABASE_URL:'https://zalo-test.supabase.co',SUPABASE_SERVICE_ROLE_KEY:'service-role-test-key',
    CRON_SECRET:'x'.repeat(32),APP_URL:'https://calo.test',CREDENTIAL_ENCRYPTION_KEY:master});
  const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
  globalThis.fetch=async(input,init)=>{
    const url=new URL(String(input)),body=typeof init?.body==='string'?JSON.parse(init.body):null;
    if(url.hostname==='bot-api.zaloplatforms.com'){
      if(url.pathname.endsWith('/getMe'))return json({ok:true,result:{id:externalId,account_name:'bot.example',account_type:'BASIC'}});
      if(url.pathname.endsWith('/setWebhook')){webhookBody=body;return json({ok:true,result:{verification:{ok:verification}}});}
    }
    if(url.hostname!=='zalo-test.supabase.co')throw new Error('Unexpected external request');
    if(url.pathname==='/auth/v1/user')return json({id:owner,email:'owner@example.com'});
    if(url.pathname==='/rest/v1/profiles')return json([{id:owner,email:'owner@example.com',active:true,role:'member'}]);
    if(url.pathname==='/rest/v1/bot_integrations'){
      if(init?.method==='POST'){stored=body;return json(stored,201);}
      if(init?.method==='PATCH'){stored={...stored,...body};return new Response(null,{status:204});}
      return json(stored?[stored]:[]);
    }
    if(url.pathname==='/rest/v1/bot_jobs'){
      if(init?.method==='POST'){queued=body;return new Response(null,{status:201});}
      return json({id:'00000000-0000-4000-8000-000000000009'});
    }
    if(url.pathname==='/rest/v1/rpc/claim_bot_jobs')return json([]);
    throw new Error('Unexpected API route');
  };
  async function invoke(handler:typeof integrations,method:string,url:string,body:unknown,headers:Record<string,string>={}){
    let text='';const res={statusCode:200,setHeader(){},end(value:string){text=value;}};
    await handler({method,url,body,headers:{cookie:'calo_access=token',origin:'https://calo.test',...headers}} as ApiRequest,res as unknown as ServerResponse);
    return {status:res.statusCode,body:JSON.parse(text)};
  }
  try{
    const created=await invoke(integrations,'POST','/api/integrations',{provider:'zalo',name:'Bot Zalo',allowed_user_id:sender,
      bot_token:'123456789:private-zalo-token',gemini_key:'private-gemini-key',gemini_model:'test-model'});
    assert.equal(created.status,200);assert.equal(stored.external_bot_id,externalId);
    assert.equal(stored.telegram_bot_id,null);assert.equal(stored.allowed_user_id,sender);
    assert.equal(created.body.bot.provider,'zalo');assert.equal(JSON.stringify(created.body).includes('private-'),false);
    assert.equal((await invoke(integrations,'POST','/api/integrations?action=connect',{id:stored.id})).status,200);
    assert.equal(webhookBody.url,`https://calo.test/api/webhook?bot=${stored.id}`);
    assert.equal('allowed_updates' in webhookBody,false);assert.equal(stored.enabled,true);
    const secret=decryptSecret(stored.webhook_ciphertext,master,stored.id);
    const event={event_name:'message.image.received',message:{message_id:'opaque.message',date:Date.now(),from:{id:sender,is_bot:false},
      chat:{id:sender,chat_type:'PRIVATE'},photo_url:'https://photo.zadn.vn/meal.jpg'}};
    const hook=`/api/webhook?bot=${stored.id}`;
    assert.equal((await invoke(webhook,'POST',hook,event,{'x-telegram-bot-api-secret-token':secret})).status,401);
    assert.equal(queued,undefined);
    assert.equal((await invoke(webhook,'POST',hook,event,{'x-bot-api-secret-token':secret})).status,200);
    const captured=(()=>queued as {chat_id:string;update_id:string;bot_id:string}|undefined)();
    assert.ok(captured);assert.equal(captured.chat_id,sender);assert.equal(captured.update_id,'opaque.message');assert.equal(captured.bot_id,stored.id);
    verification=false;
    assert.equal((await invoke(integrations,'POST','/api/integrations?action=connect',{id:stored.id})).status,400);
    assert.equal(stored.enabled,false);
  }finally{globalThis.fetch=realFetch;for(const key of Object.keys(process.env))if(!(key in previous))delete process.env[key];Object.assign(process.env,previous);}
});
