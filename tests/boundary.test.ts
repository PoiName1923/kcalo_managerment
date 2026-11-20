import assert from 'node:assert/strict';
import test from 'node:test';
import { acceptUpdate, authorized } from '../src/security.js';
import { analyze } from '../src/gemini.js';

test('requires an exact webhook secret', () => {
  assert.equal(authorized(undefined, 'secret'), false);
  assert.equal(authorized('secret-extra', 'secret'), false);
  assert.equal(authorized('secret', 'secret'), true);
});
test('accepts only fresh private messages from allowed users and selects largest photo', () => {
  const message = { message_id: 5, date: Math.floor(Date.now()/1000),
    chat: { id: 42, type: 'private' }, from: { id: 42 },
    photo: [{ file_id: 'small', width: 100, height: 100 }, { file_id: 'large', width: 1000, height: 800 }] };
  const update = { update_id: 10, message };
  assert.equal(acceptUpdate(update, ['42'])?.payload.file_id, 'large');
  assert.equal(acceptUpdate(update, ['99']), null);
  assert.equal(acceptUpdate({ ...update, message: { ...message, chat: { id: -1, type: 'group' } } }, []), null);
  assert.equal(acceptUpdate({ ...update, message: { ...message, date: 100 } }, []), null);
  assert.equal(acceptUpdate({ update_id: 'oops' }, []), null);
});
test('Gemini blocked, malformed and invalid nutrition responses fail without a fabricated meal', async () => {
  const config = { apiKey: 'test', model: 'test-model' };
  for (const text of ['not json', '{"is_food":true,"items":[]}']) {
    await assert.rejects(analyze(Buffer.from('image'), '', config, async () => new Response(JSON.stringify({
      candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }],
    }), { status: 200 })));
  }
  await assert.rejects(analyze(Buffer.from('image'), '', config, async () =>
    new Response(JSON.stringify({ candidates: [{ finishReason: 'SAFETY' }] }), { status: 200 })));
});
