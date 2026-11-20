import { z } from 'zod';
import { downloadPublicImage } from './public-image.js';

const opaqueId=z.string().min(1).max(128).regex(/^[A-Za-z0-9._-]+$/);
const schema=z.object({event_name:z.enum(['message.text.received','message.image.received']),message:z.object({
  message_id:opaqueId,date:z.number().int().safe(),from:z.object({id:opaqueId,is_bot:z.boolean().optional()}),
  chat:z.object({id:opaqueId,chat_type:z.literal('PRIVATE')}),text:z.string().max(4096).optional(),
  photo_url:z.url().max(4096).optional(),caption:z.string().max(2000).optional(),
})});
export function acceptZaloUpdate(input:unknown,allowedUserId:string){
  const parsed=schema.safeParse(input);if(!parsed.success)return null;
  const {message:m,event_name}=parsed.data,age=Date.now()-m.date;
  if(m.from.is_bot||m.from.id!==allowedUserId||m.chat.id!==m.from.id||age>30*86400000||age< -300000)return null;
  if(event_name==='message.image.received'&&(!m.photo_url||!m.photo_url.startsWith('https://')))return null;
  if(event_name==='message.text.received'&&!m.text)return null;
  return {update_id:m.message_id,chat_id:m.chat.id,message_id:m.message_id,payload:{
    ...(event_name==='message.image.received'?{file_id:m.photo_url}:{}),text:m.text??'',caption:m.caption??'',
  }};
}
export class Zalo{
  constructor(private readonly token:string,private readonly fetcher:typeof fetch=fetch,private readonly download=downloadPublicImage){}
  async call<T>(method:string,body:Record<string,unknown>):Promise<T>{
    let response:Response;
    try{response=await this.fetcher(`https://bot-api.zaloplatforms.com/bot${this.token}/${method}`,{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(20000),redirect:'error',
    });}catch{throw new Error('Zalo network failure');}
    if(!response.ok)throw new Error(`Zalo HTTP ${response.status}`);
    const data=await response.json() as {ok:boolean;result:T;error_code?:number};
    if(!data.ok)throw new Error(`Zalo API ${data.error_code??'failure'}`);
    return data.result;
  }
  async sendText(chatId:string|number,text:string,_replyTo?:string|number){
    let chunk='';
    for(const char of text){if(chunk.length+char.length>2000){await this.call('sendMessage',{chat_id:String(chatId),text:chunk});chunk='';}chunk+=char;}
    if(chunk)await this.call('sendMessage',{chat_id:String(chatId),text:chunk});
  }
  async photo(url:string){return this.download(url);}
}
