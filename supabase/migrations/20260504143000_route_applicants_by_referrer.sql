-- 20260504143000 — applications routing now honors referral_manager_id.
--
-- Sam 2026-05-04: applicants who name a referrer must land in THAT referrer's
-- box, not the round-robin pool. Applicants who apply without naming a
-- referrer must default to Sam's agent so they aren't auto-distributed
-- across all managers' boxes (prevents one manager from pulling another's
-- recruit by accident).
--
-- Two trigger fns get the same logic:
--   1. applications_auto_route_hiring_manager — sets hiring_manager_user_id
--   2. auto_assign_unassigned_application — sets assigned_agent_id
--
-- "Sam's default agent" resolved by email lookup so a future user_id remap
-- doesn't break this — picks the first active admin with email
-- info@kingofsales.net or sam.com593@gmail.com, falls back to first admin.

CREATE OR REPLACE FUNCTION public.applications_auto_route_hiring_manager()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_scope public.hiring_scope;
  v_referrer_user_id uuid;
  v_default_user_id uuid;
BEGIN
  IF NEW.hiring_manager_user_id IS NOT NULL THEN RETURN NEW; END IF;

  -- Honor referrer if applicant named one (referral_manager_id is an agent_id)
  IF NEW.referral_manager_id IS NOT NULL THEN
    SELECT user_id INTO v_referrer_user_id
    FROM public.agents
    WHERE id = NEW.referral_manager_id
      AND COALESCE(is_deactivated, false) = false
    LIMIT 1;
    IF v_referrer_user_id IS NOT NULL THEN
      NEW.hiring_manager_user_id := v_referrer_user_id;
      NEW.hiring_scope_at_intake :=
        CASE WHEN NEW.license_status = 'licensed' OR NEW.license_progress::text = 'licensed' THEN 'licensed'
             WHEN NEW.is_transfer = true THEN 'transfer'
             ELSE 'unlicensed' END;
      RETURN NEW;
    END IF;
  END IF;

  -- No (valid) referrer → default to Sam's user_id (info@kingofsales.net or
  -- sam.com593@gmail.com). Fallback: first admin user.
  SELECT u.id INTO v_default_user_id
  FROM auth.users u
  JOIN public.user_roles ur ON ur.user_id = u.id
  WHERE ur.role = 'admin'
    AND u.email IN ('info@kingofsales.net', 'sam.com593@gmail.com')
  ORDER BY (CASE u.email WHEN 'sam.com593@gmail.com' THEN 0 ELSE 1 END)
  LIMIT 1;

  IF v_default_user_id IS NULL THEN
    SELECT u.id INTO v_default_user_id
    FROM auth.users u
    JOIN public.user_roles ur ON ur.user_id = u.id
    WHERE ur.role = 'admin'
    ORDER BY u.created_at ASC
    LIMIT 1;
  END IF;

  IF NEW.license_status = 'licensed' OR NEW.license_progress::text = 'licensed' THEN
    NEW.hiring_scope_at_intake := 'licensed';
  ELSIF NEW.is_transfer = true THEN
    NEW.hiring_scope_at_intake := 'transfer';
  ELSE
    NEW.hiring_scope_at_intake := 'unlicensed';
  END IF;

  -- Use Sam's user_id directly — bypass round-robin so unclaimed applicants
  -- don't pollute other managers' inboxes.
  NEW.hiring_manager_user_id := v_default_user_id;

  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.auto_assign_unassigned_application()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_assigned uuid;
BEGIN
  IF NEW.assigned_agent_id IS NOT NULL THEN RETURN NEW; END IF;

  -- 1. Honor referrer (referral_manager_id IS the agent_id we want)
  IF NEW.referral_manager_id IS NOT NULL THEN
    SELECT id INTO v_assigned
    FROM public.agents
    WHERE id = NEW.referral_manager_id
      AND COALESCE(is_deactivated, false) = false
    LIMIT 1;
    IF v_assigned IS NOT NULL THEN
      NEW.assigned_agent_id := v_assigned;
      RETURN NEW;
    END IF;
  END IF;

  -- 2. No valid referrer → Sam's most-recent active admin agent. Email-keyed
  -- lookup keeps this stable across user_id remaps.
  SELECT a.id INTO v_assigned
  FROM public.agents a
  JOIN auth.users u ON u.id = a.user_id
  JOIN public.user_roles ur ON ur.user_id = u.id
  WHERE ur.role = 'admin'
    AND u.email IN ('info@kingofsales.net', 'sam.com593@gmail.com')
    AND COALESCE(a.is_deactivated, false) = false
  ORDER BY (CASE u.email WHEN 'sam.com593@gmail.com' THEN 0 ELSE 1 END), a.created_at DESC
  LIMIT 1;

  -- 3. Last fallback: first active admin agent
  IF v_assigned IS NULL THEN
    SELECT a.id INTO v_assigned
    FROM public.agents a
    JOIN public.user_roles ur ON ur.user_id = a.user_id
    WHERE ur.role = 'admin'
      AND COALESCE(a.is_deactivated, false) = false
    ORDER BY a.created_at ASC
    LIMIT 1;
  END IF;

  NEW.assigned_agent_id := v_assigned;
  RETURN NEW;
END;
$function$;
