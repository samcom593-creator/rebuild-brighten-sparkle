-- PL-WIB-AGENT-PORTAL-SELF: /agent-portal showed every agent 0 deals and $0 for their own month.
--
-- /agent-portal is where Login, Install, HireLink and the applicant magic link
-- send an agent (180 views by 31 agents in the last 30 days). Its headline
-- tiles read v_agent_command_center filtered to the agent's own id, and the
-- lifetime tile reads agent_lifetime_production. 20260831050000 made both
-- owner-only (`WHERE is_owner()`) to keep managers and VAs out of agency
-- money. A plain agent was never in that gate either, so every agent has read
-- zero rows of their OWN stats since 08-24, and the page printed the fallback
-- as fact: 0 deals MTD, $0 AP, "unlicensed", "Pipeline clean", 0 lifetime,
-- directly above their own recent-deals list (which reads deals and was fine).
-- Measured 2026-10-17 as each login in a rolled-back transaction: Jontay
-- Taylor, Michael Kayembe, Tyler Krejcha and Chudi Ifediora all read 0 rows.
--
-- Gate: the owner, OR the caller's own canonical row. Nothing else opens: an
-- agent, a manager or a VA still reads no one else's row (proof probe 2), so
-- the 08-31 owner-money rule stands. Own row is resolved through
-- canonical_agent_id because current_agent_id() returns the newest row for a
-- login, which can be a merged-away twin.
--
-- Source: deals_* and ap_* now read v_production_canonical, the rule every
-- production surface has read since PL-WIB-WEEKLY-PRODUCTION-CANONICAL. Raw
-- deals missed every external (Ayro/Discord) sale, 10 of 55 October deals:
-- Michael Kayembe would have opened his portal to 0 of his 3 deals, Jontay
-- to 11 of 17. Commission, chargebacks and lapses stay on deals (canonical has
-- no commission_cents, chargeback_status or lapsed rows). Phoenix calendar,
-- matching the rest of the canonical surfaces. Sam reads the same canonical
-- volume; the ranks follow it.
--
-- agent_revenue_estimate (contract %) stays owner-only on purpose: whether an
-- agent sees their own comp % is Sam's call, and the page already labels an
-- unset comp instead of inventing one.
--
-- Proof: business-ops/website-integrity-bot/scripts/prove-agent-portal-self.sh
-- (11/11 on the candidate across 10 selling agents + owner + a stranger; M1
-- pre-images flips gate and source, M2 owner-only gate flips only self-read).

begin;

CREATE OR REPLACE VIEW public.v_agent_command_center AS
 SELECT agent_id,
    user_id,
    agent_code,
    display_name,
    full_name,
    email,
    agent_status,
    onboarding_stage,
    license_status,
    manager_id,
    manager_name,
    is_presenting,
    deals_today,
    deals_wtd,
    deals_mtd,
    deals_30d,
    ap_wtd,
    ap_mtd,
    ap_30d,
    commission_lifetime_cents,
    chargebacks,
    lapses,
    presentations_today,
    presentations_wtd,
    presentations_mtd,
    hours_called_today,
    hours_called_wtd,
    hours_called_mtd,
    last_production_date,
    apps_assigned,
    apps_open,
    apps_new_7d,
    apps_needing_contact,
    close_rate_mtd_pct,
    ap_trend_pct,
    rank_agency_mtd,
    rank_agency_wtd,
    rank_team_mtd,
    activity_state,
    next_action
   FROM ( WITH dp AS (
                 -- Volume (deals_*, ap_*) is canonical production, the one rule every
                 -- production surface reads since PL-WIB-WEEKLY-PRODUCTION-CANONICAL.
                 -- Raw deals missed every external (Ayro/Discord) sale: 10 of 55 October
                 -- deals. Commission, chargebacks and lapses stay on deals: canonical
                 -- carries no commission_cents, chargeback_status or lapsed rows.
                 SELECT ids.agent_id,
                    COALESCE(c.deals_today, 0) AS deals_today,
                    COALESCE(c.deals_wtd, 0) AS deals_wtd,
                    COALESCE(c.deals_mtd, 0) AS deals_mtd,
                    COALESCE(c.deals_30d, 0) AS deals_30d,
                    COALESCE(c.deals_30_60d, 0) AS deals_30_60d,
                    COALESCE(c.ap_wtd, 0::numeric) AS ap_wtd,
                    COALESCE(c.ap_mtd, 0::numeric) AS ap_mtd,
                    COALESCE(c.ap_30d, 0::numeric) AS ap_30d,
                    COALESCE(c.ap_30_60d, 0::numeric) AS ap_30_60d,
                    COALESCE(q.commission_lifetime_cents, 0) AS commission_lifetime_cents,
                    COALESCE(q.chargebacks, 0) AS chargebacks,
                    COALESCE(q.lapses, 0) AS lapses
                   FROM ( SELECT DISTINCT COALESCE(cm.canonical_agent_id, a_1.id) AS agent_id
                           FROM agents a_1
                             LEFT JOIN v_agent_canonical_map cm ON cm.agent_id = a_1.id) ids
                     LEFT JOIN ( SELECT COALESCE(cm.canonical_agent_id, pc.agent_id) AS agent_id,
                            count(*) FILTER (WHERE pc.posted_date = (now() AT TIME ZONE 'America/Phoenix'::text)::date)::integer AS deals_today,
                            count(*) FILTER (WHERE pc.posted_date >= date_trunc('week'::text, (now() AT TIME ZONE 'America/Phoenix'::text)::date::timestamp without time zone)::date)::integer AS deals_wtd,
                            count(*) FILTER (WHERE pc.posted_date >= date_trunc('month'::text, (now() AT TIME ZONE 'America/Phoenix'::text)::date::timestamp without time zone)::date)::integer AS deals_mtd,
                            count(*) FILTER (WHERE pc.posted_date >= ((now() AT TIME ZONE 'America/Phoenix'::text)::date - 30))::integer AS deals_30d,
                            count(*) FILTER (WHERE pc.posted_date >= ((now() AT TIME ZONE 'America/Phoenix'::text)::date - 60) AND pc.posted_date < ((now() AT TIME ZONE 'America/Phoenix'::text)::date - 30))::integer AS deals_30_60d,
                            sum(pc.annual_premium) FILTER (WHERE pc.posted_date >= date_trunc('week'::text, (now() AT TIME ZONE 'America/Phoenix'::text)::date::timestamp without time zone)::date) AS ap_wtd,
                            sum(pc.annual_premium) FILTER (WHERE pc.posted_date >= date_trunc('month'::text, (now() AT TIME ZONE 'America/Phoenix'::text)::date::timestamp without time zone)::date) AS ap_mtd,
                            sum(pc.annual_premium) FILTER (WHERE pc.posted_date >= ((now() AT TIME ZONE 'America/Phoenix'::text)::date - 30)) AS ap_30d,
                            sum(pc.annual_premium) FILTER (WHERE pc.posted_date >= ((now() AT TIME ZONE 'America/Phoenix'::text)::date - 60) AND pc.posted_date < ((now() AT TIME ZONE 'America/Phoenix'::text)::date - 30)) AS ap_30_60d
                           FROM v_production_canonical pc
                             LEFT JOIN v_agent_canonical_map cm ON cm.agent_id = pc.agent_id
                          WHERE pc.agent_id IS NOT NULL
                          GROUP BY (COALESCE(cm.canonical_agent_id, pc.agent_id))) c ON c.agent_id = ids.agent_id
                     LEFT JOIN ( SELECT COALESCE(cm.canonical_agent_id, d.agent_id) AS agent_id,
                            COALESCE(sum(d.commission_cents), 0::bigint)::integer AS commission_lifetime_cents,
                            sum(
                                CASE
                                    WHEN d.chargeback_status = ANY (ARRAY['chargeback'::text, 'charged_back'::text]) THEN 1
                                    ELSE 0
                                END)::integer AS chargebacks,
                            sum(
                                CASE
                                    WHEN d.status = 'lapsed'::text THEN 1
                                    ELSE 0
                                END)::integer AS lapses
                           FROM deals d
                             LEFT JOIN v_agent_canonical_map cm ON cm.agent_id = d.agent_id
                          WHERE d.agent_id IS NOT NULL
                          GROUP BY (COALESCE(cm.canonical_agent_id, d.agent_id))) q ON q.agent_id = ids.agent_id
                ), prod AS (
                 SELECT COALESCE(cm.canonical_agent_id, dpr.agent_id) AS agent_id,
                    sum(
                        CASE
                            WHEN dpr.production_date = (now() AT TIME ZONE 'America/Phoenix'::text)::date THEN dpr.presentations
                            ELSE 0
                        END)::integer AS pres_today,
                    sum(
                        CASE
                            WHEN dpr.production_date >= date_trunc('week'::text, (now() AT TIME ZONE 'America/Phoenix'::text)::date::timestamp with time zone)::date THEN dpr.presentations
                            ELSE 0
                        END)::integer AS pres_wtd,
                    sum(
                        CASE
                            WHEN dpr.production_date >= date_trunc('month'::text, (now() AT TIME ZONE 'America/Phoenix'::text)::date::timestamp with time zone)::date THEN dpr.presentations
                            ELSE 0
                        END)::integer AS pres_mtd,
                    sum(
                        CASE
                            WHEN dpr.production_date = (now() AT TIME ZONE 'America/Phoenix'::text)::date THEN dpr.hours_called
                            ELSE 0::numeric
                        END) AS hours_today,
                    sum(
                        CASE
                            WHEN dpr.production_date >= date_trunc('week'::text, (now() AT TIME ZONE 'America/Phoenix'::text)::date::timestamp with time zone)::date THEN dpr.hours_called
                            ELSE 0::numeric
                        END) AS hours_wtd,
                    sum(
                        CASE
                            WHEN dpr.production_date >= date_trunc('month'::text, (now() AT TIME ZONE 'America/Phoenix'::text)::date::timestamp with time zone)::date THEN dpr.hours_called
                            ELSE 0::numeric
                        END) AS hours_mtd,
                    max(dpr.production_date) AS last_production_date,
                    sum(
                        CASE
                            WHEN dpr.production_date >= (CURRENT_DATE - '14 days'::interval) THEN dpr.deals_closed
                            ELSE 0
                        END)::integer AS deals_closed_14d
                   FROM daily_production dpr
                     LEFT JOIN v_agent_canonical_map cm ON cm.agent_id = dpr.agent_id
                  GROUP BY (COALESCE(cm.canonical_agent_id, dpr.agent_id))
                ), apps AS (
                 SELECT COALESCE(cm.canonical_agent_id, applications.assigned_agent_id) AS agent_id,
                    count(*)::integer AS apps_assigned,
                    count(*) FILTER (WHERE (applications.status <> ALL (ARRAY['approved'::application_status, 'rejected'::application_status])) AND applications.terminated_at IS NULL)::integer AS apps_open,
                    count(*) FILTER (WHERE applications.created_at >= (now() - '7 days'::interval))::integer AS apps_new_7d,
                    count(*) FILTER (WHERE applications.last_contacted_at IS NULL OR applications.last_contacted_at < (now() - '24:00:00'::interval))::integer AS apps_needing_contact
                   FROM v_applications_real applications
                     LEFT JOIN v_agent_canonical_map cm ON cm.agent_id = applications.assigned_agent_id
                  WHERE applications.assigned_agent_id IS NOT NULL
                  GROUP BY (COALESCE(cm.canonical_agent_id, applications.assigned_agent_id))
                ), ranks AS (
                 SELECT dp_1.agent_id,
                    rank() OVER (ORDER BY dp_1.ap_mtd DESC NULLS LAST)::integer AS rank_agency_mtd,
                    rank() OVER (ORDER BY dp_1.ap_wtd DESC NULLS LAST)::integer AS rank_agency_wtd
                   FROM dp dp_1
                ), team_ranks AS (
                 SELECT a_1.id AS agent_id,
                    a_1.manager_id,
                    rank() OVER (PARTITION BY a_1.manager_id ORDER BY (COALESCE(dp_1.ap_mtd, 0::numeric)) DESC)::integer AS rank_team_mtd
                   FROM agents a_1
                     LEFT JOIN dp dp_1 ON dp_1.agent_id = a_1.id
                  WHERE a_1.canonical_agent_id IS NULL
                )
         SELECT a.id AS agent_id,
            a.user_id,
            a.agent_code,
            a.display_name,
            p.full_name,
            p.email,
            a.status::text AS agent_status,
            a.onboarding_stage::text AS onboarding_stage,
            a.license_status::text AS license_status,
            a.manager_id,
            mgr.display_name AS manager_name,
            a.is_presenting,
            COALESCE(dp.deals_today, 0) AS deals_today,
            COALESCE(dp.deals_wtd, 0) AS deals_wtd,
            COALESCE(dp.deals_mtd, 0) AS deals_mtd,
            COALESCE(dp.deals_30d, 0) AS deals_30d,
            COALESCE(dp.ap_wtd, 0::numeric) AS ap_wtd,
            COALESCE(dp.ap_mtd, 0::numeric) AS ap_mtd,
            COALESCE(dp.ap_30d, 0::numeric) AS ap_30d,
            COALESCE(dp.commission_lifetime_cents, 0) AS commission_lifetime_cents,
            COALESCE(dp.chargebacks, 0) AS chargebacks,
            COALESCE(dp.lapses, 0) AS lapses,
            COALESCE(prod.pres_today, 0) AS presentations_today,
            COALESCE(prod.pres_wtd, 0) AS presentations_wtd,
            COALESCE(prod.pres_mtd, 0) AS presentations_mtd,
            COALESCE(prod.hours_today, 0::numeric) AS hours_called_today,
            COALESCE(prod.hours_wtd, 0::numeric) AS hours_called_wtd,
            COALESCE(prod.hours_mtd, 0::numeric) AS hours_called_mtd,
            prod.last_production_date,
            COALESCE(apps.apps_assigned, 0) AS apps_assigned,
            COALESCE(apps.apps_open, 0) AS apps_open,
            COALESCE(apps.apps_new_7d, 0) AS apps_new_7d,
            COALESCE(apps.apps_needing_contact, 0) AS apps_needing_contact,
                CASE
                    WHEN COALESCE(prod.pres_mtd, 0) > 0 THEN round(COALESCE(dp.deals_mtd, 0)::numeric / prod.pres_mtd::numeric * 100::numeric, 1)
                    ELSE NULL::numeric
                END AS close_rate_mtd_pct,
                CASE
                    WHEN COALESCE(dp.ap_30_60d, 0::numeric) > 0::numeric THEN round((COALESCE(dp.ap_30d, 0::numeric) - dp.ap_30_60d) / dp.ap_30_60d * 100::numeric, 1)
                    ELSE NULL::numeric
                END AS ap_trend_pct,
            ranks.rank_agency_mtd,
            ranks.rank_agency_wtd,
            team_ranks.rank_team_mtd,
                CASE
                    WHEN prod.last_production_date IS NULL THEN 'never_dialed'::text
                    WHEN prod.last_production_date = CURRENT_DATE THEN 'active_today'::text
                    WHEN prod.last_production_date >= (CURRENT_DATE - '2 days'::interval) THEN 'active_recent'::text
                    WHEN prod.last_production_date >= (CURRENT_DATE - '7 days'::interval) THEN 'slipping'::text
                    ELSE 'inactive_warning'::text
                END AS activity_state,
                CASE
                    WHEN a.onboarding_stage = 'pre_licensed'::onboarding_stage THEN 'Complete licensing course'::text
                    WHEN COALESCE(apps.apps_needing_contact, 0) > 0 THEN ('Contact '::text || apps.apps_needing_contact) || ' applicants'::text
                    WHEN COALESCE(prod.pres_today, 0) = 0 AND a.status = 'active'::agent_status THEN 'Get on the phones'::text
                    ELSE 'On track'::text
                END AS next_action
           FROM agents a
             LEFT JOIN profiles p ON p.id = a.profile_id
             LEFT JOIN agents mgr ON mgr.id = a.manager_id
             LEFT JOIN dp ON dp.agent_id = a.id
             LEFT JOIN prod ON prod.agent_id = a.id
             LEFT JOIN apps ON apps.agent_id = a.id
             LEFT JOIN ranks ON ranks.agent_id = a.id
             LEFT JOIN team_ranks ON team_ranks.agent_id = a.id
          WHERE a.is_deactivated IS NOT TRUE AND a.canonical_agent_id IS NULL) t
  WHERE is_owner() OR t.agent_id IN ( SELECT COALESCE(me.canonical_agent_id, me.id) AS id
           FROM agents me
          WHERE me.user_id = auth.uid());

CREATE OR REPLACE VIEW public.agent_lifetime_production AS
 SELECT agent_id,
    lifetime_alp,
    lifetime_deals,
    last_production_date
   FROM ( SELECT COALESCE(m.canonical_agent_id, u.agent_id) AS agent_id,
            COALESCE(sum(u.annual_premium), 0::numeric) AS lifetime_alp,
            count(*)::integer AS lifetime_deals,
            max(u.posted_date) AS last_production_date
           FROM v_production_unified u
             LEFT JOIN v_agent_canonical_map m ON m.agent_id = u.agent_id
          WHERE u.origin <> 'external_daily_gap'::text AND u.agent_id IS NOT NULL
          GROUP BY (COALESCE(m.canonical_agent_id, u.agent_id))) t
  WHERE is_owner() OR t.agent_id IN ( SELECT COALESCE(me.canonical_agent_id, me.id) AS id
           FROM agents me
          WHERE me.user_id = auth.uid());

do $$
begin
  if pg_get_viewdef('public.v_agent_command_center'::regclass) not like '%v_production_canonical%'
     or pg_get_viewdef('public.v_agent_command_center'::regclass) not like '%auth.uid()%'
     or pg_get_viewdef('public.agent_lifetime_production'::regclass) not like '%auth.uid()%' then
    raise exception 'agent portal self-read views did not land';
  end if;
end $$;

commit;
