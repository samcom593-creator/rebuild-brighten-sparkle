-- PL-MP248 (2026-07-06): Bad-phone tracking + couldn't-reach email flow.
--
-- Sam directive: "make applications better obviously by clicking bad numbers
-- and send them an email. Let them know we couldn't call them."
--
-- Applications:
--   phone_bad_at                  timestamptz — when Sam/team marked the number bad
--   phone_bad_reason              text        — optional short reason (no answer, disconnected, wrong person, ...)
--   couldnt_reach_email_sent_at   timestamptz — when the templated "we tried to reach you" email went out via Resend
--
-- RPC mark_phone_bad(app_id, reason) — SECURITY DEFINER so authenticated
-- users can mark without direct table UPDATE grant. Idempotent (COALESCE
-- keeps the first phone_bad_at).

ALTER TABLE applications ADD COLUMN IF NOT EXISTS phone_bad_at timestamptz;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS phone_bad_reason text;
ALTER TABLE applications ADD COLUMN IF NOT EXISTS couldnt_reach_email_sent_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_applications_phone_bad_at
  ON applications (phone_bad_at) WHERE phone_bad_at IS NOT NULL;

CREATE OR REPLACE FUNCTION public.mark_phone_bad(p_application_id uuid, p_reason text DEFAULT NULL)
RETURNS TABLE(id uuid, phone_bad_at timestamptz, phone_bad_reason text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  UPDATE applications
     SET phone_bad_at    = COALESCE(applications.phone_bad_at, now()),
         phone_bad_reason = COALESCE(p_reason, applications.phone_bad_reason)
   WHERE applications.id = p_application_id
   RETURNING applications.id, applications.phone_bad_at, applications.phone_bad_reason;
END;
$$;

GRANT EXECUTE ON FUNCTION public.mark_phone_bad(uuid, text) TO authenticated;
