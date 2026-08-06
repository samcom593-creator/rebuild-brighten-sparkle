-- 2026-08-06 — /dashboard/bulk-deals is `ProtectedRoute requireAdmin allowManagers`,
-- so managers are deliberately let onto the page. But public.deals carried only:
--   deals_admin_all              ALL     has_role(uid,'admin')
--   deals_own_insert             INSERT  agent_id = my own agent row
--   deals_own_read               SELECT  agent_id = my own agent row
--   deals_own_update             UPDATE  own row, status in (draft,submitted)
--   deals_manager_read_downline  SELECT  manager AND agent_id in my_downline_agent_ids()
--
-- No manager INSERT policy. A manager pasting downline deals therefore hit a
-- per-row 42501 on every row that was not their own — the page invited them in
-- and then refused the only thing it exists to do.
--
-- The WITH CHECK below is the WITH-CHECK twin of deals_manager_read_downline's
-- USING clause, character for character. Reusing my_downline_agent_ids() rather
-- than writing a fresh hierarchy expression is the point: read scope and write
-- scope now cannot drift apart when the hierarchy logic changes.
--
-- Scope is NOT widened. Verified under SET LOCAL ROLE authenticated with real
-- request.jwt.claims inside BEGIN ... ROLLBACK:
--   manager KJ Vaughn (16 downline, not an admin)
--     -> downline agent   ALLOWED  (was DENIED 42501 before this policy)
--     -> own agent row    ALLOWED  (already covered by deals_own_insert)
--     -> outside downline DENIED 42501
--   plain agent Jake Wantroba (no admin, no manager role)
--     -> another agent    DENIED 42501
--     -> own agent row    ALLOWED
--     -> outside downline DENIED 42501
-- deals row count 1744 before and after; zero probe rows survived, so none of
-- the 16 AFTER INSERT triggers on public.deals (Discord broadcast, celebration,
-- hot streak, InsuraCloud autopush) fired for real.
--
-- Only INSERT is added. BulkDeals.tsx performs exactly one write —
-- `supabase.from("deals").insert(row)` at L141 — and no UPDATE, so
-- deals_own_update is deliberately left untouched.

CREATE POLICY deals_manager_insert_downline
  ON public.deals
  FOR INSERT
  TO authenticated
  WITH CHECK (
    has_role((SELECT auth.uid() AS uid), 'manager'::app_role)
    AND (
      agent_id IN (
        SELECT my_downline_agent_ids.agent_id
        FROM my_downline_agent_ids() my_downline_agent_ids(agent_id)
      )
    )
  );
