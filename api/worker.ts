import type { ServerResponse } from 'node:http';
import { getConfig } from '../src/config.js';
import { database } from '../src/db.js';
import { json, type ApiRequest } from '../src/http.js';
import { authorized } from '../src/security.js';
import { drainJobs } from '../src/worker.js';

export default async function handler(req: ApiRequest, res: ServerResponse) {
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' });
  try {
    const config = getConfig();
    if (!authorized(req.headers.authorization, `Bearer ${config.CRON_SECRET}`)) return json(res, 401, { error: 'Unauthorized' });
    return json(res, 200, await drainJobs(database(config), config));
  } catch { console.error('worker_failed'); return json(res, 503, { error: 'Worker failed' }); }
}
