-- MP-SITE-SPEED (2026-11-27): six "server restarted" pg_cron failures in five
-- days (11-23 04:42Z, 11-24 01:07Z, 11-26 04:17Z, 11-26 09:17Z, 11-26 17:17Z,
-- 11-27 12:17Z); five of them land on the :17 minute, which is the hourly
-- apex-lead-pool-snapshot run, and the postgres log shows "database system was
-- not properly shut down" with NO backend OOM line, i.e. the whole 1 GB Micro
-- instance was killed from outside. refresh_lead_pool_snapshot() ran with
-- work_mem=64MB: the mat_lead_pool defining query has four UNION branches with
-- merge joins and sorts plus a row_number() sort over ~447k wide rows, and the
-- CONCURRENTLY refresh adds a full-outer-join diff on top, so several 64 MB
-- allocations sit live at once next to shared_buffers=256MB. Halve the per-node
-- budget so the refresh spills to disk instead of taking the box down; slower
-- is acceptable, a crash drops every connection and empties the cache.
-- maintenance_work_mem is not used by CONCURRENTLY refreshes; set back to the
-- server default so it cannot be mistaken for a lever.
--
-- Applied live via MCP apply_migration at 2026-11-27 15:41:09Z (this version
-- number is the one the platform recorded); this file is the repo's record.
alter function public.refresh_lead_pool_snapshot() set work_mem = '32MB';
alter function public.refresh_lead_pool_snapshot() reset maintenance_work_mem;
