CREATE OR REPLACE FUNCTION public.auto_assign_unassigned_application()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Leave unassigned if no agent specified; manual routing required
  RETURN NEW;
END;
$function$;