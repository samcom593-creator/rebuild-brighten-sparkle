-- PL-SAM-2026-06-03-010 — Wire applicant.first_dm template to fire on new application.
--
-- Template applicant.first_dm has lived in telegram_templates since 2026-06-03 but was
-- never wired to fire. /start command was the only path that sent it (and only if the
-- applicant happened to /start the bot AFTER applying). Every applicant who came in via
-- the website form with telegram_chat_id pre-set, or who had a telegram_users row
-- matchable by phone/email at insert time, was missing the first DM entirely.
--
-- This trigger queues applicant.first_dm into telegram_scheduled_messages on AFTER INSERT
-- so telegram-drain ships it on its next sweep. We queue (not direct HTTP) because
-- applications already has 31 triggers; adding a synchronous net.http_post call to a hot
-- path would couple insert latency to api.telegram.org availability. The drain pattern
-- mirrors telegram_autolink_application (welcome.matched_* queue).
--
-- Lookup order for chat_id:
--   1. NEW.telegram_chat_id (applicant linked Telegram on the Apply form).
--   2. telegram_users by digits-only phone OR LOWER(email) (mirrors
--      telegram_autolink_application).
--   3. None found → skip; /start handler in telegram-webhook is the fallback for
--      applicants who connect after applying (separate punch-list item, not this fire).
--
-- Respects applications.telegram_opt_out.
-- Dedupe: 'first_dm_' || application_id so re-running the trigger (or retro-backfill)
-- never double-sends.

CREATE OR REPLACE FUNCTION public.fn_applicant_first_dm_on_apply()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_chat_id bigint;
BEGIN
  IF NEW.telegram_opt_out IS TRUE THEN
    RETURN NEW;
  END IF;

  IF NEW.telegram_chat_id IS NOT NULL AND NEW.telegram_chat_id <> 0 THEN
    v_chat_id := NEW.telegram_chat_id;
  ELSE
    SELECT tu.chat_id INTO v_chat_id
      FROM telegram_users tu
     WHERE (
       (NEW.phone IS NOT NULL AND tu.phone = REGEXP_REPLACE(NEW.phone, '\D', '', 'g'))
       OR (NEW.email IS NOT NULL AND LOWER(tu.email) = LOWER(NEW.email))
     )
     ORDER BY tu.last_active_at DESC NULLS LAST
     LIMIT 1;
  END IF;

  IF v_chat_id IS NULL OR v_chat_id = 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO telegram_scheduled_messages(
    chat_id, template_key, context, scheduled_at, reason, dedupe_key, status
  )
  VALUES (
    v_chat_id,
    'applicant.first_dm',
    jsonb_build_object(
      'first_name', COALESCE(NEW.first_name, 'Friend'),
      'application_id', NEW.id::text,
      'ica_paid', NEW.ica_paid_at IS NOT NULL,
      'phone_provided', NEW.phone IS NOT NULL,
      'email_provided', NEW.email IS NOT NULL
    ),
    now(),
    'new_application_first_dm',
    'first_dm_' || NEW.id::text,
    'pending'
  )
  ON CONFLICT (chat_id, dedupe_key)
    WHERE dedupe_key IS NOT NULL AND status = 'pending'
    DO NOTHING;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_applicant_first_dm ON public.applications;
CREATE TRIGGER trg_applicant_first_dm
  AFTER INSERT ON public.applications
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_applicant_first_dm_on_apply();

COMMENT ON FUNCTION public.fn_applicant_first_dm_on_apply IS
  'PL-SAM-2026-06-03-010: queue applicant.first_dm into telegram_scheduled_messages on new application. Respects telegram_opt_out. Dedupe by application_id.';
