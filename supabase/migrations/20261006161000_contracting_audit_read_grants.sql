-- The contracting audit chain never worked for a signed-in user: v_contracting_audit (security_invoker)
-- reads v_contracting_reconciliation, agentlink_roster and (now) v_ethos_roster_current -> ethos_roster,
-- and none of those carried a SELECT grant for authenticated (created by a role without Supabase's
-- default privileges). Measured as the owner: "permission denied for view v_contracting_reconciliation".
-- Safe to grant: both rosters enforce admin/manager RLS policies; the view is security_invoker.
begin;
grant select on public.v_contracting_reconciliation to authenticated;
grant select on public.agentlink_roster to authenticated;
grant select on public.ethos_roster to authenticated;
commit;
