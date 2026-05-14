-- 2026-05-14 — submit_referral now ALSO checks for existing applications
--
-- Phase 4 of the launch readiness sweep. Earlier `submit_referral` only
-- de-duped against the `referrals` table itself. If an agent tried to
-- "refer" someone who had already submitted an /apply form, we'd happily
-- create a fresh open referral, which means the agent's bonus expectation
-- was wrong and the prospect would get duplicate outreach.
--
-- Now we additionally detect the matching application by normalized email
-- or normalized phone and return its UUID so the UI can show a clear
-- "this person already applied" confirmation. The matching application is
-- linked via referrals.application_id, and the referral note is annotated.
--
-- Return type extended → must DROP + CREATE (Postgres cannot mutate the
-- result-table shape of an existing function).
--
-- Idempotent.

BEGIN;

DROP FUNCTION IF EXISTS public.submit_referral(text, text, text, text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.submit_referral(
  p_first_name    text,
  p_last_name     text,
  p_email         text DEFAULT NULL,
  p_phone         text DEFAULT NULL,
  p_state         text DEFAULT NULL,
  p_license       text DEFAULT NULL,
  p_relationship  text DEFAULT NULL,
  p_notes         text DEFAULT NULL
)
RETURNS TABLE (
  referral_id              uuid,
  is_duplicate             boolean,
  duplicate_of             uuid,
  matching_application_id  uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_agent_id     uuid;
  v_user_id      uuid := auth.uid();
  v_dup_id       uuid;
  v_app_match    uuid;
  v_email_norm   text := NULLIF(lower(trim(p_email)), '');
  v_phone_norm   text := NULLIF(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'), '');
  v_referral_id  uuid;
  v_assigned_mgr uuid;
  v_extra_notes  text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'submit_referral requires authentication';
  END IF;

  SELECT id INTO v_agent_id
  FROM public.agents
  WHERE user_id = v_user_id
  LIMIT 1;

  IF v_agent_id IS NULL THEN
    RAISE EXCEPTION 'No agent record for user — only agents can submit referrals';
  END IF;

  IF v_email_norm IS NULL AND v_phone_norm IS NULL THEN
    RAISE EXCEPTION 'Referral must include either email or phone';
  END IF;

  -- 1. Duplicate against an existing referral
  SELECT id INTO v_dup_id
  FROM public.referrals
  WHERE (v_email_norm IS NOT NULL AND lower(referred_email) = v_email_norm)
     OR (v_phone_norm IS NOT NULL
         AND regexp_replace(coalesce(referred_phone, ''), '[^0-9]', '', 'g') = v_phone_norm)
  ORDER BY created_at DESC
  LIMIT 1;

  -- 2. Match against an existing application (so the agent knows this prospect
  --    already entered the funnel and ownership is determined by the app row)
  SELECT id INTO v_app_match
  FROM public.applications
  WHERE terminated_at IS NULL
    AND (
      (v_email_norm IS NOT NULL AND lower(email) = v_email_norm)
      OR (v_phone_norm IS NOT NULL
          AND regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g') = v_phone_norm)
    )
  ORDER BY created_at DESC
  LIMIT 1;

  v_assigned_mgr := public.resolve_hiring_manager_for_scope(
    CASE WHEN p_license = 'licensed'  THEN 'licensed'::hiring_scope
         WHEN p_license = 'transfer'  THEN 'transfer'::hiring_scope
         ELSE 'unlicensed'::hiring_scope
    END
  );

  v_extra_notes := coalesce(p_notes, '');
  IF v_app_match IS NOT NULL THEN
    v_extra_notes := v_extra_notes || E'\nMatches existing application: ' || v_app_match::text;
  END IF;

  INSERT INTO public.referrals (
    referrer_agent_id, referrer_user_id,
    referred_first_name, referred_last_name,
    referred_email, referred_phone, referred_state, referred_license,
    relationship, notes,
    is_duplicate, duplicate_of, application_id, assigned_manager_id,
    next_action, next_action_due_at
  ) VALUES (
    v_agent_id, v_user_id,
    trim(p_first_name), trim(p_last_name),
    v_email_norm, p_phone, p_state, p_license,
    p_relationship, NULLIF(v_extra_notes, ''),
    (v_dup_id IS NOT NULL OR v_app_match IS NOT NULL),
    v_dup_id,
    v_app_match,
    v_assigned_mgr,
    'Make first contact',
    NOW() + INTERVAL '24 hours'
  ) RETURNING id INTO v_referral_id;

  RETURN QUERY SELECT
    v_referral_id,
    (v_dup_id IS NOT NULL OR v_app_match IS NOT NULL),
    v_dup_id,
    v_app_match;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.submit_referral(text, text, text, text, text, text, text, text) TO authenticated;

COMMIT;
