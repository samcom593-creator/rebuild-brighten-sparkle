-- PERF-LOAD-TIMES part 2 (2026-11-12). Found by the verification run of 20261112063000.
--
-- Fixing the us_area_codes 403 let v_book_of_business actually EXECUTE for the first time since
-- 11-10, and the next layer surfaced: as Sam, `select client_state from v_book_of_business
-- limit 40` exceeded 25s and book_state_summary() exceeded 30s, every time with the timeout
-- landing inside has_role(). The view resolves each client's state through client_leads
-- (106,572 rows, 57 MB), deals, agentlink_book, agentlink_clients and the booking packets, and
-- those tables' read policies call has_role(auth.uid(), ...) / can_view_sold_calls() ONCE PER
-- ROW. On client_leads that is two role checks per row across 106K rows. Supabase's advisor
-- flags the same shape on 396 policies (auth_rls_initplan); these are the ones on the Book of
-- Business read path.
--
-- Every rewrite wraps an expression that depends only on the CALLER (auth.uid(), a role
-- literal, or a zero-argument caller-scoped function), never on the row, in (select ...) so it
-- is evaluated once per statement as an InitPlan. Same expression, same arguments, same truth
-- value for every row, so the same rows pass. Row-dependent parts (assigned_va_id, agent_id
-- EXISTS) are untouched. WITH CHECK clauses are rewritten only where they already exist; a
-- policy whose WITH CHECK is NULL keeps it NULL (it keeps defaulting to USING).
-- Write-path-only policies (deals_*_insert/update) are out of scope and unchanged.

-- client_leads (106,572 rows): the big one.
alter policy client_leads_admin_all on public.client_leads
  using ((select public.has_role((select auth.uid()), 'admin'::public.app_role)))
  with check ((select public.has_role((select auth.uid()), 'admin'::public.app_role)));
alter policy client_leads_va_assigned on public.client_leads
  using (((select public.has_role((select auth.uid()), 'va'::public.app_role)) and (assigned_va_id = (select auth.uid()))));
alter policy client_leads_va_update_assigned on public.client_leads
  using (((select public.has_role((select auth.uid()), 'va'::public.app_role)) and (assigned_va_id = (select auth.uid()))))
  with check (((select public.has_role((select auth.uid()), 'va'::public.app_role)) and (assigned_va_id = (select auth.uid()))));

-- deals (with_check is NULL today; stays NULL).
alter policy deals_admin_all on public.deals
  using ((select public.has_role((select auth.uid()), 'admin'::public.app_role)));

-- agentlink_book
alter policy agentlink_book_admin_all on public.agentlink_book
  using ((select public.has_role((select auth.uid()), 'admin'::public.app_role)))
  with check ((select public.has_role((select auth.uid()), 'admin'::public.app_role)));

-- agentlink_clients
alter policy al_clients_admin_or_own_read on public.agentlink_clients
  using (((select public.has_role((select auth.uid()), 'admin'::public.app_role))
          or (exists (select 1 from public.agents a
                      where a.id = agentlink_clients.agent_id
                        and a.user_id = (select auth.uid())))));
alter policy al_clients_admin_write on public.agentlink_clients
  using ((select public.has_role((select auth.uid()), 'admin'::public.app_role)))
  with check ((select public.has_role((select auth.uid()), 'admin'::public.app_role)));

-- readymode_booking_packets
alter policy rmbp_read on public.readymode_booking_packets
  using ((select public.can_view_sold_calls()));
