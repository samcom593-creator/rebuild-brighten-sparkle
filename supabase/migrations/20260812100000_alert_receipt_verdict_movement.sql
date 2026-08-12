-- wave-alert-receipt-verdict-movement (2026-08-12)
--
-- apex-doctor Check #18's last branch could never reach green.
--
-- It warns whenever `sms_receipts_that_are_literals` is non-zero. Measured
-- 2026-08-12 that is 389 rows, and the set is FROZEN: the newest literal marker
-- was written 2026-08-07T05:57:46Z, four days BEFORE the MP-273 fix that stopped
-- the writer, and 0 have been written since. The only way to drive the count to
-- zero is to backfill a receipt column with a value no gateway ever returned —
-- which is the 465-row InsuraCloud fake-success disease, and was deliberately
-- refused when MP-273 shipped.
--
-- So Check #18 was pinned yellow forever, and its `ok` line ("alert channel
-- clean") became unreachable code — on a channel that IS now clean: 0 queued,
-- flush cron restored behind a staleness guard, 1,533 rows correctly settled to
-- the terminal expired_undelivered state. Sixth costume of one disease in five
-- days: 36 false pages/day -> a gate that could not cry at all -> 39
-- true-but-misleading pages/day -> a permanent Stripe CRITICAL -> a permanent
-- outbox CRITICAL (16cd84e1, eight hours ago) -> this.
--
-- The regression case is already owned, and owned better, by Check #20:
-- v_alert_sms_truth.markerless_claims_since_fix counts ANY sent_sms_id that is
-- not a 'gateway:%' receipt since the fix instant, and escalates to CRITICAL.
-- Check #18's predicate is `sent_sms_id IN ('sent','pg_net')` — two hardcoded
-- spellings, which already MISS the 6 rows holding a bare phone number. The
-- branch that never stops warning also under-counts the disease it names.
--
-- This migration does three things:
--   1. Moves the fix instant into ONE function both views call, so the two
--      checks cannot drift apart the way curl and fn_agentlink_reap_stuck did.
--   2. Gives Check #18 a movement operand with Check #20's stronger predicate.
--   3. Leaves the historical 389 exposed, so the OK line can NAME the frozen set
--      rather than laundering it out of sight.

-- 1. Single source for the anchor. MP-273 (ed01a7de) deployed the gateway-receipt
--    writer at ~15:35Z; 15:00Z is the conservative instant already baked into
--    v_alert_sms_truth. Preserved byte-for-byte so no operand shifts underneath
--    an existing verdict — this refactor moves WHERE the constant lives, not what
--    it is.
create or replace function public.fn_alert_sms_fix_anchor()
returns timestamptz
language sql
immutable
as $$ select '2026-08-11 15:00:00+00'::timestamptz $$;

comment on function public.fn_alert_sms_fix_anchor() is
  'The MP-273 deploy instant, after which every SMS claim must carry a gateway: receipt. Read by BOTH v_alert_sms_truth (doctor Check #20) and v_bot_alert_delivery_summary (Check #18) so the two cannot disagree about when the fix landed.';

-- 2. Check #20's view, now reading the anchor instead of restating it, and
--    exposing it so a human reading one row can see what "since the fix" means.
create or replace view public.v_alert_sms_truth as
select
  (select count(*) from bot_alerts where sent_sms_id is not null) as claims_total,
  (select count(*) from bot_alerts where sent_sms_id like 'gateway:%') as claims_with_receipt,
  (select count(*) from bot_alerts where sent_sms_id is not null and sent_sms_id not like 'gateway:%') as claims_legacy_unprovable,
  (select max(created_at) from bot_alerts where sent_sms_id like 'gateway:%') as last_receipt_at,
  (select count(*) from bot_alerts
     where created_at > public.fn_alert_sms_fix_anchor()
       and sent_sms_id is not null
       and sent_sms_id not like 'gateway:%') as markerless_claims_since_fix,
  (select count(*) from profiles where phone = '4697676068' and carrier is not null) as carrier_rows,
  (select count(distinct lower(btrim(carrier))) from profiles where phone = '4697676068' and carrier is not null) as distinct_carriers,
  (select status from notification_log where recipient_phone = '4697676068' and channel = 'sms-auto' order by created_at desc limit 1) as last_sms_status,
  (select max(created_at) from notification_log where recipient_phone = '4697676068' and channel = 'sms-auto') as last_sms_attempt_at,
  case
    when (select count(distinct lower(btrim(carrier))) from profiles where phone = '4697676068' and carrier is not null) > 1 then 'carrier_conflict'
    when (select count(*) from profiles where phone = '4697676068' and carrier is not null) = 0 then 'no_carrier_on_file'
    else 'carrier_resolvable'
  end as verdict,
  public.fn_alert_sms_fix_anchor() as fix_anchor_at;

-- 3. Check #18's summary gains the movement operand. Same predicate as Check #20
--    (not like 'gateway:%'), not the two-literal test, so a third spelling of a
--    self-assigned receipt cannot slip past the branch that exists to catch it.
--    sms_receipts_that_are_literals is KEPT: the frozen historical count is real
--    and gets reported as context, never silently dropped.
create or replace view public.v_bot_alert_delivery_summary as
select
  count(*) as alerts_total,
  count(*) filter (where delivery_state = 'queued_never_dispatched' and severity = any (array['critical','celebrate'])) as queued_never_dispatched,
  count(*) filter (where delivery_state = 'delivered_email_receipt') as delivered_with_real_receipt,
  count(*) filter (where delivery_state = 'delivered_unprovable') as delivered_unprovable,
  count(*) filter (where sms_receipt_is_literal) as sms_receipts_that_are_literals,
  max(age_days) filter (where delivery_state = 'queued_never_dispatched' and severity = any (array['critical','celebrate'])) as oldest_queued_days,
  (select count(*) from cron.job where jobname = 'apex-alert-dispatch-flush') as flush_cron_scheduled,
  count(*) filter (where delivery_state = 'queued_never_dispatched' and severity <> all (array['critical','celebrate'])) as queued_for_digest,
  count(*) filter (where delivery_state = 'expired_undelivered') as expired_undelivered,
  -- Scalar subquery, not a filter(): v_bot_alert_delivery_truth exposes the
  -- boolean sms_receipt_is_literal but NOT sent_sms_id itself, and the literal
  -- boolean is the weaker two-spelling test this column exists to replace.
  (select count(*) from bot_alerts
     where created_at > public.fn_alert_sms_fix_anchor()
       and sent_sms_id is not null
       and sent_sms_id not like 'gateway:%') as sms_claims_markerless_since_fix,
  max(created_at) filter (where sms_receipt_is_literal) as newest_literal_at
from v_bot_alert_delivery_truth;

comment on view public.v_bot_alert_delivery_summary is
  'One row in every state for apex-doctor Check #18. sms_receipts_that_are_literals is an ALL-TIME frozen historical count (389 as of 2026-08-12, newest 2026-08-07) that will never reach zero because backfilling it would fabricate receipts; grade on sms_claims_markerless_since_fix instead, which is anchored to fn_alert_sms_fix_anchor() and shares Check #20 predicate.';
