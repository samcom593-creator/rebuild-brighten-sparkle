-- Bootstrap system_settings rows needed for automation
INSERT INTO public.system_settings (key, value)
VALUES ('service_role_key', '')
ON CONFLICT (key) DO NOTHING;

-- Fix run_automation_job to also check system_settings.service_role_key as fallback.
-- This lets admins set the key via the REST API without needing Postgres SQL access.
CREATE OR REPLACE FUNCTION public.run_automation_job(
  p_job_name text,
  p_function_name text,
  p_body jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions
AS $$
DECLARE
  v_log_id uuid;
  v_url text;
  v_service_key text;
  v_start timestamptz;
BEGIN
  v_start := clock_timestamp();

  INSERT INTO public.automation_run_log (job_name, status)
  VALUES (p_job_name, 'running')
  RETURNING id INTO v_log_id;

  v_url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/' || p_function_name;

  -- Try Postgres GUC first, then fall back to system_settings table
  v_service_key := current_setting('app.settings.service_role_key', true);
  IF v_service_key IS NULL OR v_service_key = '' THEN
    SELECT value INTO v_service_key FROM public.system_settings WHERE key = 'service_role_key';
  END IF;

  IF v_service_key IS NULL OR v_service_key = '' THEN
    UPDATE public.automation_run_log
    SET status = 'error',
        error = 'service_role_key not configured. Set it in system_settings (key=service_role_key) or run: ALTER DATABASE postgres SET "app.settings.service_role_key" = ''YOUR_KEY'';',
        completed_at = now(),
        duration_ms = extract(milliseconds from clock_timestamp() - v_start)::integer
    WHERE id = v_log_id;
    RETURN v_log_id;
  END IF;

  PERFORM net.http_post(
    url := v_url,
    body := p_body,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_service_key,
      'x-automation-job', p_job_name,
      'x-automation-log-id', v_log_id::text
    )
  );

  UPDATE public.automation_run_log
  SET status = 'success',
      completed_at = now(),
      duration_ms = extract(milliseconds from clock_timestamp() - v_start)::integer
  WHERE id = v_log_id;

  RETURN v_log_id;
EXCEPTION WHEN others THEN
  UPDATE public.automation_run_log
  SET status = 'error',
      error = SQLERRM,
      completed_at = now(),
      duration_ms = extract(milliseconds from clock_timestamp() - v_start)::integer
  WHERE id = v_log_id;
  RAISE;
END;
$$;

-- Fix InsuraCloud trigger: use updated run_automation_job
CREATE OR REPLACE FUNCTION public.deals_trigger_insuracloud_push()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
BEGIN
  IF NEW.synced_to_insuracloud_at IS NOT NULL OR NEW.status = 'draft' THEN
    RETURN NEW;
  END IF;

  PERFORM public.run_automation_job(
    'deal-insuracloud-push',
    'insuracloud-outbox',
    jsonb_build_object('deal_id', NEW.id)
  );

  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END;
$$;

-- Discord notification trigger for new deals
CREATE OR REPLACE FUNCTION public.deals_trigger_discord_notify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $$
DECLARE
  v_agent_name text;
BEGIN
  IF NEW.status = 'draft' THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(p.full_name, 'An agent')
  INTO v_agent_name
  FROM public.agents a
  LEFT JOIN public.profiles p ON p.id = a.profile_id
  WHERE a.id = NEW.agent_id;

  PERFORM public.run_automation_job(
    'deal-discord-notify',
    'discord-webhook-notify',
    jsonb_build_object(
      'event_type', 'deal_closed',
      'agent_name', COALESCE(v_agent_name, 'An agent'),
      'details', jsonb_build_object('aop', NEW.annual_premium, 'deals', 1)
    )
  );

  RETURN NEW;
EXCEPTION WHEN others THEN
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_deals_discord_notify ON public.deals;
CREATE TRIGGER trg_deals_discord_notify
  AFTER INSERT ON public.deals
  FOR EACH ROW
  EXECUTE FUNCTION public.deals_trigger_discord_notify();
