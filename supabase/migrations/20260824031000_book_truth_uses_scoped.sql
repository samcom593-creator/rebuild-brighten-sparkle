-- v_agentlink_book_truth summed the RAW table while the client-facing scoped
-- view deduped, so the headline would have disagreed with every list under it.
-- One source: truth now reads v_agentlink_book_scoped.
create or replace view public.v_agentlink_book_truth as  WITH p AS (
         SELECT (now() AT TIME ZONE 'America/Phoenix'::text)::date AS d
        )
 SELECT count(*)::integer AS total_deals,
    sum(b.annual_premium) AS total_annual_premium,
    count(*) FILTER (WHERE b.posted_date = p.d)::integer AS deals_today,
    COALESCE(sum(b.annual_premium) FILTER (WHERE b.posted_date = p.d), 0::numeric) AS premium_today,
    count(*) FILTER (WHERE b.posted_date >= date_trunc('week'::text, p.d::timestamp without time zone)::date AND b.posted_date <= p.d)::integer AS deals_this_week,
    COALESCE(sum(b.annual_premium) FILTER (WHERE b.posted_date >= date_trunc('week'::text, p.d::timestamp without time zone)::date AND b.posted_date <= p.d), 0::numeric) AS premium_this_week,
    count(*) FILTER (WHERE b.posted_date >= date_trunc('month'::text, p.d::timestamp without time zone)::date AND b.posted_date <= p.d)::integer AS deals_this_month,
    COALESCE(sum(b.annual_premium) FILTER (WHERE b.posted_date >= date_trunc('month'::text, p.d::timestamp without time zone)::date AND b.posted_date <= p.d), 0::numeric) AS premium_this_month,
    max(b.imported_at) AS last_synced_at,
    count(*) FILTER (WHERE b.posted_date >= (date_trunc('week'::text, p.d::timestamp without time zone)::date - 7) AND b.posted_date <= (p.d - 7))::integer AS deals_prior_week,
    COALESCE(sum(b.annual_premium) FILTER (WHERE b.posted_date >= (date_trunc('week'::text, p.d::timestamp without time zone)::date - 7) AND b.posted_date <= (p.d - 7)), 0::numeric) AS premium_prior_week,
    count(*) FILTER (WHERE b.posted_date >= (p.d - 30) AND b.posted_date <= p.d)::integer AS deals_30d,
    COALESCE(sum(b.annual_premium) FILTER (WHERE b.posted_date >= (p.d - 30) AND b.posted_date <= p.d), 0::numeric) AS premium_30d,
    count(*) FILTER (WHERE b.posted_date >= (p.d - 60) AND b.posted_date < (p.d - 30))::integer AS deals_prior_30d,
    COALESCE(sum(b.annual_premium) FILTER (WHERE b.posted_date >= (p.d - 60) AND b.posted_date < (p.d - 30)), 0::numeric) AS premium_prior_30d
   FROM v_agentlink_book_scoped b,
    p
  WHERE b.is_dead IS NOT TRUE AND NOT fn_agent_is_roster_excluded(b.agent_id);
