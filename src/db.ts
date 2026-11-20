import { createClient } from '@supabase/supabase-js';
import type { Config } from './config.js';

export function database(config: Config) {
  return createClient(config.SUPABASE_URL, config.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false },
      global: { fetch: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(20_000) }) } });
}
export type Database = ReturnType<typeof database>;
export function checked<T>({ data, error }: { data: T; error: unknown }): T {
  if (error) throw new Error('Supabase operation failed');
  return data;
}
