-- 20260504093000 — switch agent-facing RLS from agents.profile_id = auth.uid()
-- to agents.user_id = auth.uid().
--
-- Why: the previous policies were checking profile_id, but profile_id is the
-- FK into profiles, not the auth user id. The migration's auto-create-profile
-- trigger does set profile_id = auth.uid() most of the time, but Path B
-- migration produced rows where profile_id ≠ user_id (different UUIDs after
-- admin API regeneration). Result: agents could not see their own
-- agentlink_leads / agentlink_rewards / commission_ledger / lead_purchases.
--
-- Fix: predicate on agents.user_id, which is the canonical auth linkage.

DROP POLICY IF EXISTS aleads_own_read ON public.agentlink_leads;
CREATE POLICY aleads_own_read ON public.agentlink_leads
  FOR SELECT
  USING (
    agent_id IN (
      SELECT id FROM public.agents WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS arw_own ON public.agentlink_rewards;
CREATE POLICY arw_own ON public.agentlink_rewards
  FOR SELECT
  USING (
    agent_id IN (
      SELECT id FROM public.agents WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS cl_own ON public.commission_ledger;
CREATE POLICY cl_own ON public.commission_ledger
  FOR SELECT
  USING (
    agent_id IN (
      SELECT id FROM public.agents WHERE user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS lp_own ON public.lead_purchases;
CREATE POLICY lp_own ON public.lead_purchases
  FOR SELECT
  USING (
    agent_id IN (
      SELECT id FROM public.agents WHERE user_id = auth.uid()
    )
  );
