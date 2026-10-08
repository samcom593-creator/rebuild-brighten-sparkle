-- PL-WIB-SECDEF-STAFF-GATE (2026-10-08). Hand-applied via bot-sql at ~18:35Z.
-- CREATE OR REPLACE throughout, so a CI re-apply is a no-op. Function bodies were
-- generated from the LIVE pg_get_functiondef, not from older migration files, so this
-- adds one guard line and changes nothing else in any body.
--
-- 20261008171600 took these functions away from the public key and kept them for every
-- signed-in account, noting that open signup means signed-in is not staff. Measured:
-- /auth/v1/settings says disable_signup=false, and handle_new_user gives every new
-- account role 'agent'. 554 accounts hold agent and nothing else. As one of them
-- (apex-sql-as.sh, rolled back) sam_todo_list returned Sam's 10 to-dos,
-- sync_health_summary returned, and mark_phone_bad updated a real applicant's row.
-- None of the 13 read the caller's role.
--
-- Each function now refuses (42501) any signed-in caller whose role the page that calls
-- it does not admit. The role lists copy the ProtectedRoute on each page in src/App.tsx,
-- so a person who can open the page can still press the button. Callers with no user id
-- (service_role key, pg_cron, bot-sql, the external cron backup) pass, as before. No
-- other database function, trigger or cron.job calls any of the 13 (control: the same
-- search finds 63 callers of has_role).
--
-- Left signed-in on purpose: apex_dashboard_summary and get_agent_production_stats are
-- read by the agent portal (/agent-portal, any signed-in agent). Gating them on staff
-- would blank the agent's own dashboard.

CREATE OR REPLACE FUNCTION public.fn_require_caller_role(p_roles public.app_role[], p_allow_presenter boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    -- No user id: the service_role key, pg_cron, bot-sql or a direct session. The public
    -- key has no user id either, so refuse it by name: if a later grant gives anon
    -- EXECUTE again, it must not ride this branch.
    IF coalesce(auth.role(), '') IN ('anon', 'authenticated') THEN
      RAISE EXCEPTION 'permission denied: sign-in required' USING ERRCODE = '42501';
    END IF;
    RETURN;
  END IF;

  IF EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = v_uid AND role = ANY (p_roles)) THEN
    RETURN;
  END IF;

  -- /dashboard/seminar also admits an agent who is presenting (ProtectedRoute allowPresenters).
  IF p_allow_presenter AND EXISTS (SELECT 1 FROM public.agents WHERE user_id = v_uid AND is_presenting) THEN
    RETURN;
  END IF;

  RAISE EXCEPTION 'permission denied: requires one of %', p_roles USING ERRCODE = '42501';
END;
$function$;

-- Only ever called from inside the postgres-owned definer functions below, which run it
-- with the owner's privileges. Nobody needs to call it directly.
REVOKE ALL ON FUNCTION public.fn_require_caller_role(public.app_role[], boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_require_caller_role(public.app_role[], boolean) TO service_role;

-- advance_referral_status(uuid,referral_status,text): /dashboard/referrals
CREATE OR REPLACE FUNCTION public.advance_referral_status(p_referral_id uuid, p_new_status referral_status, p_note text DEFAULT NULL::text)
 RETURNS referrals
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_row public.referrals;
BEGIN
  PERFORM public.fn_require_caller_role(ARRAY['admin','manager']::public.app_role[]);
  UPDATE public.referrals
  SET status        = p_new_status,
      contacted_at  = CASE WHEN p_new_status = 'contacted'  AND contacted_at IS NULL THEN NOW() ELSE contacted_at END,
      booked_at     = CASE WHEN p_new_status = 'booked'     AND booked_at IS NULL THEN NOW() ELSE booked_at END,
      attended_at   = CASE WHEN p_new_status = 'attended'   AND attended_at IS NULL THEN NOW() ELSE attended_at END,
      onboarded_at  = CASE WHEN p_new_status = 'onboarded'  AND onboarded_at IS NULL THEN NOW() ELSE onboarded_at END,
      licensed_at   = CASE WHEN p_new_status = 'licensed'   AND licensed_at IS NULL THEN NOW() ELSE licensed_at END,
      contracted_at = CASE WHEN p_new_status = 'contracted' AND contracted_at IS NULL THEN NOW() ELSE contracted_at END,
      producing_at  = CASE WHEN p_new_status = 'producing'  AND producing_at IS NULL THEN NOW() ELSE producing_at END,
      rejected_at   = CASE WHEN p_new_status = 'rejected'   AND rejected_at IS NULL THEN NOW() ELSE rejected_at END,
      rejected_reason = COALESCE(p_note, rejected_reason),
      notes         = COALESCE(notes, '') || CASE WHEN p_note IS NULL THEN '' ELSE E'\n['||to_char(NOW(),'YYYY-MM-DD HH24:MI')||'] '||p_note END,
      updated_at    = NOW()
  WHERE id = p_referral_id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$function$;

-- agentlink_award_top_producers(): DashboardCommandCenter (/dashboard/admin)
CREATE OR REPLACE FUNCTION public.agentlink_award_top_producers()
 RETURNS TABLE(period_out text, awarded integer)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_today date := (NOW() AT TIME ZONE 'America/Chicago')::date;
  v_week_start date := date_trunc('week', NOW() AT TIME ZONE 'America/Chicago')::date;
  v_month_start date := date_trunc('month', NOW() AT TIME ZONE 'America/Chicago')::date;
  v_daily int := 0; v_weekly int := 0; v_monthly int := 0;
BEGIN
  PERFORM public.fn_require_caller_role(ARRAY['admin']::public.app_role[]);
  WITH daily AS (
    SELECT a.id AS agent_id,
      COUNT(*)::int AS dc,
      ROUND(SUM(d.annual_premium)::numeric, 2) AS ap,
      ROUND(SUM(d.monthly_premium)::numeric, 2) AS mp_,
      ROW_NUMBER() OVER (ORDER BY SUM(d.annual_premium) DESC, COUNT(*) DESC) AS rnk
    FROM public.deals d
    JOIN public.agents a ON a.id = d.agent_id
    WHERE d.status IN ('submitted','active')
      AND (d.posted_at AT TIME ZONE 'America/Chicago')::date = v_today
    GROUP BY a.id
    HAVING COUNT(*) > 0
  )
  INSERT INTO public.leaderboard_snapshots (snapshot_date, period, rank, agent_id, deals, alp, mp)
  SELECT v_today, 'daily', rnk::int, agent_id, dc, ap, mp_ FROM daily WHERE rnk <= 10
  ON CONFLICT (snapshot_date, period, rank) DO UPDATE
    SET agent_id = EXCLUDED.agent_id, deals = EXCLUDED.deals, alp = EXCLUDED.alp, mp = EXCLUDED.mp;

  WITH top3 AS (
    SELECT s.agent_id, s.rank, s.deals, s.alp FROM public.leaderboard_snapshots s
    WHERE s.snapshot_date = v_today AND s.period = 'daily' AND s.rank <= 3
  )
  INSERT INTO public.agentlink_rewards (agent_id, period, period_key, rank, title, description, alp, deals)
  SELECT agent_id, 'daily', to_char(v_today,'YYYY-MM-DD'), rank,
    CASE rank WHEN 1 THEN 'Daily #1' WHEN 2 THEN 'Daily #2' ELSE 'Daily #3' END,
    format('%s deals · $%s ALP on %s', deals, alp::text, to_char(v_today,'Mon DD')),
    alp, deals
  FROM top3
  ON CONFLICT (agent_id, period, period_key, rank) DO NOTHING;
  GET DIAGNOSTICS v_daily = ROW_COUNT;

  -- weekly
  WITH weekly AS (
    SELECT a.id AS agent_id,
      COUNT(*)::int AS dc,
      ROUND(SUM(d.annual_premium)::numeric, 2) AS ap,
      ROUND(SUM(d.monthly_premium)::numeric, 2) AS mp_,
      ROW_NUMBER() OVER (ORDER BY SUM(d.annual_premium) DESC, COUNT(*) DESC) AS rnk
    FROM public.deals d
    JOIN public.agents a ON a.id = d.agent_id
    WHERE d.status IN ('submitted','active')
      AND (d.posted_at AT TIME ZONE 'America/Chicago')::date BETWEEN v_week_start AND v_today
    GROUP BY a.id
    HAVING COUNT(*) > 0
  )
  INSERT INTO public.leaderboard_snapshots (snapshot_date, period, rank, agent_id, deals, alp, mp)
  SELECT v_today, 'weekly', rnk::int, agent_id, dc, ap, mp_ FROM weekly WHERE rnk <= 10
  ON CONFLICT (snapshot_date, period, rank) DO UPDATE
    SET agent_id = EXCLUDED.agent_id, deals = EXCLUDED.deals, alp = EXCLUDED.alp, mp = EXCLUDED.mp;
  GET DIAGNOSTICS v_weekly = ROW_COUNT;

  -- monthly
  WITH monthly AS (
    SELECT a.id AS agent_id,
      COUNT(*)::int AS dc,
      ROUND(SUM(d.annual_premium)::numeric, 2) AS ap,
      ROUND(SUM(d.monthly_premium)::numeric, 2) AS mp_,
      ROW_NUMBER() OVER (ORDER BY SUM(d.annual_premium) DESC, COUNT(*) DESC) AS rnk
    FROM public.deals d
    JOIN public.agents a ON a.id = d.agent_id
    WHERE d.status IN ('submitted','active')
      AND (d.posted_at AT TIME ZONE 'America/Chicago')::date BETWEEN v_month_start AND v_today
    GROUP BY a.id
    HAVING COUNT(*) > 0
  )
  INSERT INTO public.leaderboard_snapshots (snapshot_date, period, rank, agent_id, deals, alp, mp)
  SELECT v_today, 'monthly', rnk::int, agent_id, dc, ap, mp_ FROM monthly WHERE rnk <= 10
  ON CONFLICT (snapshot_date, period, rank) DO UPDATE
    SET agent_id = EXCLUDED.agent_id, deals = EXCLUDED.deals, alp = EXCLUDED.alp, mp = EXCLUDED.mp;
  GET DIAGNOSTICS v_monthly = ROW_COUNT;

  RETURN QUERY VALUES
    ('daily',   v_daily),
    ('weekly',  v_weekly),
    ('monthly', v_monthly);
END;
$function$;

-- agentlink_live_pull(): DashboardCommandCenter (/dashboard/admin); cron backup via bot-sql
CREATE OR REPLACE FUNCTION public.agentlink_live_pull()
 RETURNS agentlink_sync_log
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions', 'net'
 SET statement_timeout TO '90s'
AS $function$
DECLARE
  v_log public.agentlink_sync_log;
  v_cookie text;
  v_req bigint;
  v_resp net.http_response_result;
  v_status_code int;
  v_body text;
  v_payload jsonb;
  v_seen int := 0;
  v_inserted int := 0;
  v_updated int := 0;
BEGIN
  PERFORM public.fn_require_caller_role(ARRAY['admin']::public.app_role[]);
  -- Prevent overlapping cron/GitHub/manual pulls from fighting over the
  -- same policy rows or piling up stuck upstream requests.
  IF NOT pg_try_advisory_xact_lock(hashtext('agentlink_live_pull')) THEN
    INSERT INTO public.agentlink_sync_log (finished_at, status, error_message)
    VALUES (now(), 'error', 'deals: another AgentLink pull is already running')
    RETURNING * INTO v_log;
    RETURN v_log;
  END IF;

  INSERT INTO public.agentlink_sync_log (status, error_message)
  VALUES ('running', 'deals')
  RETURNING * INTO v_log;

  SELECT value INTO v_cookie
  FROM public.system_settings
  WHERE key = 'agent_link_session_cookie';

  IF v_cookie IS NULL OR length(v_cookie) < 20 THEN
    UPDATE public.agentlink_sync_log
    SET finished_at = now(),
        status = 'no_cookie',
        error_message = 'deals: no cookie'
    WHERE id = v_log.id
    RETURNING * INTO v_log;
    RETURN v_log;
  END IF;

  v_req := net.http_get(
    url := 'https://agentlink.insuracloud.ai/api/deals',
    headers := jsonb_build_object(
      'Cookie', v_cookie,
      'Accept', 'application/json',
      'User-Agent', 'APEX/1.1'
    ),
    timeout_milliseconds := 30000
  );

  UPDATE public.agentlink_sync_log
  SET http_request_id = v_req
  WHERE id = v_log.id;

  v_resp := net.http_collect_response(v_req, async := false);
  v_status_code := (v_resp.response).status_code;
  v_body := (v_resp.response).body;

  UPDATE public.agentlink_sync_log
  SET upstream_status = v_status_code
  WHERE id = v_log.id;

  IF v_resp.status::text <> 'SUCCESS' OR v_status_code NOT BETWEEN 200 AND 299 THEN
    UPDATE public.agentlink_sync_log
    SET finished_at = now(),
        status = 'error',
        error_message = format('deals HTTP %s: %s', coalesce(v_status_code, 0), left(coalesce(v_body, ''), 220))
    WHERE id = v_log.id
    RETURNING * INTO v_log;
    RETURN v_log;
  END IF;

  BEGIN
    v_payload := v_body::jsonb;
  EXCEPTION WHEN others THEN
    UPDATE public.agentlink_sync_log
    SET finished_at = now(),
        status = 'error',
        error_message = 'deals: non-JSON'
    WHERE id = v_log.id
    RETURNING * INTO v_log;
    RETURN v_log;
  END;

  IF jsonb_typeof(v_payload) <> 'array' THEN
    UPDATE public.agentlink_sync_log
    SET finished_at = now(),
        status = 'error',
        error_message = 'deals: unexpected payload shape'
    WHERE id = v_log.id
    RETURNING * INTO v_log;
    RETURN v_log;
  END IF;

  v_seen := jsonb_array_length(v_payload);
  IF v_seen = 0 THEN
    UPDATE public.agentlink_sync_log
    SET finished_at = now(),
        status = 'empty',
        policies_seen = 0,
        error_message = 'deals: empty'
    WHERE id = v_log.id
    RETURNING * INTO v_log;
    RETURN v_log;
  END IF;

  CREATE TEMP TABLE tmp_agentlink_deals ON COMMIT DROP AS
  WITH raw AS (
    SELECT jsonb_array_elements(v_payload) AS d
  ),
  resolved AS (
    SELECT
      d,
      NULLIF(d->>'id', '')::text AS external_id,
      (
        SELECT a.id
        FROM public.agents a
        WHERE a.insuracloud_user_id = CASE
          WHEN NULLIF(d->>'userId', '') ~ '^\d+$' THEN NULLIF(d->>'userId', '')::int
          ELSE NULL::int
        END
        LIMIT 1
      ) AS agent_id,
      (
        SELECT c.id
        FROM public.carriers c
        WHERE c.insuracloud_carrier_id = CASE
          WHEN NULLIF(d->>'carrierId', '') ~ '^\d+$' THEN NULLIF(d->>'carrierId', '')::int
          ELSE NULL::int
        END
        LIMIT 1
      ) AS carrier_id,
      d->'policyStatus'->>'standardStatus' AS al_status_raw,
      COALESCE(NULLIF(d->>'policyNumber', ''), NULLIF(d->>'id', '')) AS policy_number_raw,
      CASE
        WHEN NULLIF(d->>'createdAt', '') ~ '^\d{4}-\d{2}-\d{2}' THEN NULLIF(d->>'createdAt', '')::timestamptz
        ELSE NULL::timestamptz
      END AS posted_at_raw,
      CASE
        WHEN NULLIF(d->>'clientDateOfBirth', '') ~ '^\d{4}-\d{2}-\d{2}'
          THEN NULLIF(d->>'clientDateOfBirth', '')::date
        ELSE '1970-01-01'::date
      END AS client_dob_raw,
      CASE
        WHEN NULLIF(d->>'effectiveDate', '') ~ '^\d{4}-\d{2}-\d{2}'
          THEN NULLIF(d->>'effectiveDate', '')::date
        ELSE CURRENT_DATE
      END AS effective_date_raw,
      CASE
        WHEN NULLIF(d->>'policyExpirationDate', '') ~ '^\d{4}-\d{2}-\d{2}'
          THEN NULLIF(d->>'policyExpirationDate', '')::date
        ELSE NULL::date
      END AS policy_expiration_date_raw,
      COALESCE(NULLIF(regexp_replace(coalesce(d->>'monthlyPremium', ''), '[^0-9.\-]', '', 'g'), '')::numeric, 0) AS monthly_premium_raw,
      COALESCE(NULLIF(regexp_replace(coalesce(d->>'annualPremium', ''), '[^0-9.\-]', '', 'g'), '')::numeric, 0) AS annual_premium_raw,
      COALESCE(NULLIF(regexp_replace(coalesce(d->>'faceAmount', ''), '[^0-9.\-]', '', 'g'), '')::numeric, 0) AS face_amount_raw
    FROM raw
  )
  SELECT
    agent_id,
    carrier_id,
    COALESCE(NULLIF(d->>'clientFirstName', ''), 'Unknown') AS client_first_name,
    COALESCE(NULLIF(d->>'clientLastName', ''), 'Unknown') AS client_last_name,
    COALESCE(NULLIF(d->>'clientPhoneNumber', ''), 'UNKNOWN') AS client_phone,
    client_dob_raw AS client_dob,
    COALESCE(NULLIF(d->>'productSold', ''), 'Life Insurance') AS product_sold,
    policy_number_raw AS policy_number,
    monthly_premium_raw AS monthly_premium,
    COALESCE(NULLIF(annual_premium_raw, 0), monthly_premium_raw * 12, 0) AS annual_premium,
    face_amount_raw AS face_amount,
    effective_date_raw AS effective_date,
    policy_expiration_date_raw AS policy_expiration_date,
    public.map_al_status(al_status_raw) AS status,
    al_status_raw AS policy_status_standard,
    CASE public.map_al_status(al_status_raw)
      WHEN 'active' THEN 'approved'
      WHEN 'lapsed' THEN 'lapsed'
      ELSE 'submitted'
    END AS pipeline_stage,
    external_id,
    NULLIF(d->>'notes', '') AS notes,
    posted_at_raw
  FROM resolved
  WHERE agent_id IS NOT NULL
    AND policy_number_raw IS NOT NULL
    AND agent_id NOT IN (SELECT * FROM public.sam_agent_ids_to_exclude());

  WITH upd AS (
    UPDATE public.deals d
    SET carrier_id = COALESCE(t.carrier_id, d.carrier_id),
        client_first_name = t.client_first_name,
        client_last_name = t.client_last_name,
        client_phone = t.client_phone,
        client_dob = t.client_dob,
        product_sold = t.product_sold,
        monthly_premium = t.monthly_premium,
        annual_premium = t.annual_premium,
        face_amount = t.face_amount,
        effective_date = t.effective_date,
        policy_expiration_date = t.policy_expiration_date,
        status = t.status,
        policy_status_standard = t.policy_status_standard,
        status_updated_at = CASE WHEN d.status IS DISTINCT FROM t.status THEN now() ELSE d.status_updated_at END,
        source = 'agent_link',
        pipeline_stage = t.pipeline_stage,
        notes = t.notes,
        posted_at = COALESCE(t.posted_at_raw, d.posted_at, t.effective_date::timestamptz),
        updated_at = now()
    FROM tmp_agentlink_deals t
    WHERE d.agent_id = t.agent_id
      AND d.policy_number = t.policy_number
    RETURNING d.id
  )
  SELECT count(*)::int INTO v_updated FROM upd;

  WITH ins AS (
    INSERT INTO public.deals (
      agent_id, carrier_id, client_first_name, client_last_name, client_phone, client_dob,
      product_sold, policy_number, monthly_premium, annual_premium, face_amount,
      effective_date, policy_expiration_date, status, policy_status_standard, status_updated_at,
      source, pipeline_stage, external_deal_id, notes, posted_at
    )
    SELECT
      t.agent_id, t.carrier_id, t.client_first_name, t.client_last_name, t.client_phone, t.client_dob,
      t.product_sold, t.policy_number, t.monthly_premium, t.annual_premium, t.face_amount,
      t.effective_date, t.policy_expiration_date, t.status, t.policy_status_standard, now(),
      'agent_link', t.pipeline_stage, t.external_id, t.notes,
      COALESCE(t.posted_at_raw, t.effective_date::timestamptz)
    FROM tmp_agentlink_deals t
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.deals d
      WHERE d.agent_id = t.agent_id
        AND d.policy_number = t.policy_number
    )
    ON CONFLICT (external_deal_id) DO NOTHING
    RETURNING id
  )
  SELECT count(*)::int INTO v_inserted FROM ins;

  UPDATE public.agentlink_sync_log
  SET finished_at = now(),
      status = 'ok',
      policies_seen = v_seen,
      deals_inserted = v_inserted,
      deals_updated = v_updated,
      error_message = format('deals: %s new, %s updated', v_inserted, v_updated)
  WHERE id = v_log.id
  RETURNING * INTO v_log;

  RETURN v_log;
EXCEPTION WHEN others THEN
  IF v_log.id IS NOT NULL THEN
    UPDATE public.agentlink_sync_log
    SET finished_at = now(),
        status = 'error',
        error_message = left('deals: ' || SQLERRM, 500)
    WHERE id = v_log.id
    RETURNING * INTO v_log;
    RETURN v_log;
  END IF;
  RAISE;
END;
$function$;

-- fn_match_carrier_policy_agents(): /dashboard/book-quality
CREATE OR REPLACE FUNCTION public.fn_match_carrier_policy_agents()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_matched integer := 0;
BEGIN
  PERFORM public.fn_require_caller_role(ARRAY['admin','manager']::public.app_role[]);
  -- 1. Email match
  UPDATE carrier_policies cp
  SET agent_id = a.id, agent_match_method = 'email', matched_at = now()
  FROM agents a
  JOIN auth.users u ON u.id = a.user_id
  WHERE cp.agent_id IS NULL
    AND cp.agent_raw ILIKE '%@%'
    AND lower(u.email) = lower(trim(cp.agent_raw));
  GET DIAGNOSTICS v_matched = ROW_COUNT;

  -- 2. "LAST/ FIRST" pattern (American Amicable rendering)
  UPDATE carrier_policies cp
  SET agent_id = a.id, agent_match_method = 'lastfirst', matched_at = now()
  FROM agents a
  LEFT JOIN profiles p ON p.id = a.profile_id
  WHERE cp.agent_id IS NULL
    AND cp.agent_raw LIKE '%/%'
    AND lower(trim(split_part(cp.agent_raw, '/', 2))) = lower(split_part(COALESCE(a.display_name, p.full_name), ' ', 1))
    AND lower(trim(split_part(cp.agent_raw, '/', 1))) = lower(split_part(COALESCE(a.display_name, p.full_name), ' ', -1));

  -- 3. "First Last" exact (case-insensitive) on display_name or profile.full_name
  UPDATE carrier_policies cp
  SET agent_id = a.id, agent_match_method = 'name', matched_at = now()
  FROM agents a
  LEFT JOIN profiles p ON p.id = a.profile_id
  WHERE cp.agent_id IS NULL
    AND cp.agent_raw NOT LIKE '%@%'
    AND cp.agent_raw NOT LIKE '%/%'
    AND lower(trim(cp.agent_raw)) = lower(COALESCE(a.display_name, p.full_name));

  RETURN v_matched;
END $function$;

-- fn_match_xcel_students(): /dashboard/pre-licensing
CREATE OR REPLACE FUNCTION public.fn_match_xcel_students()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_matched integer := 0;
BEGIN
  PERFORM public.fn_require_caller_role(ARRAY['admin','manager']::public.app_role[]);
  -- Match by email first (highest signal)
  UPDATE xcel_pre_licensing_students s
  SET application_id = a.id, matched_at = now()
  FROM applications a
  WHERE s.application_id IS NULL
    AND s.email IS NOT NULL
    AND lower(a.email) = lower(s.email)
    AND a.terminated_at IS NULL;
  GET DIAGNOSTICS v_matched = ROW_COUNT;

  -- Then by phone fallback (last 10 digits)
  WITH digits AS (
    SELECT s.id AS sid, regexp_replace(s.phone, '\D', '', 'g') AS sp
    FROM xcel_pre_licensing_students s
    WHERE s.application_id IS NULL AND s.phone IS NOT NULL
  ),
  matched AS (
    SELECT d.sid, a.id AS aid
    FROM digits d
    JOIN applications a ON regexp_replace(a.phone, '\D', '', 'g') = d.sp
                       AND a.terminated_at IS NULL
                       AND length(d.sp) >= 10
  )
  UPDATE xcel_pre_licensing_students s
  SET application_id = m.aid, matched_at = now()
  FROM matched m
  WHERE s.id = m.sid;

  -- Propagate progress back to applications.license_progress (real type).
  UPDATE applications a
  SET
    license_progress = (
      CASE
        WHEN s.pct_complete >= 100 AND a.license_progress NOT IN ('test_scheduled','waiting_on_license','fingerprints_done','licensed')
          THEN 'finished_course'::license_progress
        WHEN s.pct_complete > 0 AND a.license_progress = 'unlicensed'
          THEN 'course_purchased'::license_progress
        ELSE a.license_progress
      END
    ),
    course_started_at = COALESCE(a.course_started_at, s.date_enrolled::timestamptz),
    course_purchased_at = COALESCE(a.course_purchased_at, s.date_enrolled::timestamptz)
  FROM xcel_pre_licensing_students s
  WHERE s.application_id = a.id
    AND s.report_id = (SELECT id FROM xcel_pre_licensing_reports ORDER BY report_date DESC LIMIT 1)
    AND a.terminated_at IS NULL;

  RETURN v_matched;
END
$function$;

-- kj_seminar_metrics(): /dashboard/seminar* (allowPresenters)
CREATE OR REPLACE FUNCTION public.kj_seminar_metrics()
 RETURNS jsonb
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.fn_require_caller_role(ARRAY['admin','manager']::public.app_role[], true);
  SELECT jsonb_build_object(
    'as_of', NOW(),
    'upcoming_total',         (SELECT COUNT(*)::int FROM public.v_kj_seminar_control WHERE stage='upcoming'),
    'next_seminar_date',      (SELECT MIN(seminar_date) FROM public.v_kj_seminar_control WHERE stage='upcoming'),
    'no_shows_30d',           (SELECT COUNT(*)::int FROM public.v_kj_seminar_control WHERE stage='no_show' AND seminar_date >= CURRENT_DATE - INTERVAL '30 days'),
    'attended_30d',           (SELECT COUNT(*)::int FROM public.v_kj_seminar_control WHERE attended=true AND seminar_date >= CURRENT_DATE - INTERVAL '30 days'),
    'attended_unpaid',        (SELECT COUNT(*)::int FROM public.v_kj_seminar_control WHERE stage='attended_unpaid'),
    'paid_pre_licensing',     (SELECT COUNT(*)::int FROM public.v_kj_seminar_control WHERE stage='paid_pre_licensing'),
    'in_licensing',           (SELECT COUNT(*)::int FROM public.v_kj_seminar_control WHERE stage='in_licensing'),
    'licensed_pre_contract',  (SELECT COUNT(*)::int FROM public.v_kj_seminar_control WHERE stage='licensed_pre_contract'),
    'contracted_no_deal',     (SELECT COUNT(*)::int FROM public.v_kj_seminar_control WHERE stage='contracted_no_deal'),
    'active_producers',       (SELECT COUNT(*)::int FROM public.v_kj_seminar_control WHERE stage='active_producer'),
    'conversion_funnel', jsonb_build_object(
        'registered',  (SELECT COUNT(*)::int FROM public.v_kj_seminar_control),
        'attended',    (SELECT COUNT(*)::int FROM public.v_kj_seminar_control WHERE attended=true),
        'paid',        (SELECT COUNT(*)::int FROM public.v_kj_seminar_control WHERE ica_paid=true),
        'licensed',    (SELECT COUNT(*)::int FROM public.v_kj_seminar_control WHERE app_license_progress='licensed'),
        'contracted',  (SELECT COUNT(*)::int FROM public.v_kj_seminar_control WHERE agent_contracted_at IS NOT NULL),
        'producing',   (SELECT COUNT(*)::int FROM public.v_kj_seminar_control WHERE first_deal_at IS NOT NULL)
    )
  );
$function$;

-- mark_phone_bad(uuid,text): /dashboard/recruiting
CREATE OR REPLACE FUNCTION public.mark_phone_bad(p_application_id uuid, p_reason text DEFAULT NULL::text)
 RETURNS TABLE(id uuid, phone_bad_at timestamp with time zone, phone_bad_reason text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.fn_require_caller_role(ARRAY['admin','manager','va_manager','va','recruiter']::public.app_role[]);
  UPDATE public.applications AS a
     SET phone_bad_at = COALESCE(a.phone_bad_at, now()),
         phone_bad_reason = COALESCE(p_reason, a.phone_bad_reason)
   WHERE a.id = p_application_id
   RETURNING a.id, a.phone_bad_at, a.phone_bad_reason;
$function$;

-- promote_aged_lead_to_application(uuid): /admin/unlicensed-all
CREATE OR REPLACE FUNCTION public.promote_aged_lead_to_application(p_aged_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_al aged_leads%ROWTYPE;
  v_new_app_id uuid;
BEGIN
  PERFORM public.fn_require_caller_role(ARRAY['admin','manager','va_manager','va']::public.app_role[]);
  SELECT * INTO v_al FROM aged_leads WHERE id = p_aged_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'aged_lead % not found', p_aged_id; END IF;

  -- Idempotency: if we already promoted, skip
  IF v_al.status = 'promoted_to_application' THEN
    RETURN v_al.id; -- no-op
  END IF;

  INSERT INTO applications (
    first_name, last_name, email, phone, state, notes,
    license_status, license_progress, instagram_handle,
    referral_source, assigned_agent_id, assigned_va_id,
    last_contacted_at
  ) VALUES (
    v_al.first_name, v_al.last_name, v_al.email, v_al.phone, v_al.state,
    COALESCE(v_al.notes, v_al.about_me),
    'unlicensed'::license_status,
    COALESCE(v_al.license_progress, 'unlicensed')::license_progress,
    v_al.instagram_handle,
    'aged_lead_excel_import',
    v_al.assigned_agent_id, v_al.assigned_va_id,
    v_al.last_contacted_at
  ) RETURNING id INTO v_new_app_id;

  UPDATE aged_leads SET status = 'promoted_to_application', processed_at = now()
   WHERE id = p_aged_id;

  RETURN v_new_app_id;
END;
$function$;

-- sam_todo_list(): /dashboard/sam-todo
CREATE OR REPLACE FUNCTION public.sam_todo_list()
 RETURNS TABLE(source text, source_id text, text text, status text, created_at timestamp with time zone, due_at timestamp with time zone, priority integer, link text)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.fn_require_caller_role(ARRAY['admin']::public.app_role[]);
  select source, source_id, text, status, created_at, due_at, priority, link
  from v_sam_todo
  order by priority asc, coalesce(due_at, created_at) asc, created_at desc
  limit 250
$function$;

-- sync_health_summary(): Dashboard.tsx, role === 'admin' only
CREATE OR REPLACE FUNCTION public.sync_health_summary()
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT public.fn_require_caller_role(ARRAY['admin']::public.app_role[]);
  SELECT jsonb_build_object(
    'as_of', NOW(),
    'sources', jsonb_agg(jsonb_build_object(
      'source', source,
      'last_attempt_at', last_attempt_at,
      'last_success_at', last_success_at,
      'last_status', last_status,
      'last_error', last_error,
      'stale_minutes', stale_minutes,
      'stale_threshold_minutes', stale_threshold_minutes,
      'is_stale', is_stale,
      'is_partial', is_partial,
      'action_required', action_required
    ) ORDER BY source),
    'any_stale', bool_or(is_stale),
    'any_partial', bool_or(is_partial),
    'stale_count', COUNT(*) FILTER (WHERE is_stale),
    'partial_count', COUNT(*) FILTER (WHERE is_partial)
  )
  FROM public.v_sync_health;
$function$;

-- unified_assign_va(uuid,uuid,text): /admin/unlicensed-all
CREATE OR REPLACE FUNCTION public.unified_assign_va(p_id uuid, p_va_user_id uuid, p_source text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn_require_caller_role(ARRAY['admin','manager','va_manager','va']::public.app_role[]);
  IF p_source = 'aged_lead' THEN
    UPDATE aged_leads
       SET assigned_va_id = p_va_user_id,
           assigned_va_at = now()
     WHERE id = p_id;
  ELSE
    UPDATE applications
       SET assigned_va_id = p_va_user_id,
           assigned_va_at = now()
     WHERE id = p_id;
  END IF;
END;
$function$;

-- unified_mark_contacted(uuid,text,uuid): /admin/recovery-queue, /admin/unlicensed-all
CREATE OR REPLACE FUNCTION public.unified_mark_contacted(p_id uuid, p_source text, p_by_user_id uuid DEFAULT auth.uid())
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn_require_caller_role(ARRAY['admin','manager','va_manager','va']::public.app_role[]);
  IF p_source = 'aged_lead' OR p_source = 'aged_leads' THEN
    UPDATE aged_leads
      SET last_contacted_at = now(),
          contacted_at = COALESCE(contacted_at, now())
      WHERE id = p_id;
  ELSE
    UPDATE applications
      SET last_contacted_at = now(),
          contacted_at = COALESCE(contacted_at, now())
      WHERE id = p_id;
    INSERT INTO application_contact_log (application_id, channel, outcome, notes, logged_by)
    VALUES (p_id, 'contact', 'marked_contacted', NULL, p_by_user_id);
  END IF;
END;
$function$;

-- unified_set_license_progress(uuid,text,text): /admin/recovery-queue, /admin/unlicensed-all
CREATE OR REPLACE FUNCTION public.unified_set_license_progress(p_id uuid, p_progress text, p_source text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.fn_require_caller_role(ARRAY['admin','manager','va_manager','va']::public.app_role[]);
  IF p_source = 'aged_lead' THEN
    UPDATE aged_leads SET license_progress = p_progress WHERE id = p_id;
  ELSE
    UPDATE applications SET license_progress = p_progress::license_progress WHERE id = p_id;
  END IF;
END;
$function$;
