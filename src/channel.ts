import { Telegram } from './telegram.js';
import { Zalo } from './zalo.js';
export type Provider='telegram'|'zalo';
export interface ChatBot{
  sendText(chatId:string|number,text:string,replyTo?:string|number):Promise<void>;
  photo(source:string):Promise<Buffer>;
  sendArchive?(chatId:string|number,data:Buffer,id:string):Promise<void>;
}
export const channelBot=(provider:Provider,token:string)=>provider==='zalo'?new Zalo(token):new Telegram(token);
export const senderId=(bot:Record<string,any>)=>String(bot.allowed_user_id??bot.telegram_user_id??'');
export const webhookHeader=(provider:Provider)=>provider==='zalo'?'x-bot-api-secret-token':'x-telegram-bot-api-secret-token';
