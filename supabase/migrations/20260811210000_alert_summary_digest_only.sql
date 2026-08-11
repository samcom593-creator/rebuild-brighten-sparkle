-- Stop counting digest-only alerts as undelivered.
--
-- With the dispatcher restored (f15029be) apex-doctor Check #18 dropped from
-- CRITICAL to a WARN — and the WARN is wrong:
--
--   "alert backlog: 2 of 2780 alerts undelivered (oldest 1.0d) despite the
--    flush cron being scheduled — confirm apex-alert-dispatch is actually
--    running"
--
-- The cron IS running (jobid 76, verified firing at 18:15:00Z, status
-- succeeded). Both remaining rows are severity='warn', and the dispatcher
-- deliberately never sends warn standalone — apex-alert-dispatch's own header
-- says so: "warn -> NEVER sent standalone. Rolled into the 7am morning digest."
-- STANDALONE is exactly {critical, celebrate}.
--
-- So the check counts rows that are behaving precisely as designed and asks a
-- human to go confirm a healthy daemon. Left alone it is yellow forever, and a
-- check that is always yellow gets read as decoration — the same failure the
-- cron gate wore four costumes of this week, just a quieter one.
--
-- queued_never_dispatched now means "waiting on a dispatcher that should have
-- taken it". Digest-only severities get their own counter. Neither is hidden.

create or replace view public.v_bot_alert_delivery_summary as
 SELECT count(*) AS alerts_total,
    -- Only severities the flush actually claims. warn/info are digest-only.
    count(*) FILTER (
      WHERE delivery_state = 'queued_never_dispatched'::text
        AND severity = ANY (ARRAY['critical'::text, 'celebrate'::text])
    ) AS queued_never_dispatched,
    count(*) FILTER (WHERE delivery_state = 'delivered_email_receipt'::text) AS delivered_with_real_receipt,
    count(*) FILTER (WHERE delivery_state = 'delivered_unprovable'::text) AS delivered_unprovable,
    count(*) FILTER (WHERE sms_receipt_is_literal) AS sms_receipts_that_are_literals,
    max(age_days) FILTER (
      WHERE delivery_state = 'queued_never_dispatched'::text
        AND severity = ANY (ARRAY['critical'::text, 'celebrate'::text])
    ) AS oldest_queued_days,
    ( SELECT count(*) AS count
           FROM cron.job
          WHERE job.jobname = 'apex-alert-dispatch-flush'::text) AS flush_cron_scheduled,
    -- Appended: `create or replace view` cannot insert columns mid-list.
    count(*) FILTER (
      WHERE delivery_state = 'queued_never_dispatched'::text
        AND severity <> ALL (ARRAY['critical'::text, 'celebrate'::text])
    ) AS queued_for_digest,
    count(*) FILTER (WHERE delivery_state = 'expired_undelivered'::text) AS expired_undelivered
   FROM v_bot_alert_delivery_truth;

comment on view public.v_bot_alert_delivery_summary is
  'Alert delivery rollup. queued_never_dispatched counts ONLY severities the flush claims (critical, celebrate) — warn/info are digest-only by design and are counted separately as queued_for_digest, not as a backlog. expired_undelivered is its own terminal state and never implies delivery.';

grant select on public.v_bot_alert_delivery_summary to authenticated;
