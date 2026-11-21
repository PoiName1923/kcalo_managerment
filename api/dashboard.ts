import { gunzipSync } from 'node:zlib';
import { downloadArchive } from '../src/history.js';
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
    if(url.searchParams.has('day')){
      const day=z.iso.date().parse(url.searchParams.get('day'));
      const start=new Date(`${day}T00:00:00+07:00`).toISOString();
      const end=new Date(Date.parse(start)+86400000).toISOString();
      const meals=[];
      for(let offset=0;;offset+=500){
        let query=db.from('meals').select('id,created_at,estimate,bot_id').eq('owner_id',account.id)
          .gte('created_at',start).lt('created_at',end).order('created_at').order('id').range(offset,offset+499);
        if(botId)query=query.eq('bot_id',botId);
        const rows=checked(await query)??[];meals.push(...rows);
        if(rows.length<500)break;
      }
      let archives=db.from('archive_batches').select('*').eq('owner_id',account.id).eq('status','complete')
        .lt('earliest_at',end).gte('latest_at',start);
      if(botId)archives=archives.eq('bot_id',botId);
      for(const batch of checked(await archives)??[]){
        const bytes=await downloadArchive(batch.chat_id,batch,async path=>{
          const blob=checked(await db.storage.from('meal-archives').download(path));
          if(!blob)throw new Error('Không tải được dữ liệu lưu trữ.');
          return Buffer.from(await blob.arrayBuffer());
        });
        const archived=JSON.parse(gunzipSync(bytes).toString('utf8'));
        for(const meal of archived.meals){
          if(meal.owner_id===account.id&&(!botId||meal.bot_id===botId)&&Date.parse(meal.created_at)>=Date.parse(start)&&Date.parse(meal.created_at)<Date.parse(end)){
            meals.push({id:meal.id,created_at:meal.created_at,estimate:meal.estimate,bot_id:meal.bot_id});
          }
        }
      }
      return {day,meals:[...new Map(meals.map(meal=>[meal.id,meal])).values()].sort((a,b)=>a.created_at.localeCompare(b.created_at))};
    }
    const stats=checked(await db.rpc('dashboard_data',{p_owner:account.id,p_days:days,p_bot:botId}));
    let query=db.from('meals').select('id,created_at,estimate,bot_id').eq('owner_id',account.id).order('created_at',{ascending:false}).limit(8);
    if(botId) query=query.eq('bot_id',botId);
    return {stats,bots:bots.map(publicIntegration),recent:checked(await query)??[]};
  });
}
