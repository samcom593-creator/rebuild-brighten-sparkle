-- A1 finisher: v_today_dashboard deal tiles must match apex_dashboard_summary().
--
-- The previous fix corrected monthly_premium -> annual_premium, but the view
-- still read public.deals.created_at while apex_dashboard_summary() reads
-- public.v_agentlink_book_truth. That left Sam's "today" tile off by one deal
-- and $72.84 on 2026-06-18.
--
-- Keep the operational applicant/lead counts from the existing live view, but
-- source all deal counts + premium totals from the same AgentLink truth view as
-- apex_dashboard_summary().
--
-- rollback: recreate v_today_dashboard from 20260618050000_v_today_dashboard_annual_premium_fix.sql.

CREATE OR REPLACE VIEW public.v_today_dashboard AS
WITH day_start AS (
  SELECT date_trunc('day', now() AT TIME ZONE 'America/Chicago')::timestamp with time zone AS t
),
week_start AS (
  SELECT date_trunc('week', now() AT TIME ZONE 'America/Chicago')::timestamp with time zone AS t
),
month_start AS (
  SELECT date_trunc('month', now() AT TIME ZONE 'America/Chicago')::timestamp with time zone AS t
),
truth AS (
  SELECT
    deals_today,
    premium_today,
    deals_this_week,
    premium_this_week,
    deals_this_month,
    premium_this_month
  FROM public.v_agentlink_book_truth
)
SELECT
  (SELECT count(*)::integer FROM public.applications WHERE created_at >= (SELECT t FROM day_start)) AS new_apps_today,
  (SELECT count(*)::integer FROM public.applications WHERE ica_paid = true AND ica_paid_at >= (SELECT t FROM day_start)) AS paid_today,
  COALESCE((SELECT premium_today FROM truth), 0::numeric) AS deal_premium_today,
  COALESCE((SELECT deals_today FROM truth), 0)::integer AS deal_count_today,
  (SELECT count(*)::integer FROM public.applications WHERE created_at >= (SELECT t FROM week_start)) AS new_apps_week,
  (SELECT count(*)::integer FROM public.applications WHERE ica_paid = true AND ica_paid_at >= (SELECT t FROM week_start)) AS paid_week,
  COALESCE((SELECT premium_this_week FROM truth), 0::numeric) AS deal_ap_week,
  COALESCE((SELECT deals_this_week FROM truth), 0)::integer AS deal_count_week,
  (SELECT count(*)::integer FROM public.applications WHERE created_at >= (SELECT t FROM month_start)) AS new_apps_mtd,
  (SELECT count(*)::integer FROM public.applications WHERE ica_paid = true AND ica_paid_at >= (SELECT t FROM month_start)) AS paid_mtd,
  COALESCE((SELECT premium_this_month FROM truth), 0::numeric) AS deal_ap_mtd,
  COALESCE((SELECT deals_this_month FROM truth), 0)::integer AS deal_count_mtd,
  (SELECT count(*)::integer FROM public.applications WHERE status::text = 'new'::text AND created_at < (now() - interval '3 days')) AS stale_new_apps,
  (SELECT count(*)::integer FROM public.applications WHERE contacted_at IS NULL AND created_at < (now() - interval '24 hours')) AS uncontacted_24h,
  (SELECT count(*)::integer FROM public.partial_applications) AS partial_applications_total,
  (SELECT count(*)::integer FROM public.policy_quality_flags WHERE resolved = false) AS unresolved_policy_flags,
  (SELECT count(*)::integer FROM public.applications) AS total_applications,
  (SELECT count(*)::integer FROM public.agents WHERE is_deactivated IS NOT TRUE) AS active_agents,
  (SELECT count(*)::integer FROM public.aged_leads) AS aged_leads_total,
  (SELECT count(*)::integer FROM public.aged_leads WHERE dnc = true) AS aged_leads_dnc,
  now() AS generated_at;

GRANT SELECT ON public.v_today_dashboard TO authenticated, anon, service_role;

COMMENT ON VIEW public.v_today_dashboard IS
'Finisher A1 2026-06-18: deal count and premium fields now read v_agentlink_book_truth,
the same source used by apex_dashboard_summary(), so the today dashboard tile cannot
drift from the truth RPC.';
