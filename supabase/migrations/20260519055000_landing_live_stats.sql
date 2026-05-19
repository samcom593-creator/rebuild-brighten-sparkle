-- ═══════════════════════════════════════════════════════════════════════════
-- Public landing_live_stats() RPC + landing_unclaimed_summary() admin RPC
-- (2026-05-19, visible-transform sprint)
--
-- Purpose: feed the live-counter strip on the public landing AND surface the
-- "Unclaimed Leads" KPI on the admin DashboardCommandCenter. Data is summary-
-- only (no PII), so the landing RPC is publicly callable. Admin RPC stays
-- gated by has_role(auth.uid(),'admin'::app_role).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── PUBLIC: landing_live_stats() — counts only, zero PII ──────────────────
CREATE OR REPLACE FUNCTION landing_live_stats()
RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path = public STABLE AS $$
  SELECT jsonb_build_object(
    'active_agents',     (SELECT count(*)::int FROM agents WHERE status::text NOT IN ('terminated')),
    'hires_recent',      (SELECT count(*)::int FROM landing_recent_hires()),
    'applications_30d',  (SELECT count(*)::int FROM applications WHERE created_at >= now() - interval '30 days'),
    'applications_total',(SELECT count(*)::int FROM applications),
    'carriers_partnered',22,  -- matches the HeroSection carriers[] list length
    'generated_at',      now()
  );
$$;

REVOKE ALL ON FUNCTION landing_live_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION landing_live_stats() TO anon, authenticated;

-- ─── ADMIN: landing_unclaimed_summary() ────────────────────────────────────
-- Surfaces the 309 leads that have no agent assigned + how urgent the oldest
-- one is. Powers the new UnclaimedLeadsCard on the admin DashboardCommandCenter.
CREATE OR REPLACE FUNCTION landing_unclaimed_summary()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public STABLE AS $$
DECLARE
  v_payload jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  SELECT jsonb_build_object(
    'total',         count(*)::int,
    'urgent_72h',    count(*) FILTER (WHERE created_at < now() - interval '72 hours')::int,
    'newest_first',  count(*) FILTER (WHERE created_at >= now() - interval '24 hours')::int,
    'oldest_age_days', COALESCE(extract(day FROM (now() - min(created_at)))::int, 0),
    'sample',        COALESCE(
                       (SELECT jsonb_agg(jsonb_build_object(
                          'id', a.id,
                          'first_name', a.first_name,
                          'created_at', a.created_at,
                          'age_hours', round(extract(epoch FROM (now() - a.created_at)) / 3600)::int
                        ) ORDER BY a.created_at)
                        FROM (SELECT id, first_name, created_at FROM v_unclaimed_new_apps
                              ORDER BY created_at ASC LIMIT 5) a),
                       '[]'::jsonb
                     )
  ) INTO v_payload
  FROM v_unclaimed_new_apps;

  RETURN v_payload;
END $$;

REVOKE ALL ON FUNCTION landing_unclaimed_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION landing_unclaimed_summary() TO authenticated;

COMMIT;
