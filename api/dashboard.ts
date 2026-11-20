import type { ServerResponse } from 'node:http';
import { z } from 'zod';
import { checked } from '../src/db.js';
import { type ApiRequest } from '../src/http.js';
import { publicIntegration } from '../src/credentials.js';
import { webRoute,HttpError } from '../src/web-auth.js';

export default async function handler(req:ApiRequest,res:ServerResponse) {
  return webRoute(req,res,['GET'],async({db,account,url})=>{
    const days=z.coerce.number().int().min(1).max(90).parse(url.searchParams.get('days')??30);
    const botId=url.searchParams.get('bot') ? z.uuid().parse(url.searchParams.get('bot')) : null;
    const bots=checked(await db.from('bot_integrations').select('*').eq('owner_id',account.id).order('created_at',{ascending:false}))??[];
    if(botId && !bots.some(b=>b.id===botId)) throw new HttpError(404,'Không tìm thấy bot.');
    const stats=checked(await db.rpc('dashboard_data',{p_owner:account.id,p_days:days,p_bot:botId}));
    let query=db.from('meals').select('id,created_at,estimate,bot_id').eq('owner_id',account.id).order('created_at',{ascending:false}).limit(8);
    if(botId) query=query.eq('bot_id',botId);
    return {stats,bots:bots.map(publicIntegration),recent:checked(await query)??[]};
  });
}
