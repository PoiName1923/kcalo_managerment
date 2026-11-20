import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('Postgres enforces job leases, duplicate delivery and safe archive finalization', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema storage; create table storage.buckets(id text primary key, name text, public boolean,
      file_size_limit bigint, allowed_mime_types text[]);`);
    await db.exec(await readFile(new URL('../supabase/migrations/001_initial.sql', import.meta.url), 'utf8'));
    await db.exec(`insert into jobs(update_id,chat_id,message_id,payload) values (10,42,1,'{"text":"/start"}');
      insert into jobs(update_id,chat_id,message_id,payload) values (10,42,1,'{}') on conflict do nothing;`);
    const first = await db.query<any>('select * from claim_jobs(1,10)');
    assert.equal(first.rows.length, 1);
    assert.equal((await db.query('select * from claim_jobs(1,10)')).rows.length, 0);
    await db.exec(`update jobs set locked_until=now()-interval '1 second' where update_id=10;`);
    const second = await db.query<any>('select * from claim_jobs(1,10)');
    assert.notEqual(first.rows[0].lease_token, second.rows[0].lease_token);
    assert.equal((await db.query<any>('select finish_job(10,$1,true) as ok', [first.rows[0].lease_token])).rows[0].ok, false);
    assert.equal((await db.query<any>('select finish_job(10,$1,true) as ok', [second.rows[0].lease_token])).rows[0].ok, true);
    // A killed final attempt must become a durable notification, not silently disappear.
    await db.exec(`insert into jobs(update_id,chat_id,message_id,payload,status,attempts,locked_until)
      values(99,42,99,'{}','processing',3,now()-interval '1 second');`);
    const notice = (await db.query<any>('select * from claim_jobs(1,99)')).rows[0];
    assert.ok(notice, 'exhausted crash should be claimed for a terminal notice');
    assert.equal(notice.notification_pending, true);
    await db.query('select finish_job(99,$1,false)', [notice.lease_token]);
    await db.exec('update jobs set available_at=now() where update_id=99');
    const retriedNotice = (await db.query<any>('select * from claim_jobs(1,99)')).rows[0];
    assert.equal(retriedNotice.notification_pending, true);
    await db.query('select finish_job(99,$1,true)', [retriedNotice.lease_token]);
    assert.equal((await db.query('select * from claim_jobs(1,99)')).rows.length, 0);
    await db.exec(`insert into meals(update_id,chat_id,created_at,estimate,model) values
      (10,42,now()-interval '31 days','{"totals":{"kcal":100}}','test'),
      (11,43,now()-interval '31 days','{"totals":{"kcal":200}}','test'),
      (12,42,now()-interval '29 days','{"totals":{"kcal":300}}','test');`);
    const prepared = (await db.query<any>('select prepare_archive() as result')).rows[0].result;
    assert.equal(prepared.meals.length, 1);
    assert.equal(prepared.batch.chat_id, 42);
    assert.equal((await db.query('select * from meals')).rows.length, 3);
    const retry = (await db.query<any>('select prepare_archive() as result')).rows[0].result;
    assert.equal(retry.batch.id, prepared.batch.id);
    await assert.rejects(db.query('select finalize_archive($1,$2,100)', [prepared.batch.id, 'bad']));
    assert.equal((await db.query('select * from meals')).rows.length, 3);
    await db.query('select finalize_archive($1,$2,100)', [prepared.batch.id, 'a'.repeat(64)]);
    assert.equal((await db.query('select * from meals')).rows.length, 2);
    await db.query('select finalize_archive($1,$2,100)', [prepared.batch.id, 'a'.repeat(64)]);
    assert.equal((await db.query('select * from meals')).rows.length, 2);
    const manifest = (await db.query<any>('select * from archive_batches where id=$1', [prepared.batch.id])).rows[0];
    assert.equal(manifest.status, 'complete');
    assert.equal(manifest.row_count, 1);
    await db.exec('set role anon');
    await assert.rejects(db.query('select * from meals'), /permission denied/);
    await assert.rejects(db.query('select prepare_archive()'), /permission denied/);
    await db.exec('reset role');
    assert.equal((await db.query<any>("select acquire_maintenance_lock('a') as ok")).rows[0].ok, true);
    assert.equal((await db.query<any>("select acquire_maintenance_lock('b') as ok")).rows[0].ok, false);
  } finally { await db.close(); }
});
