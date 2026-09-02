-- MP-375: instrument pg_cron timeout stalls with live pg_stat_activity snapshots
-- Fires when a job enters CRON_TASK_ERROR with "job startup timeout" message
-- Goal: capture backend state at the moment of a stall so we can diagnose root cause

create table if not exists public.pg_cron_timeout_samples (
  sample_id uuid primary key default gen_random_uuid(),
  sampled_at timestamptz not null,
  max_running_jobs int,
  active_backends int,
  active_queries int,
  sample_data jsonb not null,
  created_at timestamptz not null default now()
);

comment on table public.pg_cron_timeout_samples is
  'Snapshots of pg_stat_activity taken at the moment a pg_cron job fails with "job startup timeout". Used to diagnose the root cause of ALL-OR-NOTHING stall windows where all scheduled fires in a single second fail.';

create index if not exists idx_pg_cron_timeout_samples_sampled_at
  on public.pg_cron_timeout_samples (sampled_at desc nulls first);

grant select on public.pg_cron_timeout_samples to authenticated;

-- Procedure to capture state when a timeout occurs
-- (The trigger will be added by the watchdog when sampling is armed)
create or replace function public.fn_capture_pg_cron_timeout_state()
  returns void language plpgsql security definer as $$
declare
  v_sample_id uuid;
  v_backend_dist json;
begin
  v_sample_id := gen_random_uuid();
  
  -- snapshot backend distribution NOW
  select json_object_agg(backend_type, cnt order by backend_type)
    into v_backend_dist
    from (
      select backend_type, count(*) cnt
        from pg_stat_activity
       where state != 'idle'
       group by backend_type
    ) s;
  
  insert into public.pg_cron_timeout_samples (
    sample_id, sampled_at, max_running_jobs, active_backends, active_queries, sample_data
  ) values (
    v_sample_id,
    now(),
    (select setting::int from pg_settings where name = 'cron.max_running_jobs'),
    (select count(*) from pg_stat_activity where state != 'idle'),
    (select count(*) from pg_stat_activity where state = 'active'),
    jsonb_build_object(
      'backend_distribution', v_backend_dist,
      'pg_cron_jobs_active', (select count(*) from pg_stat_activity where query like '%pg_cron%' and state != 'idle'),
      'max_connections', (select setting::int from pg_settings where name = 'max_connections'),
      'query_start_skew_seconds', (select extract(epoch from (max(query_start) - min(query_start))) from pg_stat_activity where state = 'active'),
      'oldest_active_query_age_seconds', (select extract(epoch from (now() - min(query_start))) from pg_stat_activity where state = 'active')
    )
  );
  
exception when others then
  -- silent on permission or schema issues; the diagnostic tool should never block prod
  null;
end $$;

comment on function public.fn_capture_pg_cron_timeout_state() is
  'Called by the pg_cron watchdog when a job startup timeout is detected. Captures current pg_stat_activity state for post-mortem analysis of stall windows.';
