-- ============================================================================
-- PL-024 — Chargebacks 30d: verify accuracy + future-proof source aggregation
-- ============================================================================
-- Sam's complaint: "Chargebacks 30d showing 0 — may be missing the column /
-- using wrong source." After audit: 0 is ACCURATE (0 deals.chargeback_at IS
-- NOT NULL, 0 lead_purchases.refunded_at IS NOT NULL, 0 stripe_subscription_events
-- with event_type ILIKE '%dispute%'). The view was correct.
--
-- The real risk: chargeback signals arrive from multiple sources and right now
-- only `deals.chargeback_at` was being read. When the first chargeback lands
-- (Stripe dispute, lead-pack refund, carrier chargeback), the dashboard needs
-- to surface it regardless of which path the data takes.
--
-- This migration:
--   1. Creates `v_chargebacks_30d` — unioned view of every chargeback signal.
--   2. Updates `v_ceo_command_center.chargebacks_30d` to count off that view.
-- ============================================================================

CREATE OR REPLACE VIEW public.v_chargebacks_30d AS
WITH d AS (
  SELECT
    d.id::text AS source_id,
    'deals'::text AS source,
    d.chargeback_at AS occurred_at,
    d.annual_premium AS amount,
    d.agent_id::text AS agent_id,
    -- deals has no customer_email; use client_first_name + last_4 phone as a stable identifier
    (COALESCE(d.client_first_name,'') || ' ' || COALESCE(d.client_last_name,'') || ' · ' || right(COALESCE(d.client_phone,''), 4))::text AS customer_email,
    d.chargeback_status AS status_text
  FROM public.deals d
  WHERE d.chargeback_status = ANY(ARRAY['chargeback','charged_back'])
    AND d.chargeback_at IS NOT NULL
    AND d.chargeback_at >= (NOW() - INTERVAL '30 days')
),
lp AS (
  SELECT
    lp.id::text AS source_id,
    'lead_purchases'::text AS source,
    lp.refunded_at AS occurred_at,
    (COALESCE(lp.amount_cents, 0) / 100.0)::numeric AS amount,
    COALESCE(lp.agent_id_ref::text, '') AS agent_id,
    lp.customer_email,
    'refunded'::text AS status_text
  FROM public.lead_purchases lp
  WHERE lp.refunded_at IS NOT NULL
    AND lp.refunded_at >= (NOW() - INTERVAL '30 days')
),
sd AS (
  SELECT
    e.id::text AS source_id,
    'stripe_disputes'::text AS source,
    e.created_at AS occurred_at,
    NULL::numeric AS amount,
    ''::text AS agent_id,
    e.customer_email,
    e.event_type AS status_text
  FROM public.stripe_subscription_events e
  WHERE e.event_type ILIKE '%dispute%'
    AND e.created_at >= (NOW() - INTERVAL '30 days')
)
SELECT * FROM d
UNION ALL
SELECT * FROM lp
UNION ALL
SELECT * FROM sd;

COMMENT ON VIEW public.v_chargebacks_30d IS
  'PL-024: unions chargeback signals from deals.chargeback_at + lead_purchases.refunded_at + stripe_subscription_events(dispute*). All sources contribute or chargebacks_30d silently undercounts.';

-- ----------------------------------------------------------------------------
-- Rebuild v_ceo_command_center using the consolidated chargebacks view.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW public.v_ceo_command_center AS
WITH totals AS (
  SELECT
    count(*) FILTER (WHERE deals.posted_at::date = CURRENT_DATE)::integer AS deals_today,
    count(*) FILTER (WHERE deals.posted_at >= date_trunc('week', now()))::integer AS deals_wtd,
    count(*) FILTER (WHERE deals.posted_at >= date_trunc('month', now()))::integer AS deals_mtd,
    count(*) FILTER (WHERE deals.posted_at >= (now() - interval '30 days'))::integer AS deals_30d,
    COALESCE(sum(deals.annual_premium) FILTER (WHERE deals.posted_at >= date_trunc('week', now())), 0::numeric) AS ap_wtd,
    COALESCE(sum(deals.annual_premium) FILTER (WHERE deals.posted_at >= date_trunc('month', now())), 0::numeric) AS ap_mtd,
    COALESCE(sum(deals.annual_premium) FILTER (WHERE deals.posted_at >= (now() - interval '30 days')), 0::numeric) AS ap_30d,
    COALESCE(sum(deals.annual_premium) FILTER (WHERE deals.posted_at >= (now() - interval '60 days') AND deals.posted_at < (now() - interval '30 days')), 0::numeric) AS ap_prev_30d,
    (SELECT COUNT(*)::integer FROM public.v_chargebacks_30d) AS chargebacks_30d,
    count(*) FILTER (WHERE deals.status = 'lapsed' AND deals.status_updated_at >= (now() - interval '30 days'))::integer AS lapses_30d
  FROM public.deals
),
agent_counts AS (
  SELECT count(*)::integer AS total_agents,
    count(*) FILTER (WHERE agents.status = 'active'::agent_status)::integer AS active_agents,
    count(*) FILTER (WHERE agents.status = 'inactive'::agent_status)::integer AS inactive_agents,
    count(*) FILTER (WHERE agents.license_status = 'licensed'::license_status)::integer AS licensed_agents,
    count(*) FILTER (WHERE agents.license_status = 'unlicensed'::license_status)::integer AS unlicensed_agents,
    count(*) FILTER (WHERE agents.onboarding_stage = ANY(ARRAY['onboarding'::onboarding_stage, 'training_online'::onboarding_stage, 'in_field_training'::onboarding_stage]))::integer AS onboarding_agents,
    count(*) FILTER (WHERE agents.id IN (SELECT deals.agent_id FROM public.deals WHERE deals.posted_at >= (now() - interval '30 days')))::integer AS producing_agents_30d
  FROM public.agents
  WHERE agents.is_deactivated IS NOT TRUE
),
app_counts AS (
  SELECT count(*)::integer AS total_applications,
    count(*) FILTER (WHERE applications.created_at >= CURRENT_DATE)::integer AS apps_today,
    count(*) FILTER (WHERE applications.created_at >= date_trunc('week', now()))::integer AS apps_wtd,
    count(*) FILTER (WHERE applications.created_at >= date_trunc('month', now()))::integer AS apps_mtd,
    count(*) FILTER (WHERE applications.ica_paid = true AND applications.ica_paid_at >= date_trunc('month', now()))::integer AS paid_mtd,
    count(*) FILTER (WHERE applications.status::text = ANY(ARRAY['new','reviewing']) AND applications.created_at < (now() - interval '3 days'))::integer AS stale_new_3d,
    count(*) FILTER (WHERE applications.assigned_agent_id IS NULL AND applications.status::text <> ALL(ARRAY['approved','rejected']))::integer AS unassigned_open,
    count(*) FILTER (WHERE applications.last_contacted_at IS NULL AND applications.created_at < (now() - interval '24 hours') AND applications.status::text <> ALL(ARRAY['approved','rejected']))::integer AS uncontacted_24h
  FROM public.applications
),
seminar_counts AS (
  SELECT count(*)::integer AS sem_registrations_total,
    count(*) FILTER (WHERE seminar_registrations.seminar_date >= CURRENT_DATE)::integer AS sem_upcoming,
    count(*) FILTER (WHERE seminar_registrations.attended = true)::integer AS sem_attended,
    count(*) FILTER (WHERE seminar_registrations.paid_after = true)::integer AS sem_paid_after
  FROM public.seminar_registrations
),
referral_counts AS (
  SELECT count(*)::integer AS ref_total,
    count(*) FILTER (WHERE referrals.status::text = 'submitted')::integer AS ref_open,
    count(*) FILTER (WHERE referrals.created_at >= (now() - interval '30 days'))::integer AS ref_30d,
    count(*) FILTER (WHERE referrals.status::text = ANY(ARRAY['contracted','producing']))::integer AS ref_won
  FROM public.referrals
),
top_producers AS (
  SELECT json_agg(t.* ORDER BY t.ap_mtd DESC) AS top_5
  FROM (
    SELECT v_agent_command_center.agent_id, v_agent_command_center.display_name,
           v_agent_command_center.ap_mtd, v_agent_command_center.deals_mtd,
           v_agent_command_center.rank_agency_mtd
    FROM public.v_agent_command_center
    WHERE v_agent_command_center.ap_mtd > 0::numeric
    ORDER BY v_agent_command_center.ap_mtd DESC
    LIMIT 5
  ) t
),
underperformers AS (
  SELECT json_agg(t.*) AS bottom_5
  FROM (
    SELECT v_agent_command_center.agent_id, v_agent_command_center.display_name,
           v_agent_command_center.deals_30d, v_agent_command_center.activity_state,
           v_agent_command_center.agent_status
    FROM public.v_agent_command_center
    WHERE v_agent_command_center.agent_status = 'active' AND v_agent_command_center.deals_30d = 0 AND v_agent_command_center.license_status = 'licensed'
    ORDER BY v_agent_command_center.ap_30d NULLS FIRST
    LIMIT 5
  ) t
)
SELECT totals.deals_today, totals.deals_wtd, totals.deals_mtd, totals.deals_30d,
       totals.ap_wtd, totals.ap_mtd, totals.ap_30d, totals.ap_prev_30d,
       totals.chargebacks_30d, totals.lapses_30d,
       agent_counts.total_agents, agent_counts.active_agents, agent_counts.inactive_agents,
       agent_counts.licensed_agents, agent_counts.unlicensed_agents, agent_counts.onboarding_agents,
       agent_counts.producing_agents_30d,
       app_counts.total_applications, app_counts.apps_today, app_counts.apps_wtd, app_counts.apps_mtd,
       app_counts.paid_mtd, app_counts.stale_new_3d, app_counts.unassigned_open, app_counts.uncontacted_24h,
       seminar_counts.sem_registrations_total, seminar_counts.sem_upcoming,
       seminar_counts.sem_attended, seminar_counts.sem_paid_after,
       referral_counts.ref_total, referral_counts.ref_open, referral_counts.ref_30d, referral_counts.ref_won,
       top_producers.top_5 AS top_producers_mtd,
       underperformers.bottom_5 AS underperformers_30d,
       CASE WHEN totals.ap_prev_30d > 0::numeric
            THEN round((totals.ap_30d - totals.ap_prev_30d) / totals.ap_prev_30d * 100::numeric, 1)
            ELSE NULL::numeric END AS ap_trend_pct,
       now() AS as_of
FROM totals, agent_counts, app_counts, seminar_counts, referral_counts, top_producers, underperformers;

COMMENT ON VIEW public.v_ceo_command_center IS
  'CEO/Agency dashboard rollup. PL-024 (2026-05-20): chargebacks_30d now reads from v_chargebacks_30d which unions deals/lead_purchases/stripe_subscription_events.';
