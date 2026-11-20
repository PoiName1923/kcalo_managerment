import assert from 'node:assert/strict';
import test from 'node:test';
import { Telegram } from '../src/telegram.js';
import { downloadArchive } from '../src/history.js';
import { gzipSync } from 'node:zlib';
import { checksum } from '../src/retention.js';

test('photo download enforces file and streamed byte limits', async () => {
  const tooLarge = new Telegram('test', async () => new Response(JSON.stringify({
    ok: true, result: { file_path: 'photos/a.jpg', file_size: 20_000_000 },
  })));
  await assert.rejects(tooLarge.photo('id'), /large/i);
  const badPath = new Telegram('test', async () => new Response(JSON.stringify({
    ok: true, result: { file_path: '../token', file_size: 50 },
  })));
  await assert.rejects(badPath.photo('id'), /path/i);
  const streaming = new Telegram('test', async url => String(url).includes('/getFile')
    ? new Response(JSON.stringify({ ok: true, result: { file_path: 'photos/a.jpg' } }))
    : new Response(new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(10 * 1024 * 1024 + 1)); controller.close();
    } })));
  await assert.rejects(streaming.photo('id'), /large/i);
});
test('Telegram failures expose only sanitized status, never token or upstream response', async () => {
  const bot = new Telegram('secret-token', async () => new Response('secret-token', { status: 502 }));
  await assert.rejects(bot.sendText(42, 'hello'), error =>
    error instanceof Error && !error.message.includes('secret-token') && error.message.includes('502'));
});
test('archive retrieval checks owner and checksum before sending any content', async () => {
  const bytes = gzipSync('{"meals":[]}');
  const manifest = { chat_id: 42, status: 'complete', object_path: '42/a.json.gz', checksum: checksum(bytes) };
  assert.deepEqual(await downloadArchive(42, manifest, async () => bytes), bytes);
  await assert.rejects(downloadArchive(43, manifest, async () => bytes), /owner/i);
  await assert.rejects(downloadArchive(42, { ...manifest, status: 'pending' }, async () => bytes));
  await assert.rejects(downloadArchive(42, manifest, async () => Buffer.from('corrupt')), /checksum/i);
});
