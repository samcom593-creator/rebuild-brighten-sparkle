-- Add DELETE policy for admins on onboarding_progress
CREATE POLICY "Admins can delete all progress" 
ON public.onboarding_progress 
FOR DELETE 
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- Also allow managers to delete their team's progress
CREATE POLICY "Managers can delete team progress" 
ON public.onboarding_progress 
FOR DELETE 
TO authenticated
USING (
  has_role(auth.uid(), 'manager'::app_role) 
  AND agent_id IN (
    SELECT id FROM agents 
    WHERE invited_by_manager_id = current_agent_id()
  )
);