-- ============================================================
-- Kill email spam: disable duplicate/overlapping nudge crons
-- and add a 24h-contact dedupe guard to applications.
-- User report: multiple applicants receiving emails all day.
-- Root cause: 50 scheduled crons, several hitting the same applicants.
-- ============================================================

DO $$
DECLARE
  jn text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed — skipping';
    RETURN;
  END IF;

  -- Drop the specific crons that overlap with nudge-unworked-applications.
  -- Keep ONLY nudge-unworked-applications as the single daily sweep.
  FOR jn IN
    SELECT jobname FROM cron.job
    WHERE jobname IN (
      'apex-abandoned-applications',
      'apex-ghosted-applicants',
      'apex-dropped-leads',
      'onboarding-nudge-sweep',
      'send-aged-lead-email-cron',
      'send-followup-emails-cron',
      'send-course-hurry-emails-cron'
    )
  LOOP
    PERFORM cron.unschedule(jn);
    RAISE NOTICE 'Unscheduled duplicate cron: %', jn;
  END LOOP;
END $$;

-- ─── Dedupe helper: true if applicant was contacted by ANY channel in last 24h ─
CREATE OR REPLACE FUNCTION public.applicant_contacted_recently(p_app_id uuid, p_hours int DEFAULT 24)
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.applications
    WHERE id = p_app_id
      AND (
        last_contacted_at > NOW() - (p_hours || ' hours')::interval
        OR contacted_at    > NOW() - (p_hours || ' hours')::interval
      )
  ) OR EXISTS (
    SELECT 1 FROM public.notification_log nl
    WHERE nl.metadata->>'application_id' = p_app_id::text
      AND nl.status = 'sent'
      AND nl.created_at > NOW() - (p_hours || ' hours')::interval
  );
$$;

-- ─── Track the last time we sent any email globally per applicant ──
ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS last_automated_email_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_applications_last_automated_email
  ON public.applications(last_automated_email_at DESC);

-- ─── Keep SMS auto-detect from fan-out spam: after first success,
-- the cron-driven path should remember the carrier — but the old logs
-- show 8× log entries per send. Add a once-per-day guard. ──
CREATE TABLE IF NOT EXISTS public.sms_send_guard (
  phone_e164 text PRIMARY KEY,
  last_sent_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.sms_allowed(p_phone text, p_window_minutes int DEFAULT 60)
RETURNS boolean
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
    (SELECT last_sent_at FROM public.sms_send_guard WHERE phone_e164 = p_phone)
    < NOW() - (p_window_minutes || ' minutes')::interval,
    true
  );
$$;

-- Report what's still scheduled after cleanup
SELECT 'Active crons remaining: ' || count(*)::text
FROM cron.job
WHERE jobname LIKE 'apex-%' OR jobname LIKE 'nudge-%' OR jobname LIKE 'send-%';
