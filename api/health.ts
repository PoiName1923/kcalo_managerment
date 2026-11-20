import type { ServerResponse } from 'node:http';
import { json, type ApiRequest } from '../src/http.js';

export default function handler(req: ApiRequest, res: ServerResponse) {
  if (req.method !== 'GET') return json(res, 405, { error: 'Method not allowed' });
  return json(res, 200, { service: 'calo-ingest', status: 'ok' });
}
