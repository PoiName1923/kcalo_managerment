import { createHash, randomUUID } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { checked, type Database } from './db.js';

export interface ArchiveInput {
  batch: { id: string; object_path: string; chat_id: number|string; row_count: number };
  meals: unknown[];
}
interface ArchiveStore {
  upload(path: string, data: Buffer): Promise<void>;
  download(path: string): Promise<Buffer>;
  finalize(id: string, hash: string, bytes: number): Promise<void>;
}
export const checksum = (data: Buffer) => createHash('sha256').update(data).digest('hex');

export async function archiveBatch(input: ArchiveInput, store: ArchiveStore) {
  if (input.meals.length !== input.batch.row_count || !input.meals.length) throw new Error('Archive row count mismatch');
  const data = gzipSync(JSON.stringify({ schema_version: 1, batch_id: input.batch.id, meals: input.meals }), { level: 9 });
  const hash = checksum(data);
  await store.upload(input.batch.object_path, data);
  const stored = await store.download(input.batch.object_path);
  if (checksum(stored) !== hash) throw new Error('Archive read-back verification failed');
  await store.finalize(input.batch.id, hash, data.length);
  return { checksum: hash, bytes: data.length };
}

export async function maintain(db: Database) {
  const owner = randomUUID();
  if (!checked(await db.rpc('acquire_maintenance_lock', { p_owner: owner }))) return { skipped: true };
  let deletedImages = 0, archivedBatches = 0, imageErrors = 0;
  const deadline = Date.now() + 200_000;
  try {
    const cutoff = new Date(Date.now() - 30 * 86400_000).toISOString();
    // Independent image ledger: archive failure cannot prevent image expiry, and vice versa.
    const assets = checked(await db.from('image_assets').select('object_path').is('deleted_at', null)
      .lt('created_at', cutoff).order('created_at').limit(500)) ?? [];
    for (let i = 0; i < assets.length && Date.now() < deadline; i += 100) {
      const paths = assets.slice(i, i + 100).map(row => row.object_path as string);
      const { error } = await db.storage.from('meal-images').remove(paths);
      if (error) { imageErrors += paths.length; continue; }
      checked(await db.from('image_assets').update({ deleted_at: new Date().toISOString() }).in('object_path', paths));
      deletedImages += paths.length;
    }
    const bucket = db.storage.from('meal-archives');
    while (Date.now() < deadline && archivedBatches < 20) {
      const input = checked(await db.rpc('prepare_archive')) as ArchiveInput | null;
      if (!input) break;
      await archiveBatch(input, {
        async upload(path, data) { checked(await bucket.upload(path, data, { contentType: 'application/gzip', upsert: true })); },
        async download(path) {
          const blob = checked(await bucket.download(path));
          if (!blob) throw new Error('Missing uploaded archive');
          return Buffer.from(await blob.arrayBuffer());
        },
        async finalize(id, hash, bytes) {
          checked(await db.rpc('finalize_archive', { p_id: id, p_checksum: hash, p_bytes: bytes }));
        },
      });
      archivedBatches++;
    }
    checked(await db.rpc('prune_operational_data'));
    checked(await db.rpc('prune_login_attempts'));
    // Tenant tables are present when web-console encryption is configured.
    if(process.env.CREDENTIAL_ENCRYPTION_KEY) checked(await db.rpc('prune_bot_operational_data'));
    return { deletedImages, archivedBatches, imageErrors };
  } finally {
    checked(await db.rpc('release_maintenance_lock', { p_owner: owner }));
  }
}
