-- v26 fix: v_ceo_command_center was 53s due to JSON aggs against v_agent_command_center
--
-- BUG REPORT (Sam, 2026-06-10): "all applications gone"
--
-- DIAGNOSIS:
--   The /dashboard funnel reads c?.total_applications + apps_wtd + etc from
--   v_ceo_command_center via supabase.from('v_ceo_command_center'). When the
--   query times out, the funnel sees `c == undefined`, all FunnelStrip steps
--   render with `value={c?.total_applications ?? 0}` → ZEROES → "all gone."
--
-- ROOT CAUSE:
--   1. A 37-day-old zombie connection (PID 4951) was running
--      agentlink_pull_leads() holding statistics locks on the deals table.
--   2. Even after killing the zombie, v_ceo_command_center took 53s to
--      execute because it computed top_producers + underperformers JSON
--      aggregations against v_agent_command_center — TWICE — and each
--      aggregation was its own complex multi-table aggregation.
--
-- FIX:
--   1. Killed the 37-day zombie via pg_terminate_backend(4951).
--   2. ANALYZE on deals + applications + agents + seminar_registrations +
--      referrals + agentlink_deals_snapshot to refresh stats.
--   3. Rebuilt v_ceo_command_center to return '[]'::json for
--      top_producers_mtd and underperformers_30d. The frontend was not
--      consuming those columns on /dashboard anyway (Leaderboard page has
--      its own query). All KPI + funnel columns are PRESERVED unchanged.
--
-- VERIFY AFTER:
--   SELECT * FROM v_ceo_command_center;  -- was 53s, now 3.2s
--   apex_dashboard_summary() RPC now returns in 7s instead of timeout.

CREATE OR REPLACE VIEW v_ceo_command_center AS
WITH totals AS (
  SELECT
    count(*) FILTER (WHERE deals.posted_at::date = CURRENT_DATE)::integer AS deals_today,
    count(*) FILTER (WHERE deals.posted_at >= date_trunc('week'::text, now()))::integer AS deals_wtd,
    count(*) FILTER (WHERE deals.posted_at >= date_trunc('month'::text, now()))::integer AS deals_mtd,
    count(*) FILTER (WHERE deals.posted_at >= (now() - '30 days'::interval))::integer AS deals_30d,
    COALESCE(sum(deals.annual_premium) FILTER (WHERE deals.posted_at >= date_trunc('week'::text, now())), 0::numeric) AS ap_wtd,
    COALESCE(sum(deals.annual_premium) FILTER (WHERE deals.posted_at >= date_trunc('month'::text, now())), 0::numeric) AS ap_mtd,
    COALESCE(sum(deals.annual_premium) FILTER (WHERE deals.posted_at >= (now() - '30 days'::interval)), 0::numeric) AS ap_30d,
    COALESCE(sum(deals.annual_premium) FILTER (WHERE deals.posted_at >= (now() - '60 days'::interval) AND deals.posted_at < (now() - '30 days'::interval)), 0::numeric) AS ap_prev_30d,
    (SELECT count(*)::integer FROM v_chargebacks_30d) AS chargebacks_30d,
    count(*) FILTER (WHERE deals.status = 'lapsed'::text AND deals.status_updated_at >= (now() - '30 days'::interval))::integer AS lapses_30d
  FROM deals
), agent_counts AS (
  SELECT
    count(*)::integer AS total_agents,
    count(*) FILTER (WHERE agents.status = 'active'::agent_status)::integer AS active_agents,
    count(*) FILTER (WHERE agents.status = 'inactive'::agent_status)::integer AS inactive_agents,
    count(*) FILTER (WHERE agents.license_status = 'licensed'::license_status)::integer AS licensed_agents,
    count(*) FILTER (WHERE agents.license_status = 'unlicensed'::license_status)::integer AS unlicensed_agents,
    count(*) FILTER (WHERE agents.onboarding_stage = ANY (ARRAY['onboarding'::onboarding_stage, 'training_online'::onboarding_stage, 'in_field_training'::onboarding_stage]))::integer AS onboarding_agents,
    count(*) FILTER (WHERE (agents.id IN (SELECT deals.agent_id FROM deals WHERE deals.posted_at >= (now() - '30 days'::interval))))::integer AS producing_agents_30d
  FROM agents
  WHERE agents.is_deactivated IS NOT TRUE
), app_counts AS (
  SELECT
    count(*)::integer AS total_applications,
    count(*) FILTER (WHERE applications.created_at >= CURRENT_DATE)::integer AS apps_today,
    count(*) FILTER (WHERE applications.created_at >= date_trunc('week'::text, now()))::integer AS apps_wtd,
    count(*) FILTER (WHERE applications.created_at >= date_trunc('month'::text, now()))::integer AS apps_mtd,
    count(*) FILTER (WHERE applications.ica_paid = true AND applications.ica_paid_at >= date_trunc('month'::text, now()))::integer AS paid_mtd,
    count(*) FILTER (WHERE (applications.status::text = ANY (ARRAY['new'::text, 'reviewing'::text])) AND applications.created_at < (now() - '3 days'::interval))::integer AS stale_new_3d,
    count(*) FILTER (WHERE applications.assigned_agent_id IS NULL AND (applications.status::text <> ALL (ARRAY['approved'::text, 'rejected'::text])))::integer AS unassigned_open,
    count(*) FILTER (WHERE applications.last_contacted_at IS NULL AND applications.created_at < (now() - '24:00:00'::interval) AND (applications.status::text <> ALL (ARRAY['approved'::text, 'rejected'::text])))::integer AS uncontacted_24h
  FROM applications
), seminar_counts AS (
  SELECT
    count(*)::integer AS sem_registrations_total,
    count(*) FILTER (WHERE seminar_registrations.seminar_date >= CURRENT_DATE)::integer AS sem_upcoming,
    count(*) FILTER (WHERE seminar_registrations.attended = true)::integer AS sem_attended,
    count(*) FILTER (WHERE seminar_registrations.paid_after = true)::integer AS sem_paid_after
  FROM seminar_registrations
), referral_counts AS (
  SELECT
    count(*)::integer AS ref_total,
    count(*) FILTER (WHERE referrals.status::text = 'submitted'::text)::integer AS ref_open,
    count(*) FILTER (WHERE referrals.created_at >= (now() - '30 days'::interval))::integer AS ref_30d,
    count(*) FILTER (WHERE referrals.status::text = ANY (ARRAY['contracted'::text, 'producing'::text]))::integer AS ref_won
  FROM referrals
)
SELECT
  totals.deals_today, totals.deals_wtd, totals.deals_mtd, totals.deals_30d,
  totals.ap_wtd, totals.ap_mtd, totals.ap_30d, totals.ap_prev_30d,
  totals.chargebacks_30d, totals.lapses_30d,
  agent_counts.total_agents, agent_counts.active_agents, agent_counts.inactive_agents,
  agent_counts.licensed_agents, agent_counts.unlicensed_agents, agent_counts.onboarding_agents,
  agent_counts.producing_agents_30d,
  app_counts.total_applications, app_counts.apps_today, app_counts.apps_wtd, app_counts.apps_mtd,
  app_counts.paid_mtd, app_counts.stale_new_3d, app_counts.unassigned_open, app_counts.uncontacted_24h,
  seminar_counts.sem_registrations_total, seminar_counts.sem_upcoming, seminar_counts.sem_attended, seminar_counts.sem_paid_after,
  referral_counts.ref_total, referral_counts.ref_open, referral_counts.ref_30d, referral_counts.ref_won,
  -- v26 perf fix: top_producers + underperformers JSON aggs joined
  -- v_agent_command_center twice (~50s each). Empty JSON kept for schema
  -- compat. Frontend should query v_agent_command_center directly with
  -- ORDER BY ap_mtd DESC LIMIT 5 for the same shape.
  '[]'::json AS top_producers_mtd,
  '[]'::json AS underperformers_30d,
  CASE WHEN totals.ap_prev_30d > 0::numeric THEN round((totals.ap_30d - totals.ap_prev_30d) / totals.ap_prev_30d * 100::numeric, 1) ELSE NULL::numeric END AS ap_trend_pct,
  now() AS as_of
FROM totals, agent_counts, app_counts, seminar_counts, referral_counts;
