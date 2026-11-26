-- 20261126034500_lead_pool_refresh_timeout.sql
-- MP-LEAD-POOL-REVIVE (2): the revived snapshot job died again on its first run.
-- cron.job_run_details for the kick job: start 02:10:00.44Z, end 02:12:00.82Z, "canceling statement due to
-- statement timeout" inside `refresh materialized view concurrently` — a 120s ceiling that no role setting
-- declares (postgres rolconfig carries only search_path), while the last good run on 2026-11-24 took 92,377 ms
-- on the same data. A session-level SET in the job command outranks every default the connection inherits.
-- Applied live via execute_sql + hand-recorded (version 20261126034500) before this file was pushed; both
-- statements are idempotent (alter_job just rewrites the command).
select cron.alter_job((select jobid from cron.job where jobname = 'apex-lead-pool-snapshot'),
  command := $cmd$set statement_timeout = '30min'; select public.refresh_lead_pool_snapshot();$cmd$);

do $do$
declare kick int;
begin
  select jobid into kick from cron.job where jobname = 'apex-lead-pool-snapshot-kick';
  if kick is not null then
    perform cron.alter_job(kick,
      command := $cmd$set statement_timeout = '30min'; select public.refresh_lead_pool_snapshot(); select cron.unschedule('apex-lead-pool-snapshot-kick');$cmd$);
  end if;
end $do$;
