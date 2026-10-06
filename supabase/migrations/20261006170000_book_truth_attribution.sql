-- Book of Business tiles read v_agentlink_book_truth, which counted every unified row.
-- Home, the scoreboard and v_imo_by_agency already exclude rows with no agent identity or a
-- roster-excluded producer (20261006080000), so the same page showed "This month $1,863,009 /
-- 23 deals" beside "$41,409 / 21 policies". The gap was the $1.82M unattributed AgentLink pair.
-- Same rule here; the excluded rows stay visible through production_attribution_exceptions().
-- security_invoker is restated because CREATE OR REPLACE VIEW replaces the view's reloptions.
create or replace view public.v_agentlink_book_truth with (security_invoker = true) as
 WITH p AS (
         SELECT ((now() AT TIME ZONE 'America/Phoenix'::text))::date AS d
        )
 SELECT (count(*))::integer AS total_deals,
    sum(b.annual_premium) AS total_annual_premium,
    (count(*) FILTER (WHERE (b.posted_date = p.d)))::integer AS deals_today,
    COALESCE(sum(b.annual_premium) FILTER (WHERE (b.posted_date = p.d)), (0)::numeric) AS premium_today,
    (count(*) FILTER (WHERE ((b.posted_date >= (date_trunc('week'::text, (p.d)::timestamp without time zone))::date) AND (b.posted_date <= p.d))))::integer AS deals_this_week,
    COALESCE(sum(b.annual_premium) FILTER (WHERE ((b.posted_date >= (date_trunc('week'::text, (p.d)::timestamp without time zone))::date) AND (b.posted_date <= p.d))), (0)::numeric) AS premium_this_week,
    (count(*) FILTER (WHERE ((b.posted_date >= (date_trunc('month'::text, (p.d)::timestamp without time zone))::date) AND (b.posted_date <= p.d))))::integer AS deals_this_month,
    COALESCE(sum(b.annual_premium) FILTER (WHERE ((b.posted_date >= (date_trunc('month'::text, (p.d)::timestamp without time zone))::date) AND (b.posted_date <= p.d))), (0)::numeric) AS premium_this_month,
    max(b.synced_at) AS last_synced_at,
    (count(*) FILTER (WHERE ((b.posted_date >= ((date_trunc('week'::text, (p.d)::timestamp without time zone))::date - 7)) AND (b.posted_date <= (p.d - 7)))))::integer AS deals_prior_week,
    COALESCE(sum(b.annual_premium) FILTER (WHERE ((b.posted_date >= ((date_trunc('week'::text, (p.d)::timestamp without time zone))::date - 7)) AND (b.posted_date <= (p.d - 7)))), (0)::numeric) AS premium_prior_week,
    (count(*) FILTER (WHERE ((b.posted_date >= (p.d - 30)) AND (b.posted_date <= p.d))))::integer AS deals_30d,
    COALESCE(sum(b.annual_premium) FILTER (WHERE ((b.posted_date >= (p.d - 30)) AND (b.posted_date <= p.d))), (0)::numeric) AS premium_30d,
    (count(*) FILTER (WHERE ((b.posted_date >= (p.d - 60)) AND (b.posted_date < (p.d - 30)))))::integer AS deals_prior_30d,
    COALESCE(sum(b.annual_premium) FILTER (WHERE ((b.posted_date >= (p.d - 60)) AND (b.posted_date < (p.d - 30)))), (0)::numeric) AS premium_prior_30d
   FROM v_production_unified b
     LEFT JOIN v_agent_canonical_map m ON m.agent_id = b.agent_id
     CROSS JOIN p
  WHERE b.agent_id IS NOT NULL
    AND NOT fn_agent_is_roster_excluded(COALESCE(m.canonical_agent_id, b.agent_id));
