-- Add WhatsApp community invite to the onboarding auto-send chain.
--
-- Sam directive 2026-07-01: every hired+licensed agent should also get the
-- APEX WhatsApp community invite alongside course + Discord.
--
-- Changes:
--   1. Seed system_settings.whatsapp_group_invite_url.
--   2. Extend agent_onboarding_queue.email_kind check to allow 'whatsapp'.
--   3. Extend fn_enqueue_hired_licensed_onboarding (UPDATE trigger) to enqueue whatsapp.
--   4. Extend fn_enqueue_agent_onboarding_emails (INSERT trigger) to enqueue whatsapp.

-- 1. seed setting
INSERT INTO public.system_settings (key, value)
VALUES ('whatsapp_group_invite_url', 'https://chat.whatsapp.com/ELF32cxu9FLAF0V3keWSFW')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- 2. widen check constraint
ALTER TABLE public.agent_onboarding_queue
  DROP CONSTRAINT IF EXISTS agent_onboarding_queue_email_kind_check;

ALTER TABLE public.agent_onboarding_queue
  ADD CONSTRAINT agent_onboarding_queue_email_kind_check
  CHECK (email_kind = ANY (ARRAY['course'::text, 'discord'::text, 'whatsapp'::text]));

-- 3. extend UPDATE trigger (hired + licensed)
CREATE OR REPLACE FUNCTION public.fn_enqueue_hired_licensed_onboarding()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  agent_email text;
BEGIN
  IF NOT (
    (OLD.onboarding_stage IS DISTINCT FROM NEW.onboarding_stage AND NEW.onboarding_stage = 'live')
    OR (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'active' AND COALESCE(OLD.status, '') NOT IN ('active', 'live'))
  ) THEN
    RETURN NEW;
  END IF;

  IF NEW.license_status IS DISTINCT FROM 'licensed' THEN
    RETURN NEW;
  END IF;

  SELECT p.email INTO agent_email
  FROM public.profiles p
  WHERE p.user_id = NEW.user_id
  LIMIT 1;

  IF agent_email IS NULL OR length(trim(agent_email)) = 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.agent_onboarding_queue (agent_id, email_kind, target_send_at)
  VALUES
    (NEW.id, 'course',   now()),
    (NEW.id, 'discord',  now()),
    (NEW.id, 'whatsapp', now())
  ON CONFLICT (agent_id, email_kind) DO NOTHING;

  RETURN NEW;
END;
$function$;

-- 4. extend INSERT trigger (new agent creation)
CREATE OR REPLACE FUNCTION public.fn_enqueue_agent_onboarding_emails()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  target timestamptz;
  agent_email text;
BEGIN
  SELECT p.email
  INTO agent_email
  FROM public.profiles p
  WHERE p.user_id = NEW.user_id
  LIMIT 1;

  IF agent_email IS NULL OR length(trim(agent_email)) = 0 THEN
    RAISE NOTICE 'fn_enqueue_agent_onboarding_emails: agent % has no reachable email via profiles.user_id=%; skipping enqueue.',
      NEW.id, NEW.user_id;
    RETURN NEW;
  END IF;

  target := public.fn_next_onboarding_window();

  INSERT INTO public.agent_onboarding_queue (agent_id, email_kind, target_send_at)
  VALUES
    (NEW.id, 'course',   target),
    (NEW.id, 'discord',  target),
    (NEW.id, 'whatsapp', target)
  ON CONFLICT (agent_id, email_kind) DO NOTHING;

  RETURN NEW;
END;
$function$;
