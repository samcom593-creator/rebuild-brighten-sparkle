-- 20261126030616_lead_pool_refresh_work_mem.sql (version as recorded by the MCP apply on 2026-11-26 03:06Z)
-- MP-DB-HANG: pg_stat_database showed 894 temp files / 7.36 GB spilled since 2026-11-25 06:56Z on a 1 GB Micro
-- with work_mem = 3500 kB; the 446K-row concurrent refresh sorts and diffs spill to disk and that IO is what the
-- host could not absorb. Function-local settings apply only inside the refresh session (one at a time).
alter function public.refresh_lead_pool_snapshot() set work_mem = '64MB';
alter function public.refresh_lead_pool_snapshot() set maintenance_work_mem = '128MB';
