-- Fix: eliminate infinite recursion in RLS policies on public.agents
-- Root cause: policies that reference the same table (agents) via subqueries trigger recursion.
-- Approach: move lookups into SECURITY DEFINER functions with row_security=off, and simplify policies.

BEGIN;

-- 1) Harden helper functions used by policies (avoid RLS recursion)
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  );
$$;

CREATE OR REPLACE FUNCTION public.get_agent_id(_user_id uuid)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT id
  FROM public.agents
  WHERE user_id = _user_id
  LIMIT 1;
$$;

-- Convenience: current agent id (for policy usage)
CREATE OR REPLACE FUNCTION public.current_agent_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT id
  FROM public.agents
  WHERE user_id = auth.uid()
  LIMIT 1;
$$;

-- Convenience: current user's manager agent id (for policy usage)
CREATE OR REPLACE FUNCTION public.current_manager_agent_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT invited_by_manager_id
  FROM public.agents
  WHERE user_id = auth.uid()
  LIMIT 1;
$$;

-- 2) Replace self-referential policies on public.agents
DROP POLICY IF EXISTS "Agents can view their manager" ON public.agents;
CREATE POLICY "Agents can view their manager"
ON public.agents
FOR SELECT
USING (
  auth.uid() IS NOT NULL
  AND id = public.current_manager_agent_id()
);

DROP POLICY IF EXISTS "Managers can view their team" ON public.agents;
CREATE POLICY "Managers can view their team"
ON public.agents
FOR SELECT
USING (
  public.has_role(auth.uid(), 'manager'::app_role)
  AND (
    user_id = auth.uid()
    OR invited_by_manager_id = public.current_agent_id()
    OR manager_id = public.current_agent_id()
  )
);

DROP POLICY IF EXISTS "Managers can update team agent onboarding stage" ON public.agents;
CREATE POLICY "Managers can update team agent onboarding stage"
ON public.agents
FOR UPDATE
USING (
  public.has_role(auth.uid(), 'manager'::app_role)
  AND invited_by_manager_id = public.current_agent_id()
)
WITH CHECK (
  public.has_role(auth.uid(), 'manager'::app_role)
  AND invited_by_manager_id = public.current_agent_id()
);

COMMIT;