import type { ServerResponse } from 'node:http';
import { randomUUID,randomBytes } from 'node:crypto';
import { z } from 'zod';
import { checked } from '../src/db.js';
import { type ApiRequest,readBody } from '../src/http.js';
import { decryptSecret,encryptSecret,publicIntegration } from '../src/credentials.js';
import { channelBot } from '../src/channel.js';
import { HttpError,webRoute } from '../src/web-auth.js';

const inputSchema=z.object({
  id:z.uuid().optional(),name:z.string().trim().min(1).max(80),
  provider:z.enum(['telegram','zalo']).default('telegram'),
  allowed_user_id:z.string().trim().max(128).optional(),
  telegram_user_id:z.union([z.string(),z.number().int().positive().safe()]).optional(),
  bot_token:z.string().trim().max(256).default(''),gemini_key:z.string().trim().max(256).default(''),
  gemini_model:z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9._-]+$/),
});
export default async function handler(req:ApiRequest,res:ServerResponse) {
  return webRoute(req,res,['GET','POST','PATCH'],async({db,config,account,url})=>{
    if(req.method==='GET') {
      const rows=checked(await db.from('bot_integrations').select('*').eq('owner_id',account.id).order('created_at',{ascending:false}))??[];
      return {bots:rows.map(publicIntegration)};
    }
    const master=config.CREDENTIAL_ENCRYPTION_KEY;
    if(!master) throw new HttpError(503,'Server chưa cấu hình khoá mã hoá.');
    const body=await readBody(req), action=url.searchParams.get('action')??'save';
    if(action==='connect' || action==='disable' || action==='test') {
      const {id}=z.object({id:z.uuid()}).parse(body);
      const bot=checked(await db.from('bot_integrations').select('*').eq('id',id).eq('owner_id',account.id).maybeSingle());
      if(!bot) throw new HttpError(404,'Không tìm thấy bot.');
      const provider=bot.provider??'telegram';
      const messenger=channelBot(provider,decryptSecret(bot.token_ciphertext,master,id));
      if(action==='disable') {
        // Disable in the database first, so an external API outage cannot keep accepting new work.
        checked(await db.from('bot_integrations').update({enabled:false}).eq('id',id).eq('owner_id',account.id));
        return {bot:publicIntegration({...bot,enabled:false})};
      }
      if(action==='test') {
        await messenger.call('getMe',{});
        const response=await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${bot.gemini_model}:generateContent`,{
          method:'POST',
          body:JSON.stringify({contents:[{role:'user',parts:[{text:'Reply with OK.'}]}],generationConfig:{maxOutputTokens:64}}),
          headers:{'Content-Type':'application/json','x-goog-api-key':decryptSecret(bot.gemini_ciphertext,master,id)},signal:AbortSignal.timeout(30000),
        });
        if(!response.ok) {
          const reason=response.status===429?'Gemini hết quota hoặc đang giới hạn tốc độ.':response.status===404?'Không tìm thấy Gemini model đã chọn.':response.status===401||response.status===403?'Gemini API key không hợp lệ hoặc không có quyền dùng model.':`Gemini ping thất bại (HTTP ${response.status}).`;
          throw new HttpError(400,reason);
        }
        const ping=await response.json() as {candidates?:{content?:{parts?:{text?:string;thought?:boolean}[]}}[]};
        if(!ping.candidates?.some(c=>c.content?.parts?.some(p=>!p.thought&&p.text?.trim()))) throw new HttpError(400,'Gemini không trả về nội dung khi ping. Hãy kiểm tra model rồi thử lại.');
        if(!response.ok) throw new HttpError(400,'Gemini key hoặc model chưa dùng được. Kiểm tra quyền và tên model.');
        return {ok:true,message:`${provider==='zalo'?'Zalo Bot':'Telegram'} và Gemini đã xác thực. Phân tích ảnh thực tế vẫn phụ thuộc quota và khả năng của model.`};
      }
      if(!config.APP_URL || !config.APP_URL.startsWith('https://')) throw new HttpError(503,'Chưa cấu hình APP_URL HTTPS production.');
      const hook=new URL('/api/webhook',config.APP_URL); hook.searchParams.set('bot',id);
      const result=await messenger.call<{verification?:{ok:boolean}}>('setWebhook',{
        url:hook.href,secret_token:decryptSecret(bot.webhook_ciphertext,master,id),
        ...(provider==='telegram'?{allowed_updates:['message'],drop_pending_updates:false}:{}),
      });
      if(provider==='zalo' && result?.verification?.ok===false){
        checked(await db.from('bot_integrations').update({enabled:false}).eq('id',id).eq('owner_id',account.id));
        throw new HttpError(400,'Zalo đã lưu webhook nhưng không truy cập được. Kiểm tra URL production và Vercel Deployment Protection, rồi kết nối lại.');
      }
      const connected_at=new Date().toISOString();
      checked(await db.from('bot_integrations').update({enabled:true,connected_at}).eq('id',id).eq('owner_id',account.id));
      return {bot:publicIntegration({...bot,enabled:true,connected_at})};
    }
    const input=inputSchema.parse(body), id=input.id??randomUUID();
    const existing=input.id ? checked(await db.from('bot_integrations').select('*').eq('id',id).eq('owner_id',account.id).maybeSingle()) : null;
    if(input.id && !existing) throw new HttpError(404,'Không tìm thấy bot.');
    if(existing && (existing.provider??'telegram')!==input.provider)throw new HttpError(400,'Không đổi kênh của bot đã lưu. Hãy thêm cấu hình mới.');
    const allowed=(input.allowed_user_id??String(input.telegram_user_id??'')).trim();
    if(!/^[A-Za-z0-9._-]{1,128}$/.test(allowed))throw new HttpError(400,'User ID người gửi không hợp lệ.');
    if(input.provider==='telegram' && (!/^\d+$/.test(allowed)||!Number.isSafeInteger(Number(allowed))||Number(allowed)<=0))
      throw new HttpError(400,'Telegram User ID phải là số nguyên dương hợp lệ.');
    if(!existing && (!input.bot_token || !input.gemini_key)) throw new HttpError(400,'Bot mới cần Bot Token và Gemini API key.');
    if(input.bot_token && !(input.provider==='telegram'?/^\d{5,}:[A-Za-z0-9_-]{20,}$/:/^[A-Za-z0-9:_-]{10,256}$/).test(input.bot_token))
      throw new HttpError(400,'Bot Token không đúng định dạng của kênh đã chọn.');
    let identity:{id:string;name:string}|null=null;
    if(input.bot_token){
      const response=await channelBot(input.provider,input.bot_token).call<unknown>('getMe',{});
      if(input.provider==='zalo'){
        const value=z.object({id:z.string().min(1).max(128),account_name:z.string().min(1).max(256)}).parse(response);
        identity={id:value.id,name:value.account_name};
      }else{
        const value=z.object({id:z.number().int().positive().safe(),username:z.string().min(1).max(256),is_bot:z.literal(true)}).parse(response);
        identity={id:String(value.id),name:value.username};
      }
    }
    if(existing && identity && identity.id!==String(existing.external_bot_id??existing.telegram_bot_id)) throw new HttpError(400,'Token thuộc bot khác. Hãy thêm một cấu hình bot mới.');
    const externalId=identity?.id??String(existing!.external_bot_id??existing!.telegram_bot_id);
    const row={id,owner_id:account.id,name:input.name,provider:input.provider,allowed_user_id:allowed,external_bot_id:externalId,
      telegram_user_id:input.provider==='telegram'?Number(allowed):null,gemini_model:input.gemini_model,
      telegram_bot_id:input.provider==='telegram'?Number(externalId):null,bot_username:identity?.name??existing!.bot_username,
      token_ciphertext:input.bot_token?encryptSecret(input.bot_token,master,id):existing!.token_ciphertext,
      gemini_ciphertext:input.gemini_key?encryptSecret(input.gemini_key,master,id):existing!.gemini_ciphertext,
      webhook_ciphertext:existing?.webhook_ciphertext??encryptSecret(randomBytes(32).toString('hex'),master,id),
    };
    const saved=existing ? await db.from('bot_integrations').update(row).eq('id',id).eq('owner_id',account.id).select('*').single()
      : await db.from('bot_integrations').insert(row).select('*').single();
    if(saved.error?.code==='23505') throw new HttpError(409,'Bot này đã được kết nối với một tài khoản.');
    return {bot:publicIntegration(checked(saved))};
  });
}
