-- The production book is Sam's and Aisha's (book_readers); agents see their own rows and
-- managers their downline.
--
-- 1. VAs and VA managers read every outside-agency deal: production_external_deals_scope_read
--    OR'd in crm_can_read_agent_scope(), which grants va / va_manager every agent's CRM scope.
--    apex_can_read_agent() alone already covers admin, the caller's own agents and their
--    downline. crm_can_read_agent_scope() itself is unchanged: it governs the CRM tables VAs
--    work every day.
drop policy if exists production_external_deals_scope_read on public.production_external_deals;
create policy production_external_deals_scope_read on public.production_external_deals
  for select to authenticated
  using (public.apex_can_read_agent(agent_id));

-- 2. Book readers saw only part of two client-level book tables (Aisha: 130 of 1,384 snapshot
--    rows, 14 of 89 carrier policies), so Book of Business and the command views disagreed
--    with the rest of her full-book pages.
drop policy if exists agentlink_deals_snapshot_book_readers_read on public.agentlink_deals_snapshot;
create policy agentlink_deals_snapshot_book_readers_read on public.agentlink_deals_snapshot
  for select to authenticated
  using ((select public.api_is_full_reader()));

drop policy if exists carrier_policies_book_readers_read on public.carrier_policies;
create policy carrier_policies_book_readers_read on public.carrier_policies
  for select to authenticated
  using ((select public.api_is_full_reader()));
