-- Supabase usage drain controls (2026-09-04).
--
-- Production evidence before this change:
--   * apex-outbox-dispatcher ran 1,440 times/24h and called the Edge Function
--     every time even though outbox_events had zero claimable rows.
--   * run_automation_job wrote one automation_run_log row per empty launch.
--   * 203 untouched July `reissue-40d-*` emails remained pending and could be
--     sent as a surprise blast if a legacy outreach drainer were re-enabled.
--
-- Keep the one-minute outbox SLA. The cron still checks every minute inside
-- Postgres, but only pays for pg_net + Edge + automation logging when work is
-- actually claimable. New events arriving just after a check wait <60 seconds.

create or replace function public.run_apex_outbox_dispatch_if_pending()
returns uuid
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  v_log_id uuid;
begin
  -- One cron owns the gate today, but the lock keeps a manual overlap from
  -- launching a second dispatcher for the same visible work.
  if not pg_try_advisory_xact_lock(hashtextextended('apex-outbox-pending-gate', 0)) then
    return null;
  end if;

  if not exists (
    select 1
    from public.outbox_events oe
    where (
      oe.status in ('pending', 'failed')
      or (oe.status = 'processing' and oe.locked_at < now() - interval '10 minutes')
    )
      and oe.available_at <= now()
      and oe.attempts < 5
  ) then
    return null;
  end if;

  v_log_id := public.run_automation_job(
    'apex-outbox-dispatcher',
    'apex-outbox-dispatcher',
    '{"limit":20}'::jsonb
  );
  return v_log_id;
end
$function$;

revoke all on function public.run_apex_outbox_dispatch_if_pending() from public, anon, authenticated;
grant execute on function public.run_apex_outbox_dispatch_if_pending() to service_role;

do $cron$
declare
  v_job_id bigint;
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron') then
    return;
  end if;

  select jobid into v_job_id
  from cron.job
  where jobname = 'apex-outbox-dispatcher'
  order by jobid desc
  limit 1;

  if v_job_id is null then
    perform cron.schedule(
      'apex-outbox-dispatcher',
      '* * * * *',
      $job$select public.run_apex_outbox_dispatch_if_pending();$job$
    );
  else
    -- Preserve jobid so cron history and existing health checks remain intact.
    perform cron.alter_job(
      job_id := v_job_id,
      schedule := '* * * * *',
      command := 'select public.run_apex_outbox_dispatch_if_pending();'
    );
  end if;
end
$cron$;

-- These were one-time July re-engagement campaigns, never attempted, and at
-- least two weeks overdue. Quarantine only that named cohort. Current
-- applicant-onboarding-v2 and agent_onboarding_queue work is intentionally
-- untouched. `skipped` is reversible and does not mislabel anyone as DNC.
update public.outreach_queue
set status = 'skipped',
    error_message = coalesce(error_message, 'quarantined_stale_reissue_2026_09_04'),
    last_error = coalesce(last_error, 'quarantined_stale_reissue_2026_09_04')
where status = 'pending'
  and template_key like 'reissue-40d-%'
  and scheduled_for < now() - interval '14 days'
  and last_attempted_at is null
  and coalesce(attempt_count, 0) = 0;

-- Admin/service-role/database-operator aggregate only: no message body,
-- recipient, or other PII.
-- It derives suppression from existing cron + automation ledgers, so the guard
-- does not create a replacement write-amplification log of its own.
create or replace function public.supabase_usage_drain_health()
returns jsonb
language plpgsql
stable
security definer
set search_path = public, cron
as $function$
declare
  v_result jsonb;
begin
  if session_user <> 'postgres'
     and coalesce(auth.role(), '') <> 'service_role'
     and not coalesce(public.apex_is_admin(), false) then
    raise exception 'Admin role required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'measured_at', now(),
    'outbox', jsonb_build_object(
      'claimable', (
        select count(*) from public.outbox_events oe
        where (oe.status in ('pending', 'failed')
          or (oe.status = 'processing' and oe.locked_at < now() - interval '10 minutes'))
          and oe.available_at <= now() and oe.attempts < 5
      ),
      'oldest_claimable_at', (
        select min(oe.created_at) from public.outbox_events oe
        where (oe.status in ('pending', 'failed')
          or (oe.status = 'processing' and oe.locked_at < now() - interval '10 minutes'))
          and oe.available_at <= now() and oe.attempts < 5
      ),
      'dead_letter', (select count(*) from public.outbox_events where status = 'dead_letter'),
      'duplicate_idempotency_keys', (
        select count(*) from (
          select idempotency_key from public.outbox_events
          group by idempotency_key having count(*) > 1
        ) duplicates
      )
    ),
    'dispatcher_24h', jsonb_build_object(
      'cron_checks', (
        select count(*) from cron.job_run_details d
        where d.jobid = (select jobid from cron.job where jobname = 'apex-outbox-dispatcher' limit 1)
          and d.start_time > now() - interval '24 hours'
      ),
      'edge_launches', (
        select count(*) from public.automation_run_log
        where job_name = 'apex-outbox-dispatcher'
          and triggered_at > now() - interval '24 hours'
      ),
      'last_edge_launch_at', (
        select max(triggered_at) from public.automation_run_log
        where job_name = 'apex-outbox-dispatcher'
      ),
      'cron_uses_pending_gate', coalesce((
        select command like '%run_apex_outbox_dispatch_if_pending%'
        from cron.job where jobname = 'apex-outbox-dispatcher' limit 1
      ), false)
    ),
    'email_queues', jsonb_build_object(
      'current_outreach_pending', (
        select count(*) from public.outreach_queue
        where status = 'pending' and scheduled_for <= now()
      ),
      'quarantined_stale_reissue', (
        select count(*) from public.outreach_queue
        where status = 'skipped'
          and (error_message = 'quarantined_stale_reissue_2026_09_04'
            or last_error = 'quarantined_stale_reissue_2026_09_04')
      ),
      'agent_onboarding_due_retryable', (
        select count(*) from public.agent_onboarding_queue
        where sent_at is null and attempt_count < 5 and target_send_at <= now()
      ),
      'applicant_login_queued', (
        select count(*) from public.applicant_login_queue where status = 'queued'
      )
    ),
    'analytics_24h', (
      select jsonb_build_object(
        'total_rows', count(*),
        'web_vital_inp_rows', count(*) filter (where event_name = 'web_vital.INP'),
        'web_vital_sessions', count(distinct session_id) filter (where event_name like 'web_vital.%')
      )
      from public.analytics_events
      where created_at > now() - interval '24 hours'
    ),
    'cron_startup_failures_24h', (
      select count(*) from cron.job_run_details
      where start_time > now() - interval '24 hours'
        and status = 'failed' and return_message = 'job startup timeout'
    )
  ) into v_result;

  return v_result;
end
$function$;

revoke all on function public.supabase_usage_drain_health() from public, anon;
grant execute on function public.supabase_usage_drain_health() to authenticated, service_role;

comment on function public.run_apex_outbox_dispatch_if_pending() is
  'One-minute outbox preflight: invokes the Edge dispatcher only when a row is currently claimable.';
comment on function public.supabase_usage_drain_health() is
  'Admin/service-role/operator PII-free rollup for outbox suppression, email queue state, analytics volume, and cron startup pressure.';
