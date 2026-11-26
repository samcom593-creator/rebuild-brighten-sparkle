-- 20261126033000_lead_pool_snapshot_revive.sql
-- MP-LEAD-POOL-REVIVE (2026-11-25, Sam: "lead manager not working and pos leads from the dialer not there").
--
-- Measured: cron job apex-lead-pool-snapshot (jobid 149, '7,37 * * * *') had active=false since its 2026-11-24
-- 01:07Z run failed with "server restarted"; lead_pool_snapshot_meta.refreshed_at froze at 2026-11-24 01:01Z, so
-- every positive dialer disposition since then (Completed Sale, Appointments) never entered mat_lead_pool / tier
-- 'pos'. Separately, lead_pool_counts('dialer', '{}') walked mat_lead_pool_phone10 over all 446,566 rows and
-- filtered source='dialer' afterwards (195,779 rows removed by filter, 431K shared buffers, 7.7s measured) -> the
-- signed-in call hit the 8s API statement timeout and the Leads console rendered POST /rpc/lead_pool_counts 500
-- (27 times between 01:58Z and 02:04Z on 2026-11-26).
--
-- 1. The merge join wants phone10 order per source: give it an index that is already filtered by source.
--    mat_lead_pool is refreshed CONCURRENTLY (unique index mat_lead_pool_rid), so indexes survive refreshes.
create index if not exists mat_lead_pool_source_phone10 on public.mat_lead_pool using btree (source, phone10);

-- 2. Re-arm the snapshot refresh (the schedule itself is unchanged: 7,37 past the hour).
select cron.alter_job((select jobid from cron.job where jobname = 'apex-lead-pool-snapshot'), active := true);

-- 3. One immediate refresh so the pool catches up now, not at the next :07/:37. The kick job removes itself.
do $do$
begin
  if not exists (select 1 from cron.job where jobname = 'apex-lead-pool-snapshot-kick') then
    perform cron.schedule('apex-lead-pool-snapshot-kick', '* * * * *',
      $cmd$select public.refresh_lead_pool_snapshot(); select cron.unschedule('apex-lead-pool-snapshot-kick');$cmd$);
  end if;
end $do$;
