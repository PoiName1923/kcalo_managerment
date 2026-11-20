import assert from 'node:assert/strict';
import test from 'node:test';
import { gunzipSync } from 'node:zlib';
import { archiveBatch } from '../src/retention.js';

const batch = { id: 'batch-id', object_path: '42/batch-id.json.gz', chat_id: 42, row_count: 1 };
const meals = [{ id: 'meal-id', chat_id: 42, estimate: { totals: { kcal: 500 } } }];
test('archive is readable gzip JSON and is verified before source deletion', async () => {
  let object: Buffer = Buffer.alloc(0), deleted = false;
  await archiveBatch({ batch, meals }, {
    async upload(path, data) { assert.equal(path, batch.object_path); object = data; },
    async download() { return object; },
    async finalize(id, hash, bytes) {
      assert.equal(id, 'batch-id'); assert.match(hash, /^[a-f0-9]{64}$/);
      assert.equal(bytes, object.length); deleted = true;
    },
  });
  assert.equal(deleted, true);
  const decoded = JSON.parse(gunzipSync(object).toString());
  assert.equal(decoded.schema_version, 1);
  assert.equal(decoded.meals[0].estimate.totals.kcal, 500);
});
test('failed uploads and corrupt read-back never delete source data', async () => {
  for (const failUpload of [true, false]) {
    let deleted = false;
    await assert.rejects(archiveBatch({ batch, meals }, {
      async upload() { if (failUpload) throw new Error('unavailable'); },
      async download() { return Buffer.from('corrupt'); },
      async finalize() { deleted = true; },
    }));
    assert.equal(deleted, false);
  }
});
