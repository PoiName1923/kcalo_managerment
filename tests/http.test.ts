import assert from 'node:assert/strict';
import test from 'node:test';
import type { ServerResponse } from 'node:http';
import webhook from '../api/webhook.js';
import worker from '../api/worker.js';
import maintenance from '../api/maintenance.js';
import health from '../api/health.js';
import { readBody, type ApiRequest } from '../src/http.js';

test('HTTP endpoints enforce methods and secrets before external work', async () => {
  const previous = { ...process.env };
  Object.assign(process.env, {
    TELEGRAM_BOT_TOKEN: 'test-token-long', TELEGRAM_WEBHOOK_SECRET: 'a'.repeat(32),
    GEMINI_API_KEY: 'test-api-key', GEMINI_MODEL: 'test-model', CRON_SECRET: 'b'.repeat(32),
    SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
  });
  async function invoke(handler: typeof webhook | typeof health, method: string, headers = {}, body?: unknown) {
    let output = '';
    const response = { statusCode: 200, setHeader() {}, end(value: string) { output = value; } };
    await handler({ method, headers, body } as ApiRequest, response as unknown as ServerResponse);
    return { status: response.statusCode, body: JSON.parse(output) };
  }
  try {
    assert.equal((await invoke(webhook, 'GET')).status, 405);
    assert.equal((await invoke(webhook, 'POST', {}, {})).status, 401);
    assert.equal((await invoke(worker, 'POST', {}, {})).status, 401);
    assert.equal((await invoke(maintenance, 'GET', {}, {})).status, 401);
    const headers = { 'x-telegram-bot-api-secret-token': 'a'.repeat(32) };
    assert.equal((await invoke(webhook, 'POST', headers, 'broken JSON')).status, 400);
    assert.equal((await invoke(webhook, 'POST', headers, { update_id: 10 })).status, 200);
    assert.equal((await invoke(health, 'GET')).body.status, 'ok');
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in previous)) delete process.env[key];
    Object.assign(process.env, previous);
  }
});
test('unparsed HTTP request bodies have a bounded size', async () => {
  const request = { async *[Symbol.asyncIterator]() { yield Buffer.alloc(128 * 1024 + 1); } };
  await assert.rejects(readBody(request as ApiRequest), /large/i);
});
