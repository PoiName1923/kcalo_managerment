import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import sharp from 'sharp';
import { database } from '../src/db.js';
import { drainJobs } from '../src/worker.js';
import type { Config } from '../src/config.js';
import { downloadArchive } from '../src/history.js';
import { maintain } from '../src/retention.js';
import { gunzipSync } from 'node:zlib';

test('photo workflow saves once, retries Telegram without repeating Gemini, then archives and expires image', async t => {
  const sql = new PGlite();
  const realFetch = globalThis.fetch;
  const objects = new Map<string, Buffer>();
  let analyses = 0, sends = 0, failDelivery = true;
  const replies: string[] = [];
  t.mock.method(console, 'error', () => {});
  const photo = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#cc6633' } }).jpeg().toBuffer();
  const config: Config = {
    TELEGRAM_BOT_TOKEN: 'test-token', TELEGRAM_WEBHOOK_SECRET: 'a'.repeat(32),
    GEMINI_API_KEY: 'test-api-key', GEMINI_MODEL: 'test-model', CRON_SECRET: 'b'.repeat(32),
    SUPABASE_URL: 'https://test.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key', ALLOWED_TELEGRAM_USER_IDS: '',
  };
  const result = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
  try {
    await sql.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema storage; create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);`);
    await sql.exec(await readFile(new URL('../supabase/migrations/001_initial.sql', import.meta.url), 'utf8'));
    await sql.exec(`insert into jobs(update_id,chat_id,message_id,payload) values (10,42,5,'{"file_id":"photo-id","caption":"150 g cơm"}');`);
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : undefined;
      if (url.hostname === 'api.telegram.org') {
        if (url.pathname.endsWith('/getFile')) return result({ ok: true, result: { file_path: 'photos/a.jpg', file_size: photo.length } });
        if (url.pathname.startsWith('/file/')) return new Response(new Uint8Array(photo));
        if (url.pathname.endsWith('/sendMessage')) {
          sends++;
          if (failDelivery) { failDelivery = false; return result({ ok: false }, 502); }
          replies.push(body.text); return result({ ok: true, result: { message_id: 1 } });
        }
      }
      if (url.hostname === 'generativelanguage.googleapis.com') {
        analyses++;
        assert.equal(body.contents[0].parts[0].inlineData.mimeType, 'image/jpeg');
        assert.equal(body.generationConfig.responseMimeType, 'application/json');
        return result({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({
          is_food: true, items: [{ name: 'Cơm', grams: 150, kcal: 195, kcal_low: 170, kcal_high: 230,
            protein_g: 4, carbs_g: 43, fat_g: 0.5 }], confidence: 'medium', assumptions: ['Theo chú thích người dùng'],
        }) }] } }] });
      }
      if (url.hostname !== 'test.supabase.co') throw new Error('Unexpected external request');
      if (url.pathname.startsWith('/rest/v1/rpc/')) {
        const name = url.pathname.split('/').pop();
        const params: Record<string, [string, unknown[]]> = {
          claim_jobs: ['select * from claim_jobs($1,$2)', [body.p_limit, body.p_update_id]],
          finish_job: ['select finish_job($1,$2,$3) as value', [body.p_update_id, body.p_token, body.p_success]],
          save_meal: ['select save_meal($1,$2,$3,$4,$5) as value', [body.p_update_id, body.p_token, body.p_estimate, body.p_model, body.p_image_path]],
          acquire_maintenance_lock: ['select acquire_maintenance_lock($1) as value', [body.p_owner]],
          release_maintenance_lock: ['select release_maintenance_lock($1) as value', [body.p_owner]],
          prepare_archive: ['select prepare_archive() as value', []],
          finalize_archive: ['select finalize_archive($1,$2,$3) as value', [body.p_id, body.p_checksum, body.p_bytes]],
          prune_operational_data: ['select prune_operational_data() as value', []],
          prune_login_attempts: ['select null as value', []],
        };
        const [query, args] = params[name!];
        const rows = (await sql.query<any>(query, args)).rows;
        return result(name === 'claim_jobs' ? rows : rows[0]?.value ?? null);
      }
      if (url.pathname === '/rest/v1/meals') {
        const id = Number(url.searchParams.get('update_id')?.slice(3));
        return result((await sql.query('select estimate from meals where update_id=$1', [id])).rows);
      }
      if (url.pathname === '/rest/v1/image_assets') {
        if (init?.method === 'POST') {
          await sql.query('insert into image_assets(object_path) values($1) on conflict do nothing', [body.object_path]);
          return new Response(null, { status: 201 });
        }
        if (init?.method === 'PATCH') {
          await sql.query('update image_assets set deleted_at=$1', [body.deleted_at]);
          return new Response(null, { status: 204 });
        }
        return result((await sql.query("select object_path from image_assets where deleted_at is null and created_at<now()-interval '30 days'")).rows);
      }
      if (url.pathname.startsWith('/storage/v1/object/')) {
        const path = url.pathname.replace('/storage/v1/object/', '').replace(/^authenticated\//, '');
        if (init?.method === 'DELETE') {
          for (const prefix of body.prefixes) objects.delete(`${path}/${prefix}`);
          return result([]);
        }
        if (init?.method === 'POST' || init?.method === 'PUT') {
          const data = Buffer.from(await new Response(init.body).arrayBuffer());
          objects.set(path, data); return result({ Key: path });
        }
        const data = objects.get(path);
        if (!data) return result({ message: 'not found' }, 404);
        return new Response(new Uint8Array(data));
      }
      throw new Error(`Unexpected test route ${url.pathname}`);
    };
    const db = database(config);
    await drainJobs(db, config, 10);
    assert.equal((await sql.query('select * from meals')).rows.length, 1);
    assert.equal(analyses, 1);
    assert.equal((await sql.query<any>('select status from jobs')).rows[0].status, 'pending');
    await sql.exec('update jobs set available_at=now()');
    await drainJobs(db, config, 10);
    await drainJobs(db, config, 10);
    assert.equal(analyses, 1);
    assert.equal(sends, 2);
    assert.match(replies[0], /195 kcal/);
    assert.equal((await sql.query<any>('select status from jobs')).rows[0].status, 'done');
    assert.equal((await sql.query('select * from meals')).rows.length, 1);
    const savedImage = objects.get('meal-images/42/10.webp');
    assert.ok(savedImage);
    assert.equal((await sharp(savedImage).metadata()).format, 'webp');
    await sql.exec("update meals set created_at=now()-interval '31 days'; update image_assets set created_at=now()-interval '31 days';");
    const maintenance = await maintain(db);
    assert.equal(maintenance.deletedImages, 1);
    assert.equal(maintenance.archivedBatches, 1);
    assert.equal(objects.has('meal-images/42/10.webp'), false);
    assert.equal((await sql.query('select * from meals')).rows.length, 0);
    const manifest = (await sql.query<any>('select * from archive_batches')).rows[0];
    const archive = await downloadArchive(42, manifest, async path => objects.get(`meal-archives/${path}`)!);
    assert.equal(JSON.parse(gunzipSync(archive).toString()).meals[0].estimate.totals.kcal, 195);
  } finally { globalThis.fetch = realFetch; await sql.close(); }
});
