-- Fix current_agent_id() to use consistent ordering (newest first)
CREATE OR REPLACE FUNCTION public.current_agent_id()
  RETURNS uuid
  LANGUAGE sql
  STABLE SECURITY DEFINER
  SET search_path = public
  SET row_security = 'off'
AS $$
  SELECT id
  FROM public.agents
  WHERE user_id = auth.uid()
  ORDER BY created_at DESC
  LIMIT 1;
$$;

-- Fix get_agent_id() with same ordering
CREATE OR REPLACE FUNCTION public.get_agent_id(_user_id uuid)
  RETURNS uuid
  LANGUAGE sql
  STABLE SECURITY DEFINER
  SET search_path = public
  SET row_security = 'off'
AS $$
  SELECT id
  FROM public.agents
  WHERE user_id = _user_id
  ORDER BY created_at DESC
  LIMIT 1;
$$;

-- Fix current_manager_agent_id() with same ordering
CREATE OR REPLACE FUNCTION public.current_manager_agent_id()
  RETURNS uuid
  LANGUAGE sql
  STABLE SECURITY DEFINER
  SET search_path = public
  SET row_security = 'off'
AS $$
  SELECT invited_by_manager_id
  FROM public.agents
  WHERE user_id = auth.uid()
  ORDER BY created_at DESC
  LIMIT 1;
$$;