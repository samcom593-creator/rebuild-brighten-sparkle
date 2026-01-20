-- Fix: Replace broad manager profile access with team-scoped access
-- Managers should only view profiles of agents on their team, not all profiles

DROP POLICY IF EXISTS "Managers can view team profiles" ON public.profiles;

CREATE POLICY "Managers can view their team profiles" 
ON public.profiles FOR SELECT 
USING (
  public.has_role(auth.uid(), 'manager') AND (
    -- Manager can view own profile
    user_id = auth.uid() OR
    -- Manager can view profiles of agents on their team
    user_id IN (
      SELECT a.user_id 
      FROM public.agents a
      WHERE a.manager_id = public.get_agent_id(auth.uid())
    )
  )
);