-- crm_agent_roster() returned every row of public.agents, so /dashboard/team
-- showed 182 and Sam's deactivations appeared to do nothing.
CREATE OR REPLACE FUNCTION public.crm_agent_roster()
 RETURNS TABLE(agent_id uuid, full_name text, email text, phone text, avatar_url text, agent_code text, status text, is_deactivated boolean, is_inactive boolean, is_sync_only boolean, license_status text, license_progress text, onboarding_stage text, training_stage text, manager_id uuid, manager_name text, downline_count integer, contracts_total integer, contracts_active integer, mtd_alp numeric, mtd_deals integer, l30_alp numeric, l30_deals integer, lifetime_alp numeric, lifetime_deals integer, first_posted_date date, last_posted_date date, last_contacted_at timestamp with time zone, created_at timestamp with time zone, tenure_days integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- Sam deactivates an agent, the write succeeds, and they stay on the page.
  -- This function returned EVERY row of public.agents, so the roster headline
  -- read 182 while his real team is 37 and his deactivations looked ignored.
  -- An explicit human flag is authoritative here exactly as in v_apex_roster;
  -- the "deactivated" segment is the place to go looking for them on purpose.
  AND coalesce(a.is_inactive, false) = false
  AND coalesce(a.is_deactivated, false) = false
  -- Agents Sam has explicitly removed never appear in CRM either; without
  -- this the roster would still list a person the leaderboard, production
  -- and book truth have already dropped.
  AND NOT public.fn_agent_is_roster_excluded(a.id);
$function$
;
