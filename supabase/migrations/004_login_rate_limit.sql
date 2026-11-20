begin;

create table public.login_attempts (
  id bigint generated always as identity primary key,
  client_key text not null check(length(client_key) between 32 and 128),
  attempted_at timestamptz not null default clock_timestamp()
);
create index login_attempts_key_time_idx on public.login_attempts(client_key,attempted_at,id);

create function public.consume_login_attempt(p_client_key text,p_limit integer,p_window_seconds integer)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare
  now_at timestamptz:=clock_timestamp();
  used integer;
  oldest timestamptz;
  retry integer;
begin
  if p_client_key is null or length(p_client_key) not between 32 and 128
    or p_limit not between 1 and 100 or p_window_seconds not between 1 and 86400 then
    raise exception 'Invalid login limit parameters';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_client_key,0));
  delete from public.login_attempts
    where client_key=p_client_key and attempted_at<=now_at-make_interval(secs=>p_window_seconds);
  select count(*)::integer,min(attempted_at) into used,oldest
    from public.login_attempts where client_key=p_client_key;
  if used>=p_limit then
    retry:=greatest(1,ceil(extract(epoch from oldest+make_interval(secs=>p_window_seconds)-now_at))::integer);
    return jsonb_build_object('allowed',false,'retry_after',retry,'remaining',0);
  end if;
  insert into public.login_attempts(client_key,attempted_at) values(p_client_key,now_at);
  return jsonb_build_object('allowed',true,'retry_after',0,'remaining',p_limit-used-1);
end;
$$;

revoke all on public.login_attempts from public,anon,authenticated;
grant all on public.login_attempts to service_role;
revoke all on function public.consume_login_attempt(text,integer,integer) from public,anon,authenticated;
grant execute on function public.consume_login_attempt(text,integer,integer) to service_role;

create function public.prune_login_attempts()
returns void language sql security definer set search_path=public,pg_temp as $$
  delete from public.login_attempts where attempted_at<clock_timestamp()-interval '30 minutes';
$$;
revoke all on function public.prune_login_attempts() from public,anon,authenticated;
grant execute on function public.prune_login_attempts() to service_role;

commit;
