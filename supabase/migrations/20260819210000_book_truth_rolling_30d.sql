-- 2026-08-19 (Sam: "production should be ~300k for last 30 days"): the dashboard's
-- calendar month-to-date ($178k on Aug 19) is honest but understates recent
-- production mid-month. v_agentlink_book_truth had today/week/month but no rolling
-- window. Added deals_30d/premium_30d (+ prior_30d for a real trend), same
-- Phoenix tz, same posted_date basis, same is_dead exclusion. Rolling 30d = $305k.
-- Columns appended so existing consumers are untouched. Applied live via bot-sql.
create or replace view public.v_agentlink_book_truth as
 WITH p AS (SELECT (now() AT TIME ZONE 'America/Phoenix')::date AS d)
 SELECT count(*)::integer AS total_deals,
    sum(b.annual_premium) AS total_annual_premium,
    count(*) FILTER (WHERE b.posted_date = p.d)::integer AS deals_today,
    COALESCE(sum(b.annual_premium) FILTER (WHERE b.posted_date = p.d), 0::numeric) AS premium_today,
    count(*) FILTER (WHERE b.posted_date >= date_trunc('week', p.d::timestamp)::date AND b.posted_date <= p.d)::integer AS deals_this_week,
    COALESCE(sum(b.annual_premium) FILTER (WHERE b.posted_date >= date_trunc('week', p.d::timestamp)::date AND b.posted_date <= p.d), 0::numeric) AS premium_this_week,
    count(*) FILTER (WHERE b.posted_date >= date_trunc('month', p.d::timestamp)::date AND b.posted_date <= p.d)::integer AS deals_this_month,
    COALESCE(sum(b.annual_premium) FILTER (WHERE b.posted_date >= date_trunc('month', p.d::timestamp)::date AND b.posted_date <= p.d), 0::numeric) AS premium_this_month,
    max(b.imported_at) AS last_synced_at,
    count(*) FILTER (WHERE b.posted_date >= (date_trunc('week', p.d::timestamp)::date - 7) AND b.posted_date <= (p.d - 7))::integer AS deals_prior_week,
    COALESCE(sum(b.annual_premium) FILTER (WHERE b.posted_date >= (date_trunc('week', p.d::timestamp)::date - 7) AND b.posted_date <= (p.d - 7)), 0::numeric) AS premium_prior_week,
    count(*) FILTER (WHERE b.posted_date >= (p.d - 30) AND b.posted_date <= p.d)::integer AS deals_30d,
    COALESCE(sum(b.annual_premium) FILTER (WHERE b.posted_date >= (p.d - 30) AND b.posted_date <= p.d), 0::numeric) AS premium_30d,
    count(*) FILTER (WHERE b.posted_date >= (p.d - 60) AND b.posted_date < (p.d - 30))::integer AS deals_prior_30d,
    COALESCE(sum(b.annual_premium) FILTER (WHERE b.posted_date >= (p.d - 60) AND b.posted_date < (p.d - 30)), 0::numeric) AS premium_prior_30d
   FROM agentlink_book b, p
  WHERE b.is_dead IS NOT TRUE;
