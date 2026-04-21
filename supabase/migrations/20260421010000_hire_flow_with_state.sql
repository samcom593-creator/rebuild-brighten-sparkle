-- ============================================================
-- Upgrade agent_activated Discord trigger: include STATE
-- Discord embed now shows name + state + manager + referred-by
-- ============================================================

CREATE OR REPLACE FUNCTION public.trg_fn_agent_activated_discord()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_agent_name   text;
  v_instagram    text;
  v_manager_name text;
  v_referred_by  text;
  v_state        text;
  v_email        text;
BEGIN
  -- Only fire on initial activation (contracted_at going from NULL → value)
  IF OLD.contracted_at IS NOT NULL OR NEW.contracted_at IS NULL THEN
    RETURN NEW;
  END IF;

  -- Name + instagram from profile
  SELECT p.full_name, p.instagram_handle, p.email
  INTO v_agent_name, v_instagram, v_email
  FROM public.profiles p WHERE p.id = NEW.profile_id;

  -- State: prefer profile, fall back to matching application by email
  SELECT COALESCE(p.state,
                  (SELECT a.state FROM public.applications a
                   WHERE LOWER(a.email) = LOWER(v_email)
                     AND a.state IS NOT NULL
                   ORDER BY a.created_at DESC LIMIT 1),
                  '')
  INTO v_state
  FROM public.profiles p WHERE p.id = NEW.profile_id;

  IF NEW.manager_id IS NOT NULL THEN
    SELECT COALESCE(pm.full_name, 'Sam')
    INTO v_manager_name
    FROM public.agents am
    JOIN public.profiles pm ON pm.id = am.profile_id
    WHERE am.id = NEW.manager_id;
  END IF;

  IF NEW.invited_by_manager_id IS NOT NULL THEN
    SELECT COALESCE(pr.full_name, '')
    INTO v_referred_by
    FROM public.agents ar
    JOIN public.profiles pr ON pr.id = ar.profile_id
    WHERE ar.id = NEW.invited_by_manager_id;
  END IF;

  PERFORM public.run_automation_job(
    'agent-activated-discord',
    'discord-webhook-notify',
    jsonb_build_object(
      'event_type', 'agent_activated',
      'details', jsonb_build_object(
        'agent_name',  COALESCE(v_agent_name, 'New Agent'),
        'state',       COALESCE(v_state, ''),
        'hired_by',    COALESCE(v_manager_name, 'Sam'),
        'manager',     COALESCE(v_manager_name, 'Sam'),
        'referred_by', v_referred_by,
        'start_date',  TO_CHAR(COALESCE(NEW.start_date, CURRENT_DATE), 'Mon DD, YYYY'),
        'instagram',   v_instagram,
        'email',       v_email
      )
    )
  );
  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_agent_activated_discord ON public.agents;
CREATE TRIGGER trg_agent_activated_discord
  AFTER UPDATE OF contracted_at ON public.agents
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_agent_activated_discord();
