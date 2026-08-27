-- MP-326: the agents table was writable by any logged-in account.
--
-- "Deny public access to agents" is named like a lockdown and is the opposite:
-- PERMISSIVE, cmd=ALL, USING (auth.uid() IS NOT NULL), with_check NULL. For an
-- ALL policy a NULL with_check falls back to the USING expression, so it granted
-- INSERT to every authenticated session, and no RESTRICTIVE INSERT policy existed
-- to bound it. Proven in a rolled-back prod transaction: a uid with no agent row
-- at all (any self-signup) inserted a row successfully.
--
-- That is not a junk-row problem. agents carries AFTER INSERT triggers
-- trg_agent_inserted_discord and trg_telegram_broadcast_new_hire, and the row
-- surfaces in the public recent-hires ticker -- so a stranger's write reached
-- Sam's real Discord, his Telegram, and the public site.
--
-- Replacing the blanket grant is not a straight DROP. The blanket ALL policy is
-- also the only PERMISSIVE policy carrying agent self-writes (course enroll,
-- ref_slug unlock, profile settings) -- the own-row rule lives in RESTRICTIVE
-- agents_update_scoped, and a RESTRICTIVE policy grants nothing on its own.
-- Dropping it alone silently breaks those. Measured, not assumed.
--
-- INSERT stays open to staff roles rather than being closed outright, because
-- crm/BulkStageActions.tsx upserts by id; an upsert needs INSERT permission even
-- when every row already exists, and that surface is reachable by managers
-- (DashboardCRM.tsx:2024 gates the block on isAdmin || isManager). Every real
-- agent-creation path (agent-signup, manager-signup, claim-account,
-- consume-invite-token, add-agent, link-account, self-enroll-course,
-- submit-contracting-intake) runs service-role and bypasses RLS, so none of
-- them depend on this policy.
--
-- READS ARE DELIBERATELY UNCHANGED. All 190 rows remain readable agent-to-agent
-- via "Authenticated users can view agents for leaderboard". That leak is real
-- (override_rate on 10 agents, contract_percentage, deactivation_reason
-- 'bad_business' on 2 named people, leader_notes) and is NOT closed here: it
-- needs ~30 agent-facing call sites repointed at a directory view first, and
-- dropping the SELECT policy before those land white-screens the leaderboards.
-- Shipping the write half whole beats shipping both halves partly.
--
-- Proof: 7/7 branches green; M1 (blanket policy left in place) fails exactly
-- the stranger-insert and plain-agent-insert branches.

DROP POLICY IF EXISTS "Deny public access to agents" ON public.agents;

-- Preserves agent self-writes that the blanket policy had been carrying.
CREATE POLICY "Agents can update own record" ON public.agents
  FOR UPDATE TO authenticated
  USING (user_id = (SELECT auth.uid()))
  WITH CHECK (user_id = (SELECT auth.uid()));

-- Bounded replacement for the blanket INSERT grant.
CREATE POLICY "Staff can insert agents" ON public.agents
  FOR INSERT TO authenticated
  WITH CHECK (
    has_role((SELECT auth.uid()), 'admin'::app_role)
    OR has_role((SELECT auth.uid()), 'manager'::app_role)
  );
