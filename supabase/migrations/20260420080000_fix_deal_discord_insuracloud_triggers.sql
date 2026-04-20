-- Fix InsuraCloud trigger: use run_automation_job (handles key resolution + logging)
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

-- Add Discord notification trigger for new deals
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
