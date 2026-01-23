-- Allow managers to create their own invite links
CREATE POLICY "Managers can create invite links"
ON public.manager_invite_links
FOR INSERT
WITH CHECK (
  has_role(auth.uid(), 'manager'::app_role) AND
  manager_agent_id = get_agent_id(auth.uid())
);