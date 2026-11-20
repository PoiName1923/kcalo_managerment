import { waitUntil } from '@vercel/functions';
import type { ServerResponse } from 'node:http';
import { getConfig } from '../src/config.js';
import { checked, database } from '../src/db.js';
import { json, readBody, type ApiRequest } from '../src/http.js';
import { acceptUpdate, authorized } from '../src/security.js';
import { drainJobs,drainBotJobs } from '../src/worker.js';
import { decryptSecret } from '../src/credentials.js';
import { z } from 'zod';
import { acceptZaloUpdate } from '../src/zalo.js';
import { senderId,webhookHeader } from '../src/channel.js';

export default async function handler(req: ApiRequest, res: ServerResponse) {
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(res, 405, { error: 'Method not allowed' }); }
  try {
    const config = getConfig();
    const botId=new URL(req.url??'/','https://local.invalid').searchParams.get('bot');
    if(botId) {
      if(!z.uuid().safeParse(botId).success) return json(res,404,{error:'Not found'});
      const db=database(config);
      const bot=checked(await db.from('bot_integrations').select('*').eq('id',botId).maybeSingle());
      if(!bot || !config.CREDENTIAL_ENCRYPTION_KEY) return json(res,404,{error:'Not found'});
      const secret=decryptSecret(bot.webhook_ciphertext,config.CREDENTIAL_ENCRYPTION_KEY,botId);
      if(!authorized(req.headers[webhookHeader(bot.provider??'telegram')],secret)) return json(res,401,{error:'Unauthorized'});
      const owner=checked(await db.from('profiles').select('active').eq('id',bot.owner_id).maybeSingle());
      if(!bot.enabled || !owner?.active) return json(res,200,{ok:true});
      let body;
      try { body=await readBody(req); } catch { return json(res,400,{error:'Invalid JSON'}); }
      const update=bot.provider==='zalo' ? acceptZaloUpdate(body,senderId(bot)) : acceptUpdate(body,[senderId(bot)]);
      if(!update) return json(res,200,{ok:true});
      checked(await db.from('bot_jobs').upsert({...update,bot_id:botId},{onConflict:'bot_id,update_id',ignoreDuplicates:true}));
      const job=checked(await db.from('bot_jobs').select('id').eq('bot_id',botId).eq('update_id',update.update_id).single());
      if(!job) throw new Error('Missing queued job');
      waitUntil(drainBotJobs(db,config,job.id).catch(()=>console.error('background_bot_worker_failed')));
      return json(res,200,{ok:true});
    }
    if (!authorized(req.headers['x-telegram-bot-api-secret-token'], config.TELEGRAM_WEBHOOK_SECRET))
      return json(res, 401, { error: 'Unauthorized' });
    let body: unknown;
    try { body = await readBody(req); } catch { return json(res, 400, { error: 'Invalid JSON' }); }
    const update = acceptUpdate(body, config.ALLOWED_TELEGRAM_USER_IDS.split(',').map(s => s.trim()).filter(Boolean));
    if (!update) return json(res, 200, { ok: true });
    const db = database(config);
    checked(await db.from('jobs').upsert(update, { onConflict: 'update_id', ignoreDuplicates: true }));
    waitUntil(drainJobs(db, config, update.update_id).catch(() => { console.error('background_worker_failed'); }));
    return json(res, 200, { ok: true });
  } catch {
    console.error('webhook_failed');
    return json(res, 503, { error: 'Service temporarily unavailable' });
  }
}
