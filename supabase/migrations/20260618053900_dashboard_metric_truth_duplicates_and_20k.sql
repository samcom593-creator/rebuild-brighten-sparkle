-- A2 finisher: dashboard metric truth sweep.
--
-- apex-doctor 2026-06-18 found two live dashboard leaks:
--   1) duplicate same-person rows still surfaced in v_recruiter_pipeline;
--   2) v_agent_20k_target_leaderboard rendered two active producers as
--      "Unknown" because it ignored agents.display_name when profiles were
--      missing, and it still used deals.created_at instead of posted_at.
--
-- Fix obvious same-person duplicate rows by assigning canonical_agent_id to
-- the no-signal/terminated duplicate, then rewrite the 20K view to use the
-- canonical posted_at/status truth and concrete display fallbacks.
--
-- rollback: set the three canonical_agent_id values below back to NULL and
-- recreate v_agent_20k_target_leaderboard from 20260614084200_canonical_agent_dedup_production_views.sql.

-- Jacob Causer: inactive/no-production duplicate -> active AgentLink producer.
UPDATE public.agents
SET canonical_agent_id = '4fdb2e83-e66c-465e-8df4-076174e70b82'::uuid
WHERE id = 'bf948376-1022-4927-96a3-a319f4ef4bd3'::uuid
  AND canonical_agent_id IS NULL;

-- Kyle Johnson: later no-signal duplicate -> earlier AgentLink-mapped row.
UPDATE public.agents
SET canonical_agent_id = 'c5c3d19a-42aa-407c-aca9-028c98723e2b'::uuid
WHERE id = '7650f7f6-a0e2-46cc-aae7-456666cdf060'::uuid
  AND canonical_agent_id IS NULL;

-- Xaviar Watts: terminated duplicate -> active producer row.
UPDATE public.agents
SET canonical_agent_id = '19e7f9d8-0277-43f9-a90c-3e326cca4403'::uuid
WHERE id = '709be2cb-5344-4516-affb-598ba2702b12'::uuid
  AND canonical_agent_id IS NULL;

CREATE OR REPLACE VIEW public.v_agent_20k_target_leaderboard AS
WITH canonical_agents AS (
  SELECT
    a.id,
    a.profile_id,
    a.agent_code,
    a.display_name,
    a.license_status,
    a.created_at
  FROM public.agents a
  WHERE a.canonical_agent_id IS NULL
    AND a.status = 'active'::agent_status
),
deals_canon AS (
  SELECT
    COALESCE(m.canonical_agent_id, d.agent_id) AS canon_agent_id,
    d.id,
    d.annual_premium,
    d.posted_at,
    d.policy_number
  FROM public.deals d
  LEFT JOIN public.v_agent_canonical_map m ON m.agent_id = d.agent_id
  WHERE d.status = ANY (ARRAY['submitted'::text, 'active'::text])
),
base AS (
  SELECT
    ca.id AS agent_id,
    COALESCE(
      NULLIF(p.full_name, ''),
      NULLIF(ca.display_name, ''),
      NULLIF(ca.agent_code, ''),
      'Agent ' || left(ca.id::text, 8)
    ) AS name,
    p.email,
    ca.license_status,
    ca.created_at::date AS hired,
    count(dc.id) FILTER (WHERE dc.posted_at >= date_trunc('month', now())) AS deals_mtd,
    COALESCE(sum(dc.annual_premium) FILTER (WHERE dc.posted_at >= date_trunc('month', now())), 0::numeric)::integer AS ap_mtd,
    count(dc.id) FILTER (
      WHERE dc.posted_at >= date_trunc('month', now())
        AND (dc.policy_number IS NULL OR dc.policy_number = '')
    ) AS deals_no_policy_mtd,
    COALESCE(sum(dc.annual_premium) FILTER (
      WHERE dc.posted_at >= date_trunc('month', now())
        AND (dc.policy_number IS NULL OR dc.policy_number = '')
    ), 0::numeric)::integer AS ap_at_risk_mtd
  FROM canonical_agents ca
  LEFT JOIN public.profiles p ON p.id = ca.profile_id
  LEFT JOIN deals_canon dc ON dc.canon_agent_id = ca.id
  GROUP BY ca.id, ca.agent_code, ca.display_name, p.full_name, p.email, ca.license_status, ca.created_at
)
SELECT
  agent_id,
  name,
  email,
  license_status,
  hired,
  deals_mtd,
  ap_mtd,
  deals_no_policy_mtd,
  ap_at_risk_mtd,
  greatest(20000 - ap_mtd, 0) AS ap_to_20k,
  CASE
    WHEN (extract(day FROM now()))::integer = 0 THEN 0
    ELSE (round(((ap_mtd::numeric / extract(day FROM now())) * extract(day FROM (date_trunc('month', now()) + interval '1 mon -1 days')))))::integer
  END AS projected_eom_ap,
  CASE
    WHEN ap_mtd >= 20000 THEN 'hit_20k'::text
    WHEN ap_mtd > 0
      AND ((ap_mtd::numeric / nullif(extract(day FROM now()), 0::numeric)) * extract(day FROM (date_trunc('month', now()) + interval '1 mon -1 days'))) >= 20000::numeric
      THEN 'on_pace_20k'::text
    WHEN ap_mtd > 0 THEN 'below_pace'::text
    WHEN hired > (now() - interval '30 days')::date THEN 'new_hire_grace'::text
    ELSE 'zero_mtd'::text
  END AS pace_verdict
FROM base
WHERE deals_mtd > 0
   OR ap_mtd > 0
   OR hired > (now() - interval '30 days')::date
ORDER BY ap_mtd DESC NULLS LAST,
  CASE
    WHEN (extract(day FROM now()))::integer = 0 THEN 0
    ELSE (round(((ap_mtd::numeric / extract(day FROM now())) * extract(day FROM (date_trunc('month', now()) + interval '1 mon -1 days')))))::integer
  END DESC;

COMMENT ON VIEW public.v_agent_20k_target_leaderboard IS
'Finisher A2 2026-06-18: canonical agents only, deal MTD uses posted_at + submitted/active
status truth, and producer name falls back from profile.full_name to agents.display_name,
agent_code, then short id. No user-facing Unknown rows.';
