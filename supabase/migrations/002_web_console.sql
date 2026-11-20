begin;
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null, display_name text not null default '',
  role text not null default 'member' check(role in ('admin','member')),
  active boolean not null default false, created_at timestamptz not null default now()
);
create function public.handle_new_account() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  insert into public.profiles(id,email,display_name) values(new.id,coalesce(new.email,''),left(coalesce(new.raw_user_meta_data->>'display_name',''),100))
    on conflict(id) do update set email=excluded.email;
  return new;
end; $$;
create trigger calo_account_created after insert or update of email on auth.users for each row execute function public.handle_new_account();
insert into public.profiles(id,email,display_name) select id,coalesce(email,''),left(coalesce(raw_user_meta_data->>'display_name',''),100) from auth.users on conflict do nothing;

create table public.bot_integrations (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null references public.profiles(id),
  name text not null check(length(name) between 1 and 80),
  telegram_bot_id bigint not null unique, telegram_user_id bigint not null check(telegram_user_id>0),
  bot_username text not null, gemini_model text not null default 'gemini-3.5-flash-lite',
  token_ciphertext text not null, gemini_ciphertext text not null, webhook_ciphertext text not null,
  enabled boolean not null default false, connected_at timestamptz,
  created_at timestamptz not null default now()
);
create index bot_owner_idx on public.bot_integrations(owner_id);
create table public.bot_jobs (
  id uuid primary key default gen_random_uuid(), bot_id uuid not null references public.bot_integrations(id),
  update_id bigint not null, chat_id bigint not null, message_id bigint not null, payload jsonb not null,
  status text not null default 'pending' check(status in ('pending','processing','done','failed')),
  attempts integer not null default 0, notification_pending boolean not null default false,
  lease_token uuid, locked_until timestamptz, available_at timestamptz not null default now(),
  created_at timestamptz not null default now(), unique(bot_id,update_id)
);
create index bot_jobs_pending_idx on public.bot_jobs(status,available_at,locked_until);
alter table public.meals alter column update_id drop not null;
alter table public.meals add column owner_id uuid references public.profiles(id);
alter table public.meals add column bot_id uuid references public.bot_integrations(id);
alter table public.meals add column source_job_id uuid unique;
alter table public.archive_batches add column owner_id uuid references public.profiles(id);
alter table public.archive_batches add column bot_id uuid references public.bot_integrations(id);
create index meals_owner_idx on public.meals(owner_id,created_at desc);

create table public.nutrition_daily (
  owner_id uuid not null references public.profiles(id), bot_id uuid not null references public.bot_integrations(id),
  day date not null, meal_count integer not null default 0,
  kcal numeric not null default 0, protein_g numeric not null default 0,
  carbs_g numeric not null default 0, fat_g numeric not null default 0,
  primary key(bot_id,day)
);
create index nutrition_owner_idx on public.nutrition_daily(owner_id,day);
create table public.gemini_usage_daily (
  owner_id uuid not null references public.profiles(id), bot_id uuid not null references public.bot_integrations(id),
  day date not null, calls integer not null default 0, successes integer not null default 0,
  total_tokens bigint not null default 0, primary key(bot_id,day)
);
create table public.gemini_usage_events (
  job_id uuid not null, attempt integer not null, created_at timestamptz not null default now(), primary key(job_id,attempt)
);

create function public.claim_bot_jobs(p_limit integer default 1,p_job_id uuid default null)
returns setof public.bot_jobs language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.bot_jobs set status='failed',notification_pending=true,payload='{}',lease_token=null,locked_until=null,available_at=now()
    where status='processing' and locked_until<now() and attempts>=3 and not notification_pending;
  return query with picked as (
    select j.id from public.bot_jobs j join public.bot_integrations b on b.id=j.bot_id join public.profiles p on p.id=b.owner_id
    where b.enabled and p.active and j.available_at<=now() and (p_job_id is null or j.id=p_job_id) and (
      (j.attempts<3 and (j.status='pending' or (j.status='processing' and j.locked_until<now())))
      or (j.notification_pending and (j.status='failed' or (j.status='processing' and j.locked_until<now())))
    ) order by j.created_at limit greatest(1,least(p_limit,2)) for update of j skip locked
  ) update public.bot_jobs j set status='processing',attempts=j.attempts+1,lease_token=gen_random_uuid(),locked_until=now()+interval '4 minutes'
    from picked where j.id=picked.id returning j.*;
end; $$;
create function public.finish_bot_job(p_job_id uuid,p_token uuid,p_success boolean)
returns boolean language plpgsql security definer set search_path=public,pg_temp as $$
begin
  update public.bot_jobs set
    status=case when notification_pending then 'failed' when p_success then 'done' when attempts>=3 then 'failed' else 'pending' end,
    payload=case when p_success or attempts>=3 then '{}'::jsonb else payload end,
    available_at=now()+case when notification_pending then interval '1 hour' else interval '30 seconds' end,
    notification_pending=case when notification_pending then not p_success else not p_success and attempts>=3 end,
    lease_token=null,locked_until=null
    where id=p_job_id and lease_token=p_token and status='processing' and locked_until>now();
  return found;
end; $$;
create function public.save_bot_meal(p_job_id uuid,p_token uuid,p_estimate jsonb,p_model text,p_image_path text)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare j public.bot_jobs; b public.bot_integrations; inserted uuid; d date;
begin
  select * into j from public.bot_jobs where id=p_job_id and lease_token=p_token and status='processing' and locked_until>now() for update;
  if not found then raise exception 'Job lease expired'; end if;
  select bi.* into b from public.bot_integrations bi join public.profiles p on p.id=bi.owner_id where bi.id=j.bot_id and bi.enabled and p.active;
  if not found then raise exception 'Inactive integration'; end if;
  insert into public.meals(source_job_id,owner_id,bot_id,chat_id,created_at,estimate,model,image_path)
    values(j.id,b.owner_id,b.id,j.chat_id,j.created_at,p_estimate,p_model,p_image_path)
    on conflict(source_job_id) do nothing returning id into inserted;
  if inserted is null then return; end if;
  d=(j.created_at at time zone 'Asia/Ho_Chi_Minh')::date;
  insert into public.nutrition_daily(owner_id,bot_id,day,meal_count,kcal,protein_g,carbs_g,fat_g)
    values(b.owner_id,b.id,d,1,(p_estimate#>>'{totals,kcal}')::numeric,(p_estimate#>>'{totals,protein_g}')::numeric,
      (p_estimate#>>'{totals,carbs_g}')::numeric,(p_estimate#>>'{totals,fat_g}')::numeric)
    on conflict(bot_id,day) do update set meal_count=nutrition_daily.meal_count+1,kcal=nutrition_daily.kcal+excluded.kcal,
      protein_g=nutrition_daily.protein_g+excluded.protein_g,carbs_g=nutrition_daily.carbs_g+excluded.carbs_g,fat_g=nutrition_daily.fat_g+excluded.fat_g;
end; $$;
create function public.record_gemini_usage(p_job_id uuid,p_attempt integer,p_success boolean,p_tokens bigint default 0)
returns void language plpgsql security definer set search_path=public,pg_temp as $$
declare b public.bot_integrations; inserted uuid;
begin
  select bi.* into b from public.bot_jobs j join public.bot_integrations bi on bi.id=j.bot_id where j.id=p_job_id;
  if not found then return; end if;
  insert into public.gemini_usage_events(job_id,attempt) values(p_job_id,p_attempt) on conflict do nothing returning job_id into inserted;
  if inserted is null then return; end if;
  insert into public.gemini_usage_daily(owner_id,bot_id,day,calls,successes,total_tokens)
    values(b.owner_id,b.id,(now() at time zone 'Asia/Ho_Chi_Minh')::date,1,case when p_success then 1 else 0 end,greatest(0,p_tokens))
    on conflict(bot_id,day) do update set calls=gemini_usage_daily.calls+1,successes=gemini_usage_daily.successes+excluded.successes,
      total_tokens=gemini_usage_daily.total_tokens+excluded.total_tokens;
end; $$;

-- Keep batches isolated by bot even if two integrations accept the same Telegram chat.
create or replace function public.prepare_archive()
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare batch public.archive_batches; chosen_chat bigint; chosen_bot uuid; chosen_owner uuid; chosen_ids uuid[]; batch_id uuid:=gen_random_uuid(); result jsonb;
begin
  perform pg_advisory_xact_lock(827341);
  select * into batch from public.archive_batches where status='pending' order by created_at limit 1 for update;
  if not found then
    select chat_id,bot_id,owner_id into chosen_chat,chosen_bot,chosen_owner from public.meals
      where created_at<now()-interval '30 days' and archive_batch_id is null order by created_at,id limit 1;
    if not found then return null; end if;
    select array_agg(id) into chosen_ids from (select id from public.meals
      where chat_id=chosen_chat and bot_id is not distinct from chosen_bot and created_at<now()-interval '30 days'
        and archive_batch_id is null order by created_at,id limit 100 for update) picked;
    insert into public.archive_batches(id,chat_id,owner_id,bot_id,object_path,row_count,earliest_at,latest_at)
      select batch_id,chosen_chat,chosen_owner,chosen_bot,coalesce(chosen_bot::text || '/','') || chosen_chat::text || '/' || batch_id::text || '.json.gz',
        count(*),min(created_at),max(created_at) from public.meals where id=any(chosen_ids) returning * into batch;
    update public.meals set archive_batch_id=batch.id where id=any(chosen_ids);
  end if;
  select jsonb_build_object('batch',to_jsonb(batch),'meals',jsonb_agg(to_jsonb(m) order by m.created_at,m.id)) into result from public.meals m where m.archive_batch_id=batch.id;
  return result;
end; $$;

create function public.dashboard_data(p_owner uuid,p_days integer default 30,p_bot uuid default null)
returns jsonb language sql security definer set search_path=public,pg_temp as $$
  select jsonb_build_object(
    'daily',coalesce((select jsonb_agg(to_jsonb(d) order by d.day) from (select day,sum(meal_count) meal_count,sum(kcal) kcal,
      sum(protein_g) protein_g,sum(carbs_g) carbs_g,sum(fat_g) fat_g from public.nutrition_daily
      where owner_id=p_owner and (p_bot is null or bot_id=p_bot)
        and day >= (now() at time zone 'Asia/Ho_Chi_Minh')::date-greatest(1,least(p_days,90))+1 group by day) d),'[]'),
    'all_time',coalesce((select jsonb_build_object('meals',sum(meal_count),'kcal',sum(kcal)) from public.nutrition_daily where owner_id=p_owner and (p_bot is null or bot_id=p_bot)),'{}'),
    'usage',coalesce((select jsonb_build_object('calls',sum(calls),'successes',sum(successes),'total_tokens',sum(total_tokens)) from public.gemini_usage_daily
      where owner_id=p_owner and (p_bot is null or bot_id=p_bot) and day >= (now() at time zone 'Asia/Ho_Chi_Minh')::date-greatest(1,least(p_days,90))+1),'{}')
  );
$$;

create function public.prune_bot_operational_data() returns void language sql security definer set search_path=public,pg_temp as $$
  delete from public.bot_jobs where created_at<now()-interval '30 days' and status in ('done','failed');
  delete from public.gemini_usage_events where created_at<now()-interval '30 days';
$$;

alter table public.profiles enable row level security;
alter table public.bot_integrations enable row level security;
alter table public.bot_jobs enable row level security;
alter table public.nutrition_daily enable row level security;
alter table public.gemini_usage_daily enable row level security;
alter table public.gemini_usage_events enable row level security;
revoke all on public.profiles,public.bot_integrations,public.bot_jobs,public.nutrition_daily,public.gemini_usage_daily,public.gemini_usage_events from public,anon,authenticated;
grant all on public.profiles,public.bot_integrations,public.bot_jobs,public.nutrition_daily,public.gemini_usage_daily,public.gemini_usage_events to service_role;
revoke all on function public.handle_new_account(),public.claim_bot_jobs(integer,uuid),public.finish_bot_job(uuid,uuid,boolean),
  public.save_bot_meal(uuid,uuid,jsonb,text,text),public.record_gemini_usage(uuid,integer,boolean,bigint),public.dashboard_data(uuid,integer,uuid),public.prune_bot_operational_data() from public,anon,authenticated;
grant execute on function public.claim_bot_jobs(integer,uuid),public.finish_bot_job(uuid,uuid,boolean),public.save_bot_meal(uuid,uuid,jsonb,text,text),
  public.record_gemini_usage(uuid,integer,boolean,bigint),public.dashboard_data(uuid,integer,uuid),public.prune_bot_operational_data() to service_role;
commit;
