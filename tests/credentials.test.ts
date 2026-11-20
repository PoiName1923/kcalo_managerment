import assert from 'node:assert/strict';
import test from 'node:test';
import { encryptSecret, decryptSecret, publicIntegration } from '../src/credentials.js';

test('credential encryption is randomized, authenticated and bound to its bot', () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  const encrypted = encryptSecret('private-api-key', key, 'bot-a');
  assert.notEqual(encrypted, encryptSecret('private-api-key', key, 'bot-a'));
  assert.equal(decryptSecret(encrypted, key, 'bot-a'), 'private-api-key');
  assert.throws(() => decryptSecret(encrypted, key, 'bot-b'));
  assert.throws(() => decryptSecret(encrypted.slice(0, -3) + 'bad', key, 'bot-a'));
  assert.throws(() => encryptSecret('secret', 'short', 'bot-a'));
});
test('integration responses never contain encrypted or plaintext secrets', () => {
  const visible = publicIntegration({ id: 'a', name: 'Lunch', owner_id: 'owner', enabled: true,
    bot_username: 'lunch_bot', telegram_user_id: 42, gemini_model: 'test',
    token_ciphertext: 'secret-token', gemini_ciphertext: 'secret-key', webhook_ciphertext: 'secret-webhook',
    created_at: '2026-11-20', connected_at: null });
  assert.equal(visible.has_gemini_key, true);
  assert.equal(JSON.stringify(visible).includes('secret-'), false);
  assert.equal('owner_id' in visible, false);
});
