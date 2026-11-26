-- 20261126030548_lead_pool_refresh_hourly.sql (version as recorded by the MCP apply on 2026-11-26 03:05Z)
-- MP-DB-HANG: after the 2026-11-26 ~02:45Z host freeze on the Micro (1 GB) instance, the pool snapshot rebuild
-- runs once an hour (it took 680 s and 350 s that day vs 92 s on 11-24) with its own 30-minute statement
-- timeout (Supabase's platform default is 120 s and pg_cron sessions inherit it). The Leads console's stale
-- threshold is 60 min; :17 avoids the :07/:37 crowd. Idempotent: alter_job only rewrites the row.
select cron.alter_job((select jobid from cron.job where jobname = 'apex-lead-pool-snapshot'),
  schedule := '17 * * * *',
  command := $cmd$set statement_timeout = '30min'; select public.refresh_lead_pool_snapshot();$cmd$,
  active := true);
