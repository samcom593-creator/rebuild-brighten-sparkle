-- ═══════════════════════════════════════════════════════════════════════════
-- Carrier Book — Business Quality Engine (2026-05-18)
--
-- Sam: "Crouch check policies that fell off or lapsed but have not been put
-- back on the books. While looking for policies that are duplicated across
-- different books. Anyone who doesn't put in their policy numbers is an
-- automatic red flag. Ensuring people don't just submit ghost deals."
--
-- Adds reconciliation views on top of carrier_policies + deals:
--   v_lapsed_recovery       — dead policies w/ no successor on the book
--   v_duplicate_policies    — same client + carrier, multiple policy #s
--   v_ghost_deals           — internal deals with NO carrier confirmation
--   v_falloff_watch         — "Lapse Pending" sorted by urgency
--   v_agent_quality_score   — per-agent: ghost rate, no-policy-# rate, dead rate
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ─── Lapsed/dead policies that DON'T have an active successor ──────────────
DROP VIEW IF EXISTS v_lapsed_recovery CASCADE;
CREATE VIEW v_lapsed_recovery AS
WITH dead AS (
  SELECT *
  FROM carrier_policies
  WHERE lower(policy_status) IN ('lapsed','lapse pending','cancelled','withdrawn','not taken')
),
has_successor AS (
  SELECT DISTINCT d.id AS dead_id
  FROM dead d
  JOIN carrier_policies live
    ON lower(live.client_first_name) = lower(d.client_first_name)
   AND lower(live.client_last_name)  = lower(d.client_last_name)
   AND live.id <> d.id
   AND lower(live.policy_status) IN ('active','approved','in review','pending')
)
SELECT
  d.id,
  d.client_first_name,
  d.client_last_name,
  d.carrier_name,
  d.policy_number,
  d.policy_status,
  d.effective_date,
  d.face_amount,
  d.annual_premium,
  d.agent_id,
  COALESCE(ag.display_name, p.full_name) AS agent_name,
  d.agent_raw,
  -- Days since policy went dead (best-effort, uses effective_date as proxy
  -- since carrier_policies doesn't have a lapse_at column)
  (CURRENT_DATE - d.effective_date)::int AS days_since_effective,
  -- Approx commission that walked
  COALESCE(d.annual_premium, 0)::numeric * 0.80 AS approx_walked_commission_usd
FROM dead d
LEFT JOIN agents   ag ON ag.id = d.agent_id
LEFT JOIN profiles p  ON p.id = ag.profile_id
WHERE d.id NOT IN (SELECT dead_id FROM has_successor);

GRANT SELECT ON v_lapsed_recovery TO authenticated;

-- ─── Duplicates: same client + carrier, different policy numbers ───────────
DROP VIEW IF EXISTS v_duplicate_policies CASCADE;
CREATE VIEW v_duplicate_policies AS
WITH grouped AS (
  SELECT
    lower(trim(coalesce(client_first_name,''))) AS fn_lc,
    lower(trim(coalesce(client_last_name,''))) AS ln_lc,
    carrier_name,
    array_agg(id ORDER BY imported_at) AS ids,
    array_agg(policy_number ORDER BY imported_at) AS policy_nums,
    array_agg(policy_status ORDER BY imported_at) AS statuses,
    count(*)::int AS dup_count
  FROM carrier_policies
  WHERE policy_number IS NOT NULL
  GROUP BY fn_lc, ln_lc, carrier_name
  HAVING count(*) > 1
)
SELECT
  fn_lc, ln_lc, carrier_name, dup_count, ids, policy_nums, statuses,
  -- Conservative "money tied up" estimate: sum of premiums where multiple
  -- non-dead rows exist (suggests double-counting or churn).
  (
    SELECT COALESCE(sum(cp.annual_premium), 0)::numeric
    FROM carrier_policies cp
    WHERE cp.id = ANY(grouped.ids)
      AND lower(cp.policy_status) NOT IN ('lapsed','lapse pending','cancelled','withdrawn','declined','not taken')
  ) AS live_premium_tied_up
FROM grouped;

GRANT SELECT ON v_duplicate_policies TO authenticated;

-- ─── Ghost deals: internal deal row with no matching carrier_policy ────────
DROP VIEW IF EXISTS v_ghost_deals CASCADE;
CREATE VIEW v_ghost_deals AS
SELECT
  d.id AS deal_id,
  d.client_first_name,
  d.client_last_name,
  d.client_phone,
  d.product_sold,
  d.policy_number,
  d.annual_premium,
  d.monthly_premium,
  d.posted_at,
  d.status                AS deal_status,
  d.pipeline_stage,
  d.carrier_id,
  c.name                  AS carrier_name,
  d.agent_id,
  COALESCE(ag.display_name, p.full_name) AS agent_name,
  (d.policy_number IS NULL OR length(trim(d.policy_number)) = 0) AS flag_no_policy_num,
  -- "ghost" = deal has a policy_number but no carrier_policy row matches it,
  --          OR deal has no policy_number at all (Sam's automatic red flag)
  (
    (d.policy_number IS NULL OR length(trim(d.policy_number)) = 0)
    OR NOT EXISTS (
      SELECT 1 FROM carrier_policies cp
      WHERE cp.policy_number IS NOT NULL
        AND lower(cp.policy_number) = lower(d.policy_number)
    )
  ) AS flag_ghost
FROM deals d
LEFT JOIN carriers c  ON c.id = d.carrier_id
LEFT JOIN agents   ag ON ag.id = d.agent_id
LEFT JOIN profiles p  ON p.id = ag.profile_id
WHERE d.status IN ('submitted','active')
  AND d.posted_at IS NOT NULL;

GRANT SELECT ON v_ghost_deals TO authenticated;

-- ─── Falloff watch: lapse-pending sorted by urgency (premium $) ────────────
DROP VIEW IF EXISTS v_falloff_watch CASCADE;
CREATE VIEW v_falloff_watch AS
SELECT
  cp.id,
  cp.client_first_name,
  cp.client_last_name,
  cp.carrier_name,
  cp.policy_number,
  cp.effective_date,
  cp.face_amount,
  cp.annual_premium,
  cp.agent_id,
  COALESCE(ag.display_name, p.full_name) AS agent_name,
  cp.agent_raw,
  COALESCE(cp.annual_premium, 0)::numeric * 0.80 AS approx_save_commission_usd
FROM carrier_policies cp
LEFT JOIN agents   ag ON ag.id = cp.agent_id
LEFT JOIN profiles p  ON p.id = ag.profile_id
WHERE lower(cp.policy_status) = 'lapse pending';

GRANT SELECT ON v_falloff_watch TO authenticated;

-- ─── Agent quality scorecard ────────────────────────────────────────────────
DROP VIEW IF EXISTS v_agent_quality_score CASCADE;
CREATE VIEW v_agent_quality_score AS
WITH agent_deals AS (
  SELECT
    d.agent_id,
    count(*)::int AS deal_count,
    count(*) FILTER (WHERE d.policy_number IS NULL OR length(trim(d.policy_number)) = 0)::int AS no_pnum_count,
    count(*) FILTER (WHERE d.status IN ('lapsed','cancelled','withdrawn'))::int AS dead_count
  FROM deals d
  WHERE d.agent_id IS NOT NULL
  GROUP BY d.agent_id
),
agent_carrier AS (
  SELECT
    cp.agent_id,
    count(*)::int AS carrier_count,
    count(*) FILTER (WHERE lower(cp.policy_status) IN ('lapsed','lapse pending','cancelled','withdrawn','declined','not taken'))::int AS carrier_dead_count
  FROM carrier_policies cp
  WHERE cp.agent_id IS NOT NULL
  GROUP BY cp.agent_id
),
ghosts AS (
  SELECT agent_id, count(*)::int AS ghost_count
  FROM v_ghost_deals
  WHERE flag_ghost = true
  GROUP BY agent_id
)
SELECT
  a.id AS agent_id,
  COALESCE(a.display_name, p.full_name) AS agent_name,
  a.agent_code,
  COALESCE(ad.deal_count, 0) AS deal_count,
  COALESCE(ad.no_pnum_count, 0) AS no_policy_num_count,
  COALESCE(g.ghost_count, 0) AS ghost_deal_count,
  COALESCE(ad.dead_count, 0) AS dead_deal_count,
  COALESCE(ac.carrier_count, 0) AS carrier_book_count,
  COALESCE(ac.carrier_dead_count, 0) AS carrier_dead_count,
  -- Quality score 0..100. Lose points for ghost deals + no-policy-# + dead rate.
  GREATEST(0, LEAST(100, 100
    - 20 * CASE WHEN COALESCE(ad.deal_count, 0) > 0
                THEN COALESCE(g.ghost_count, 0)::numeric / ad.deal_count ELSE 0 END
    - 30 * CASE WHEN COALESCE(ad.deal_count, 0) > 0
                THEN COALESCE(ad.no_pnum_count, 0)::numeric / ad.deal_count ELSE 0 END
    - 25 * CASE WHEN COALESCE(ad.deal_count, 0) > 0
                THEN COALESCE(ad.dead_count, 0)::numeric / ad.deal_count ELSE 0 END
  ))::int AS quality_score
FROM agents a
LEFT JOIN profiles p ON p.id = a.profile_id
LEFT JOIN agent_deals  ad ON ad.agent_id = a.id
LEFT JOIN agent_carrier ac ON ac.agent_id = a.id
LEFT JOIN ghosts        g  ON g.agent_id = a.id
WHERE COALESCE(ad.deal_count, 0) + COALESCE(ac.carrier_count, 0) > 0;

GRANT SELECT ON v_agent_quality_score TO authenticated;

COMMIT;
