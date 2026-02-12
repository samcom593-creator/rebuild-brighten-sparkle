-- Remove the old policy that lets managers see unassigned leads
DROP POLICY "Managers can view their team applications" ON applications;

-- Recreate without the assigned_agent_id IS NULL clause
CREATE POLICY "Managers can view their team applications"
ON applications FOR SELECT
USING (
  has_role(auth.uid(), 'manager'::app_role) AND (
    assigned_agent_id = get_agent_id(auth.uid()) 
    OR assigned_agent_id IN (
      SELECT id FROM agents WHERE invited_by_manager_id = get_agent_id(auth.uid())
    )
  )
);