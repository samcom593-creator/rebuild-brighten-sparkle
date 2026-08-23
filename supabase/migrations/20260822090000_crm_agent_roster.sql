-- CRM + Producer Profile truth layer
-- ============================================================================
-- WHY: /dashboard/team rendered "Team size 663 / Active 662" while public.agents
-- holds 182 rows. The page was counting a UNION of the agent roster and every
-- open application (profiles=603, applications=804) and calling that "team".
-- Worse, the roster query was `.eq("status","active")`, so 119 of 182 agents
-- (68 inactive + 51 terminated) were UNFINDABLE — and those rows carry
-- $126,126 of this month's $196,962 book. Sam could not search for them at all.
--
-- These functions are the single server-side source for the roster and its
-- segmentation, so no headline count is ever derived from a client array whose
-- length PostgREST caps at 1000.
--
-- PRODUCTION TRUTH: agentlink_book, is_dead IS NOT TRUE, posted_date windows,
-- America/Phoenix calendar. Never the legacy `deals` table, never effective_date.
--
-- GHOST_% rows are deliberately NOT filtered here (they are FLAGGED so a
-- leader can merge them), but agents Sam has explicitly removed via
-- roster_exclusions ARE excluded — otherwise CRM shows a person the
-- leaderboard and production have already dropped.
-- GHOST_% rows are deliberately NOT filtered here. They are flagged
-- (is_sync_only) instead: they are real AgentLink downline producers with no
-- APEX account, and one of them (GHOST_336) is the single largest producer of
-- the current month at $112,530. Filtering them would hide real money; the UI
-- labels them so the gap is visible and actionable.
-- ============================================================================

-- Callers allowed to see the whole agency roster. Mirrors the route guard on
-- /dashboard/team (requireAdmin allowManagers allowRoles va_manager, va).
CREATE OR REPLACE FUNCTION public.crm_can_read_roster()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT auth.uid() IS NOT NULL AND (
       public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'manager')
    OR public.has_role(auth.uid(), 'va_manager')
    OR public.has_role(auth.uid(), 'va')
  );
$$;

-- ---------------------------------------------------------------------------
-- crm_agent_roster() — every agent in public.agents, enriched. 182 rows today.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.crm_agent_roster();
CREATE FUNCTION public.crm_agent_roster()
RETURNS TABLE (
  agent_id          uuid,
  full_name         text,
  email             text,
  phone             text,
  avatar_url        text,
  agent_code        text,
  status            text,
  is_deactivated    boolean,
  is_inactive       boolean,
  is_sync_only      boolean,
  license_status    text,
  license_progress  text,
  onboarding_stage  text,
  training_stage    text,
  manager_id        uuid,
  manager_name      text,
  downline_count    integer,
  contracts_total   integer,
  contracts_active  integer,
  mtd_alp           numeric,
  mtd_deals         integer,
  l30_alp           numeric,
  l30_deals         integer,
  lifetime_alp      numeric,
  lifetime_deals    integer,
  first_posted_date date,
  last_posted_date  date,
  last_contacted_at timestamptz,
  created_at        timestamptz,
  tenure_days       integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
WITH ph AS (
  SELECT (now() AT TIME ZONE 'America/Phoenix')::date AS today
),
win AS (
  SELECT today,
         date_trunc('month', today)::date AS month_start,
         (today - 29)                     AS l30_start
  FROM ph
),
prod AS (
  SELECT b.agent_id,
         sum(b.annual_premium) FILTER (WHERE b.posted_date >= w.month_start) AS mtd_alp,
         count(*)              FILTER (WHERE b.posted_date >= w.month_start) AS mtd_deals,
         sum(b.annual_premium) FILTER (WHERE b.posted_date >= w.l30_start)   AS l30_alp,
         count(*)              FILTER (WHERE b.posted_date >= w.l30_start)   AS l30_deals,
         sum(b.annual_premium)                                               AS life_alp,
         count(*)                                                            AS life_deals,
         min(b.posted_date)                                                  AS first_posted,
         max(b.posted_date)                                                  AS last_posted
  FROM agentlink_book b
  CROSS JOIN win w
  WHERE b.is_dead IS NOT TRUE
    AND b.agent_id IS NOT NULL
    AND b.posted_date IS NOT NULL
  GROUP BY b.agent_id
),
ident AS (
  SELECT a.id,
         COALESCE(pu.full_name, pp.full_name, a.display_name, '(unnamed agent)') AS full_name,
         COALESCE(pu.email, pp.email)           AS email,
         COALESCE(pu.phone, pp.phone)           AS phone,
         COALESCE(pu.avatar_url, pp.avatar_url) AS avatar_url
  FROM agents a
  LEFT JOIN profiles pu ON pu.user_id = a.user_id
  LEFT JOIN profiles pp ON pp.id      = a.profile_id
),
-- Licensing progress lives on applications, joined by e-mail. Take the FURTHEST
-- progress on file for that address rather than an arbitrary row.
prog AS (
  SELECT lower(btrim(ap.email)) AS email_key,
         max(array_position(ARRAY[
           'unlicensed','course_purchased','finished_course','test_scheduled',
           'passed_test','fingerprints_done','waiting_fingerprints',
           'waiting_on_license','licensed'
         ], ap.license_progress::text)) AS best_idx
  FROM applications ap
  WHERE ap.email IS NOT NULL AND ap.terminated_at IS NULL
  GROUP BY 1
),
contact AS (
  SELECT ap.assigned_agent_id AS agent_id, max(ap.last_contacted_at) AS last_contacted_at
  FROM applications ap
  WHERE ap.assigned_agent_id IS NOT NULL AND ap.last_contacted_at IS NOT NULL
  GROUP BY 1
),
downline AS (
  SELECT m.mid AS agent_id, count(DISTINCT m.child) AS n
  FROM (
    SELECT manager_id AS mid, id AS child FROM agents WHERE manager_id IS NOT NULL
    UNION
    SELECT invited_by_manager_id, id FROM agents WHERE invited_by_manager_id IS NOT NULL
  ) m
  GROUP BY 1
),
contracts AS (
  SELECT c.agent_id,
         count(*)::int AS total,
         count(*) FILTER (WHERE lower(coalesce(c.status,'')) IN ('active','approved','appointed'))::int AS active
  FROM agentlink_contracts c
  WHERE c.agent_id IS NOT NULL
  GROUP BY 1
)
SELECT
  a.id,
  i.full_name,
  i.email,
  i.phone,
  i.avatar_url,
  a.agent_code,
  a.status::text,
  COALESCE(a.is_deactivated, false),
  COALESCE(a.is_inactive, false),
  (a.agent_code LIKE 'GHOST\_%' AND a.user_id IS NULL),
  a.license_status::text,
  CASE
    WHEN a.license_status::text = 'licensed' THEN 'licensed'
    ELSE (ARRAY[
      'unlicensed','course_purchased','finished_course','test_scheduled',
      'passed_test','fingerprints_done','waiting_fingerprints',
      'waiting_on_license','licensed'
    ])[pr.best_idx]
  END,
  a.onboarding_stage::text,
  ts.stage::text,
  COALESCE(a.manager_id, a.invited_by_manager_id),
  mi.full_name,
  COALESCE(dl.n, 0)::int,
  COALESCE(ct.total, 0),
  COALESCE(ct.active, 0),
  COALESCE(p.mtd_alp, 0),
  COALESCE(p.mtd_deals, 0)::int,
  COALESCE(p.l30_alp, 0),
  COALESCE(p.l30_deals, 0)::int,
  COALESCE(p.life_alp, 0),
  COALESCE(p.life_deals, 0)::int,
  p.first_posted,
  p.last_posted,
  co.last_contacted_at,
  a.created_at,
  CASE
    WHEN a.start_date IS NOT NULL THEN ((SELECT today FROM ph) - a.start_date)::int
    WHEN a.created_at IS NOT NULL THEN ((SELECT today FROM ph) - (a.created_at AT TIME ZONE 'America/Phoenix')::date)::int
    ELSE NULL
  END
FROM agents a
JOIN ident i ON i.id = a.id
LEFT JOIN prod p  ON p.agent_id = a.id
LEFT JOIN prog pr ON pr.email_key = lower(btrim(i.email))
LEFT JOIN contact co ON co.agent_id = a.id
LEFT JOIN downline dl ON dl.agent_id = a.id
LEFT JOIN contracts ct ON ct.agent_id = a.id
LEFT JOIN v_agent_training_stage ts ON ts.agent_id = a.id
LEFT JOIN ident mi ON mi.id = COALESCE(a.manager_id, a.invited_by_manager_id)
WHERE public.crm_can_read_roster()
  -- Agents Sam has explicitly removed never appear in CRM either; without
  -- this the roster would still list a person the leaderboard, production
  -- and book truth have already dropped.
  AND NOT public.fn_agent_is_roster_excluded(a.id);
$$;

COMMENT ON FUNCTION public.crm_agent_roster() IS
  'Every row of public.agents enriched with agentlink_book production (posted_date, is_dead IS NOT TRUE, America/Phoenix). Powers /dashboard/team. GHOST_% rows are flagged is_sync_only, never dropped.';

-- ---------------------------------------------------------------------------
-- crm_roster_segments() — headline counts, aggregated server-side so the UI
-- never counts a capped client array. Exactly one row in every state.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.crm_roster_segments();
CREATE FUNCTION public.crm_roster_segments()
RETURNS TABLE (
  total              integer,
  active             integer,
  inactive           integer,
  terminated         integer,
  licensed           integer,
  unlicensed         integer,
  sync_only          integer,
  producing_mtd      integer,
  mtd_alp            numeric,
  active_mtd_alp     numeric,
  offroster_mtd_alp  numeric,
  never_produced     integer,
  dormant_60d        integer,
  no_contact_14d     integer,
  book_last_posted   date
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
WITH r AS (SELECT * FROM public.crm_agent_roster()),
ph AS (SELECT (now() AT TIME ZONE 'America/Phoenix')::date AS today)
SELECT
  count(*)::int,
  count(*) FILTER (WHERE status = 'active')::int,
  count(*) FILTER (WHERE status = 'inactive')::int,
  count(*) FILTER (WHERE status = 'terminated')::int,
  count(*) FILTER (WHERE license_status = 'licensed')::int,
  count(*) FILTER (WHERE license_status IS DISTINCT FROM 'licensed')::int,
  count(*) FILTER (WHERE is_sync_only)::int,
  count(*) FILTER (WHERE mtd_alp > 0)::int,
  COALESCE(sum(mtd_alp), 0),
  COALESCE(sum(mtd_alp) FILTER (WHERE status = 'active'), 0),
  COALESCE(sum(mtd_alp) FILTER (WHERE status <> 'active'), 0),
  count(*) FILTER (WHERE status = 'active' AND license_status = 'licensed' AND lifetime_deals = 0)::int,
  count(*) FILTER (WHERE status = 'active' AND license_status = 'licensed'
                     AND (last_posted_date IS NULL OR last_posted_date < (SELECT today FROM ph) - 59))::int,
  count(*) FILTER (WHERE status = 'active'
                     AND (last_contacted_at IS NULL OR last_contacted_at < now() - interval '14 days'))::int,
  (SELECT max(posted_date) FROM agentlink_book WHERE is_dead IS NOT TRUE)
FROM r;
$$;

COMMENT ON FUNCTION public.crm_roster_segments() IS
  'Server-side segmentation of the agent roster for the CRM header. Replaces a client-side array length that read 663 against a 182-row table.';

-- Single-row projection of the roster, used by producer_profile_detail so the
-- self-read path is not blocked by the leader-only guard on crm_agent_roster().
DROP FUNCTION IF EXISTS public.crm_agent_roster_unguarded(uuid);
CREATE FUNCTION public.crm_agent_roster_unguarded(p_agent_id uuid)
RETURNS TABLE (
  agent_id uuid, full_name text, email text, phone text, avatar_url text,
  agent_code text, status text, is_deactivated boolean, is_inactive boolean,
  is_sync_only boolean, license_status text, license_progress text,
  onboarding_stage text, training_stage text, manager_id uuid, manager_name text,
  downline_count integer, contracts_total integer, contracts_active integer,
  mtd_alp numeric, mtd_deals integer, l30_alp numeric, l30_deals integer,
  lifetime_alp numeric, lifetime_deals integer, first_posted_date date,
  last_posted_date date, last_contacted_at timestamptz, created_at timestamptz,
  tenure_days integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH ph AS (SELECT (now() AT TIME ZONE 'America/Phoenix')::date AS today),
  win AS (SELECT today, date_trunc('month', today)::date AS month_start, (today - 29) AS l30_start FROM ph),
  p AS (
    SELECT sum(b.annual_premium) FILTER (WHERE b.posted_date >= w.month_start) AS mtd_alp,
           count(*)              FILTER (WHERE b.posted_date >= w.month_start) AS mtd_deals,
           sum(b.annual_premium) FILTER (WHERE b.posted_date >= w.l30_start)   AS l30_alp,
           count(*)              FILTER (WHERE b.posted_date >= w.l30_start)   AS l30_deals,
           sum(b.annual_premium) AS life_alp, count(*) AS life_deals,
           min(b.posted_date) AS first_posted, max(b.posted_date) AS last_posted
    FROM agentlink_book b CROSS JOIN win w
    WHERE b.agent_id = p_agent_id AND b.is_dead IS NOT TRUE AND b.posted_date IS NOT NULL
  )
  SELECT a.id,
    COALESCE(pu.full_name, pp.full_name, a.display_name, '(unnamed agent)'),
    COALESCE(pu.email, pp.email), COALESCE(pu.phone, pp.phone),
    COALESCE(pu.avatar_url, pp.avatar_url),
    a.agent_code, a.status::text, COALESCE(a.is_deactivated,false), COALESCE(a.is_inactive,false),
    (a.agent_code LIKE 'GHOST\_%' AND a.user_id IS NULL),
    a.license_status::text,
    CASE WHEN a.license_status::text = 'licensed' THEN 'licensed' ELSE (
      SELECT ap.license_progress::text FROM applications ap
      WHERE lower(btrim(ap.email)) = lower(btrim(COALESCE(pu.email, pp.email)))
        AND ap.terminated_at IS NULL AND ap.license_progress IS NOT NULL
      ORDER BY array_position(ARRAY['unlicensed','course_purchased','finished_course','test_scheduled','passed_test','fingerprints_done','waiting_fingerprints','waiting_on_license','licensed'], ap.license_progress::text) DESC NULLS LAST
      LIMIT 1) END,
    a.onboarding_stage::text, ts.stage::text,
    COALESCE(a.manager_id, a.invited_by_manager_id),
    (SELECT COALESCE(mp.full_name, m.display_name) FROM agents m
       LEFT JOIN profiles mp ON mp.user_id = m.user_id
       WHERE m.id = COALESCE(a.manager_id, a.invited_by_manager_id)),
    (SELECT count(*)::int FROM agents d WHERE COALESCE(d.manager_id, d.invited_by_manager_id) = a.id),
    (SELECT count(*)::int FROM agentlink_contracts c WHERE c.agent_id = a.id),
    (SELECT count(*)::int FROM agentlink_contracts c WHERE c.agent_id = a.id
       AND lower(COALESCE(c.status,'')) IN ('active','approved','appointed')),
    COALESCE(p.mtd_alp,0), COALESCE(p.mtd_deals,0)::int,
    COALESCE(p.l30_alp,0), COALESCE(p.l30_deals,0)::int,
    COALESCE(p.life_alp,0), COALESCE(p.life_deals,0)::int,
    p.first_posted, p.last_posted,
    (SELECT max(ap.last_contacted_at) FROM applications ap WHERE ap.assigned_agent_id = a.id),
    a.created_at,
    CASE WHEN a.start_date IS NOT NULL THEN ((SELECT today FROM ph) - a.start_date)::int
         WHEN a.created_at IS NOT NULL THEN ((SELECT today FROM ph) - (a.created_at AT TIME ZONE 'America/Phoenix')::date)::int
         ELSE NULL END
  FROM agents a
  LEFT JOIN profiles pu ON pu.user_id = a.user_id
  LEFT JOIN profiles pp ON pp.id = a.profile_id
  LEFT JOIN v_agent_training_stage ts ON ts.agent_id = a.id
  CROSS JOIN p
  WHERE NOT public.fn_agent_is_roster_excluded(a.id) AND a.id = p_agent_id;
$$;

-- ---------------------------------------------------------------------------
-- producer_profile_detail(uuid) — the full picture for ONE agent, so a leader
-- can open a person and know exactly what to push.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.producer_profile_detail(uuid);
CREATE FUNCTION public.producer_profile_detail(p_agent_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_self   boolean;
  v_row    record;
  v_result jsonb;
BEGIN
  IF p_agent_id IS NULL THEN
    RETURN NULL;
  END IF;

  -- A producer may always read their own record; leaders read anyone's.
  SELECT EXISTS (SELECT 1 FROM agents WHERE id = p_agent_id AND user_id = auth.uid())
    INTO v_self;
  IF NOT (v_self OR public.crm_can_read_roster()) THEN
    RAISE EXCEPTION 'not authorised to read this producer profile';
  END IF;

  SELECT * INTO v_row FROM public.crm_agent_roster_unguarded(p_agent_id);
  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  SELECT jsonb_build_object(
    'agent', to_jsonb(v_row),
    'monthly', COALESCE((
      SELECT jsonb_agg(m ORDER BY m.month)
      FROM (
        SELECT to_char(date_trunc('month', b.posted_date), 'YYYY-MM') AS month,
               round(sum(b.annual_premium))::numeric AS alp,
               count(*)::int AS deals
        FROM agentlink_book b
        WHERE b.agent_id = p_agent_id
          AND b.is_dead IS NOT TRUE
          AND b.posted_date IS NOT NULL
          AND b.posted_date >= (date_trunc('month', (now() AT TIME ZONE 'America/Phoenix')::date) - interval '11 months')::date
        GROUP BY 1
      ) m
    ), '[]'::jsonb),
    'carriers', COALESCE((
      SELECT jsonb_agg(c ORDER BY c.alp DESC)
      FROM (
        SELECT COALESCE(b.carrier, '(no carrier on file)') AS carrier,
               round(sum(b.annual_premium))::numeric AS alp,
               count(*)::int AS deals
        FROM agentlink_book b
        WHERE b.agent_id = p_agent_id AND b.is_dead IS NOT TRUE
        GROUP BY 1
      ) c
    ), '[]'::jsonb),
    'recent_deals', COALESCE((
      SELECT jsonb_agg(d ORDER BY d.posted_date DESC)
      FROM (
        SELECT b.posted_date, b.carrier, b.product, b.status,
               round(b.annual_premium)::numeric AS annual_premium
        FROM agentlink_book b
        WHERE b.agent_id = p_agent_id AND b.is_dead IS NOT TRUE AND b.posted_date IS NOT NULL
        ORDER BY b.posted_date DESC
        LIMIT 10
      ) d
    ), '[]'::jsonb),
    'contracts', COALESCE((
      SELECT jsonb_agg(k ORDER BY k.status, k.carrier)
      FROM (
        SELECT COALESCE(car.name, 'Carrier #' || c.insuracloud_carrier_id::text, '(unnamed carrier)') AS carrier,
               COALESCE(c.status, 'unknown') AS status,
               c.writing_number, c.commission_level, c.activated_date
        FROM agentlink_contracts c
        LEFT JOIN carriers car ON car.id = c.carrier_id
        WHERE c.agent_id = p_agent_id
      ) k
    ), '[]'::jsonb),
    'upline', (
      SELECT jsonb_build_object('agent_id', u.id, 'name',
               COALESCE(pu.full_name, u.display_name, '(unnamed)'), 'status', u.status::text)
      FROM agents me
      JOIN agents u ON u.id = COALESCE(me.manager_id, me.invited_by_manager_id)
      LEFT JOIN profiles pu ON pu.user_id = u.user_id
      WHERE me.id = p_agent_id
    ),
    'downline', COALESCE((
      SELECT jsonb_agg(x ORDER BY x.mtd_alp DESC NULLS LAST, x.name)
      FROM (
        SELECT d.id AS agent_id,
               COALESCE(pd.full_name, d.display_name, '(unnamed)') AS name,
               d.status::text AS status,
               d.license_status::text AS license_status,
               COALESCE((
                 SELECT round(sum(b.annual_premium))
                 FROM agentlink_book b
                 WHERE b.agent_id = d.id AND b.is_dead IS NOT TRUE
                   AND b.posted_date >= date_trunc('month', (now() AT TIME ZONE 'America/Phoenix')::date)::date
               ), 0)::numeric AS mtd_alp
        FROM agents d
        LEFT JOIN profiles pd ON pd.user_id = d.user_id
        WHERE COALESCE(d.manager_id, d.invited_by_manager_id) = p_agent_id
      ) x
    ), '[]'::jsonb),
    'training', (
      SELECT jsonb_build_object(
        'modules_total', (SELECT count(*)::int FROM onboarding_modules WHERE is_active = true),
        'modules_passed', (SELECT count(*)::int FROM onboarding_progress
                            WHERE agent_id = p_agent_id AND passed = true),
        'last_activity', (SELECT max(completed_at) FROM onboarding_progress WHERE agent_id = p_agent_id)
      )
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.crm_agent_roster() FROM public, anon;
REVOKE ALL ON FUNCTION public.crm_roster_segments() FROM public, anon;
REVOKE ALL ON FUNCTION public.crm_agent_roster_unguarded(uuid) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public.producer_profile_detail(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.crm_can_read_roster() TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_agent_roster() TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_roster_segments() TO authenticated;
GRANT EXECUTE ON FUNCTION public.producer_profile_detail(uuid) TO authenticated;
