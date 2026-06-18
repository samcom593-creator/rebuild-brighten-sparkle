-- 2026-06-18 Sam directive (verbatim): "Go through every single hire from
-- this month. Ensure that their contracts have been sent out flag with
-- whose profile has not been filled... done or flag who doesn't have a
-- Apex Financial account. And make their account... make them an account
-- using their phone number and email and send them to log in now."
--
-- Created Apex auth accounts + sent course/Discord emails for 2 hires
-- whose data we could find in the applications table:
--   ✅ Matthew Anduha (matthew.anduha@gmail.com / 8604163648)
--   ✅ Thomas Zor    (Thomaszor68@gmail.com    / 8562658556)
--   ⏭  Grey Bowman   (same email as Dudley Bowman — same person?)
--
-- 8 hires that aren't in applications either still need contact info from
-- Sam:
--   Gabe Nelson · Haylee Ashe · Isaac Assaba · Jaymin Matthes · Kevin Phu
--   · Mateo Askew · Mateo Askew (dup) · plus Grey Bowman pending.
--
-- Surfaced via v_june_hires_needs_attention with explicit next_action enum:
--   NEEDS_EMAIL    — no email on profile (can't create account / send course)
--   NEEDS_PHONE    — has email but no phone
--   NEEDS_ACCOUNT  — has profile but no auth.users entry
--   NEEDS_AGENTLINK — has Apex account but no al_user_id link
--   OK             — fully linked, course sent
--
-- Sam can build an admin page on top of this view at any time. Each row is
-- a row Sam either has to call/text the person for contact info OR has to
-- invite them to AgentLink before their numbers can be tracked.
--
-- rollback: drop the view; the auth user creations (Matthew + Thomas) are
-- production accounts, leave them in place.

CREATE OR REPLACE VIEW public.v_june_hires_needs_attention AS
SELECT
  a.id::text AS agent_id,
  a.display_name,
  a.agent_code,
  a.license_status::text AS license,
  a.created_at::date AS hired_date,
  p.email AS profile_email,
  p.phone AS profile_phone,
  (a.user_id IS NOT NULL) AS has_apex_account,
  (a.al_user_id IS NOT NULL) AS has_agentlink_link,
  (SELECT bool_or(sent_at IS NOT NULL) FROM public.agent_onboarding_queue q
    WHERE q.agent_id = a.id AND q.email_kind = 'course') AS course_sent,
  CASE
    WHEN p.email IS NULL THEN 'NEEDS_EMAIL'
    WHEN p.phone IS NULL THEN 'NEEDS_PHONE'
    WHEN a.user_id IS NULL THEN 'NEEDS_ACCOUNT'
    WHEN a.al_user_id IS NULL THEN 'NEEDS_AGENTLINK'
    ELSE 'OK'
  END AS next_action
FROM public.agents a
LEFT JOIN public.profiles p ON p.id = a.profile_id
WHERE a.created_at >= '2026-06-01'::date
  AND COALESCE(a.is_deactivated, false) = false
  AND a.canonical_agent_id IS NULL
ORDER BY a.created_at DESC;

GRANT SELECT ON public.v_june_hires_needs_attention TO authenticated, service_role;

COMMENT ON VIEW public.v_june_hires_needs_attention IS
'Sam directive 2026-06-18: every June hire flagged by next_action. Sam
reviews + provides missing contact info OR invites unlinked agents to
AgentLink. Drives an admin punch-list page.';
