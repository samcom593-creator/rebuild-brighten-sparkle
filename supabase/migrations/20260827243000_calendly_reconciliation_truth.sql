-- Calendly capture health must distinguish "no new bookings" from "the
-- reconciler did not run." The old watchdog used the newest booking's
-- created_at, so a healthy quiet period produced the same red state as a dead
-- integration. Persist every poll receipt and drive health from the last
-- successful reconciliation instead.

create table if not exists public.calendly_reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null,
  finished_at timestamptz not null,
  status text not null check (status in ('ok', 'failed')),
  records_seen integer not null default 0 check (records_seen >= 0),
  records_upserted integer not null default 0 check (records_upserted >= 0),
  records_failed integer not null default 0 check (records_failed >= 0),
  error_redacted text,
  created_at timestamptz not null default now()
);

create index if not exists calendly_reconciliation_runs_finished_idx
  on public.calendly_reconciliation_runs (finished_at desc);

alter table public.calendly_reconciliation_runs enable row level security;
revoke all on public.calendly_reconciliation_runs from public, anon, authenticated;
grant select, insert on public.calendly_reconciliation_runs to service_role;

comment on table public.calendly_reconciliation_runs is
  'Provider-level receipts for every Calendly reconciliation. A successful run with zero new bookings is healthy and must not be reported as a capture outage.';

create or replace view public.v_interview_capture_reconciliation as
with windows as (
  select
    count(*) filter (where created_at > now() - interval '24 hours') as captured_24h,
    count(*) filter (where created_at > now() - interval '7 days') as captured_7d,
    count(*) filter (where created_at > now() - interval '28 days') as captured_28d,
    max(created_at) as last_capture_at
  from public.interview_events
  where source = 'calendly'
), reconciliation as (
  select max(finished_at) filter (where status = 'ok') as last_success_at
  from public.calendly_reconciliation_runs
)
select
  w.captured_24h,
  w.captured_7d,
  w.captured_28d,
  w.last_capture_at,
  round(w.captured_28d / 28.0, 2) as avg_per_day_28d,
  extract(epoch from (now() - w.last_capture_at)) / 3600.0 as hours_since_last_capture,
  (r.last_success_at is null or now() - r.last_success_at > interval '8 hours') as capture_stalled,
  (select count(*) from public.interview_events
    where outcome is null and canceled_at is null and scheduled_at < now()) as undispositioned_backlog,
  (select count(*) from public.v_interview_conflicts
    where is_hard_block and scheduled_at > now()) as future_hard_conflicts,
  r.last_success_at as last_reconciliation_at,
  extract(epoch from (now() - r.last_success_at)) / 3600.0 as reconciliation_hours_ago
from windows w
cross join reconciliation r;

comment on view public.v_interview_capture_reconciliation is
  'Calendly health truth. capture_stalled means no successful provider reconciliation for 8 hours; a quiet booking period alone is never called an outage.';

-- The original cron read an unset app.settings.service_role_key and emitted an
-- invalid JWT. Use the same vaulted bot credential as the other live workers.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'mp264-calendly-reconcile') then
    perform cron.unschedule('mp264-calendly-reconcile');
  end if;
  perform cron.schedule(
    'mp264-calendly-reconcile',
    '17 */6 * * *',
    $job$
      select net.http_post(
        url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/calendly-backfill',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'apex_bot_token' limit 1)
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 30000
      );
    $job$
  );
end
$$;

