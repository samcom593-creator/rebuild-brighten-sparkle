-- ANCHOR 2026-11-11: mirror of a live change made at ~21:06Z.
-- Cron 108 'apex-followup-emails-daily' (send-followup-emails) was unscheduled live
-- (0 clicks on 23 delivered in 30 days, hype/income copy, collided with the lane
-- ladder on days 1, 3 and 7). The two recruit_sequences rows that pointed at it are
-- retired so doctor #45 does not grade an 'active' sequence with no sends as CRITICAL.
-- Idempotent: the cron step is a no-op when the job is already gone, the update only
-- touches rows that are still active. Rollback + pre-image:
-- business-ops/2026-11-11-onboarding-anchor/receipts/preimage-cron108.txt
do $$
begin
  if exists (select 1 from cron.job where jobname = 'apex-followup-emails-daily') then
    perform cron.unschedule('apex-followup-emails-daily');
  end if;
end $$;

update public.recruit_sequences
   set status = 'retired',
       notes = coalesce(notes, '') || ' | RETIRED 2026-11-11 by ANCHOR: cron 108 apex-followup-emails-daily unscheduled; the lane ladder (hour 24/72/168) is the one applicant drip.'
 where key in ('applicant_nudge', 'applicant_followup')
   and status = 'active';
