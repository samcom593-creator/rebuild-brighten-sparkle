-- MP-264 — reconciliation cron + capture-stall alarm
-- 2026-07-24
--
-- The 105-booking loss was invisible for six weeks because nothing ever
-- compared what Calendly held against what we stored. Two jobs close that:
--   1. calendly-backfill every 6h — reconciles and self-heals any miss.
--   2. a capture-stall alarm — fires when an established booking rate goes
--      >48h silent, which is the signal the original outage never produced.

select cron.unschedule('mp264-calendly-reconcile')
 where exists (select 1 from cron.job where jobname = 'mp264-calendly-reconcile');

select cron.schedule(
  'mp264-calendly-reconcile',
  '17 */6 * * *',   -- :17 past, every 6h — off the top of the hour so it does
                    -- not queue behind the pile of on-the-hour jobs
  $$
  select net.http_post(
    url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/calendly-backfill',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Capture-stall alarm. Deliberately reads the reconciliation view rather than
-- counting rows directly, so "stalled" always means "quiet against our own
-- trailing rate" and never "quiet because business is quiet".
create or replace function public.mp264_capture_stall_check()
returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  v record;
  v_msg text;
begin
  select * into v from public.v_interview_capture_reconciliation;

  if v.capture_stalled then
    v_msg := format(
      'APEX: Calendly capture STALLED — %s h since last booking captured (28d avg %s/day). Backlog %s. Check calendly-webhook + calendly-backfill.',
      round(v.hours_since_last_capture)::text,
      v.avg_per_day_28d::text,
      v.undispositioned_backlog::text
    );

    perform net.http_post(
      url := 'https://ntfy.sh/sams-agent-yrkv9kbqp9e987nb',
      headers := jsonb_build_object(
        'Content-Type', 'text/plain',
        'Title', 'APEX capture stalled',
        'Priority', 'high',
        'Tags', 'rotating_light'
      ),
      body := to_jsonb(v_msg)
    );
  end if;

  return jsonb_build_object(
    'stalled', v.capture_stalled,
    'hours_since_last_capture', round(v.hours_since_last_capture),
    'backlog', v.undispositioned_backlog,
    'future_hard_conflicts', v.future_hard_conflicts
  );
end $$;

select cron.unschedule('mp264-capture-stall-check')
 where exists (select 1 from cron.job where jobname = 'mp264-capture-stall-check');

-- 14:00 UTC = 9am Chicago (CDT). Sam sees it with the morning stack.
select cron.schedule('mp264-capture-stall-check', '0 14 * * *',
                     $$select public.mp264_capture_stall_check()$$);
