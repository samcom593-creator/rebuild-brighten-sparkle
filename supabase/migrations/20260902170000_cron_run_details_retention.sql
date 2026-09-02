-- MP-388 — cron.job_run_details retention.
--
-- MEASURED 2026-09-02: 528 MB, oldest row 2026-06-11, nothing has ever pruned
-- it (0 jobs reference the table). pg_cron's launcher writes this table
-- SYNCHRONOUSLY inside its scheduling loop (InsertJobRunDetail /
-- UpdateJobRunDetail via SPI); when the instance is IO-stalled those writes
-- are what push the tick past its 10s startDeadline and the whole tick is
-- dropped [job startup timeout]. The stall's driver is fixed in the front end
-- (useProductionRealtime coalescing, same wave); this keeps the launcher's
-- write target small so a future stall has less to push through.
--
-- 14 days: apex-doctor Check #46 reads 7d of history, MP-375's sampler less.
-- Batched (10k rows / call) and scheduled at 10:00Z = 03:00 Phoenix so the
-- prune itself cannot become the stall it is meant to soften.

create or replace function public.fn_prune_cron_run_details(p_keep interval default interval '14 days', p_batch int default 10000)
returns int
language plpgsql
security definer
set search_path = public, cron
as $$
declare
  v_deleted int := 0;
  v_round int;
begin
  loop
    with victims as (
      select runid from cron.job_run_details
      where coalesce(end_time, start_time) < now() - p_keep
      order by runid
      limit p_batch
    )
    delete from cron.job_run_details d using victims v where d.runid = v.runid;
    get diagnostics v_round = row_count;
    v_deleted := v_deleted + v_round;
    exit when v_round < p_batch or v_deleted >= 200000; -- cap one run at 200k rows
  end loop;
  return v_deleted;
end;
$$;

revoke all on function public.fn_prune_cron_run_details(interval, int) from public, anon, authenticated;

select cron.unschedule(jobid) from cron.job where jobname = 'apex-cron-run-details-prune';
select cron.schedule('apex-cron-run-details-prune', '0 10 * * *', $$select public.fn_prune_cron_run_details();$$);
