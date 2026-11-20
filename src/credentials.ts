import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function key(value: string) {
  const bytes = Buffer.from(value, 'base64');
  if (bytes.length !== 32) throw new Error('CREDENTIAL_ENCRYPTION_KEY must contain 32 base64-encoded bytes');
  return bytes;
}
export function encryptSecret(value: string, masterKey: string, botId: string) {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key(masterKey), iv);
  cipher.setAAD(Buffer.from(botId));
  const data = Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  return ['v1',iv.toString('base64'),cipher.getAuthTag().toString('base64'),data.toString('base64')].join('.');
}
export function decryptSecret(value: string, masterKey: string, botId: string) {
  const [version,iv,tag,data] = value.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Invalid encrypted secret');
  const decipher = createDecipheriv('aes-256-gcm',key(masterKey),Buffer.from(iv,'base64'));
  decipher.setAAD(Buffer.from(botId)); decipher.setAuthTag(Buffer.from(tag,'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data,'base64')),decipher.final()]).toString('utf8');
}
export function publicIntegration(row: Record<string, any>) {
  return { id:row.id,name:row.name,provider:row.provider??'telegram',bot_username:row.bot_username,
    allowed_user_id:String(row.allowed_user_id??row.telegram_user_id??''),telegram_user_id:row.telegram_user_id,
    gemini_model:row.gemini_model,enabled:row.enabled,connected_at:row.connected_at,created_at:row.created_at,
    has_bot_token:!!row.token_ciphertext,has_gemini_key:!!row.gemini_ciphertext };
}
