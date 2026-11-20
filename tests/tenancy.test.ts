import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('two bots can share update IDs; tenant rollups survive archive; secrets stay server-only', async () => {
  const db = new PGlite();
  const ownerA = '00000000-0000-4000-8000-000000000001', ownerB = '00000000-0000-4000-8000-000000000002';
  const botA = '00000000-0000-4000-8000-000000000003', botB = '00000000-0000-4000-8000-000000000004';
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema auth; create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb);
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
    for (const file of ['001_initial.sql','002_web_console.sql'])
      await db.exec(await readFile(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
    await db.query("insert into auth.users values($1,'a@example.com','{}'),($2,'b@example.com','{}')", [ownerA, ownerB]);
    assert.equal((await db.query<any>('select active from profiles where id=$1',[ownerA])).rows[0].active,false,'unprovisioned Auth users must not gain access');
    await db.exec('update profiles set active=true');
    await db.query(`insert into bot_integrations(id,owner_id,name,telegram_bot_id,telegram_user_id,bot_username,token_ciphertext,gemini_ciphertext,webhook_ciphertext,enabled)
      values($1,$2,'Bot A',1,42,'bot_a','enc','enc','enc',true),($3,$4,'Bot B',2,42,'bot_b','enc','enc','enc',true)`, [botA,ownerA,botB,ownerB]);
    await db.exec(await readFile(new URL('../supabase/migrations/003_zalo_channel.sql',import.meta.url),'utf8'));
    const migrated=(await db.query<any>('select provider,external_bot_id,allowed_user_id from bot_integrations where id=$1',[botA])).rows[0];
    assert.equal(migrated.provider,'telegram');assert.equal(migrated.external_bot_id,'1');assert.equal(migrated.allowed_user_id,'42');
    await db.query(`insert into bot_jobs(bot_id,update_id,chat_id,message_id,payload,created_at)
      values($1,10,42,1,'{}',now()-interval '31 days'),($2,10,42,1,'{}',now()-interval '31 days')`, [botA,botB]);
    const jobs = (await db.query<any>('select * from claim_bot_jobs(2,null)')).rows;
    assert.equal(jobs.length, 2);
    const estimate = { is_food:true, totals:{kcal:500,protein_g:20,carbs_g:60,fat_g:15} };
    for (const j of jobs) {
      await db.query('select save_bot_meal($1,$2,$3,$4,$5)',[j.id,j.lease_token,estimate,'test',null]);
      await db.query('select save_bot_meal($1,$2,$3,$4,$5)',[j.id,j.lease_token,estimate,'test',null]);
    }
    assert.equal((await db.query('select * from meals')).rows.length,2);
    assert.equal((await db.query<any>('select sum(meal_count)::int as n from nutrition_daily')).rows[0].n,2);
    const zalo='00000000-0000-4000-8000-000000000005';
    await db.query(`insert into bot_integrations(id,owner_id,name,provider,external_bot_id,allowed_user_id,bot_username,token_ciphertext,gemini_ciphertext,webhook_ciphertext,enabled)
      values($1,$2,'Zalo','zalo','1','abc.zalo','bot.zalo','enc','enc','enc',true)`,[zalo,ownerA]);
    await db.query(`insert into bot_jobs(bot_id,update_id,chat_id,message_id,payload,created_at)
      values($1,'message.opaque','abc.zalo','message.opaque','{}',now()-interval '32 days') on conflict do nothing`,[zalo]);
    await db.query(`insert into bot_jobs(bot_id,update_id,chat_id,message_id,payload)
      values($1,'message.opaque','abc.zalo','message.opaque','{}') on conflict do nothing`,[zalo]);
    const zj=(await db.query<any>('select * from claim_bot_jobs(1,null)')).rows[0];
    assert.equal(zj.chat_id,'abc.zalo');assert.equal(zj.update_id,'message.opaque');
    await db.query('select save_bot_meal($1,$2,$3,$4,$5)',[zj.id,zj.lease_token,estimate,'test',null]);
    const zb=(await db.query<any>('select prepare_archive() as value')).rows[0].value;
    assert.equal(zb.batch.chat_id,'abc.zalo');assert.equal(zb.meals.length,1);
    await db.query('select finalize_archive($1,$2,100)',[zb.batch.id,'b'.repeat(64)]);
    const batch = (await db.query<any>('select prepare_archive() as value')).rows[0].value;
    assert.equal(batch.meals.length,1, 'same chat ID must not mix owners or bots in an archive');
    assert.ok([ownerA,ownerB].includes(batch.batch.owner_id));
    await db.query('select finalize_archive($1,$2,100)', [batch.batch.id, 'a'.repeat(64)]);
    assert.equal((await db.query('select * from meals')).rows.length,1);
    assert.equal((await db.query<any>('select sum(meal_count)::int as n from nutrition_daily')).rows[0].n,3);
    // The string-ID migration must also preserve the optional shared Telegram bot.
    await db.exec(`insert into jobs(update_id,chat_id,message_id,payload,created_at) values(900,42,1,'{}',now()-interval '33 days')`);
    const legacy=(await db.query<any>('select * from claim_jobs(1,900)')).rows[0];
    await db.query('select save_meal($1,$2,$3,$4,$5)',[900,legacy.lease_token,estimate,'test',null]);
    const legacyBatch=(await db.query<any>('select prepare_archive() as value')).rows[0].value;
    assert.equal(legacyBatch.batch.chat_id,'42');assert.equal(legacyBatch.batch.bot_id,null);
    assert.equal(legacyBatch.meals.length,1);
    await db.query('update profiles set active=false where id=$1',[ownerB]);
    const b = jobs.find(j=>j.bot_id===botB)!;
    await assert.rejects(db.query('select save_bot_meal($1,$2,$3,$4,$5)',[b.id,b.lease_token,estimate,'test',null]));
    await db.exec('set role authenticated');
    await assert.rejects(db.query('select token_ciphertext from bot_integrations'),/permission denied/);
    await assert.rejects(db.query('select * from nutrition_daily'),/permission denied/);
  } finally { await db.close(); }
});
