-- Fix: auto_assign_unassigned_application referenced hardcoded agent_id
-- from the OLD Lovable-org project. On a fresh project that ID doesn't
-- exist, so every application insert violated FK on assigned_agent_id.
-- Replaced with a dynamic lookup of any active admin agent (or fallback
-- to the first active agent). Idempotent on the old project.
CREATE OR REPLACE FUNCTION public.auto_assign_unassigned_application()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_agent_id uuid;
BEGIN
  IF NEW.assigned_agent_id IS NULL THEN
    SELECT a.id INTO v_admin_agent_id
    FROM public.agents a
    JOIN public.user_roles ur ON ur.user_id = a.user_id
    WHERE ur.role = 'admin' AND a.status = 'active'
    ORDER BY a.created_at ASC
    LIMIT 1;
    IF v_admin_agent_id IS NULL THEN
      SELECT id INTO v_admin_agent_id FROM public.agents
      WHERE status = 'active' ORDER BY created_at ASC LIMIT 1;
    END IF;
    NEW.assigned_agent_id := v_admin_agent_id;
  END IF;
  RETURN NEW;
END $$;
