-- 20261006070000/090000 created these tables through bot-sql, and the role that ran them does not
-- carry Supabase's default privileges, so signed-in users had RLS policies but no SELECT grant:
-- /dashboard/contracting/ethos read ethos_sheet_snapshots -> 403 (seen by apex-see-page.mjs).
-- Grant SELECT only; RLS keeps rows to admins and contracting staff. Writes stay RPC/service-role only.
begin;
grant select on public.ethos_sheet_snapshots to authenticated;
grant select on public.ethos_sheet_rows to authenticated;
grant select on public.contracting_ethos_approvals to authenticated;
grant select on public.contracting_ethos_approval_log to authenticated;
grant select on public.onboarding_packet_versions to authenticated;
commit;
