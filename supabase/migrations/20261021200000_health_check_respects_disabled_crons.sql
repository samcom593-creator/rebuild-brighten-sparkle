-- PL-WIB-HEALTH-NO-FIRE (2026-10-21)
--
-- system-health-check (every 15 min) POSTed an automation whenever its last
-- automation_runs row was more than 26h old. It never asked whether that
-- automation's cron was on, and all four crons it watched were active=false.
-- So the health check was their real schedule, firing each one about every
-- 26h:
--   apex-licensing-sequences   Sam left it off on 2026-10-14 to avoid
--                              double-messaging applicants. 127 sweeps since May.
--   send-numbers-reminder      retired on 2026-08-25 for numbers-reminder
--                              (one idempotent reminder a day). 84 runs.
--   apex-manager-daily-digest  off, reason not recorded. 132 runs.
--   apex-daily-churn-check     off, reason not recorded. 132 runs.
--
-- The function now fires only an automation whose cron is on, and needs to
-- read cron state to know. get_cron_jobs_with_status is admin-only (it checks
-- auth.uid(), which is NULL for the service role), so it cannot serve. This
-- adds a narrow service-role-only reader.

create or replace function public.fn_cron_jobs_active(p_jobnames text[])
returns table(jobname text, active boolean)
language sql
stable
security definer
set search_path = pg_catalog, cron
as $$
  select j.jobname::text, j.active
  from cron.job j
  where j.jobname = any(p_jobnames)
$$;

revoke all on function public.fn_cron_jobs_active(text[]) from public, anon, authenticated;
grant execute on function public.fn_cron_jobs_active(text[]) to service_role;

comment on function public.fn_cron_jobs_active(text[]) is
  'PL-WIB-HEALTH-NO-FIRE: system-health-check reads this before it auto-fires an automation. A disabled cron is never fired.';

-- The digest and the churn check have run about daily for five months only
-- because the health check fired them. Once it stops, their disabled crons
-- would end them without anyone deciding that. Turning the crons back on
-- keeps today's cadence on the schedule they were wired with
-- (20260517030000), and puts the schedule in charge instead of the health
-- check. To stop either one, disable its cron: the health check now honours
-- that. The licensing drip stays off (Sam's call), and send-numbers-reminder
-- has no cron at all.
select cron.alter_job(j.jobid, active := true)
from cron.job j
where j.jobname in ('apex-manager-daily-digest', 'apex-daily-churn-check')
  and not j.active;
