begin;
alter table public.bot_integrations add column provider text not null default 'telegram' check(provider in ('telegram','zalo'));
alter table public.bot_integrations add column external_bot_id text;
alter table public.bot_integrations add column allowed_user_id text;
update public.bot_integrations set external_bot_id=telegram_bot_id::text,allowed_user_id=telegram_user_id::text;
alter table public.bot_integrations alter column telegram_bot_id drop not null;
alter table public.bot_integrations alter column telegram_user_id drop not null;
alter table public.bot_integrations add constraint bot_provider_identity unique(provider,external_bot_id);
alter table public.bot_integrations add constraint bot_provider_fields check(
  (provider='telegram' and telegram_bot_id is not null and telegram_user_id is not null)
  or (provider='zalo' and length(external_bot_id)>0 and external_bot_id is not null and length(allowed_user_id)>0 and allowed_user_id is not null)
);
-- Zalo uses opaque string IDs, including values larger than JavaScript safe integers.
alter table public.bot_jobs alter column update_id type text using update_id::text;
alter table public.bot_jobs alter column chat_id type text using chat_id::text;
alter table public.bot_jobs alter column message_id type text using message_id::text;
alter table public.meals alter column chat_id type text using chat_id::text;
alter table public.archive_batches alter column chat_id type text using chat_id::text;

create or replace function public.prepare_archive()
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare batch public.archive_batches; chosen_chat text; chosen_bot uuid; chosen_owner uuid; chosen_ids uuid[]; batch_id uuid:=gen_random_uuid(); result jsonb;
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
      select batch_id,chosen_chat,chosen_owner,chosen_bot,coalesce(chosen_bot::text || '/','') || chosen_chat || '/' || batch_id::text || '.json.gz',
        count(*),min(created_at),max(created_at) from public.meals where id=any(chosen_ids) returning * into batch;
    update public.meals set archive_batch_id=batch.id where id=any(chosen_ids);
  end if;
  select jsonb_build_object('batch',to_jsonb(batch),'meals',jsonb_agg(to_jsonb(m) order by m.created_at,m.id)) into result from public.meals m where m.archive_batch_id=batch.id;
  return result;
end; $$;
commit;
