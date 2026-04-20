-- ─── Discord Webhook: store the production URL ───────────────────────────────
INSERT INTO public.system_settings (key, value)
VALUES (
  'discord_webhook_url',
  'https://discord.com/api/webhooks/1425987081418571779/3JrtT5W00gDos8XY2iYc5_nb5sxr9S9ztagW1bBigI-8daIrb170vTyxIqXV2E8x2S0T'
)
ON CONFLICT (key) DO UPDATE SET value = excluded.value;

-- ─── Trigger: New Application → Discord ───────────────────────────────────────
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
        'phone',  COALESCE(NEW.phone, ''),
        'state',  COALESCE(NEW.state, '')
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

-- ─── Trigger: Pipeline Stage Change → Discord ─────────────────────────────────
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

-- ─── Enable Realtime on key tables (idempotent) ───────────────────────────────
-- applications table realtime (already enabled in many setups, safe to repeat)
DO $$
BEGIN
  -- Only add if not already present; ignore error if already member
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.applications;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.deals;
  EXCEPTION WHEN duplicate_object THEN
    NULL;
  END;
END;
$$;
