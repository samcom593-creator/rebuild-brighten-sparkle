-- Hiring flow: auto-alert when an applicant passes licensing so we provision
-- them as an agent without letting them sit in limbo.
--
-- Context: today 15 applications have license_progress='licensed' but no
-- corresponding profile/agent record — they got their license and then fell
-- through the cracks. The existing trg_bot_alert_licensed_app only fires on
-- INSERT; stages that progress through UPDATE never triggered an alert.
--
-- This migration:
--   1. Adds trg_bot_alert_newly_licensed (AFTER UPDATE on applications)
--   2. Backfills a single catch-up alert for the 15 existing stuck cases
--   3. Creates apex_provision_licensed_applicant() RPC for the dashboard
--      "Provision" button to call with one click.

-- ─── 1. Trigger on license_progress transition ───────────────────────────────
CREATE OR REPLACE FUNCTION public.bot_alert_newly_licensed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $body$
BEGIN
  IF (OLD.license_progress IS DISTINCT FROM NEW.license_progress
      AND NEW.license_progress = 'licensed')
     OR (OLD.license_status IS DISTINCT FROM NEW.license_status
         AND NEW.license_status = 'licensed')
  THEN
    INSERT INTO public.bot_alerts (source, event_type, severity, subject, body, sms_body, action_link, channels)
    VALUES (
      'trigger', 'applicant_newly_licensed', 'celebrate',
      format('🎓 %s %s passed their license exam', COALESCE(NEW.first_name, ''), COALESCE(NEW.last_name, '')),
      format(E'**%s %s** just hit LICENSED in APEX — time to provision their agent account.\n\nEmail: %s\nState: %s\n\nClick the link to open their card and hit "Provision" to activate the agent record, unlock production, and send the Welcome email.',
             COALESCE(NEW.first_name, ''), COALESCE(NEW.last_name, ''),
             NEW.email, COALESCE(NEW.license_states::text, 'TX')),
      format('%s %s just got LICENSED. Provision them now.', COALESCE(NEW.first_name, ''), COALESCE(NEW.last_name, '')),
      format('https://apex-financial.org/dashboard/hiring-pipeline?application=%s', NEW.id),
      ARRAY['email','sms','discord']::text[]
    );
  END IF;
  RETURN NEW;
END;
$body$;

DROP TRIGGER IF EXISTS trg_bot_alert_newly_licensed ON public.applications;
CREATE TRIGGER trg_bot_alert_newly_licensed
  AFTER UPDATE ON public.applications
  FOR EACH ROW EXECUTE FUNCTION public.bot_alert_newly_licensed();

-- ─── 2. Backfill alerts for the 15 stuck cases ───────────────────────────────
-- Use a single roll-up alert instead of 15 individual ones so Sam's inbox
-- doesn't get slammed with historical noise.
WITH stuck AS (
  SELECT a.id, a.first_name, a.last_name, a.email
    FROM public.applications a
    WHERE (a.license_progress = 'licensed' OR a.license_status = 'licensed')
      AND NOT EXISTS (
        SELECT 1 FROM public.profiles p WHERE LOWER(p.email) = LOWER(a.email)
      )
)
INSERT INTO public.bot_alerts (source, event_type, severity, subject, body, sms_body, action_link, channels)
SELECT
  'audit',
  'licensed_not_provisioned_backlog',
  'warn',
  format('%s licensed applicants need agent accounts provisioned', COUNT(*)),
  format(E'**%s applicants are LICENSED but have no agent account yet.** They likely closed the course + passed the exam but never got their login, so they can\u2019t log deals.\n\nNames: %s\n\nOpen Hiring Pipeline and click "Provision" on each one.',
    COUNT(*),
    string_agg(first_name || ' ' || last_name, ', ' ORDER BY first_name)
  ),
  format('%s licensed applicants still need agent accounts. Check Hiring Pipeline.', COUNT(*)),
  'https://apex-financial.org/dashboard/hiring-pipeline?filter=licensed_unprovisioned',
  ARRAY['email']::text[]
FROM stuck
WHERE (SELECT COUNT(*) FROM stuck) > 0
  AND NOT EXISTS (
    SELECT 1 FROM public.bot_alerts
    WHERE event_type = 'licensed_not_provisioned_backlog'
      AND created_at > NOW() - INTERVAL '24 hours'
  );

-- ─── 3. Provisioning RPC (called from dashboard "Provision" button) ──────────
-- Creates the agent record linked to the application. Does NOT create the
-- auth.users row — that happens when the applicant signs in via magic link.
-- This lets an agent exist in the system with pending_login status so Sam
-- can see their progress before they've claimed their login.

CREATE OR REPLACE FUNCTION public.apex_provision_licensed_applicant(p_application_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $body$
DECLARE
  v_app       public.applications;
  v_agent_id  uuid;
  v_profile_id uuid;
BEGIN
  SELECT * INTO v_app FROM public.applications WHERE id = p_application_id;
  IF v_app IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'application_not_found');
  END IF;

  IF v_app.license_progress <> 'licensed' AND v_app.license_status <> 'licensed' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_licensed_yet', 'license_progress', v_app.license_progress);
  END IF;

  -- Check if a profile already exists by email. If so, reuse it.
  SELECT id INTO v_profile_id FROM public.profiles WHERE LOWER(email) = LOWER(v_app.email) LIMIT 1;

  -- If no profile, insert a pre-auth stub so UI can show them right away.
  IF v_profile_id IS NULL THEN
    INSERT INTO public.profiles (email, full_name, phone)
    VALUES (
      LOWER(v_app.email),
      trim(concat_ws(' ', v_app.first_name, v_app.last_name)),
      v_app.phone
    )
    RETURNING id INTO v_profile_id;
  END IF;

  -- Check if an agent record already exists (idempotent).
  SELECT id INTO v_agent_id FROM public.agents
   WHERE profile_id = v_profile_id
      OR (display_name = trim(concat_ws(' ', v_app.first_name, v_app.last_name)) AND display_name IS NOT NULL)
   LIMIT 1;

  IF v_agent_id IS NOT NULL THEN
    -- Existing agent — just update stage + link.
    UPDATE public.agents
       SET profile_id = COALESCE(profile_id, v_profile_id),
           display_name = COALESCE(display_name, trim(concat_ws(' ', v_app.first_name, v_app.last_name))),
           license_status = 'licensed',
           status = 'active',
           onboarding_stage = COALESCE(onboarding_stage, 'provisioned'),
           start_date = COALESCE(start_date, CURRENT_DATE),
           updated_at = now()
     WHERE id = v_agent_id;
  ELSE
    -- Create a new agent record. No user_id yet — gets set when they sign in.
    INSERT INTO public.agents (
      profile_id, display_name, license_status, status, onboarding_stage, start_date, manager_id
    ) VALUES (
      v_profile_id,
      trim(concat_ws(' ', v_app.first_name, v_app.last_name)),
      'licensed', 'active', 'provisioned', CURRENT_DATE,
      v_app.hiring_manager_user_id
    )
    RETURNING id INTO v_agent_id;
  END IF;

  -- Mark the application as provisioned so the pipeline UI can move it.
  UPDATE public.applications
     SET status = 'approved',
         license_progress = 'licensed',
         license_status = 'licensed',
         updated_at = now()
   WHERE id = p_application_id;

  -- Fire a celebrate alert so Discord + Sam's SMS both light up.
  INSERT INTO public.bot_alerts (source, event_type, severity, subject, body, sms_body, channels)
  VALUES (
    'manual', 'agent_provisioned', 'celebrate',
    format('✨ %s is now a LIVE APEX agent', trim(concat_ws(' ', v_app.first_name, v_app.last_name))),
    format('%s cleared licensing and is live on the production dashboard. Agent ID: %s.',
           trim(concat_ws(' ', v_app.first_name, v_app.last_name)), v_agent_id),
    format('%s is live. Let\u2019s get the first deal logged today.', trim(concat_ws(' ', v_app.first_name, v_app.last_name))),
    ARRAY['email','sms','discord']::text[]
  );

  RETURN jsonb_build_object(
    'ok', true,
    'agent_id', v_agent_id,
    'profile_id', v_profile_id,
    'application_id', p_application_id
  );
END;
$body$;

REVOKE ALL ON FUNCTION public.apex_provision_licensed_applicant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apex_provision_licensed_applicant(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.apex_provision_licensed_applicant(uuid) TO service_role;
