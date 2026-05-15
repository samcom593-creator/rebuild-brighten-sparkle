-- 2026-05-15 — Canonical Sam James resolver
--
-- There are two Sam admin/agent records in production:
--
--   1. "Sam James"     (active, agent_code SJAMES02)
--      agent_id  cde14d07-2366-444a-80cc-58a8f7da6f95
--      user_id   71826bba-5577-4810-a226-1f6f2ad5288a
--      email     sam.com593@gmail.com    (last sign-in 2026-05-15)
--
--   2. "Samuel James"  (legacy,   agent_code SJAMES01)
--      agent_id  7c3c5581-3544-437f-bfe2-91391afb217d   <-- this is the
--      user_id   811fc5f4-05f4-446e-a916-445ce7fd051f       SAM_AGENT_ID
--      email     info@kingofsales.net   (last sign-in 2026-05-02)       constant
--                                                                       hardcoded in
--                                                                       src/lib/dataLayer.ts
--
-- Most filters that "exclude Sam from leaderboards" need to exclude BOTH
-- records. Most fallback assignments ("unknown applicant -> Sam") should
-- target the ACTIVE record. The hardcoded const points at the legacy
-- record, which is why leaderboard counts have drifted and fallback
-- routing landed on the dead account.
--
-- This migration ships a single SQL function the frontend + edge functions
-- can call instead of guessing.
--
-- Idempotent.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_canonical_sam_agent()
RETURNS TABLE (
  agent_id        uuid,
  user_id         uuid,
  profile_id      uuid,
  display_name    text,
  agent_code      text,
  auth_email      text,
  last_sign_in_at timestamptz,
  legacy_agent_id uuid
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
  WITH candidates AS (
    SELECT
      a.id AS agent_id,
      a.user_id,
      a.profile_id,
      COALESCE(a.display_name, p.full_name) AS display_name,
      a.agent_code,
      u.email::text AS auth_email,
      u.last_sign_in_at
    FROM public.agents a
    LEFT JOIN public.profiles p ON p.id = a.profile_id
    JOIN auth.users u ON u.id = a.user_id
    JOIN public.user_roles ur ON ur.user_id = a.user_id
    WHERE ur.role = 'admin'::app_role
      AND u.email IN ('sam.com593@gmail.com', 'info@kingofsales.net', 'sam@apex-financial.org')
      AND COALESCE(a.is_deactivated, false) = false
  ),
  ranked AS (
    SELECT *,
      ROW_NUMBER() OVER (
        ORDER BY last_sign_in_at DESC NULLS LAST,
                 CASE auth_email
                   WHEN 'sam.com593@gmail.com' THEN 0
                   WHEN 'info@kingofsales.net' THEN 1
                   ELSE 2
                 END
      ) AS rk
    FROM candidates
  )
  SELECT
    r.agent_id, r.user_id, r.profile_id, r.display_name, r.agent_code,
    r.auth_email, r.last_sign_in_at,
    (SELECT agent_id FROM ranked WHERE rk <> 1 ORDER BY rk LIMIT 1) AS legacy_agent_id
  FROM ranked r
  WHERE r.rk = 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_canonical_sam_agent() TO authenticated, anon;

-- Convenience: returns the set of agent_ids that should be EXCLUDED from
-- leaderboards, "live agents", and rank calculations. Always returns both
-- Sam records so future identity drift can't silently re-inflate metrics.
CREATE OR REPLACE FUNCTION public.sam_agent_ids_to_exclude()
RETURNS SETOF uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'auth'
AS $$
  SELECT a.id
  FROM public.agents a
  JOIN auth.users u ON u.id = a.user_id
  JOIN public.user_roles ur ON ur.user_id = a.user_id
  WHERE ur.role = 'admin'::app_role
    AND u.email IN ('sam.com593@gmail.com', 'info@kingofsales.net', 'sam@apex-financial.org');
$$;

GRANT EXECUTE ON FUNCTION public.sam_agent_ids_to_exclude() TO authenticated, anon;

COMMIT;
