-- 20260906160000_schedule_followup_emails_daily.sql
-- send-followup-emails (the 3-template applicant drip incl. the licensed
-- "Did We Get to You Yet?") had NO invoker: not on pg_cron, not in GH Actions,
-- not called by any function. Last licensed follow-up fired 2026-04-27; 123 of
-- 136 licensed applicants never received it. Re-armed 2026-09-06 via bot-sql as
-- jobid 107; this mirrors it so `db push` reproduces it. SAFE to re-arm: the
-- function only targets applicants created 3-4 days ago (built-in window), so
-- no backlog burst. Idempotent: unschedule-if-exists then schedule.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='apex-followup-emails-daily') THEN
    PERFORM cron.unschedule('apex-followup-emails-daily');
  END IF;
  PERFORM cron.schedule('apex-followup-emails-daily','0 15 * * *', $j$
    SELECT net.http_post(
      url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/send-followup-emails',
      headers := jsonb_build_object('Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='apex_bot_token' LIMIT 1),'Content-Type','application/json'),
      body := '{}'::jsonb, timeout_milliseconds := 30000);
  $j$);
END $$;
