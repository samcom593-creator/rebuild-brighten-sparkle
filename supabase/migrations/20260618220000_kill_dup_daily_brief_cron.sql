-- 2026-06-18 — kill the duplicate daily-brief cron
--
-- Sam had TWO cron jobs both hitting the same daily-brief edge function:
--   apex-daily-brief-7am-cst — 13:00 UTC (CDT shifted to 8 AM — wrong for summer)
--   apex-daily-brief-7am-ct  — 12:00 UTC (7 AM CDT — correct)
--
-- He was getting 2 daily briefs every morning, ~1 hr apart. The -cst entry
-- was the pre-DST naming; the -ct one is the canonical correct-for-DST
-- version that runs at the actual Chicago morning time.
--
-- Killed -cst via cron.unschedule('apex-daily-brief-7am-cst') live; this
-- file is the audit trail.
--
-- rollback: re-schedule via cron.schedule(...) using the original command.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'apex-daily-brief-7am-cst') THEN
    PERFORM cron.unschedule('apex-daily-brief-7am-cst');
  END IF;
END $$;
