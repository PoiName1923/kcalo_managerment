begin;

create table public.jobs (
  update_id bigint primary key,
  chat_id bigint not null,
  message_id bigint not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending','processing','done','failed')),
  attempts integer not null default 0,
  notification_pending boolean not null default false,
  lease_token uuid,
  locked_until timestamptz,
  available_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index jobs_pending_idx on public.jobs(status, available_at, locked_until);

create table public.archive_batches (
  id uuid primary key default gen_random_uuid(),
  chat_id bigint not null,
  object_path text unique not null,
  status text not null default 'pending' check (status in ('pending','complete')),
  row_count integer not null check (row_count > 0 and row_count <= 100),
  earliest_at timestamptz not null,
  latest_at timestamptz not null,
  checksum text,
  compressed_bytes integer,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index archive_chat_idx on public.archive_batches(chat_id,created_at desc);
create table public.meals (
  id uuid primary key default gen_random_uuid(),
  update_id bigint not null unique,
  chat_id bigint not null,
  created_at timestamptz not null default now(),
  estimate jsonb not null,
  model text not null,
  image_path text,
  archive_batch_id uuid references public.archive_batches(id)
);
create index meals_chat_idx on public.meals(chat_id,created_at desc);
create index meals_retention_idx on public.meals(created_at) where archive_batch_id is null;
create table public.image_assets (
  object_path text primary key,
  created_at timestamptz not null default now(),
  deleted_at timestamptz
);
create index image_expiration_idx on public.image_assets(created_at) where deleted_at is null;
create table public.maintenance_lock (
  id integer primary key check (id = 1), owner text not null, locked_until timestamptz not null
);

alter table public.jobs enable row level security;
alter table public.meals enable row level security;
alter table public.image_assets enable row level security;
alter table public.archive_batches enable row level security;
alter table public.maintenance_lock enable row level security;
revoke all on public.jobs,public.meals,public.image_assets,public.archive_batches,public.maintenance_lock from public,anon,authenticated;
grant all on public.jobs,public.meals,public.image_assets,public.archive_batches,public.maintenance_lock to service_role;

create function public.claim_jobs(p_limit integer default 1, p_update_id bigint default null)
returns setof public.jobs language plpgsql security definer set search_path = public,pg_temp as $$
begin
  update public.jobs set status='failed', notification_pending=true, payload='{}', lease_token=null, locked_until=null,
    available_at=now()
    where status='processing' and locked_until < now() and attempts >= 3 and not notification_pending;
  return query
  with picked as (
    select update_id from public.jobs
    where available_at <= now() and (
      (attempts < 3 and (status='pending' or (status='processing' and locked_until < now())))
      or (notification_pending and (status='failed' or (status='processing' and locked_until < now())))
    )
      and (p_update_id is null or update_id=p_update_id)
    order by created_at limit greatest(1,least(p_limit,2)) for update skip locked
  )
  update public.jobs j set status='processing', attempts=j.attempts+1,
    lease_token=gen_random_uuid(), locked_until=now()+interval '4 minutes'
  from picked where j.update_id=picked.update_id returning j.*;
end;
$$;

create function public.finish_job(p_update_id bigint, p_token uuid, p_success boolean)
returns boolean language plpgsql security definer set search_path = public,pg_temp as $$
begin
  update public.jobs set
    status=case when notification_pending then 'failed' when p_success then 'done' when attempts >= 3 then 'failed' else 'pending' end,
    payload=case when p_success or attempts >= 3 then '{}'::jsonb else payload end,
    available_at=now()+case when notification_pending then interval '1 hour' else interval '30 seconds' end,
    notification_pending=case when notification_pending then not p_success else not p_success and attempts >= 3 end,
    lease_token=null, locked_until=null
    where update_id=p_update_id and lease_token=p_token and status='processing' and locked_until > now();
  return found;
end;
$$;

create function public.save_meal(p_update_id bigint,p_token uuid,p_estimate jsonb,p_model text,p_image_path text)
returns void language plpgsql security definer set search_path = public,pg_temp as $$
declare job public.jobs;
begin
  select * into job from public.jobs where update_id=p_update_id and lease_token=p_token
    and status='processing' and locked_until>now() for update;
  if not found then raise exception 'Job lease expired'; end if;
  insert into public.meals(update_id,chat_id,created_at,estimate,model,image_path)
    values(job.update_id,job.chat_id,job.created_at,p_estimate,p_model,p_image_path)
    on conflict(update_id) do nothing;
end;
$$;

create function public.acquire_maintenance_lock(p_owner text)
returns boolean language plpgsql security definer set search_path = public,pg_temp as $$
begin
  insert into public.maintenance_lock(id,owner,locked_until) values(1,p_owner,now()+interval '10 minutes')
    on conflict(id) do update set owner=excluded.owner,locked_until=excluded.locked_until
    where public.maintenance_lock.locked_until<now();
  return found;
end;
$$;
create function public.release_maintenance_lock(p_owner text)
returns void language sql security definer set search_path = public,pg_temp as $$
  delete from public.maintenance_lock where id=1 and owner=p_owner;
$$;

create function public.prepare_archive()
returns jsonb language plpgsql security definer set search_path = public,pg_temp as $$
declare batch public.archive_batches; chosen_chat bigint; chosen_ids uuid[]; batch_id uuid := gen_random_uuid(); result jsonb;
begin
  perform pg_advisory_xact_lock(827341);
  select * into batch from public.archive_batches where status='pending' order by created_at limit 1 for update;
  if not found then
    select chat_id into chosen_chat from public.meals where created_at<now()-interval '30 days'
      and archive_batch_id is null order by created_at,update_id limit 1;
    if not found then return null; end if;
    select array_agg(id) into chosen_ids from (
      select id from public.meals where chat_id=chosen_chat and created_at<now()-interval '30 days'
        and archive_batch_id is null order by created_at,update_id limit 100 for update
    ) picked;
    insert into public.archive_batches(id,chat_id,object_path,row_count,earliest_at,latest_at)
      select batch_id,chosen_chat,chosen_chat::text || '/' || batch_id::text || '.json.gz',
        count(*),min(created_at),max(created_at) from public.meals where id=any(chosen_ids)
      returning * into batch;
    update public.meals set archive_batch_id=batch.id where id=any(chosen_ids);
  end if;
  select jsonb_build_object('batch',to_jsonb(batch),'meals',jsonb_agg(to_jsonb(m) order by m.created_at,m.id))
    into result from public.meals m where m.archive_batch_id=batch.id;
  return result;
end;
$$;

create function public.finalize_archive(p_id uuid,p_checksum text,p_bytes integer)
returns void language plpgsql security definer set search_path = public,pg_temp as $$
declare batch public.archive_batches; deleted integer;
begin
  if p_checksum !~ '^[a-f0-9]{64}$' or p_checksum is null or p_bytes<=0 or p_bytes is null
    then raise exception 'Invalid archive verification'; end if;
  select * into batch from public.archive_batches where id=p_id for update;
  if not found then raise exception 'Unknown archive'; end if;
  if batch.status='complete' then
    if batch.checksum<>p_checksum or batch.compressed_bytes<>p_bytes then raise exception 'Archive mismatch'; end if;
    return;
  end if;
  delete from public.meals where archive_batch_id=batch.id;
  get diagnostics deleted = row_count;
  if deleted <> batch.row_count then raise exception 'Archive count mismatch'; end if;
  update public.archive_batches set status='complete',checksum=p_checksum,compressed_bytes=p_bytes,completed_at=now() where id=p_id;
end;
$$;

create function public.prune_operational_data()
returns void language sql security definer set search_path = public,pg_temp as $$
  delete from public.jobs where created_at<now()-interval '30 days' and status in ('done','failed');
  delete from public.image_assets where deleted_at is not null and created_at<now()-interval '30 days';
$$;

revoke all on function public.claim_jobs(integer,bigint), public.finish_job(bigint,uuid,boolean),
 public.save_meal(bigint,uuid,jsonb,text,text), public.acquire_maintenance_lock(text),public.release_maintenance_lock(text),
 public.prepare_archive(),public.finalize_archive(uuid,text,integer),public.prune_operational_data() from public,anon,authenticated;
grant execute on function public.claim_jobs(integer,bigint),public.finish_job(bigint,uuid,boolean),
 public.save_meal(bigint,uuid,jsonb,text,text),public.acquire_maintenance_lock(text),public.release_maintenance_lock(text),
 public.prepare_archive(),public.finalize_archive(uuid,text,integer),public.prune_operational_data() to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
  ('meal-images','meal-images',false,10485760,array['image/webp']),
  ('meal-archives','meal-archives',false,10485760,array['application/gzip'])
on conflict(id) do nothing;
commit;
