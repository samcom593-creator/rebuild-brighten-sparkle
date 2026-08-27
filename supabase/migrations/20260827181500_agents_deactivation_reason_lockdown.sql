-- MP-329: close the last sensitive column MP-328 left readable on agents.
--
-- MP-328 (20260827150000) revoked 17 sensitive columns from authenticated/anon
-- and repointed admin surfaces at the staff-gated v_agents_full. It missed one:
-- deactivation_reason, which carries free-text like 'bad_business' on named,
-- terminated people and was still SELECTable by every authenticated account
-- agent-to-agent. Measured live: of all sensitive columns, this was the only
-- one still readable.
--
-- Fix is a single column REVOKE (idempotent — safe to re-run, so it cannot break
-- the deploy pipeline the way a bare CREATE POLICY can). Admins keep reading it
-- through v_agents_full, which already carries the column and is gated on
-- is_agency_staff(); DashboardCRM reads it there, not from the base table, so no
-- frontend repoint is required. Verified both directions: authenticated has 0
-- SELECT grant on the column after this; v_agents_full still exposes it.

revoke select (deactivation_reason) on public.agents from authenticated, anon;
