-- MP-PERF-OPS follow-up: bound the pre-warm compute. apex_admin_operations_snapshot_compute
-- is normally 1-3.5s but spiked to a 2-minute cron run once under load. A background
-- warmer must never run away, so cap each run at 30s: a pathological compute aborts and
-- the previous (still-recent) cache value is kept, instead of holding a connection for
-- two minutes. 30s is ~8x the normal worst case, so a healthy run is never cut off.
alter function public.apex_ops_snapshot_prewarm() set statement_timeout = '30s';
