-- 20260907235000_unschedule_apex_ai_nudge.sql
-- Sam, 2026-09-07: "any automations that we don't know or need — remove."
-- cron 58 'apex-ai-nudge-30m' fired every 30 minutes at an edge function
-- (apex-ai-nudge) that has NO source in this repository — deployed remotely
-- only — and whose served bundle sends applicant emails through Resend on a
-- day0/3/7/14 ladder. That overlaps the send-followup-emails drip re-armed
-- on 2026-09-06 (day 3 / day 7), so applicants were on two drips, one of
-- them unreviewable. Unscheduled (reversible: cron.schedule it again); the
-- function itself is left deployed and its bundle is archived in the ledger.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='apex-ai-nudge-30m') THEN
    PERFORM cron.unschedule('apex-ai-nudge-30m');
  END IF;
END $$;
