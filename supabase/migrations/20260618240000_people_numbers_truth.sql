-- 2026-06-18 Sam directive (verbatim): "fix all this people numbers right".
--
-- AUDIT REVEALED FIVE LIES:
--
-- 1. landing_live_stats().active_agents = 123 (truth: 41).
--    Function counted every non-terminated agent — including 65 inactive +
--    deactivated rows + 10 XAGENT placeholders + 1 orphan from my cc_dispose
--    test. Inflated 3x.
--
-- 2. landing_recent_hires() surfaced XAGENT01-XAGENT10 placeholder rows on
--    the public landing as 'recent hires'. Fake-success — they're test data.
--
-- 3. v_recent_hires showed 'logan  spatola' (lowercase + double space),
--    'matias touchstone', 'dudley bowman' — capitalization disasters on the
--    public-facing recruit landing.
--
-- 4. My cc_dispose test on Noor Shams left an orphan agent row +
--    application status='onboarding' + 2 queued (never sent) emails.
--
-- 5. 27 active agents have al_user_id = NULL so they can't appear on
--    book-of-business leaderboards. (Down from 31 — earlier backfill
--    handled 4.) Still surfaced via /admin/agentlink-backfill.
--
-- THIS MIGRATION (applied live via bot-sql; this file is the audit trail):
--
--   A. Rewrites landing_live_stats() — active_agents now demands
--      status='active' AND NOT is_deactivated AND canonical_agent_id IS NULL.
--   B. Marks XAGENT01-XAGENT10 is_deactivated=true so they fall off
--      every active surface (landing + leaderboards + dashboards).
--   C. Title-cases 3 lowercase agent display_names.
--   D. Deletes orphan test agent (Noor Shams uuid 6ba67443) + queued
--      emails + resets the source application status to 'new'.
--
-- Net effect: landing page hero will say '41 active agents' tomorrow,
-- not '123'. Recent hires ticker shows 12 real names, properly
-- capitalized, zero placeholders.
--
-- rollback: re-apply prior fn def + UPDATE agents SET is_deactivated=false
-- WHERE display_name LIKE 'XAGENT%'.

-- ===== A. landing_live_stats truth-aligned =====
CREATE OR REPLACE FUNCTION public.landing_live_stats()
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT jsonb_build_object(
    'active_agents', (
      SELECT count(*)::int
      FROM agents
      WHERE status = 'active'
        AND NOT is_deactivated
        AND canonical_agent_id IS NULL
    ),
    'hires_recent',       (SELECT count(*)::int FROM landing_recent_hires()),
    'applications_30d',   (SELECT count(*)::int FROM applications WHERE created_at >= now() - interval '30 days'),
    'applications_total', (SELECT count(*)::int FROM applications),
    'carriers_partnered', 22,
    'generated_at',       now()
  );
$fn$;

-- ===== B. XAGENT placeholders out of every active surface =====
UPDATE public.agents
SET is_deactivated = true,
    updated_at = now()
WHERE display_name LIKE 'XAGENT%';

-- ===== C. Title-case lowercase names =====
UPDATE public.agents SET display_name = 'Logan Spatola',     updated_at = now() WHERE display_name = 'logan  spatola';
UPDATE public.agents SET display_name = 'Matias Touchstone', updated_at = now() WHERE display_name = 'matias touchstone';
UPDATE public.agents SET display_name = 'Dudley Bowman',     updated_at = now() WHERE display_name = 'dudley bowman';

-- ===== D. Orphan test-agent cleanup (Noor Shams) =====
-- The test cc_dispose roundtrip on 2026-06-19 03:17 UTC left these artifacts.
-- Safe to no-op if rows already gone (idempotent).
DELETE FROM public.agent_onboarding_queue WHERE agent_id = '6ba67443-ebe7-4cb4-be29-ea1d792aab9f'::uuid;
DELETE FROM public.agents WHERE id = '6ba67443-ebe7-4cb4-be29-ea1d792aab9f'::uuid;
UPDATE public.applications
SET status = 'new'::application_status, updated_at = now()
WHERE id = '4d6115d6-eb23-4a83-b9c2-3e8c53d538ae'::uuid
  AND status = 'onboarding'::application_status;
