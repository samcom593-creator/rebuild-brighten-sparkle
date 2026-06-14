-- Wave-95: canonicalize 4 additional per-agent rollup views via v_agent_canonical_map.
-- Continues the wave-93/94 sweep. Same disease, same medicine: dup agent_id rows (where
-- canonical_agent_id IS NOT NULL) get folded into the canonical row, and fact-table joins
-- (deals, carrier_policies, v_charge_anomalies) route agent_id through v_agent_canonical_map
-- so any work attached to the dup gets attributed to the canonical id.
-- Current dup_rows=3 (SJAMES02, JWANTROB01, JDIGNAN02) carrying 105 deals + 9 carrier_policies.

-- 1. v_recent_activations_alp — admin landing recent activations panel.
--    Pre: agents row taken raw; dup with its own first_deal_at could show as a second activation.
--    Post: dup agents excluded from activation set; deals routed via canonical map so a dup's
--    deals still count toward the canonical agent's first_30d_alp window.
CREATE OR REPLACE VIEW public.v_recent_activations_alp AS
WITH canonical_agents AS (
  SELECT id AS agent_id, display_name, contracted_at, first_deal_at
  FROM agents
  WHERE canonical_agent_id IS NULL
),
activations AS (
  SELECT
    a.agent_id,
    a.display_name,
    a.contracted_at,
    a.first_deal_at,
    date_trunc('month'::text, a.first_deal_at) AS activation_month
  FROM canonical_agents a
  WHERE a.first_deal_at IS NOT NULL
    AND a.first_deal_at >= (date_trunc('month'::text, now()) - interval '1 month')
),
window_alp AS (
  SELECT
    act.agent_id,
    act.display_name,
    act.first_deal_at,
    act.activation_month,
    COALESCE(sum(d.annual_premium) FILTER (
      WHERE d.posted_at IS NOT NULL
        AND d.posted_at >= act.first_deal_at
        AND d.posted_at <= (act.first_deal_at + interval '30 days')
        AND d.status = ANY (ARRAY['active'::text, 'submitted'::text])
    ), 0::numeric) AS first_30d_alp,
    count(d.id) FILTER (
      WHERE d.posted_at IS NOT NULL
        AND d.posted_at >= act.first_deal_at
        AND d.posted_at <= (act.first_deal_at + interval '30 days')
        AND d.status = ANY (ARRAY['active'::text, 'submitted'::text])
    ) AS first_30d_deals
  FROM activations act
  LEFT JOIN v_agent_canonical_map m ON m.canonical_agent_id = act.agent_id
  LEFT JOIN deals d ON d.agent_id = m.agent_id
  GROUP BY act.agent_id, act.display_name, act.first_deal_at, act.activation_month
)
SELECT
  agent_id,
  display_name,
  first_deal_at,
  activation_month,
  first_30d_alp,
  first_30d_deals,
  rank() OVER (PARTITION BY activation_month ORDER BY first_30d_alp DESC) AS rank_in_month
FROM window_alp
ORDER BY activation_month DESC, first_30d_alp DESC;

-- 2. v_agent_charge_rollup — Stripe charge anomaly rollup per agent.
--    Pre: GROUP BY raw resolved_agent_id from v_charge_anomalies.
--    Post: canonicalize at rollup time; resolve agent_name from canonical agents.
CREATE OR REPLACE VIEW public.v_agent_charge_rollup AS
SELECT
  COALESCE(m.canonical_agent_id, ca.resolved_agent_id) AS agent_id,
  COALESCE(can_a.display_name, ca.resolved_agent_name) AS agent_name,
  count(*) AS total_charges,
  count(*) FILTER (WHERE ca.flag_name_mismatch OR ca.flag_unlinked OR ca.flag_unusual_amount OR ca.flag_duplicate_window) AS flagged_charges,
  count(*) FILTER (WHERE ca.flag_duplicate_window) AS duplicate_charges,
  ((sum(ca.amount_cents))::numeric / 100::numeric) AS total_billed_usd,
  ((sum(ca.amount_cents) FILTER (WHERE ca.flag_duplicate_window))::numeric / 100::numeric) AS duplicate_amount_usd,
  max(ca.charged_at) AS last_charged_at
FROM v_charge_anomalies ca
LEFT JOIN v_agent_canonical_map m ON m.agent_id = ca.resolved_agent_id
LEFT JOIN agents can_a ON can_a.id = COALESCE(m.canonical_agent_id, ca.resolved_agent_id)
WHERE ca.resolved_agent_id IS NOT NULL
GROUP BY COALESCE(m.canonical_agent_id, ca.resolved_agent_id), COALESCE(can_a.display_name, ca.resolved_agent_name);

-- 3. v_commission_recovery_by_agent — carrier_policies missing premium/face per agent.
--    Pre: GROUP BY cp.agent_id raw.
--    Post: canonicalize before grouping so dup-attached policies roll up to canonical agent.
CREATE OR REPLACE VIEW public.v_commission_recovery_by_agent AS
SELECT
  COALESCE(a.display_name, 'unmatched'::text) AS agent_display,
  COALESCE(m.canonical_agent_id, cp.agent_id) AS agent_id,
  count(*) AS total_to_recover,
  count(*) FILTER (WHERE cp.recovery_email_sent_at IS NOT NULL) AS emailed,
  count(*) FILTER (WHERE cp.recovery_response_received_at IS NOT NULL) AS responded,
  count(*) FILTER (WHERE cp.recovery_email_sent_at IS NULL) AS not_yet_emailed
FROM carrier_policies cp
LEFT JOIN v_agent_canonical_map m ON m.agent_id = cp.agent_id
LEFT JOIN agents a ON a.id = COALESCE(m.canonical_agent_id, cp.agent_id)
WHERE cp.face_amount IS NULL
   OR cp.annual_premium IS NULL
   OR cp.face_amount = 0::numeric
   OR cp.annual_premium = 0::numeric
GROUP BY a.display_name, COALESCE(m.canonical_agent_id, cp.agent_id);

-- 4. v_agent_quality_score — composite quality score per agent.
--    Pre: 3 CTEs each GROUP BY raw agent_id, joined to agents table raw.
--    Post: CTEs canonicalize agent_id via map; outer JOIN starts from canonical agents only.
CREATE OR REPLACE VIEW public.v_agent_quality_score AS
WITH agent_deals AS (
  SELECT
    COALESCE(m.canonical_agent_id, d.agent_id) AS agent_id,
    (count(*))::integer AS deal_count,
    (count(*) FILTER (WHERE d.policy_number IS NULL OR length(TRIM(BOTH FROM d.policy_number)) = 0))::integer AS no_pnum_count,
    (count(*) FILTER (WHERE d.status = ANY (ARRAY['lapsed'::text, 'cancelled'::text, 'withdrawn'::text])))::integer AS dead_count
  FROM deals d
  LEFT JOIN v_agent_canonical_map m ON m.agent_id = d.agent_id
  WHERE d.agent_id IS NOT NULL
  GROUP BY COALESCE(m.canonical_agent_id, d.agent_id)
),
agent_carrier AS (
  SELECT
    COALESCE(m.canonical_agent_id, cp.agent_id) AS agent_id,
    (count(*))::integer AS carrier_count,
    (count(*) FILTER (WHERE lower(cp.policy_status) = ANY (ARRAY['lapsed'::text, 'lapse pending'::text, 'cancelled'::text, 'withdrawn'::text, 'declined'::text, 'not taken'::text])))::integer AS carrier_dead_count
  FROM carrier_policies cp
  LEFT JOIN v_agent_canonical_map m ON m.agent_id = cp.agent_id
  WHERE cp.agent_id IS NOT NULL
  GROUP BY COALESCE(m.canonical_agent_id, cp.agent_id)
),
ghosts AS (
  SELECT
    COALESCE(m.canonical_agent_id, v_ghost_deals.agent_id) AS agent_id,
    (count(*))::integer AS ghost_count
  FROM v_ghost_deals
  LEFT JOIN v_agent_canonical_map m ON m.agent_id = v_ghost_deals.agent_id
  WHERE v_ghost_deals.flag_ghost = true
  GROUP BY COALESCE(m.canonical_agent_id, v_ghost_deals.agent_id)
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
  (GREATEST(0::numeric, LEAST(100::numeric,
    100::numeric
      - (20::numeric * CASE WHEN COALESCE(ad.deal_count, 0) > 0 THEN (COALESCE(g.ghost_count, 0))::numeric / (ad.deal_count)::numeric ELSE 0::numeric END)
      - (30::numeric * CASE WHEN COALESCE(ad.deal_count, 0) > 0 THEN (COALESCE(ad.no_pnum_count, 0))::numeric / (ad.deal_count)::numeric ELSE 0::numeric END)
      - (25::numeric * CASE WHEN COALESCE(ad.deal_count, 0) > 0 THEN (COALESCE(ad.dead_count, 0))::numeric / (ad.deal_count)::numeric ELSE 0::numeric END)
  )))::integer AS quality_score
FROM agents a
LEFT JOIN profiles p ON p.id = a.profile_id
LEFT JOIN agent_deals ad ON ad.agent_id = a.id
LEFT JOIN agent_carrier ac ON ac.agent_id = a.id
LEFT JOIN ghosts g ON g.agent_id = a.id
WHERE a.canonical_agent_id IS NULL
  AND (COALESCE(ad.deal_count, 0) + COALESCE(ac.carrier_count, 0)) > 0;

COMMENT ON VIEW public.v_recent_activations_alp IS 'Wave-95 (2026-06-14): canonicalized via v_agent_canonical_map. Dup agents folded into canonical row; dup deals attribute upward.';
COMMENT ON VIEW public.v_agent_charge_rollup IS 'Wave-95 (2026-06-14): canonicalized via v_agent_canonical_map. Stripe charge rollup uses canonical agent_id.';
COMMENT ON VIEW public.v_commission_recovery_by_agent IS 'Wave-95 (2026-06-14): canonicalized via v_agent_canonical_map. Carrier-policy commission-recovery rollup uses canonical agent_id.';
COMMENT ON VIEW public.v_agent_quality_score IS 'Wave-95 (2026-06-14): canonicalized via v_agent_canonical_map. CTEs canonicalize source agent_id; outer SELECT starts from canonical agents only.';
