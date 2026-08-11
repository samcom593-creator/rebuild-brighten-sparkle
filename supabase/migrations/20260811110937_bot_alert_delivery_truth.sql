-- wave-alert-receipts 2026-08-11
-- The alert channel could not say what it had actually delivered.
--
-- Measured before writing this: 2,779 bot_alerts rows. sent_sms_id has NEVER
-- held a provider receipt in its life -- distinct values are the literal
-- 'sent' (314), the literal 'pg_net' (75), a bare phone number (6), null
-- (2,384). apex-alert-dispatch sets sent_sms=true purely because
-- supabase.functions.invoke() resolved, and invoke() returns {data,error} on a
-- non-2xx rather than throwing, so the catch never fires and a failed SMS is
-- recorded as 'sent'. Same disease as the 465 fake-success InsuraCloud rows.
--
-- Deliberately NOT counting `sent_at IS NOT NULL AND sent_email_id IS NULL` as
-- a failure: the dispatcher force-adds discord+ntfy to every alert regardless
-- of the row's channels array, and those two return booleans with no message
-- id, so that shape legitimately means "ntfy delivered it". Counting nulls in
-- a receipt column answers "how many rows lack an id", not "how many alerts
-- went undelivered". This view reports UNPROVABLE as its own state instead of
-- laundering it into either success or failure.
--
-- Applied live via bot-sql at 2026-08-11T11:09:37Z and verified against
-- pg_class + supabase_migrations.schema_migrations, not against the apply's
-- own ok:true. Live at cutover: 2,779 total / 1,533 never dispatched (55.2%,
-- oldest 105.7d) / 176 with a provable receipt (6.3%) / 1,070 unprovable /
-- 389 literal SMS receipts / flush cron absent.

create or replace view public.v_bot_alert_delivery_truth as
select
  a.id,
  a.event_type,
  a.severity,
  a.channels,
  a.created_at,
  a.sent_at,
  round(extract(epoch from (now() - a.created_at))/86400.0, 1) as age_days,

  case
    when a.sent_at is null then 'queued_never_dispatched'
    when a.sent_email_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-' then 'delivered_email_receipt'
    else 'delivered_unprovable'
  end as delivery_state,

  ('email' = any(a.channels))                                   as email_requested,
  (a.sent_email_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-')              as email_receipt_is_real,
  ('sms' = any(a.channels))                                     as sms_requested,
  -- every value this column has ever held is self-assigned, not a provider id
  (a.sent_sms_id is not null and a.sent_sms_id in ('sent','pg_net')) as sms_receipt_is_literal
from public.bot_alerts a;

comment on view public.v_bot_alert_delivery_truth is
  'wave-alert-receipts 2026-08-11: per-alert delivery truth. delivery_state is deliberately three-valued -- discord/ntfy return booleans with no message id, so "delivered_unprovable" is reported as its own state rather than being counted as either success or failure.';

create or replace view public.v_bot_alert_delivery_summary as
select
  count(*)                                                              as alerts_total,
  count(*) filter (where delivery_state = 'queued_never_dispatched')    as queued_never_dispatched,
  count(*) filter (where delivery_state = 'delivered_email_receipt')    as delivered_with_real_receipt,
  count(*) filter (where delivery_state = 'delivered_unprovable')       as delivered_unprovable,
  count(*) filter (where sms_receipt_is_literal)                        as sms_receipts_that_are_literals,
  max(age_days) filter (where delivery_state = 'queued_never_dispatched') as oldest_queued_days,
  -- the flush cron this depends on (apex-alert-dispatch-flush, scheduled by
  -- migration 20260420250000) is absent from cron.job as of 2026-08-11, so
  -- anything not POSTed directly by a trigger has no consumer at all
  (select count(*) from cron.job where jobname = 'apex-alert-dispatch-flush') as flush_cron_scheduled
from public.v_bot_alert_delivery_truth;

comment on view public.v_bot_alert_delivery_summary is
  'wave-alert-receipts 2026-08-11: one-row rollup for apex-doctor. flush_cron_scheduled = 0 means queued alerts have no consumer.';
