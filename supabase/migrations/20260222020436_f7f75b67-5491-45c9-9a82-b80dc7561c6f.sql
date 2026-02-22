
-- Safety net trigger: auto-assign any application with NULL assigned_agent_id to admin
CREATE OR REPLACE FUNCTION public.auto_assign_unassigned_application()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.assigned_agent_id IS NULL THEN
    NEW.assigned_agent_id := '7c3c5581-3544-437f-bfe2-91391afb217d';
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER trg_auto_assign_application
BEFORE INSERT ON public.applications
FOR EACH ROW
EXECUTE FUNCTION public.auto_assign_unassigned_application();
