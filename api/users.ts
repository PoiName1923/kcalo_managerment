import type { ServerResponse } from 'node:http';
import { z } from 'zod';
import { checked } from '../src/db.js';
import { type ApiRequest,readBody } from '../src/http.js';
import { webRoute,adminOnly,HttpError } from '../src/web-auth.js';

export default async function handler(req:ApiRequest,res:ServerResponse) {
  return webRoute(req,res,['GET','POST','PATCH'],async({db,account,url})=>{
    adminOnly(account);
    if(req.method==='GET') {
      const page=z.coerce.number().int().min(1).max(10000).parse(url.searchParams.get('page')??1);
      const profiles=await db.from('profiles').select('id,email,display_name,role,active,created_at',{count:'exact'})
        .order('created_at',{ascending:false}).range((page-1)*50,page*50-1);
      const users=checked(profiles)??[];
      const bots=users.length ? checked(await db.from('bot_integrations').select('owner_id,enabled').in('owner_id',users.map(p=>p.id)))??[] : [];
      return {users:users.map(user=>({...user,bot_count:bots.filter(b=>b.owner_id===user.id).length})),total:profiles.count??0,page};
    }
    if(req.method==='POST') {
      const body=z.object({email:z.email().max(254),display_name:z.string().trim().min(1).max(100),password:z.string().min(12).max(128)}).parse(await readBody(req));
      const result=await db.auth.admin.createUser({email:body.email,password:body.password,email_confirm:true,user_metadata:{display_name:body.display_name}});
      if(result.error) throw new HttpError(400,'Không tạo được tài khoản. Kiểm tra email đã tồn tại và chính sách mật khẩu Supabase.');
      checked(await db.from('profiles').update({active:true}).eq('id',result.data.user.id));
      return {ok:true};
    }
    const body=z.object({id:z.uuid(),active:z.boolean(),display_name:z.string().trim().min(1).max(100).optional()}).parse(await readBody(req));
    if(body.id===account.id && !body.active) throw new HttpError(400,'Bạn không thể tự khoá tài khoản đang sử dụng.');
    checked(await db.from('profiles').update({active:body.active,...(body.display_name?{display_name:body.display_name}:{})}).eq('id',body.id));
    return {ok:true};
  });
}
