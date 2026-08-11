-- MP-273: tell the truth about whether Sam's alert SMS channel can actually send.
--
-- What went wrong, in order:
--   1. profiles holds TWO rows for Sam's phone, both carrier='tmobile'. The lookup
--      in send-sms-auto-detect used .maybeSingle(), which for a GET returning >1 row
--      sets data=null AND an error. The caller destructured { data } only, so a
--      carrier that WAS on file read as "none" and the SMS was never attempted.
--   2. apex-alert-dispatch set sent_sms=true the moment the round trip finished and
--      wrote the literal string 'sent', so 5 of 5 alerts from 2026-07-31 to 08-07
--      recorded a delivery that never happened.
--   3. Underneath both: the function was DEAD at boot in production (WORKER_ERROR),
--      because esm.sh resolves transitive deps at request time and ws@8.21.3 began
--      throwing on import. The supabase-js version pin protected nothing below it.
--
-- Design rules taken from the Stripe-freshness wave:
--   * every column is a scalar subquery, so this view returns EXACTLY ONE ROW in
--     every state, including an empty bot_alerts. A view that can go blank can go
--     blank-green, and blank reads as healthy on every surface.
--   * the verdict is three-valued and describes only what is actually knowable.
--     A gateway that accepted a message is NOT proof the carrier delivered it, so
--     nothing here ever claims delivery.
--   * legacy markers are reported as their own state, never laundered into success.
--
-- SAM_PHONE is hardcoded here on purpose: apex-alert-dispatch hardcodes the same
-- constant, and this view exists to describe that exact path. If the dispatcher's
-- number changes, this must change with it.
create or replace view v_alert_sms_truth as
select
  -- Claim accounting ---------------------------------------------------------
  (select count(*) from bot_alerts where sent_sms_id is not null)                        as claims_total,
  (select count(*) from bot_alerts where sent_sms_id like 'gateway:%')                   as claims_with_receipt,
  (select count(*) from bot_alerts
     where sent_sms_id is not null and sent_sms_id not like 'gateway:%')                 as claims_legacy_unprovable,
  (select max(created_at) from bot_alerts where sent_sms_id like 'gateway:%')            as last_receipt_at,

  -- Regression ratchet: post-MP-273 every SMS claim carries a gateway receipt.
  -- Anchored to the deploy instant, NOT a rolling window. A rolling window would
  -- have started at 1 (the 2026-08-07 legacy 'sent' row) and gone quiet on its own
  -- three days later, which is a guard that is dirty when you install it and green
  -- for reasons unrelated to the fix. Since the cutoff, this must be 0 forever;
  -- non-zero means the literal-marker write came back.
  (select count(*) from bot_alerts
     where created_at > timestamptz '2026-08-11 15:00:00+00'
       and sent_sms_id is not null
       and sent_sms_id not like 'gateway:%')                                             as markerless_claims_since_fix,

  -- Can the path resolve a carrier at all? -----------------------------------
  (select count(*) from profiles
     where phone = '4697676068' and carrier is not null)                                 as carrier_rows,
  (select count(distinct lower(btrim(carrier))) from profiles
     where phone = '4697676068' and carrier is not null)                                 as distinct_carriers,

  -- What the SMS function itself last reported (diagnostic only, never votes) --
  (select status from notification_log
     where recipient_phone = '4697676068' and channel = 'sms-auto'
     order by created_at desc limit 1)                                                   as last_sms_status,
  (select max(created_at) from notification_log
     where recipient_phone = '4697676068' and channel = 'sms-auto')                      as last_sms_attempt_at,

  case
    when (select count(distinct lower(btrim(carrier))) from profiles
            where phone = '4697676068' and carrier is not null) > 1
      then 'carrier_conflict'
    when (select count(*) from profiles
            where phone = '4697676068' and carrier is not null) = 0
      then 'no_carrier_on_file'
    else 'carrier_resolvable'
  end                                                                                    as verdict;

comment on view v_alert_sms_truth is
  'MP-273. One row in every state. verdict describes whether the alert SMS path can '
  'resolve a carrier at all: carrier_resolvable / no_carrier_on_file / carrier_conflict. '
  'markerless_claims_since_fix must stay 0 -- non-zero means something reintroduced the '
  'literal sent_sms_id write that recorded 5 unsent alerts as delivered. A gateway '
  'receipt is acceptance by the carrier gateway, never proof of delivery.';
