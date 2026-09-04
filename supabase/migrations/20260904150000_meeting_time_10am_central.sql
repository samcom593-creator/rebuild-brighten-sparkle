-- 20260904150000_meeting_time_10am_central.sql
--
-- The daily team meeting moved from 9:30 AM to 10:00 AM US/Central (Sam directive,
-- 2026-09-04). The onboarding email that delivers the Discord invite is timed to
-- land at meeting start, so its two pg_cron drain jobs move with it. Applied live
-- via bot-sql at change time; this migration mirrors that into the repo so a fresh
-- `db push` reproduces the state instead of reverting it. alter_job to the same
-- schedule is a no-op, so re-running is safe.
--
--   apex-agent-onboarding-emails-cdt : 9:30 CDT (14:30 UTC, '30 14') -> 10:00 CDT (15:00 UTC, '0 15')
--   apex-agent-onboarding-emails-cst : 9:30 CST (15:30 UTC, '30 15') -> 10:00 CST (16:00 UTC, '0 16')
--
-- The dual-job pattern keeps 10:00 wall-clock correct across DST: exactly one of
-- the two fires at 10:00 Central on any given day, the other an hour off; the
-- edge function's UNIQUE(agent_id, email_kind) + ON CONFLICT DO NOTHING makes the
-- second fire a no-op. Meeting COPY lives in the edge-function email templates
-- (notify-agent-live-field, notify-course-complete, notify-training-reminder,
-- send-agent-onboarding-email) and is changed in those files, not here.

DO $$
DECLARE
  v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'apex-agent-onboarding-emails-cdt';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.alter_job(v_jobid, schedule => '0 15 * * *');
    RAISE NOTICE 'apex-agent-onboarding-emails-cdt -> 0 15 * * * (10:00 CDT)';
  ELSE
    RAISE NOTICE 'apex-agent-onboarding-emails-cdt not found — nothing to alter';
  END IF;

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'apex-agent-onboarding-emails-cst';
  IF v_jobid IS NOT NULL THEN
    PERFORM cron.alter_job(v_jobid, schedule => '0 16 * * *');
    RAISE NOTICE 'apex-agent-onboarding-emails-cst -> 0 16 * * * (10:00 CST)';
  ELSE
    RAISE NOTICE 'apex-agent-onboarding-emails-cst not found — nothing to alter';
  END IF;
END $$;
