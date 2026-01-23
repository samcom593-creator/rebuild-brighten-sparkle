-- ============================================
-- FIX APPLICATIONS TABLE RLS POLICIES
-- ============================================

-- Drop the overly permissive agent policies that include blanket manager access
DROP POLICY IF EXISTS "Agents can view their assigned applications" ON public.applications;
DROP POLICY IF EXISTS "Agents can update their assigned applications" ON public.applications;
DROP POLICY IF EXISTS "Managers can view their team applications" ON public.applications;

-- Create properly scoped agent SELECT policy (agents see ONLY their assigned apps)
CREATE POLICY "Agents can view their assigned applications"
ON public.applications FOR SELECT
TO authenticated
USING (
  assigned_agent_id IN (
    SELECT id FROM agents WHERE user_id = auth.uid()
  )
);

-- Create properly scoped agent UPDATE policy
CREATE POLICY "Agents can update their assigned applications"
ON public.applications FOR UPDATE
TO authenticated
USING (
  assigned_agent_id IN (
    SELECT id FROM agents WHERE user_id = auth.uid()
  )
)
WITH CHECK (
  assigned_agent_id IN (
    SELECT id FROM agents WHERE user_id = auth.uid()
  )
);

-- Create properly scoped manager SELECT policy
CREATE POLICY "Managers can view their team applications"
ON public.applications FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'manager'::app_role) AND (
    -- Their own assigned applications
    assigned_agent_id = get_agent_id(auth.uid())
    OR
    -- Their team's applications (agents they invited)
    assigned_agent_id IN (
      SELECT id FROM agents WHERE invited_by_manager_id = get_agent_id(auth.uid())
    )
    OR
    -- Unassigned applications (for lead distribution)
    assigned_agent_id IS NULL
  )
);

-- Add manager UPDATE policy for their team
CREATE POLICY "Managers can update their team applications"
ON public.applications FOR UPDATE
TO authenticated
USING (
  has_role(auth.uid(), 'manager'::app_role) AND (
    assigned_agent_id = get_agent_id(auth.uid())
    OR assigned_agent_id IN (
      SELECT id FROM agents WHERE invited_by_manager_id = get_agent_id(auth.uid())
    )
  )
)
WITH CHECK (
  has_role(auth.uid(), 'manager'::app_role) AND (
    assigned_agent_id = get_agent_id(auth.uid())
    OR assigned_agent_id IN (
      SELECT id FROM agents WHERE invited_by_manager_id = get_agent_id(auth.uid())
    )
  )
);

-- ============================================
-- FIX PROFILES TABLE RLS POLICIES
-- ============================================

-- Drop the policy using wrong column (manager_id instead of invited_by_manager_id)
DROP POLICY IF EXISTS "Managers can view their team profiles" ON public.profiles;

-- Create properly scoped manager profile SELECT policy
CREATE POLICY "Managers can view their team profiles"
ON public.profiles FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'manager'::app_role) AND (
    -- Their own profile
    user_id = auth.uid()
    OR
    -- Profiles of agents they invited
    user_id IN (
      SELECT a.user_id FROM agents a
      WHERE a.invited_by_manager_id = get_agent_id(auth.uid())
    )
  )
);