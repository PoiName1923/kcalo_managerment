import type { ServerResponse } from 'node:http';
import { z } from 'zod';
import { getConfig } from '../src/config.js';
import { database,checked } from '../src/db.js';
import { json,readBody,type ApiRequest } from '../src/http.js';
import { authClient,cookies,HttpError,requireAccount,sameOrigin,sessionCookies,webError } from '../src/web-auth.js';
import {requireLoginProxy} from '../src/login-proxy.js';

export default async function handler(req:ApiRequest,res:ServerResponse) {
  try {
    const config=getConfig(), db=database(config), action=new URL(req.url ?? '/', 'https://local.invalid').searchParams.get('action') ?? 'me';
    if(req.method==='GET' && action==='me') return json(res,200,{account:await requireAccount(req,db)});
    if(req.method!=='POST') return json(res,405,{error:'Phương thức không được hỗ trợ.'});
    sameOrigin(req,config);
    if(action==='login')requireLoginProxy(req,config.LOGIN_PROXY_SECRET);
    if(action==='logout') {
      const token=cookies(req).calo_access;
      if(token) await db.auth.admin.signOut(token,'local').catch(()=>undefined);
      sessionCookies(res,config,null); return json(res,200,{ok:true});
    }
    if(action==='password') {
      const account=await requireAccount(req,db);
      const body=z.object({password:z.string().min(12).max(128)}).parse(await readBody(req));
      const updated=await db.auth.admin.updateUserById(account.id,{password:body.password});
      if(updated.error) throw new HttpError(400,'Không đổi được mật khẩu. Kiểm tra chính sách mật khẩu Supabase.');
      return json(res,200,{ok:true});
    }
    const auth=authClient(config);
    let session;
    if(action==='login') {
      const body=z.object({email:z.email().max(254),password:z.string().min(1).max(128)}).parse(await readBody(req));
      const result=await auth.auth.signInWithPassword(body);
      if(result.error || !result.data.session) throw new HttpError(401,'Email hoặc mật khẩu không đúng.');
      session=result.data.session;
    } else if(action==='refresh') {
      const token=cookies(req).calo_refresh;
      if(!token) throw new HttpError(401,'Vui lòng đăng nhập lại.');
      const result=await auth.auth.refreshSession({refresh_token:token});
      if(result.error || !result.data.session) { sessionCookies(res,config,null); throw new HttpError(401,'Phiên đăng nhập đã hết hạn.'); }
      session=result.data.session;
    } else throw new HttpError(400,'Thao tác không hợp lệ.');
    const account=checked(await db.from('profiles').select('id,email,display_name,role,active,created_at').eq('id',session.user.id).maybeSingle());
    if(!account?.active) { await auth.auth.signOut(); throw new HttpError(403,'Tài khoản chưa được cấp quyền hoặc đã bị tạm khoá.'); }
    sessionCookies(res,config,session);
    return json(res,200,{account});
  } catch(error) { return webError(res,error); }
}
