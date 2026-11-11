-- MP-ONBOARD-ANCHOR-PKG1 (2026-11-12) 4/9: one drip. Unschedule cron 108.
--
-- WHAT
--   cron.unschedule of 'apex-followup-emails-daily' (jobid 108, '0 15 * * *', POSTs
--   send-followup-emails with the vault apex_bot_token). The job's exact definition is
--   saved first in system_settings 'anchor_pkg1_cron108_backup' so the rollback is one
--   cron.schedule with the recorded schedule and command.
-- WHY
--   message_map_and_copy.md section 6 / DECISIONS.md "cron 108": 0 clicks on 23 delivered,
--   hype and income copy ("ready to start earning immediately"), a dead Reply-To, and it
--   collides with the next-step ladder on days 1, 3 and 7 (C2-C5). The ladder is the one
--   applicant sequence. send-followup-emails itself is owned by another session (6e) and is
--   not edited here; with no schedule nothing calls it.
-- IDEMPOTENT
--   Unschedules only when the job exists; the backup row is written once. ANCHOR already
--   unscheduled the job live on 2026-11-11 ~21:06Z (pre-image in business-ops
--   2026-11-11-onboarding-anchor/receipts/preimage-cron108.txt, recruit_sequences
--   applicant_nudge + applicant_followup retired in the same step and mirrored by the
--   integrator as 20261112000001_retire_followup_cron.sql). On that database this migration
--   only raises a notice and writes nothing.
-- ROLLBACK
--   select cron.schedule(b->>'jobname', b->>'schedule', b->>'command')
--     from (select value::jsonb b from public.system_settings where key = 'anchor_pkg1_cron108_backup') x;
--   As read live on 2026-11-11 that is:
--     select cron.schedule('apex-followup-emails-daily', '0 15 * * *', $$
--       SELECT net.http_post(
--         url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/send-followup-emails',
--         headers := jsonb_build_object('Authorization','Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='apex_bot_token' LIMIT 1),'Content-Type','application/json'),
--         body := '{}'::jsonb, timeout_milliseconds := 30000);
--     $$);

do $mig$
declare
  v_job record;
begin
  select j.jobid, j.jobname, j.schedule, j.command, j.active
    into v_job
    from cron.job j
   where j.jobname = 'apex-followup-emails-daily'
   order by j.jobid
   limit 1;
  if not found then
    raise notice 'PKG1: apex-followup-emails-daily is not scheduled; nothing to unschedule';
    return;
  end if;
  insert into public.system_settings (key, value, updated_at)
  values ('anchor_pkg1_cron108_backup',
          jsonb_build_object('jobid', v_job.jobid, 'jobname', v_job.jobname, 'schedule', v_job.schedule,
                             'command', v_job.command, 'active', v_job.active,
                             'unscheduled_at', now())::text,
          now())
  on conflict (key) do nothing;
  perform cron.unschedule(v_job.jobid);
  raise notice 'PKG1: unscheduled cron job % (%)', v_job.jobid, v_job.jobname;
end
$mig$;
