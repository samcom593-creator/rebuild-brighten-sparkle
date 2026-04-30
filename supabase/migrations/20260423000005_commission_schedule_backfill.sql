-- ════════════════════════════════════════════════════════════════════════
-- Section 5: commission schedule backfill — zero out the 38 unscheduled agents
--
-- Seeds agent_carrier_comp for every active agent × every active carrier
-- with a conservative 80% first-year baseline. Real contracts override
-- via the UI; this is the safety floor so fn_commission_rate never
-- returns NULL and no active deal ever fires a blocker alert.
--
-- Then backfills commission_ledger for every EXISTING 'active' deal so
-- historical production converts into pending-payout rows.
-- ════════════════════════════════════════════════════════════════════════

-- 0. Fix fn_commission_rate to treat override_pct=0 / effective_pct=0 as "no value"
--    (original version let 0-rates masquerade as valid, producing $0 commissions)
CREATE OR REPLACE FUNCTION public.fn_commission_rate(p_agent_id uuid, p_carrier_id uuid)
RETURNS TABLE(rate_pct numeric, rate_source text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT rate_pct, rate_source FROM (
    SELECT override_pct AS rate_pct, 'override'::text AS rate_source, 1 AS priority
    FROM public.agent_carrier_comp
    WHERE agent_id = p_agent_id AND carrier_id = p_carrier_id
      AND override_pct IS NOT NULL AND override_pct > 0
    UNION ALL
    SELECT effective_pct, 'contract'::text, 2
    FROM public.agent_carrier_comp
    WHERE agent_id = p_agent_id AND carrier_id = p_carrier_id
      AND effective_pct IS NOT NULL AND effective_pct > 0
    UNION ALL
    SELECT contract_pct, 'contract'::text, 3
    FROM public.agent_carrier_comp
    WHERE agent_id = p_agent_id AND carrier_id = p_carrier_id
      AND contract_pct IS NOT NULL AND contract_pct > 0
  ) t ORDER BY priority LIMIT 1;
$fn$;

-- 1. Seed schedules for all active agents × all active carriers (idempotent)
INSERT INTO public.agent_carrier_comp (agent_id, carrier_id, carrier_name, contract_pct, effective_pct, override_pct, notes)
SELECT
  a.id, c.id, c.name,
  80.00,                                               -- conservative baseline
  80.00,                                               -- effective_pct mirrors contract for now
  0.00,                                                -- no upline override by default
  '[auto-seeded 2026-04-23 — update via integrations UI with real contract pct]'
FROM public.agents a
CROSS JOIN public.carriers c
WHERE NOT a.is_deactivated
  AND c.is_active
  AND NOT EXISTS (
    SELECT 1 FROM public.agent_carrier_comp acc
    WHERE acc.agent_id = a.id AND acc.carrier_id = c.id
  );

-- 2. Backfill commission_ledger for every already-'active' deal
INSERT INTO public.commission_ledger (
  deal_id, agent_id, carrier_id, annual_premium,
  rate_pct, rate_source, amount, as_earned_pct, expected_paid_date, status
)
SELECT
  d.id,
  d.agent_id,
  d.carrier_id,
  d.annual_premium,
  fcr.rate_pct,
  fcr.rate_source,
  d.annual_premium * fcr.rate_pct / 100.0,
  100,
  COALESCE(d.effective_date, CURRENT_DATE) + interval '14 days',
  'pending'
FROM public.deals d
CROSS JOIN LATERAL public.fn_commission_rate(d.agent_id, d.carrier_id) fcr
WHERE d.status = 'active'
  AND d.agent_id IS NOT NULL
  AND d.carrier_id IS NOT NULL
  AND fcr.rate_pct IS NOT NULL
ON CONFLICT (deal_id) DO NOTHING;

-- 3. Audit trail entry for every backfilled ledger row
INSERT INTO public.commission_audit_log (deal_id, agent_id, carrier_id, rate_pct, rate_source, note)
SELECT
  cl.deal_id, cl.agent_id, cl.carrier_id, cl.rate_pct, cl.rate_source,
  'backfill 2026-04-23: seeded from fn_commission_rate at $' || to_char(cl.amount, 'FM999,990.00')
FROM public.commission_ledger cl
WHERE NOT EXISTS (
  SELECT 1 FROM public.commission_audit_log cal
  WHERE cal.deal_id = cl.deal_id AND cal.note LIKE 'backfill 2026-04-23%'
);

-- 4. Verification counts
SELECT
  (SELECT COUNT(*)::int FROM public.agents a
    WHERE NOT a.is_deactivated
    AND NOT EXISTS (SELECT 1 FROM public.agent_carrier_comp acc WHERE acc.agent_id = a.id)
  ) AS unscheduled_after,
  (SELECT COUNT(*)::int FROM public.agent_carrier_comp) AS total_schedules,
  (SELECT COUNT(*)::int FROM public.commission_ledger) AS ledger_rows,
  (SELECT ROUND(SUM(amount)::numeric, 2) FROM public.commission_ledger) AS total_pending_commissions,
  (SELECT COUNT(*)::int FROM public.commission_ledger WHERE status = 'pending') AS pending_rows;
