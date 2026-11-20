import type { Config } from './config.js';
import { checked, type Database } from './db.js';
import { analyze } from './gemini.js';
import { formatEstimate, parseEstimate } from './estimate.js';
import { downloadArchive } from './history.js';
import { prepareImages } from './images.js';
import { Telegram } from './telegram.js';
import { decryptSecret } from './credentials.js';
import { channelBot,type ChatBot } from './channel.js';

interface Job {
  id?:string; bot_id?:string;
  update_id: number|string; chat_id: number|string; message_id: number|string; attempts: number; lease_token: string; notification_pending: boolean;
  payload: { file_id?: string; caption?: string; text?: string };
}
const help = `Gửi ảnh món ăn để ước tính khối lượng, kcal, protein, carb và chất béo.
Thêm chú thích như “150 g cơm, ít dầu” để tăng độ chính xác.

/today — tổng dinh dưỡng hôm nay (giờ Việt Nam)
/history — 5 bữa gần đây và các gói archive gần đây
/archive <id> — tải dữ liệu cũ dạng JSON.gz
/help — hướng dẫn

Mỗi ảnh trong album được tính riêng. Ảnh nén được giữ 30 ngày; dữ liệu chi tiết sau 30 ngày chuyển sang archive. Kết quả là ước tính từ ảnh.`;
const dateLabel = (date: string) => new Date(date).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh' });

async function command(job: Job, db: Database, bot: ChatBot) {
  const scope = (query:any) => job.bot_id ? query.eq('bot_id',job.bot_id) : query.is('bot_id',null);
  const [raw, arg] = (job.payload.text ?? '').trim().split(/\s+/);
  const name = raw?.split('@')[0];
  if (name === '/today') {
    const localDate = new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
    const start = new Date(`${localDate}T00:00:00+07:00`);
    const end = new Date(start.getTime() + 86400_000);
    const rows = (checked(await scope(db.from('meals').select('estimate').eq('chat_id', job.chat_id))
      .gte('created_at', start.toISOString()).lt('created_at', end.toISOString()).limit(1000)) ?? []) as {estimate:unknown}[];
    const totals = rows.reduce((sum, row) => {
      const t = parseEstimate(row.estimate).totals;
      return { kcal: sum.kcal + t.kcal, p: sum.p + t.protein_g, c: sum.c + t.carbs_g, f: sum.f + t.fat_g };
    }, { kcal: 0, p: 0, c: 0, f: 0 });
    await bot.sendText(job.chat_id, `Hôm nay: ${rows.length} bữa · ~${Math.round(totals.kcal)} kcal\nProtein: ${totals.p.toFixed(1)} g · Carb: ${totals.c.toFixed(1)} g · Chất béo: ${totals.f.toFixed(1)} g`);
  } else if (name === '/history') {
    const meals = (checked(await scope(db.from('meals').select('created_at,estimate').eq('chat_id', job.chat_id))
      .order('created_at', { ascending: false }).limit(5)) ?? []) as {created_at:string;estimate:unknown}[];
    const archives = (checked(await scope(db.from('archive_batches').select('id,row_count,earliest_at,latest_at')
      .eq('chat_id', job.chat_id)).eq('status', 'complete').order('created_at', { ascending: false }).limit(5)) ?? []) as {id:string;row_count:number;earliest_at:string;latest_at:string}[];
    await bot.sendText(job.chat_id, [
      'Bữa ăn gần đây:', ...meals.map(m => `${dateLabel(m.created_at)} · ~${parseEstimate(m.estimate).totals.kcal} kcal`),
      ...(!meals.length ? ['Chưa có bữa ăn trong 30 ngày gần đây.'] : []), '',
      'Archive gần đây:', ...archives.map(a => `${a.row_count} bữa · ${dateLabel(a.earliest_at)} → ${dateLabel(a.latest_at)}\n/archive ${a.id}`),
      ...(!archives.length ? ['Chưa có dữ liệu archive.'] : []),
    ].join('\n'));
  } else if (name === '/archive') {
    if (!arg || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(arg)) {
      await bot.sendText(job.chat_id, 'Dùng /history để tìm ID, sau đó gửi /archive <id>.'); return;
    }
    const manifest = checked<any>(await scope(db.from('archive_batches').select('*').eq('id', arg)
      .eq('chat_id', job.chat_id)).eq('status', 'complete').maybeSingle());
    if (!manifest) { await bot.sendText(job.chat_id, 'Không tìm thấy archive trong tài khoản của bạn.'); return; }
    const bytes = await downloadArchive(job.chat_id, manifest, async path => {
      const blob = checked(await db.storage.from('meal-archives').download(path));
      if (!blob) throw new Error('Missing archive');
      return Buffer.from(await blob.arrayBuffer());
    });
    if(bot.sendArchive)await bot.sendArchive(job.chat_id, bytes, arg);
    else {
      const link=checked(await db.storage.from('meal-archives').createSignedUrl(manifest.object_path,300,{download:`meals-${arg}.json.gz`}));
      if(!link?.signedUrl)throw new Error('Missing archive link');
      await bot.sendText(job.chat_id,`Tải archive JSON.gz của bạn (liên kết hết hạn sau 5 phút):\n${link.signedUrl}`);
    }
  } else { await bot.sendText(job.chat_id, help); }
}

async function processJob(job: Job, db: Database, config: Config, bot: ChatBot) {
  if (job.notification_pending) {
    await bot.sendText(job.chat_id, 'Mình chưa xử lý được ảnh hoặc yêu cầu này. Bạn thử gửi lại ảnh rõ hơn hoặc thử lại sau nhé.', job.message_id);
    return;
  }
  if (!job.payload.file_id) { await command(job, db, bot); return; }
  const lookup=db.from('meals').select('estimate');
  const existing = checked(await (job.id ? lookup.eq('source_job_id',job.id) : lookup.eq('update_id',job.update_id)).maybeSingle());
  if (existing) { await bot.sendText(job.chat_id, formatEstimate(parseEstimate(existing.estimate)), job.message_id); return; }
  const images = await prepareImages(await bot.photo(job.payload.file_id));
  let estimate;
  try {
    estimate = await analyze(images.analysis, job.payload.caption ?? '', { apiKey: config.GEMINI_API_KEY, model: config.GEMINI_MODEL });
    if(job.id) checked(await db.rpc('record_gemini_usage',{p_job_id:job.id,p_attempt:job.attempts,p_success:true,p_tokens:estimate.usage_tokens}));
  } catch(error) {
    if(job.id) checked(await db.rpc('record_gemini_usage',{p_job_id:job.id,p_attempt:job.attempts,p_success:false,p_tokens:0}));
    throw error;
  }
  let path: string | null = null;
  if (estimate.is_food) {
    path = `${job.bot_id ? job.bot_id+'/' : ''}${job.chat_id}/${job.update_id}.webp`;
    // Register before upload so a crash cannot leave an untracked image forever.
    checked(await db.from('image_assets').upsert({ object_path: path }, { onConflict: 'object_path', ignoreDuplicates: true }));
    checked(await db.storage.from('meal-images').upload(path, images.thumbnail, { contentType: 'image/webp', upsert: true }));
    checked(await db.rpc(job.id ? 'save_bot_meal' : 'save_meal', { ...(job.id ? {p_job_id:job.id} : {p_update_id:job.update_id}), p_token: job.lease_token,
      p_estimate: estimate, p_model: config.GEMINI_MODEL, p_image_path: path }));
  }
  await bot.sendText(job.chat_id, formatEstimate(estimate), job.message_id);
}

async function drainLegacyJobs(db: Database, config: Config, updateId?: number) {
  const bot = new Telegram(config.TELEGRAM_BOT_TOKEN);
  let processed = 0;
  for (let i = 0; i < (updateId === undefined ? 2 : 1); i++) {
    const jobs = checked(await db.rpc('claim_jobs', { p_limit: 1, p_update_id: updateId ?? null })) as Job[];
    const job = jobs[0];
    if (!job) break;
    try {
      await processJob(job, db, config, bot);
      checked(await db.rpc('finish_job', { p_update_id: job.update_id, p_token: job.lease_token, p_success: true }));
      processed++;
    } catch {
      checked(await db.rpc('finish_job', { p_update_id: job.update_id, p_token: job.lease_token, p_success: false }));
      console.error('job_failed', { update_id: job.update_id, attempt: job.attempts });
    }
  }
  return { processed };
}

export async function drainBotJobs(db:Database,config:Config,jobId?:string) {
  let processed=0;
  for(let i=0;i<(jobId ? 1 : 2);i++) {
    const jobs=checked(await db.rpc('claim_bot_jobs',{p_limit:1,p_job_id:jobId??null})) as Job[];
    const job=jobs[0]; if(!job) break;
    try {
      const integration=checked(await db.from('bot_integrations').select('*').eq('id',job.bot_id!).single());
      const account=checked(await db.from('profiles').select('active').eq('id',integration.owner_id).single());
      if(!account?.active || !integration.enabled) throw new Error('Inactive integration');
      const master=config.CREDENTIAL_ENCRYPTION_KEY??'';
      const runtime={...config,TELEGRAM_BOT_TOKEN:decryptSecret(integration.token_ciphertext,master,integration.id),
        GEMINI_API_KEY:decryptSecret(integration.gemini_ciphertext,master,integration.id),GEMINI_MODEL:integration.gemini_model};
      await processJob(job,db,runtime,channelBot(integration.provider??'telegram',runtime.TELEGRAM_BOT_TOKEN));
      checked(await db.rpc('finish_bot_job',{p_job_id:job.id,p_token:job.lease_token,p_success:true}));
      processed++;
    } catch {
      checked(await db.rpc('finish_bot_job',{p_job_id:job.id,p_token:job.lease_token,p_success:false}));
      console.error('bot_job_failed',{job_id:job.id,attempt:job.attempts});
    }
  }
  return {processed};
}
export async function drainJobs(db:Database,config:Config,updateId?:number) {
  const legacy=config.TELEGRAM_BOT_TOKEN ? await drainLegacyJobs(db,config,updateId) : {processed:0};
  const tenant=config.CREDENTIAL_ENCRYPTION_KEY && updateId===undefined ? await drainBotJobs(db,config) : {processed:0};
  return {processed:legacy.processed+tenant.processed};
}
