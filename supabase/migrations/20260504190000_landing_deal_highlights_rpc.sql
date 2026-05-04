-- 20260504190000 — public RPC for the landing-page DealsTicker.
--
-- The previous ticker shipped HARDCODED fake names + amounts (MOODY $3,324
-- etc). Sam said "no fake." This RPC gives the public landing page the top
-- 13 producing agents over the last 30 days with first names only (matches
-- the marketing-flavor of the original ticker, not full PII).
--
-- Safe to call anonymously: returns ONLY first name + rounded ALP, no
-- last name, no email, no phone, no agent_id. Production-aggregate only.
-- Filters by deals.created_at and submitted/active status — same truth
-- layer the dashboards use.

CREATE OR REPLACE FUNCTION public.landing_deal_highlights()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
  FROM (
    SELECT
      UPPER(SPLIT_PART(TRIM(p.full_name), ' ', 1)) AS agent,
      ROUND(SUM(d.annual_premium))::int AS amount
    FROM public.deals d
    JOIN public.agents a ON a.id = d.agent_id
    JOIN public.profiles p ON p.user_id = a.user_id
    WHERE d.created_at >= now() - interval '30 days'
      AND d.status::text IN ('submitted', 'active')
      AND p.full_name IS NOT NULL AND p.full_name <> ''
    GROUP BY p.full_name
    HAVING SUM(d.annual_premium) >= 500   -- skip tiny noise
    ORDER BY SUM(d.annual_premium) DESC
    LIMIT 13
  ) t;
$$;

GRANT EXECUTE ON FUNCTION public.landing_deal_highlights() TO anon, authenticated;
