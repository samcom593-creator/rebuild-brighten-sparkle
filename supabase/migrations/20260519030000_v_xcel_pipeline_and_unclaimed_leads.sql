-- ─────────────────────────────────────────────────────────────────────
-- Operating-system audit — Tier-1 moves (2026-05-19)
--
-- Move 1: create v_xcel_pipeline view (was referenced 6× in src/ but
--         missing in DB → runtime error on /dashboard/xcel-pipeline
--         and /dashboard/pre-licensing for every viewer).
--
-- Move 2: BEFORE-UPDATE trigger on applications: when
--         license_progress flips to 'licensed' but status is still
--         'new', auto-flip status to 'contracting' and stamp
--         contracted_at. Backfilled 10 stuck rows in the same pass.
--         Also patches bot_alert_agent_contracted, which had
--         COALESCE(license_status, '—') casting an em-dash to the
--         enum and silently blocking every status='contracting'
--         UPDATE that came through with a NULL license_status.
--
-- Move 3: v_unclaimed_new_apps view + claim_unclaimed_lead RPC so
--         the dashboard can surface and single-tap-claim the 319
--         status='new' applicants currently invisible.
--
-- All three applied live via bot-sql on 2026-05-19 02:30 UTC. This
-- migration locks them into git so the next DB reset doesn't lose
-- them.
-- ─────────────────────────────────────────────────────────────────────

BEGIN;

-- ── Move 1: v_xcel_pipeline ────────────────────────────────────────
CREATE OR REPLACE VIEW public.v_xcel_pipeline AS
WITH base AS (
  SELECT
    s.email                              AS student_email,
    NULLIF(TRIM(BOTH ' ' FROM CONCAT_WS(' ', s.first_name, s.last_name)), '') AS student_name,
    s.last_log_in::timestamptz           AS last_login,
    s.time_spent_minutes,
    s.pct_complete,
    s.date_completed,
    s.application_id,
    a.id                                 AS app_id,
    a.first_name                         AS app_first_name,
    a.last_name                          AS app_last_name,
    a.phone                              AS app_phone,
    a.license_status::text               AS license_status,
    a.license_progress::text             AS license_progress,
    a.assigned_agent_id,
    CASE
      WHEN s.last_log_in IS NULL THEN NULL
      ELSE GREATEST(0, (CURRENT_DATE - s.last_log_in::date))::int
    END AS days_since_login
  FROM public.xcel_pre_licensing_students s
  LEFT JOIN public.applications a ON a.id = s.application_id
),
with_state AS (
  SELECT
    b.*,
    CASE
      WHEN b.last_login IS NULL OR COALESCE(b.time_spent_minutes,0) = 0 THEN 'never_started'
      WHEN b.days_since_login <= 3                                       THEN 'active'
      WHEN b.days_since_login <= 10                                      THEN 'recent'
      ELSE                                                                    'stalled'
    END::text AS xcel_state
  FROM base b
)
SELECT
  w.student_email,
  w.student_name,
  w.last_login,
  w.xcel_state,
  w.days_since_login,
  w.application_id,
  w.app_first_name,
  w.app_last_name,
  w.app_phone,
  w.license_status,
  w.license_progress,
  ag.display_name                     AS manager_name,
  pr.avatar_url                       AS manager_avatar,
  CASE w.xcel_state
    WHEN 'never_started' THEN 'Nudge to start course'
    WHEN 'stalled'       THEN 'Reach out - 10+ days idle'
    WHEN 'recent'        THEN 'Check in this week'
    WHEN 'active'        THEN 'On pace'
  END                                  AS action_label
FROM with_state w
LEFT JOIN public.agents ag    ON ag.id      = w.assigned_agent_id
LEFT JOIN public.profiles pr  ON pr.user_id = ag.user_id;

GRANT SELECT ON public.v_xcel_pipeline TO anon, authenticated, service_role;

-- ── Move 2: auto-advance trigger + patch the em-dash enum bug ──────
CREATE OR REPLACE FUNCTION public.fn_auto_advance_licensed_to_contracting()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.license_progress::text = 'licensed'
     AND NEW.status::text       = 'new'
  THEN
    NEW.status        := 'contracting'::application_status;
    NEW.contracted_at := COALESCE(NEW.contracted_at, now());
  END IF;
  RETURN NEW;
END
$$;

DROP TRIGGER IF EXISTS trg_auto_advance_licensed_to_contracting ON public.applications;
CREATE TRIGGER trg_auto_advance_licensed_to_contracting
BEFORE UPDATE OF license_progress, status ON public.applications
FOR EACH ROW EXECUTE FUNCTION public.fn_auto_advance_licensed_to_contracting();

-- bot_alert_agent_contracted previously did COALESCE(NEW.license_status, '—')
-- which crashed when license_status was NULL (em-dash isn't a valid enum
-- value). Cast to text first so the COALESCE returns text.
CREATE OR REPLACE FUNCTION public.bot_alert_agent_contracted()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
BEGIN
  IF NEW.contracted_at IS NOT NULL AND (OLD.contracted_at IS NULL) THEN
    INSERT INTO public.bot_alerts (source, event_type, severity, subject, body, sms_body, channels, action_link)
    VALUES (
      'trigger',
      'applicant_contracted',
      'celebrate',
      format('Contracted: %s %s', NEW.first_name, NEW.last_name),
      format('<p><strong>%s %s</strong> just signed a contract. License: %s.</p>',
             NEW.first_name, NEW.last_name, COALESCE(NEW.license_status::text, 'n/a')),
      format('Contracted: %s %s', NEW.first_name, NEW.last_name),
      ARRAY['email','sms']::text[],
      'https://apex-financial.org/dashboard/hiring-pipeline'
    );
  END IF;
  RETURN NEW;
END;
$function$;

-- One-shot backfill: the 10 known stuck rows. Idempotent — trigger
-- will skip them on next run.
UPDATE public.applications
SET    status        = 'contracting'::application_status,
       contracted_at = COALESCE(contracted_at, now())
WHERE  license_progress::text = 'licensed'
  AND  status::text            = 'new'
  AND  terminated_at IS NULL;

-- ── Move 3: v_unclaimed_new_apps + claim RPC ───────────────────────
CREATE OR REPLACE VIEW public.v_unclaimed_new_apps AS
SELECT
  a.id,
  a.created_at,
  a.first_name,
  a.last_name,
  a.email,
  a.phone,
  a.state,
  a.license_status::text   AS license_status,
  a.license_progress::text AS license_progress,
  a.assigned_agent_id,
  a.referral_manager_id,
  a.recruiter_id,
  (date_part('epoch', now() - a.created_at) / 86400)::int AS days_in_queue,
  CASE
    WHEN a.created_at < now() - interval '14 days' THEN 'urgent'
    WHEN a.created_at < now() - interval '7 days'  THEN 'cold'
    WHEN a.created_at < now() - interval '3 days'  THEN 'warm'
    ELSE                                                 'fresh'
  END AS heat
FROM public.applications a
WHERE a.status::text = 'new'
  AND a.terminated_at IS NULL;

GRANT SELECT ON public.v_unclaimed_new_apps TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_unclaimed_lead(p_application_id uuid)
RETURNS public.applications
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_agent_id uuid;
  v_app      public.applications%ROWTYPE;
BEGIN
  SELECT id INTO v_agent_id FROM public.agents WHERE user_id = auth.uid() LIMIT 1;
  IF v_agent_id IS NULL THEN
    RAISE EXCEPTION 'caller has no agent row';
  END IF;
  UPDATE public.applications
  SET    assigned_agent_id    = v_agent_id,
         last_contacted_at    = COALESCE(last_contacted_at, now()),
         status               = CASE WHEN status::text = 'new'
                                     THEN 'reviewing'::application_status
                                     ELSE status END
  WHERE  id = p_application_id
    AND  status::text = 'new'
    AND  terminated_at IS NULL
  RETURNING * INTO v_app;
  RETURN v_app;
END
$$;

GRANT EXECUTE ON FUNCTION public.claim_unclaimed_lead(uuid) TO authenticated;

COMMIT;
