-- MP-518 (2026-09-11): prune cron.job_run_details nightly.
--
-- Measured during the 2026-09-11 outage post-mortem: cron.job_run_details held
-- 156,353 rows / 528 MB on a Micro compute (256 MB shared_buffers, 60
-- max_connections), oldest row 2026-08-28, and NO job in cron.job touched the
-- table (the MP-388 note said "prune nightly"; the job was never created).
-- 59 active cron jobs, two of them every minute, write ~2,900 rows/day into it.
-- A half-gigabyte, never-vacuumed history table on a 1 GB instance is real IO
-- pressure on the exact resource that wedged today.
--
-- Idempotent: unschedule any prior copy by name, then schedule. 03:30 UTC is
-- off-peak for a Phoenix agency. 7 days keeps apex-doctor's cron checks
-- (which read the last 24h-7d) fully served.
do $$
declare j record;
begin
  for j in select jobid from cron.job where jobname = 'apex-cron-run-details-prune-nightly' loop
    perform cron.unschedule(j.jobid);
  end loop;
end $$;

select cron.schedule(
  'apex-cron-run-details-prune-nightly',
  '30 3 * * *',
  $cmd$ delete from cron.job_run_details where end_time < now() - interval '7 days' $cmd$
);
