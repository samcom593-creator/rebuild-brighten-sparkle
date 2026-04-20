-- ============================================================
-- APEX FINANCIAL — ONE-TIME SETUP SCRIPT
-- Run this in your Supabase SQL Editor (Dashboard → SQL Editor)
-- ============================================================

-- 1. Set Discord webhook URL
UPDATE public.system_settings
SET value = 'https://discord.com/api/webhooks/1425987081418571779/3JrtT5W00gDos8XY2iYc5_nb5sxr9S9ztagW1bBigI-8daIrb170vTyxIqXV2E8x2S0T'
WHERE key = 'discord_webhook_url';

-- (If the row doesn't exist yet, this inserts it)
INSERT INTO public.system_settings (key, value)
VALUES (
  'discord_webhook_url',
  'https://discord.com/api/webhooks/1425987081418571779/3JrtT5W00gDos8XY2iYc5_nb5sxr9S9ztagW1bBigI-8daIrb170vTyxIqXV2E8x2S0T'
)
ON CONFLICT (key) DO UPDATE SET value = excluded.value;

-- 2. Set service role key for automation jobs
-- Replace YOUR_SERVICE_ROLE_KEY with the key from Supabase → Settings → API → service_role
ALTER DATABASE postgres SET "app.settings.service_role_key" = 'YOUR_SERVICE_ROLE_KEY';

-- 3. Create admin_configure_integration RPC (for app UI)
CREATE OR REPLACE FUNCTION public.admin_configure_integration(
  p_key   text,
  p_value text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  SELECT role INTO v_role
  FROM public.profiles
  WHERE user_id = auth.uid()
  LIMIT 1;

  IF v_role IS DISTINCT FROM 'admin' AND current_role NOT IN ('service_role','supabase_admin','postgres') THEN
    RAISE EXCEPTION 'Access denied: admin only';
  END IF;

  INSERT INTO public.system_settings (key, value)
  VALUES (p_key, p_value)
  ON CONFLICT (key) DO UPDATE SET value = excluded.value;

  RETURN jsonb_build_object('ok', true, 'key', p_key);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_configure_integration(text, text) TO authenticated;

-- 4. New-applicant Discord trigger
CREATE OR REPLACE FUNCTION public.applications_trigger_new_applicant_discord()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  PERFORM public.run_automation_job(
    'new-applicant-discord-notify',
    'discord-webhook-notify',
    jsonb_build_object(
      'event_type', 'new_applicant',
      'agent_name', COALESCE(NEW.first_name || ' ' || NEW.last_name, 'New Applicant'),
      'details', jsonb_build_object(
        'email', NEW.email,
        'phone', COALESCE(NEW.phone, ''),
        'state', COALESCE(NEW.state, '')
      )
    )
  );
  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_applications_new_applicant_discord ON public.applications;
CREATE TRIGGER trg_applications_new_applicant_discord
  AFTER INSERT ON public.applications
  FOR EACH ROW
  EXECUTE FUNCTION public.applications_trigger_new_applicant_discord();

-- 5. Stage-change Discord trigger
CREATE OR REPLACE FUNCTION public.applications_trigger_stage_change_discord()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_recruiter text;
BEGIN
  IF OLD.license_progress IS NOT DISTINCT FROM NEW.license_progress THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(p.full_name, 'Manager')
  INTO v_recruiter
  FROM public.agents a
  LEFT JOIN public.profiles p ON p.id = a.profile_id
  WHERE a.id = NEW.assigned_agent_id
  LIMIT 1;

  PERFORM public.run_automation_job(
    'pipeline-stage-change-discord',
    'discord-webhook-notify',
    jsonb_build_object(
      'event_type', 'stage_change',
      'agent_name', COALESCE(NEW.first_name || ' ' || NEW.last_name, 'Applicant'),
      'details', jsonb_build_object(
        'from_stage', COALESCE(OLD.license_progress, 'new_applicant'),
        'to_stage',   NEW.license_progress,
        'email',      NEW.email,
        'recruiter',  COALESCE(v_recruiter, '')
      )
    )
  );

  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_applications_stage_change_discord ON public.applications;
CREATE TRIGGER trg_applications_stage_change_discord
  AFTER UPDATE OF license_progress ON public.applications
  FOR EACH ROW
  EXECUTE FUNCTION public.applications_trigger_stage_change_discord();

-- 6. Enable Realtime on applications + deals
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.applications;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.deals;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END;
$$;

-- ============================================================
-- DONE! Reload the app and Discord notifications will fire.
-- ============================================================
