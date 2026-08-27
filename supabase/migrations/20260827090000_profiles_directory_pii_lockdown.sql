-- MP-325: close the agent-to-agent PII read on public.profiles.
--
-- MEASURED BEFORE THE FIX (as real non-staff agent Johnathan Carter,
-- d6635596-7a56-4f8d-8454-e18bd9077bf9, via set local role authenticated):
--   613 profile rows visible / 613 emails / 168 phones.
-- The blanket policy "Authenticated users can view profiles for leaderboard"
-- has qual (auth.uid() IS NOT NULL). SELECT policies are OR'd, so that single
-- permissive policy handed the whole table to every logged-in account,
-- including self-signup. profiles is 613 rows -- agents AND recruits/applicants,
-- so this is recruit PII, not just staff contact details.
--
-- WHY A VIEW AND NOT A COLUMN REVOKE: a column-level REVOKE applies regardless
-- of row, so it would also have blocked a user reading their OWN email, and
-- would have 403'd the three select('*') calls in src/hooks/useAuth.ts -- the
-- login path. That is the white-screen this repo warned about. A row-policy
-- change leaves those working via "Users can view own profile" (verified: own
-- row still readable = 1 after the drop).
--
-- WHY THE VIEW IS STILL NEEDED: dropping the blanket policy alone takes a plain
-- agent to 2 visible rows, which also collapses the leaderboard's name lookup
-- (613 -> 2). The directory view restores names WITHOUT email/phone.
--
-- GRANTED TO authenticated ONLY, deliberately not anon: PlaqueShare (/plaque/:slug)
-- is a public route, but profiles has no anon policy today, so that read already
-- returns nothing for logged-out visitors. Granting anon here would publish 613
-- real names that are not public today -- a new leak opened by a security fix.
-- Current behaviour is preserved exactly.

create or replace view public.v_profile_directory as
  select id, user_id, full_name, avatar_url, instagram_handle
  from public.profiles;

-- Views run with the privileges of their OWNER unless security_invoker is set,
-- so this deliberately bypasses profiles RLS and exposes ONLY these 5 columns.
-- Asserted in the proof harness: adding email/phone here must fail the check.
alter view public.v_profile_directory set (security_invoker = false);

-- REVOKE ALL FIRST, THEN GRANT SELECT. This database has default privileges that
-- hand ALL (incl. INSERT/UPDATE/DELETE) on new tables/views to authenticated, and a
-- simple single-table view is AUTO-UPDATABLE. Combined with security_invoker=false
-- (owner-run, RLS bypassed) that made this view a WRITE path into profiles for every
-- logged-in account. PROVEN before this line existed: a plain agent successfully ran
-- UPDATE v_profile_directory SET full_name=... on another user's row (rolled back).
-- A read-lockdown that opens a write escalation is strictly worse than the leak it closes.
revoke all on public.v_profile_directory from anon, authenticated, public;
grant select on public.v_profile_directory to authenticated;

comment on view public.v_profile_directory is
  'MP-325: non-PII display directory (id, user_id, full_name, avatar_url, instagram_handle). '
  'Exists so agent-facing leaderboards can resolve names without base-table access to email/phone. '
  'NEVER add email, phone, or any contact column here -- apex-doctor Check #31 fails if you do.';

-- The actual close. Admins keep "Admins can view all profiles"; managers keep
-- "Managers can view all profiles for leaderboards" and "...their team profiles";
-- every user keeps "Users can view own profile" and "Agents can view their manager profile".
-- Only the plain-agent cross-user read is removed.
drop policy if exists "Authenticated users can view profiles for leaderboard" on public.profiles;
