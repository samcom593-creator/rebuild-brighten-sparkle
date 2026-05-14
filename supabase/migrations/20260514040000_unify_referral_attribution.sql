-- 2026-05-14 — Unify referral attribution across applications
--
-- Problem: dashboards filtered by different columns (assigned_agent_id vs
-- referral_manager_id vs recruiter_id vs hiring_manager_user_id), so an agent
-- could be "the referrer" on one page and invisible on another. Manager KJ
-- in particular had 0 visible applicants until the routing rewrite.
--
-- Fixes:
--  1. Backfill referral_manager_id = assigned_agent_id where NULL
--  2. RLS policies on applications OR across assigned_agent_id,
--     referral_manager_id, recruiter_id (and hiring_manager_user_id via the
--     prior 2026-05-14 policy already in place).
--
-- Idempotent — safe to re-run.

BEGIN;

UPDATE public.applications
SET referral_manager_id = assigned_agent_id,
    updated_at = NOW()
WHERE referral_manager_id IS NULL
  AND assigned_agent_id IS NOT NULL;

DROP POLICY IF EXISTS "Agents can view their assigned applications" ON public.applications;
DROP POLICY IF EXISTS "Agents can update their assigned applications" ON public.applications;

CREATE POLICY "Agents can view their applications (any attribution)"
ON public.applications
FOR SELECT
USING (
  assigned_agent_id   IN (SELECT id FROM public.agents WHERE user_id = auth.uid())
  OR referral_manager_id IN (SELECT id FROM public.agents WHERE user_id = auth.uid())
  OR recruiter_id        IN (SELECT id FROM public.agents WHERE user_id = auth.uid())
);

CREATE POLICY "Agents can update their applications (any attribution)"
ON public.applications
FOR UPDATE
USING (
  assigned_agent_id   IN (SELECT id FROM public.agents WHERE user_id = auth.uid())
  OR referral_manager_id IN (SELECT id FROM public.agents WHERE user_id = auth.uid())
  OR recruiter_id        IN (SELECT id FROM public.agents WHERE user_id = auth.uid())
);

DROP POLICY IF EXISTS "Managers can view team applications" ON public.applications;
DROP POLICY IF EXISTS "Managers can update team applications" ON public.applications;

CREATE POLICY "Managers view team applications (any attribution)"
ON public.applications
FOR SELECT
USING (
  public.has_role(auth.uid(), 'manager'::app_role)
  AND (
    assigned_agent_id     = public.get_agent_id(auth.uid())
    OR referral_manager_id = public.get_agent_id(auth.uid())
    OR recruiter_id        = public.get_agent_id(auth.uid())
    OR assigned_agent_id IN (SELECT id FROM public.agents WHERE invited_by_manager_id = public.get_agent_id(auth.uid()))
    OR referral_manager_id IN (SELECT id FROM public.agents WHERE invited_by_manager_id = public.get_agent_id(auth.uid()))
  )
);

CREATE POLICY "Managers update team applications (any attribution)"
ON public.applications
FOR UPDATE
USING (
  public.has_role(auth.uid(), 'manager'::app_role)
  AND (
    assigned_agent_id     = public.get_agent_id(auth.uid())
    OR referral_manager_id = public.get_agent_id(auth.uid())
    OR recruiter_id        = public.get_agent_id(auth.uid())
    OR assigned_agent_id IN (SELECT id FROM public.agents WHERE invited_by_manager_id = public.get_agent_id(auth.uid()))
    OR referral_manager_id IN (SELECT id FROM public.agents WHERE invited_by_manager_id = public.get_agent_id(auth.uid()))
  )
);

COMMIT;
