-- Run once after deploying Vercel. Replace the two placeholders below.
-- Vault keeps the bearer secret out of cron.job command text.
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
create extension if not exists supabase_vault with schema vault;

select vault.create_secret('https://YOUR-PROJECT.vercel.app', 'calo_app_url');
select vault.create_secret('REPLACE_WITH_THE_SAME_CRON_SECRET_AS_VERCEL', 'calo_cron_secret');

-- Re-running this scheduling block replaces the worker schedule rather than duplicating it.
do $$
begin
  perform cron.unschedule(jobid) from cron.job where jobname in ('calo-worker','calo-cron-history');
end $$;

select cron.schedule('calo-worker', '* * * * *', $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name='calo_app_url') || '/api/worker',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'Authorization','Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name='calo_cron_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 250000
  );
$$);

select cron.schedule('calo-cron-history', '15 20 * * *', $$
  delete from cron.job_run_details where end_time < now() - interval '7 days';
$$);

-- To rotate secrets, use vault.update_secret(id, 'new-value') instead of creating duplicates.
-- To inspect scheduling: select jobname, schedule, active from cron.job;
-- To inspect HTTP errors: select * from net._http_response order by created desc limit 10;
