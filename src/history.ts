import { checksum } from './retention.js';

export async function downloadArchive(chatId: number|string,
  manifest: { chat_id: number|string; status: string; object_path: string; checksum: string },
  download: (path: string) => Promise<Buffer>) {
  if (String(chatId) !== String(manifest.chat_id)) throw new Error('Archive owner mismatch');
  if (manifest.status !== 'complete') throw new Error('Archive not complete');
  const bytes = await download(manifest.object_path);
  if (checksum(bytes) !== manifest.checksum) throw new Error('Archive checksum mismatch');
  return bytes;
}
