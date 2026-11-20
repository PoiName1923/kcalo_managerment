import { MAX_IMAGE_BYTES } from './images.js';

export class Telegram {
  constructor(private readonly token: string, private readonly request: typeof fetch = fetch) {}

  async call<T>(method: string, body: Record<string, unknown> | FormData): Promise<T> {
    let response: Response;
    try {
      response = await this.request(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: 'POST', signal: AbortSignal.timeout(20_000),
        ...(body instanceof FormData ? { body } : {
          headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        }),
      });
    } catch { throw new Error('Telegram network failure'); }
    if (!response.ok) throw new Error(`Telegram HTTP ${response.status}`);
    const data = await response.json() as { ok: boolean; result: T; error_code?: number };
    if (!data.ok) throw new Error(`Telegram API ${data.error_code ?? 'failure'}`);
    return data.result;
  }

  async sendText(chatId: number|string, text: string, replyTo?: number|string) {
    const characters = Array.from(text);
    for (let offset = 0; offset < characters.length; offset += 3500) {
      await this.call('sendMessage', { chat_id: chatId, text: characters.slice(offset, offset + 3500).join(''),
        ...(replyTo ? { reply_parameters: { message_id: Number(replyTo), allow_sending_without_reply: true } } : {}) });
    }
  }
  async sendArchive(chatId: number|string, data: Buffer, id: string) {
    const form = new FormData();
    form.set('chat_id', String(chatId));
    form.set('document', new Blob([new Uint8Array(data)], { type: 'application/gzip' }), `meals-${id}.json.gz`);
    form.set('caption', 'Lịch sử bữa ăn đã lưu trữ (JSON nén gzip).');
    await this.call('sendDocument', form);
  }
  async photo(fileId: string): Promise<Buffer> {
    const file = await this.call<{ file_path?: string; file_size?: number }>('getFile', { file_id: fileId });
    if (file.file_size && file.file_size > MAX_IMAGE_BYTES) throw new Error('Image too large');
    if (!file.file_path || !/^[a-zA-Z0-9_./-]+$/.test(file.file_path)
      || file.file_path.includes('..') || file.file_path.startsWith('/')) throw new Error('Invalid file path');
    let response: Response;
    try {
      response = await this.request(`https://api.telegram.org/file/bot${this.token}/${file.file_path}`,
        { signal: AbortSignal.timeout(20_000), redirect: 'error' });
    } catch { throw new Error('Telegram image network failure'); }
    if (!response.ok || !response.body) throw new Error('Telegram image download failed');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.length;
        if (size > MAX_IMAGE_BYTES) { await reader.cancel(); throw new Error('Image too large'); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    return Buffer.concat(chunks);
  }
}
