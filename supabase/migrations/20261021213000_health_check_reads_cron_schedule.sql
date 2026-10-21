-- PL-WIB-HEALTH-SLOT (2026-10-21)
--
-- 20261021200000 stopped system-health-check from firing disabled crons and
-- turned the digest and churn crons back on. That exposed the second half of
-- the same defect: for a cron that IS on, the check still re-fired anything
-- whose last automation_runs row was more than 26h old. A fixed bar does not
-- know the schedule. apex-manager-daily-digest runs '0 13 * * 1-6', so
-- Saturday 13:00 + 26h = Sunday 15:00: the check would email all five managers
-- (cc info@kingofsales.net) a Sunday digest every week, a day the schedule
-- leaves out on purpose.
--
-- The check now re-fires only when the cron's most recent scheduled slot is
-- two hours old with no run at or after it (_shared/cron-schedule.ts). It has
-- to read the schedule and cron.timezone to know that. fn_cron_jobs_active
-- returns neither, and a function's OUT columns cannot change in place, so this
-- adds a sibling reader. fn_cron_jobs_active stays: the deployed check calls it
-- until the new function version lands in the same deploy.

create or replace function public.fn_cron_jobs_schedule(p_jobnames text[])
returns table(jobname text, active boolean, schedule text, timezone text)
language sql
stable
security definer
set search_path = pg_catalog, cron
as $$
  select j.jobname::text, j.active, j.schedule::text, current_setting('cron.timezone', true)
  from cron.job j
  where j.jobname = any(p_jobnames)
$$;

revoke all on function public.fn_cron_jobs_schedule(text[]) from public, anon, authenticated;
grant execute on function public.fn_cron_jobs_schedule(text[]) to service_role;

comment on function public.fn_cron_jobs_schedule(text[]) is
  'PL-WIB-HEALTH-SLOT: system-health-check re-fires a cron-on automation only when its last scheduled slot has no run. A disabled cron, an unparseable schedule or a non-UTC cron.timezone is never fired.';
