-- MP-BOOK-LOCKDOWN (2026-11-09, EMERGENCY): Sam — "agents can see full book and
-- all agent data... they are stealing the book now."
-- Measured live as agent Chudi Ifediora before the cut: 244 agentlink_book rows
-- (his 145 + Wendell Funderburg 85 + Kolade Ayedun 14), 350 deals (+ Edwin
-- Ac-lumor 58), 163 agentlink_clients rows — client names and phones included.
-- Path: user_roles 'manager' (9 holders) + manager-downline SELECT policies +
-- agents.manager_id rows placing veteran producers under newer agents.
-- THE CUT: an agent reads ONLY their own rows. Admin + book_readers (Sam's
-- explicit allow-list) keep full read. The 'manager' app_role keeps its other
-- features; it no longer grants book/deal/client reads.
-- Dropped/replaced policy quals are preserved below for reversibility.

-- agentlink_book: separate own-read policy already exists — drop the downline read.
-- (was: has_role(auth.uid,'manager') AND agent_id IN my_downline_agent_ids())
drop policy if exists "agentlink_book_manager_read_downline" on public.agentlink_book;

-- deals: separate own-read policy already exists — drop the downline read.
-- (was: has_role(auth.uid,'manager') AND agent_id IN my_downline_agent_ids())
drop policy if exists "deals_manager_read_downline" on public.deals;

-- agentlink_deals_snapshot: the ONE policy combined own + downline — replace
-- with own-only so agents keep their own rows.
-- (was: exists(agents a where a.al_user_id = user_id AND (a.user_id = auth.uid()
--        OR (has_role('manager') AND a.id IN my_downline_agent_ids()))))
drop policy if exists "agentlink_snapshot_own_or_downline_read" on public.agentlink_deals_snapshot;
drop policy if exists "agentlink_snapshot_own_read" on public.agentlink_deals_snapshot;
create policy "agentlink_snapshot_own_read" on public.agentlink_deals_snapshot
  for select to authenticated
  using (exists (
    select 1 from public.agents a
    where a.al_user_id = agentlink_deals_snapshot.user_id
      and a.user_id = (select auth.uid())
  ));

-- agentlink_clients: policy combined admin + own + manager-one-hop — replace
-- with admin + own. Client PII never flows on hierarchy again.
-- (was: has_role('admin') OR exists(agents a where a.id = agent_id AND
--        (a.user_id = auth.uid() OR a.manager_id = get_agent_id(auth.uid()))))
drop policy if exists "al_clients_role_scoped" on public.agentlink_clients;
drop policy if exists "al_clients_admin_or_own_read" on public.agentlink_clients;
create policy "al_clients_admin_or_own_read" on public.agentlink_clients
  for select
  using (
    public.has_role(auth.uid(), 'admin'::app_role)
    or exists (
      select 1 from public.agents a
      where a.id = agentlink_clients.agent_id
        and a.user_id = (select auth.uid())
    )
  );

-- Second pass, same emergency: measured as Chudi AFTER the first cut —
-- readymode_dialer_calls still returned 8,070 rows (lead names + phones +
-- recordings; rmd_downline_read has NO role check, pure hierarchy reach) and
-- carrier_policies 5 downline rows. Client-facing data follows the same rule:
-- an agent reads only their own. Sold-call viewers (Sam's grant list) and
-- full readers are untouched. Left in place and flagged, not cut: coaching /
-- grade feedback / agent documents / carrier contracts downline reads —
-- agent-internal records, no client book in them (Chudi measured 0-1 rows,
-- own only).
-- (rmd_downline_read was: agent_id IN my_downline_agent_ids())
drop policy if exists "rmd_downline_read" on public.readymode_dialer_calls;
-- (rmca_downline_read: call analysis carries transcripts/summaries = client talk)
drop policy if exists "rmca_downline_read" on public.readymode_call_analysis;
-- (carrier_policies_manager_read was: has_role('manager') AND agent_id IN my_downline_agent_ids())
drop policy if exists "carrier_policies_manager_read" on public.carrier_policies;
