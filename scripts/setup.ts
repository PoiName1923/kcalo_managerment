import { getConfig } from '../src/config.js';
import { Telegram } from '../src/telegram.js';

async function main() {
  const config = getConfig();
  const url = new URL(process.env.APP_URL ?? '');
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/')
    throw new Error('APP_URL must be a production HTTPS origin');
  const bot = new Telegram(config.TELEGRAM_BOT_TOKEN);
  await bot.call('setMyCommands', { commands: [
    { command: 'start', description: 'Bắt đầu ước tính calo từ ảnh' },
    { command: 'today', description: 'Tổng dinh dưỡng hôm nay' },
    { command: 'history', description: 'Xem lịch sử và archive' },
    { command: 'archive', description: 'Tải archive theo ID' },
    { command: 'help', description: 'Hướng dẫn sử dụng' },
  ] });
  await bot.call('setWebhook', { url: new URL('/api/webhook', url).href,
    secret_token: config.TELEGRAM_WEBHOOK_SECRET, allowed_updates: ['message'],
    max_connections: 10, drop_pending_updates: false });
  const info = await bot.call<{ url: string; pending_update_count: number; last_error_date?: number }>('getWebhookInfo', {});
  console.log('Webhook configured:', { url: info.url, pendingUpdates: info.pending_update_count, lastErrorDate: info.last_error_date });
}
main().catch(() => { console.error('Telegram setup failed. Check .env, production deployment, and bot credentials.'); process.exitCode = 1; });
