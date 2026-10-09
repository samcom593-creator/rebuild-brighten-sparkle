-- PL-WIB-LEADERBOARD-PROFILES-PII (2026-10-09)
--
-- get_leaderboard_profiles() is SECURITY DEFINER and was granted to PUBLIC/anon.
-- Measured on live prod with the public anon key from the deployed bundle
-- (index-CoDW6KMy.js), no sign-in: 200, 692 rows of (user_id, full_name, avatar_url),
-- one per profile with a user_id. 446 of them carried an email address: 445 store the
-- email AS full_name, and 89 embed it in a ui-avatars.com URL (?name=<email>).
-- 431 of those 446 are not agents (applicants and other sign-ups). MP-325 closed
-- profiles.email to signed-in accounts on 2026-08-27; this function handed the same
-- addresses to anyone with the public key, because full_name and avatar_url were
-- assumed to be "display identity" and were not.
--
-- Every caller (agentDisplayNames.resolveAgentNames, BuildingLeaderboard,
-- CompactLeaderboard, LeaderboardTabs) filters the result to agents' user_ids and falls
-- back to agents.display_name when full_name is empty. All of them render inside
-- signed-in dashboard pages. So:
--   1. rows are limited to profiles whose user_id belongs to an agent (202 of 692);
--   2. an email-shaped full_name or avatar_url comes back NULL. 14 agents' leaderboard
--      name is currently their email; all 14 have a display_name, which the callers
--      already use next;
--   3. anon/PUBLIC lose EXECUTE; authenticated and service_role keep it.
--
-- Also closed here (no browser caller, measured anon 200 with names + production):
--   get_daily_leaderboard / get_weekly_leaderboard: only discord-leaderboards calls them,
--   with SUPABASE_SERVICE_ROLE_KEY. The public key returned each producer's name,
--   Instagram handle and daily/weekly AOP. Revoked from PUBLIC, anon, authenticated.
--   next_step_message_stats_24h: read only by AdminFunnelHealth (signed in). Anon closed.
--
-- apex-doctor Check #96 holds the grants (anon_closed / closed) and, for
-- get_leaderboard_profiles, calls the function and goes CRITICAL if any row carries
-- an email or a non-agent user_id.

CREATE OR REPLACE FUNCTION public.get_leaderboard_profiles()
 RETURNS TABLE(user_id uuid, full_name text, avatar_url text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT p.user_id,
         CASE WHEN p.full_name LIKE '%@%' THEN NULL ELSE p.full_name END,
         CASE WHEN p.avatar_url ~* '(@|%40)' THEN NULL ELSE p.avatar_url END
  FROM public.profiles p
  WHERE p.user_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.agents a WHERE a.user_id = p.user_id);
$function$;

REVOKE EXECUTE ON FUNCTION public.get_leaderboard_profiles() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_leaderboard_profiles() TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.get_daily_leaderboard(date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_daily_leaderboard(date) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_weekly_leaderboard(date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_weekly_leaderboard(date, date) TO service_role;

REVOKE EXECUTE ON FUNCTION public.next_step_message_stats_24h(timestamp with time zone) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.next_step_message_stats_24h(timestamp with time zone) TO authenticated, service_role;
