-- MP-341 — give license_milestone_outbox a consumer. The trigger that fills it
-- (trg_license_milestone_emit) never worked before 2026-08-27 (uncast enum), and
-- once fixed it queued SMS rows that nothing sent. Every 10 minutes the edge fn
-- license-milestone-sms-drain sends pending rows through send-sms-auto-detect and
-- records the gateway's own outcome (sent / skipped_no_carrier / failed after 3).
select cron.unschedule(jobid) from cron.job where jobname = 'license-milestone-sms-drain';
select cron.schedule(
  'license-milestone-sms-drain',
  '*/10 * * * *',
  $$select public.run_automation_job('license-milestone-sms-drain', 'license-milestone-sms-drain', '{}'::jsonb);$$
);
