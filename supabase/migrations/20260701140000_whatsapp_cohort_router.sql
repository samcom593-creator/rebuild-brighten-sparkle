-- MP-232: WhatsApp cohort router — split prospect vs hired invites.
--
-- Sam directive 2026-07-01: the single whatsapp_group_invite_url was
-- ambiguous. Now:
--   - PROSPECTS (unlicensed / license_status IS NULL) get the prospect group
--     via new email_kind='prospect_whatsapp' alongside 'calendly-invite'.
--   - HIRED + LICENSED agents get the hired group via new
--     email_kind='hired_whatsapp' alongside 'course' + 'discord'.
--
-- Changes:
--   1. Seed system_settings.whatsapp_prospect_invite_url + whatsapp_hired_invite_url.
--   2. Delete legacy whatsapp_group_invite_url (ambiguous, MP-231 residue).
--   3. Widen agent_onboarding_queue.email_kind check to include 'hired_whatsapp'
--      (and drop 'whatsapp' - migrated to the cohort-specific kinds).
--   4. Update fn_enqueue_calendly_for_unlicensed to ALSO enqueue an
--      agent_onboarding_queue-style row via outreach_queue? No — applicants
--      don't have agents yet. We enqueue a second outreach_queue row with
--      source_run='prospect_whatsapp' + template_key='prospect-whatsapp-v1'.
--   5. Update fn_enqueue_hired_licensed_onboarding to enqueue 'hired_whatsapp'
--      instead of 'whatsapp'.
--   6. Update fn_enqueue_agent_onboarding_emails (INSERT trigger) to enqueue
--      'hired_whatsapp' instead of 'whatsapp'.

-- 1. seed cohort-specific settings
INSERT INTO public.system_settings (key, value)
VALUES ('whatsapp_prospect_invite_url', 'https://chat.whatsapp.com/JoLh3zjuX8h43LdtUJBZNM?mode=gi_t')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

INSERT INTO public.system_settings (key, value)
VALUES ('whatsapp_hired_invite_url', 'https://chat.whatsapp.com/ELF32cxu9FLAF0V3keWSFW')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

-- 2. drop legacy ambiguous keys
DELETE FROM public.system_settings WHERE key IN ('whatsapp_group_invite_url', 'whatsapp_group_link');

-- 3. widen check constraint: 'whatsapp' -> 'hired_whatsapp' (cohort-specific)
--    Migrate any existing 'whatsapp' rows to 'hired_whatsapp' since the old
--    trigger only fired them on hired+licensed agents.
UPDATE public.agent_onboarding_queue
   SET email_kind = 'hired_whatsapp'
 WHERE email_kind = 'whatsapp';

ALTER TABLE public.agent_onboarding_queue
  DROP CONSTRAINT IF EXISTS agent_onboarding_queue_email_kind_check;

ALTER TABLE public.agent_onboarding_queue
  ADD CONSTRAINT agent_onboarding_queue_email_kind_check
  CHECK (email_kind = ANY (ARRAY[
    'course'::text,
    'discord'::text,
    'hired_whatsapp'::text
  ]));

-- 4. extend fn_enqueue_calendly_for_unlicensed to also enqueue prospect_whatsapp
CREATE OR REPLACE FUNCTION public.fn_enqueue_calendly_for_unlicensed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.email IS NULL OR NEW.email = '' OR position('@' in NEW.email) = 0 THEN
    RETURN NEW;
  END IF;

  IF NEW.license_status IS NULL
     OR lower(NEW.license_status::text) = 'unlicensed' THEN

    -- calendly-invite (existing behavior)
    INSERT INTO public.outreach_queue (
      channel, source_run, application_id, to_email, subject,
      template_key, status, scheduled_for, idempotency_key
    )
    VALUES (
      'email', 'calendly-invite', NEW.id, NEW.email,
      'Personal invite from Samuel James — let''s talk about your career',
      'calendly-invite-v1', 'pending', now(),
      'calendly-' || NEW.id::text
    )
    ON CONFLICT (idempotency_key) DO NOTHING;

    -- prospect_whatsapp (new — MP-232)
    INSERT INTO public.outreach_queue (
      channel, source_run, application_id, to_email, subject,
      template_key, status, scheduled_for, idempotency_key
    )
    VALUES (
      'email', 'prospect_whatsapp', NEW.id, NEW.email,
      'Join the APEX prospect WhatsApp — questions, wins, live plays',
      'prospect-whatsapp-v1', 'pending', now(),
      'prospect-whatsapp-' || NEW.id::text
    )
    ON CONFLICT (idempotency_key) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

-- 5. rewrite fn_enqueue_hired_licensed_onboarding to use hired_whatsapp
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
    OR (OLD.license_status IS DISTINCT FROM NEW.license_status AND NEW.license_status = 'licensed')
  ) THEN
    RETURN NEW;
  END IF;

  -- Cohort guard: only hired+licensed agents get the hired chain.
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
    (NEW.id, 'course',         now()),
    (NEW.id, 'discord',        now()),
    (NEW.id, 'hired_whatsapp', now())
  ON CONFLICT (agent_id, email_kind) DO NOTHING;

  RETURN NEW;
END;
$function$;

-- 6. rewrite fn_enqueue_agent_onboarding_emails (INSERT trigger)
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
    (NEW.id, 'course',         target),
    (NEW.id, 'discord',        target),
    (NEW.id, 'hired_whatsapp', target)
  ON CONFLICT (agent_id, email_kind) DO NOTHING;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.fn_enqueue_calendly_for_unlicensed() IS
  'MP-232: enqueues calendly-invite + prospect_whatsapp for unlicensed applicants.';
COMMENT ON FUNCTION public.fn_enqueue_hired_licensed_onboarding() IS
  'MP-232: enqueues course + discord + hired_whatsapp when license_status transitions to licensed OR onboarding_stage/status flips live/active.';
COMMENT ON FUNCTION public.fn_enqueue_agent_onboarding_emails() IS
  'MP-232: enqueues course + discord + hired_whatsapp on new agent INSERT.';
