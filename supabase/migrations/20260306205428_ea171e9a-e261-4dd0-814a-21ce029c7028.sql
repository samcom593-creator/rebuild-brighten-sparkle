
CREATE POLICY "Managers can view team applications"
ON public.applications
FOR SELECT
TO authenticated
USING (
  has_role(auth.uid(), 'manager'::app_role)
  AND (
    assigned_agent_id = get_agent_id(auth.uid())
    OR assigned_agent_id IN (
      SELECT id FROM agents 
      WHERE invited_by_manager_id = get_agent_id(auth.uid())
    )
  )
);

CREATE POLICY "Managers can update team applications"
ON public.applications
FOR UPDATE
TO authenticated
USING (
  has_role(auth.uid(), 'manager'::app_role)
  AND (
    assigned_agent_id = get_agent_id(auth.uid())
    OR assigned_agent_id IN (
      SELECT id FROM agents 
      WHERE invited_by_manager_id = get_agent_id(auth.uid())
    )
  )
)
WITH CHECK (
  has_role(auth.uid(), 'manager'::app_role)
  AND (
    assigned_agent_id = get_agent_id(auth.uid())
    OR assigned_agent_id IN (
      SELECT id FROM agents 
      WHERE invited_by_manager_id = get_agent_id(auth.uid())
    )
  )
);
