import { createClient } from '@supabase/supabase-js';
import type { ServerResponse } from 'node:http';
import { z } from 'zod';
import { getConfig, type Config } from './config.js';
import { checked, database, type Database } from './db.js';
import { json, type ApiRequest } from './http.js';

export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export function cookies(req: ApiRequest): Record<string,string> {
  return Object.fromEntries((req.headers.cookie ?? '').split(';').flatMap(part => {
    const index = part.indexOf('=');
    if (index < 0) return [];
    try { return [[part.slice(0,index).trim(),decodeURIComponent(part.slice(index+1))]]; } catch { return []; }
  }));
}
export function sameOrigin(req: ApiRequest, config: Config) {
  const expected = config.APP_URL ? new URL(config.APP_URL).origin : process.env.NODE_ENV === 'production' ? '' : `http://${req.headers.host}`;
  if (!expected || req.headers.origin !== expected) throw new HttpError(403,'Yêu cầu không cùng nguồn. Hãy tải lại trang.');
}
export function authClient(config: Config) {
  if (!config.SUPABASE_ANON_KEY) throw new HttpError(503,'Chưa cấu hình đăng nhập Supabase.');
  return createClient(config.SUPABASE_URL,config.SUPABASE_ANON_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
}
export function sessionCookies(res: ServerResponse, config: Config, session: {access_token:string;refresh_token:string;expires_in:number} | null) {
  const secure = config.APP_URL?.startsWith('https:') || process.env.NODE_ENV === 'production' ? '; Secure' : '';
  const cookie = (name: string,value:string,age:number) => `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${secure}`;
  res.setHeader('Set-Cookie',[
    cookie('calo_access',session?.access_token ?? '',session ? Math.min(session.expires_in,3600) : 0),
    cookie('calo_refresh',session?.refresh_token ?? '',session ? 7*86400 : 0),
  ]);
}
export interface Account { id:string;email:string;display_name:string;role:'admin'|'member';active:boolean;created_at:string }
export async function requireAccount(req: ApiRequest, db: Database): Promise<Account> {
  const token = cookies(req).calo_access;
  if (!token) throw new HttpError(401,'Vui lòng đăng nhập.');
  const {data,error} = await db.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401,'Phiên đăng nhập đã hết hạn.');
  const account = checked(await db.from('profiles').select('id,email,display_name,role,active,created_at').eq('id',data.user.id).maybeSingle()) as Account | null;
  if (!account?.active) throw new HttpError(403,'Tài khoản chưa được cấp quyền hoặc đã bị tạm khoá.');
  return account;
}
export function adminOnly(account: Account) {
  if (account.role !== 'admin') throw new HttpError(403,'Chỉ quản trị viên được sử dụng chức năng này.');
}
export type WebContext = {config:Config;db:Database;account:Account;url:URL};
export async function webRoute(req: ApiRequest,res: ServerResponse,methods: string[],
  action:(context:WebContext)=>Promise<unknown>) {
  if (!methods.includes(req.method ?? '')) { res.setHeader('Allow',methods.join(', ')); return json(res,405,{error:'Phương thức không được hỗ trợ.'}); }
  try {
    const config=getConfig(),db=database(config),account=await requireAccount(req,db);
    if (req.method!=='GET') sameOrigin(req,config);
    return json(res,200,await action({config,db,account,url:new URL(req.url ?? '/', 'https://local.invalid')}));
  } catch(error) { return webError(res,error); }
}
export function webError(res:ServerResponse,error:unknown) {
  if (error instanceof HttpError) return json(res,error.status,{error:error.message});
  if (error instanceof z.ZodError) return json(res,400,{error:'Thông tin không hợp lệ. Hãy kiểm tra các trường và thử lại.'});
  console.error('web_request_failed');
  return json(res,503,{error:'Không thể hoàn tất yêu cầu. Vui lòng thử lại sau.'});
}
