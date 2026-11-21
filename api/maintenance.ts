import type { ServerResponse } from 'node:http';
import { getConfig } from '../src/config.js';
import { database } from '../src/db.js';
import { json, type ApiRequest } from '../src/http.js';
import { maintain } from '../src/retention.js';
import { authorized } from '../src/security.js';
import { logError } from '../src/logging.js';

export default async function handler(req: ApiRequest, res: ServerResponse) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  try {
    const config = getConfig();
    if (!authorized(req.headers.authorization, `Bearer ${config.CRON_SECRET}`)) return json(res, 401, { error: 'Unauthorized' });
    const result = await maintain(database(config));
    return json(res, 'imageErrors' in result && result.imageErrors ? 503 : 200, result);
  } catch(error) { const requestId=logError('maintenance_failed',error); return json(res, 503, { error: 'Maintenance failed; source data retained',code:'MAINTENANCE_ERROR',requestId }); }
}
