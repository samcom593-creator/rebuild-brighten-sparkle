
-- Add INSERT policy for managers on onboarding_progress
CREATE POLICY "Managers can insert team progress"
ON public.onboarding_progress FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'manager'::app_role)
  AND agent_id IN (
    SELECT id FROM agents WHERE invited_by_manager_id = current_agent_id()
  )
);

-- Add UPDATE policy for managers on onboarding_progress
CREATE POLICY "Managers can update team progress"
ON public.onboarding_progress FOR UPDATE
TO authenticated
USING (
  has_role(auth.uid(), 'manager'::app_role)
  AND agent_id IN (
    SELECT id FROM agents WHERE invited_by_manager_id = current_agent_id()
  )
)
WITH CHECK (
  has_role(auth.uid(), 'manager'::app_role)
  AND agent_id IN (
    SELECT id FROM agents WHERE invited_by_manager_id = current_agent_id()
  )
);
