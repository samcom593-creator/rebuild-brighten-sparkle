-- 2026-05-16 — Beneficiary mirror + role-scoped RLS pattern
--
-- /api/dial-lists/beneficiaries returns one row per beneficiary on a deal.
-- This mirrors it so authorized users (agent → own, manager → downline,
-- admin → all) can service their clients without re-pulling upstream.
--
-- RLS pattern here is the template for any future client-facing mirror:
-- the visibility check walks deal → agent → manager_id rather than
-- duplicating role logic on every table.

BEGIN;

CREATE TABLE IF NOT EXISTS public.agentlink_beneficiaries (
  id                         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  insuracloud_beneficiary_id int UNIQUE,
  deal_id                    uuid REFERENCES public.deals(id),
  insuracloud_deal_id        int,
  first_name                 text,
  last_name                  text,
  phone                      text,
  client_full_name           text,
  created_at                 timestamptz,
  raw_payload                jsonb,
  imported_at                timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_albe_deal ON public.agentlink_beneficiaries (deal_id);

ALTER TABLE public.agentlink_beneficiaries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS al_bene_role_scoped ON public.agentlink_beneficiaries;
DROP POLICY IF EXISTS al_bene_admin_write ON public.agentlink_beneficiaries;
DROP POLICY IF EXISTS al_bene_admin       ON public.agentlink_beneficiaries;

-- Agents see beneficiaries on their own deals; managers see their downline's;
-- admins see all. Walks deal → agent_id → manager_id once per check.
CREATE POLICY al_bene_role_scoped ON public.agentlink_beneficiaries
  FOR SELECT USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR EXISTS (
      SELECT 1 FROM public.deals d
      JOIN public.agents a ON a.id = d.agent_id
      WHERE d.id = agentlink_beneficiaries.deal_id
        AND (
          a.user_id = auth.uid()
          OR a.manager_id = public.get_agent_id(auth.uid())
        )
    )
  );

-- Writes are admin-only; sync workers use service_role which bypasses RLS.
CREATE POLICY al_bene_admin_write ON public.agentlink_beneficiaries
  FOR ALL USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

REVOKE ALL ON public.agentlink_beneficiaries FROM PUBLIC, anon;
GRANT SELECT ON public.agentlink_beneficiaries TO authenticated;

COMMIT;
