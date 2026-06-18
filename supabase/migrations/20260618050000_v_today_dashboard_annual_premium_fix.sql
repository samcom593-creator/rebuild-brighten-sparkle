-- 2026-06-17/18 Sam directive: "make sure everything in here today is actually
-- accurate and good info. I did the the the one, but the pipe won't drift
-- today. Like, it... that sounds like that's terrible. It's terrible info."
--
-- Bug: v_today_dashboard.deal_premium_today summed `deals.monthly_premium`
-- while deal_ap_week + deal_ap_mtd correctly used `deals.annual_premium`.
-- Result: a 12x undercount on the today tile (e.g. $999 vs the correct
-- $3,461). Any UI surface reading v_today_dashboard.deal_premium_today
-- showed Sam a wildly wrong "today" number.
--
-- Fix: swap monthly_premium → annual_premium for parity with the rest of
-- the view (and with apex_dashboard_summary which is the truth source).
--
-- rollback: drop the view and recreate the prior version (monthly_premium)
-- via pg_get_viewdef from your last backup — but you don't want to.

DROP VIEW IF EXISTS public.v_today_dashboard CASCADE;

CREATE VIEW public.v_today_dashboard AS
 WITH day_start AS (
         SELECT (date_trunc('day'::text, (now() AT TIME ZONE 'America/Chicago'::text)))::timestamp with time zone AS t
        ), week_start AS (
         SELECT (date_trunc('week'::text, (now() AT TIME ZONE 'America/Chicago'::text)))::timestamp with time zone AS t
        ), month_start AS (
         SELECT (date_trunc('month'::text, (now() AT TIME ZONE 'America/Chicago'::text)))::timestamp with time zone AS t
        )
 SELECT
    ( SELECT count(*)::integer FROM applications WHERE created_at >= (SELECT t FROM day_start)) AS new_apps_today,
    ( SELECT count(*)::integer FROM applications WHERE ica_paid = true AND ica_paid_at >= (SELECT t FROM day_start)) AS paid_today,
    ( SELECT COALESCE(sum(annual_premium), 0::numeric) FROM deals WHERE created_at >= (SELECT t FROM day_start)) AS deal_premium_today,
    ( SELECT count(*)::integer FROM deals WHERE created_at >= (SELECT t FROM day_start)) AS deal_count_today,
    ( SELECT count(*)::integer FROM applications WHERE created_at >= (SELECT t FROM week_start)) AS new_apps_week,
    ( SELECT count(*)::integer FROM applications WHERE ica_paid = true AND ica_paid_at >= (SELECT t FROM week_start)) AS paid_week,
    ( SELECT COALESCE(sum(annual_premium), 0::numeric) FROM deals WHERE created_at >= (SELECT t FROM week_start)) AS deal_ap_week,
    ( SELECT count(*)::integer FROM deals WHERE created_at >= (SELECT t FROM week_start)) AS deal_count_week,
    ( SELECT count(*)::integer FROM applications WHERE created_at >= (SELECT t FROM month_start)) AS new_apps_mtd,
    ( SELECT count(*)::integer FROM applications WHERE ica_paid = true AND ica_paid_at >= (SELECT t FROM month_start)) AS paid_mtd,
    ( SELECT COALESCE(sum(annual_premium), 0::numeric) FROM deals WHERE created_at >= (SELECT t FROM month_start)) AS deal_ap_mtd,
    ( SELECT count(*)::integer FROM deals WHERE created_at >= (SELECT t FROM month_start)) AS deal_count_mtd,
    ( SELECT count(*)::integer FROM applications WHERE status::text = 'new'::text AND created_at < (now() - interval '14 days')) AS stale_new_apps,
    ( SELECT count(*)::integer FROM applications WHERE contacted_at IS NULL AND created_at < (now() - interval '24 hours')) AS uncontacted_24h,
    ( SELECT count(*)::integer FROM partial_applications) AS partial_applications_total,
    ( SELECT count(*)::integer FROM applications WHERE has_unresolved_policy_flag = true) AS unresolved_policy_flags,
    ( SELECT count(*)::integer FROM applications) AS total_applications,
    ( SELECT count(*)::integer FROM agents WHERE status::text = 'active'::text AND is_deactivated IS NOT TRUE) AS active_agents,
    ( SELECT count(*)::integer FROM aged_leads) AS aged_leads_total,
    ( SELECT count(*)::integer FROM aged_leads WHERE do_not_contact = true) AS aged_leads_dnc,
    now() AT TIME ZONE 'UTC' AS generated_at;

GRANT SELECT ON public.v_today_dashboard TO authenticated, anon, service_role;

COMMENT ON VIEW public.v_today_dashboard IS
'Sam directive 2026-06-17: fix the today tile. deal_premium_today now uses
annual_premium for parity with deal_ap_week + deal_ap_mtd. The old monthly_premium
sum understated by 12x.';
