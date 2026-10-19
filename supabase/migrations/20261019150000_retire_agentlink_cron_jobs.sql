-- Pause the two pg_cron jobs that still poll the retired AgentLink platform (2026-10-19, PL-WIB-AGENTLINK-JOBS-RETIRED)
--
-- 31ed6f4a retired the External cron backup's agentlink-cookie-sync leg: AgentLink stopped delivering deals, the
-- session cookie died after the last ok sync on 2026-10-15, and the only remedy was harvesting a cookie for a
-- platform Sam has stopped using. Two pg_cron jobs read that same dead cookie and were left running:
--
-- MEASURED BEFORE ACTING (2026-10-19 ~14:40Z, live):
--   * apex-agentlink-clients-sync-30m (every 30 min) posts agentlink-clients-sync, which reads
--     system_settings.agent_link_session_cookie. agentlink_clients_sync_log: last status='ok' at 2026-10-15T18:14Z,
--     then 259 'auth_failed'. Every response in net._http_response's window is 502 {"ok":false,"error":"upstream
--     auth 401"}. agentlink_clients last bulk write was 874 rows at 2026-10-15 18:00Z; the one later row (10-17 00:09Z)
--     is a manual edit. This job is what holds apex-doctor Check #77 CRITICAL ("failed EVERY fire", 12/12) with no
--     remedy anyone can perform.
--   * apex-agentlink-watchdog-1m (every minute) grades agentlink_sync_log freshness. The sync it watches was retired
--     in 31ed6f4a, so the book can never be fresh again: one episode open since 2026-10-15T20:32Z, 5,569 unresolved
--     agentlink_alerts rows (~1,490/day), already paged once (de-storm holds it to one page per episode). /admin/setup
--     shows the open count as "Open alerts" and goes warn above 5, so that tile was permanently yellow.
--
-- Refused the loud version: no money moved, no deal was lost, and nothing pages Sam hourly. The clients mirror froze on
-- 10-15 when the cookie died, not here; pausing changes no data. This retires two jobs whose output is noise.
--
-- WHAT THIS DOES (idempotent):
--   1. pauses both jobs by name (cron.alter_job active := false). Job ids differ between environments; names do not.
--   2. closes the open watchdog episode the way the watchdog's own healthy branch does (resolved_at = now()). This is
--      needed for re-enable, not cosmetics: fn_agentlink_alert_page refuses to page while an unresolved row has
--      notified = true, so leaving the episode open would keep a re-armed watchdog silent through a real outage.
--      The 5,569 rows are not deleted here. fn_prune_agentlink_alerts removes resolved rows 30 days after raised_at
--      (existing policy). Pre-image: business-ops/website-integrity-bot/snapshots/wib101/.
--
-- Left running on purpose: agentlink_reap_stuck_5min (no-op with no syncs, writes nothing) and
-- apex-prune-agentlink-alerts (drains the history above on its existing 30-day policy).
--
-- REVERT (after a fresh cookie is harvested into system_settings.agent_link_session_cookie):
--   select cron.alter_job(jobid, active := true) from cron.job
--    where jobname in ('apex-agentlink-clients-sync-30m', 'apex-agentlink-watchdog-1m');

begin;

select cron.alter_job(j.jobid, active := false)
  from cron.job j
 where j.jobname in ('apex-agentlink-clients-sync-30m', 'apex-agentlink-watchdog-1m')
   and j.active;

update public.agentlink_alerts
   set resolved_at = now()
 where resolved_at is null;

do $$
declare
  n_active int;
  n_open int;
begin
  select count(*) into n_active from cron.job
   where jobname in ('apex-agentlink-clients-sync-30m', 'apex-agentlink-watchdog-1m') and active;
  select count(*) into n_open from public.agentlink_alerts where resolved_at is null;
  if n_active <> 0 then
    raise exception 'retire_agentlink_cron_jobs: % job(s) still active', n_active;
  end if;
  if n_open <> 0 then
    raise exception 'retire_agentlink_cron_jobs: % alert(s) still open', n_open;
  end if;
end $$;

commit;
