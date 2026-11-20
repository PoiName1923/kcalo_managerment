import { z } from 'zod';

const schema = z.object({
  TELEGRAM_BOT_TOKEN: z.string().default(''),
  TELEGRAM_WEBHOOK_SECRET: z.string().default(''),
  GEMINI_API_KEY: z.string().default(''), GEMINI_MODEL: z.string().regex(/^[a-zA-Z0-9._-]+$/).default('gemini-3.5-flash-lite'),
  SUPABASE_URL: z.url().startsWith('https://'), SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  CRON_SECRET: z.string().min(32), ALLOWED_TELEGRAM_USER_IDS: z.string().default(''),
  SUPABASE_ANON_KEY: z.string().optional(), APP_URL: z.url().optional(),
  CREDENTIAL_ENCRYPTION_KEY: z.string().optional(),
  LOGIN_PROXY_SECRET: z.string().min(32).regex(/^[A-Za-z0-9_-]+$/).optional(),
});
export function getConfig() { return schema.parse(process.env); }
export type Config = ReturnType<typeof getConfig>;
