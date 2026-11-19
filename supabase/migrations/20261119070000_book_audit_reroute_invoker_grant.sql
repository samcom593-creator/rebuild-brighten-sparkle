-- MP-FIX-BOOK-403 — every Book of Business load 403'd: "permission denied for view
-- v_carrier_reroute_plan". v_book_audit_items (security_invoker) joins
-- v_carrier_reroute_plan, which was security-DEFINER and granted only to
-- service_role, so the authenticated caller could not read the nested view.
-- Flip the nested view to security_invoker so agentlink_book's RLS scopes it
-- (admin sees all, agent sees own) and grant SELECT to authenticated. This REMOVES
-- a definer bypass rather than adding one: no data leak, RLS now applies.
alter view public.v_carrier_reroute_plan set (security_invoker = true);
grant select on public.v_carrier_reroute_plan to authenticated;
