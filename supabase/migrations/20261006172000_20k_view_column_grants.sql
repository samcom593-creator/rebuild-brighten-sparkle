-- 20261004205500 re-created v_agent_20k_target_leaderboard with DROP VIEW + CREATE VIEW. Dropping a view
-- drops its grants, and objects created through bot-sql get no default privileges, so every reader (the
-- Command Center pace widget and the agent profile drawer) has been refused with 403 since 2026-10-04.
-- Restore read for signed-in users on every column except email; agent emails stay closed (MP-329).
-- If this view is ever dropped and re-created again, re-apply these grants in the same migration.
revoke all on public.v_agent_20k_target_leaderboard from anon, authenticated;
grant select (agent_id, name, license_status, hired, deals_mtd, ap_mtd, deals_no_policy_mtd,
              ap_at_risk_mtd, ap_to_20k, projected_eom_ap, pace_verdict)
  on public.v_agent_20k_target_leaderboard to authenticated;
grant select on public.v_agent_20k_target_leaderboard to service_role;
