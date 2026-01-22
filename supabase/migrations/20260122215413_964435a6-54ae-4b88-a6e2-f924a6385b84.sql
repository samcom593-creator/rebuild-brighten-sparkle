
-- Fix 1: Activity logs - Add explicit denial of anonymous access
-- The table already has RLS enabled, but add explicit authenticated check
DROP POLICY IF EXISTS "Users can view own activity" ON public.activity_logs;
CREATE POLICY "Users can view own activity" 
ON public.activity_logs 
FOR SELECT 
TO authenticated
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Admins can view all activity" ON public.activity_logs;
CREATE POLICY "Admins can view all activity" 
ON public.activity_logs 
FOR SELECT 
TO authenticated
USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Authenticated users can log activity" ON public.activity_logs;
CREATE POLICY "Authenticated users can log activity" 
ON public.activity_logs 
FOR INSERT 
TO authenticated
WITH CHECK (user_id = auth.uid());

-- Fix 2: Applications - Scope manager access to their team only
DROP POLICY IF EXISTS "Managers can view applications" ON public.applications;

CREATE POLICY "Managers can view their team applications" 
ON public.applications 
FOR SELECT 
TO authenticated
USING (
  public.has_role(auth.uid(), 'manager') AND (
    -- Applications assigned to agents invited by this manager
    assigned_agent_id IN (
      SELECT id 
      FROM public.agents 
      WHERE invited_by_manager_id = public.get_agent_id(auth.uid())
    ) OR
    -- Or unassigned applications (managers can claim/assign)
    assigned_agent_id IS NULL
  )
);
