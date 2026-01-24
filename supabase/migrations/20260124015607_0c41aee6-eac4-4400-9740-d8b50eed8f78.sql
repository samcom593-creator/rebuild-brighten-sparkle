-- Allow agents to view their manager's agent record
CREATE POLICY "Agents can view their manager"
ON public.agents
FOR SELECT
TO public
USING (
  auth.uid() IS NOT NULL AND
  id IN (
    SELECT invited_by_manager_id 
    FROM public.agents 
    WHERE user_id = auth.uid() AND invited_by_manager_id IS NOT NULL
  )
);

-- Allow agents to view their manager's profile
CREATE POLICY "Agents can view their manager profile"
ON public.profiles
FOR SELECT
TO public
USING (
  auth.uid() IS NOT NULL AND
  user_id IN (
    SELECT a_manager.user_id
    FROM public.agents a_self
    JOIN public.agents a_manager ON a_manager.id = a_self.invited_by_manager_id
    WHERE a_self.user_id = auth.uid()
  )
);