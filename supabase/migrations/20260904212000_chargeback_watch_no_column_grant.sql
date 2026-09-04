-- MP-430c — Book of Business chargeback watch was 403 for EVERY user, Sam included.
--
-- v_chargeback_watch is security_invoker (correct: it must stay RLS-scoped to
-- the caller) but it read agents.contract_percentage directly, and MP-329
-- revoked that column from the authenticated role to close the comp-level
-- read leak. Result, measured as the real authenticated role on 2026-09-04:
-- "permission denied for table agents" on every read, which PostgREST reports
-- as 403 and BookOfBusiness swallows into a warn — so the Lapse-Pending /
-- chargeback KPI has been silently empty since 2026-08-27.
--
-- Fix: the only thing the view needs from that column is the comp rate, and
-- fn_agent_contract_pct() is SECURITY DEFINER (and, since MP-430, a
-- materialized lookup) — it hands back the rate without granting the column.
-- The view keeps security_invoker so per-agent scoping is unchanged.
create or replace view public.v_chargeback_watch with (security_invoker = on) as
 WITH base AS (
         SELECT b.deal_key,
            b.policy_number,
            b.carrier,
            b.status,
            COALESCE(NULLIF(TRIM(BOTH FROM b.client_name), ''::text), TRIM(BOTH FROM (COALESCE(b.client_first_name, ''::text) || ' '::text) || COALESCE(b.client_last_name, ''::text))) AS client_name,
            b.annual_premium,
            b.monthly_premium,
            b.effective_date,
            b.posted_date,
            b.agent_id,
            COALESCE(a.display_name, b.agent_name, '(unmapped)'::text) AS agent_name,
            COALESCE(m.display_name, 'unassigned'::text) AS manager,
            COALESCE((SELECT p.pct FROM public.fn_agent_contract_pct(b.agent_id) p), 100::numeric) / 100.0 AS contract_rate,
            GREATEST(0, CURRENT_DATE - b.effective_date)::numeric / 30.44 AS months_in_force
           FROM agentlink_book b
             LEFT JOIN agents a ON a.id = b.agent_id
             LEFT JOIN agents m ON m.id = a.manager_id
          WHERE (b.status = ANY (ARRAY['Lapse Pending'::text, 'Lapsed'::text, 'Cancelled'::text])) AND b.effective_date IS NOT NULL
        )
 SELECT deal_key,
    policy_number,
    carrier,
    client_name,
    agent_id,
    agent_name,
    manager,
    status,
    effective_date,
    round(months_in_force, 1) AS months_in_force,
    annual_premium,
    round(annual_premium * contract_rate * GREATEST(0::numeric, LEAST(1::numeric, (9::numeric - months_in_force) / 9.0)), 0) AS est_clawback_exposure,
    round(contract_rate * 100::numeric, 0) AS contract_pct,
        CASE
            WHEN status = 'Lapse Pending'::text AND months_in_force < 9::numeric THEN 1
            WHEN status = 'Lapse Pending'::text THEN 2
            WHEN (status = ANY (ARRAY['Lapsed'::text, 'Cancelled'::text])) AND months_in_force < 9::numeric THEN 3
            ELSE 4
        END AS priority,
        CASE
            WHEN status = 'Lapse Pending'::text AND months_in_force < 9::numeric THEN 'ACT NOW — still saveable, and the advance is still partly unearned'::text
            WHEN status = 'Lapse Pending'::text THEN 'Lapse pending, advance already earned out — save the client, not the commission'::text
            WHEN (status = ANY (ARRAY['Lapsed'::text, 'Cancelled'::text])) AND months_in_force < 9::numeric THEN 'Already lapsed inside the window — expect a clawback; confirm against the carrier statement'::text
            ELSE 'Lapsed after the window — no clawback expected'::text
        END AS what_this_means,
    'ESTIMATE — annual premium x contract %, straight-line over 9 months. No payout feed exists; confirm against carrier statements.'::text AS basis
   FROM base
  ORDER BY (
        CASE
            WHEN status = 'Lapse Pending'::text AND months_in_force < 9::numeric THEN 1
            WHEN status = 'Lapse Pending'::text THEN 2
            WHEN (status = ANY (ARRAY['Lapsed'::text, 'Cancelled'::text])) AND months_in_force < 9::numeric THEN 3
            ELSE 4
        END), (round(annual_premium * contract_rate * GREATEST(0::numeric, LEAST(1::numeric, (9::numeric - months_in_force) / 9.0)), 0)) DESC NULLS LAST;
