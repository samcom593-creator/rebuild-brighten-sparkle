-- Wave B v9 (2026-06-10): truth-view RPCs + top-leg view
-- Applied live via bot-sql at ship time; committed here so a fresh clone
-- can replay it against a local Supabase. See master prompt
-- ~/business-ops/master-prompts/104-apex-website-ux-master-v9.md §5.

ALTER TABLE public.agents ADD COLUMN IF NOT EXISTS al_user_id INTEGER;
CREATE INDEX IF NOT EXISTS idx_agents_al_user_id ON public.agents(al_user_id) WHERE al_user_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.apex_dashboard_summary()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT jsonb_build_object(
    'today',       (SELECT jsonb_build_object('deals', deals_today,      'premium', premium_today)      FROM v_agentlink_book_truth),
    'this_week',   (SELECT jsonb_build_object('deals', deals_this_week,  'premium', premium_this_week)  FROM v_agentlink_book_truth),
    'this_month',  (SELECT jsonb_build_object('deals', deals_this_month, 'premium', premium_this_month) FROM v_agentlink_book_truth),
    'total',       (SELECT jsonb_build_object('deals', total_deals,      'premium', total_annual_premium) FROM v_agentlink_book_truth),
    'last_sync_at',(SELECT last_synced_at FROM v_agentlink_book_truth),
    'new_apps_today',  (SELECT COUNT(*) FROM applications WHERE created_at >= CURRENT_DATE),
    'new_agents_today',(SELECT COUNT(*) FROM agents WHERE created_at >= CURRENT_DATE),
    'just_hired_7d',   (SELECT COUNT(*) FROM agents WHERE created_at >= NOW() - INTERVAL '7 days'),
    'stale_apps_14d',  (SELECT COUNT(*) FROM v_old_licensed_applicants),
    'inbound_open',    (SELECT COUNT(*) FROM inbound_leads WHERE stage NOT IN ('won','lost'))
  );
$$;
GRANT EXECUTE ON FUNCTION public.apex_dashboard_summary() TO authenticated, anon, service_role;

CREATE OR REPLACE FUNCTION public.apex_agent_book(_agent_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER AS $$
  WITH a AS (
    SELECT al_user_id FROM agents WHERE id = _agent_id
  ),
  base AS (
    SELECT s.*
    FROM agentlink_deals_snapshot s
    JOIN a ON a.al_user_id IS NOT NULL AND s.user_id = a.al_user_id
  ),
  recents AS (
    SELECT jsonb_agg(
      jsonb_build_object(
        'id', id,
        'client', COALESCE(client_first_name,'') || ' ' || COALESCE(client_last_name,''),
        'product', product_sold,
        'premium', annual_premium,
        'date', effective_date
      )
      ORDER BY effective_date DESC NULLS LAST
    ) AS list
    FROM base
    WHERE effective_date >= (NOW() - INTERVAL '30 days')::date
  )
  SELECT jsonb_build_object(
    'mtd_deals',     (SELECT COUNT(*)                       FROM base WHERE effective_date >= date_trunc('month', CURRENT_DATE)::date),
    'mtd_premium',   (SELECT COALESCE(SUM(annual_premium),0) FROM base WHERE effective_date >= date_trunc('month', CURRENT_DATE)::date),
    'ytd_deals',     (SELECT COUNT(*)                       FROM base WHERE effective_date >= date_trunc('year',  CURRENT_DATE)::date),
    'ytd_premium',   (SELECT COALESCE(SUM(annual_premium),0) FROM base WHERE effective_date >= date_trunc('year',  CURRENT_DATE)::date),
    'total_deals',   (SELECT COUNT(*)                       FROM base),
    'total_premium', (SELECT COALESCE(SUM(annual_premium),0) FROM base),
    'recent',        COALESCE((SELECT list FROM recents), '[]'::jsonb),
    'al_mapped',     (SELECT al_user_id IS NOT NULL FROM a)
  );
$$;
GRANT EXECUTE ON FUNCTION public.apex_agent_book(uuid) TO authenticated, service_role;

-- v9 §3/§12 check 8: Top Producing Leg sub-view excludes Sam's leg so the
-- ranking surfaces actual downline managers, not Sam swallowing every deal.
CREATE OR REPLACE VIEW public.v_top_legs_excl_sam AS
WITH leg_totals AS (
  SELECT
    a.manager_id,
    COALESCE(SUM(s.annual_premium), 0) AS premium,
    COUNT(s.id) AS deals,
    COUNT(DISTINCT a.id) AS leg_size
  FROM agents a
  LEFT JOIN agentlink_deals_snapshot s
    ON a.al_user_id IS NOT NULL AND s.user_id = a.al_user_id
  WHERE a.manager_id IS NOT NULL
  GROUP BY a.manager_id
)
SELECT
  lt.manager_id,
  COALESCE(p.full_name, mgr.display_name, 'Unknown manager') AS manager_name,
  lt.deals,
  lt.premium,
  lt.leg_size
FROM leg_totals lt
JOIN agents mgr ON mgr.id = lt.manager_id
LEFT JOIN profiles p ON p.id = mgr.profile_id
WHERE mgr.id != '7c3c5581-3544-437f-bfe2-91391afb217d'::uuid
ORDER BY lt.premium DESC, lt.deals DESC;

GRANT SELECT ON public.v_top_legs_excl_sam TO authenticated, anon, service_role;
