-- MP-430e — My Commissions and Producer Profile were empty for every signed-in user.
-- v_production_comp_truth is security_invoker (correct — it must stay scoped to
-- the caller) and its canonical_agents CTE read agents.contract_percentage
-- directly. MP-329 revoked that column from the authenticated role to close the
-- comp-level read leak, so every REST read of this view — the MyCommissions
-- estimate fallback and the ProducerProfile book roll-up — has been 42501
-- "permission denied for table agents" since 2026-08-27. Proven with Sam's real
-- session against PostgREST (bot-sql's role switch runs as postgres and cannot
-- see grant-level failures). The comp level now comes from
-- fn_agent_contract_pct() (SECURITY DEFINER, materialized since MP-430), which
-- is also what the scoreboard already uses, so the two surfaces agree. The
-- comp_by_name CTE went with it: it read agent_comp_levels (also ungranted) and
-- the resolver already folds carrier averages in.
create or replace view public.v_production_comp_truth with (security_invoker = on) as
 WITH canonical_agents AS (
         SELECT COALESCE(m_1.canonical_agent_id, a.id) AS canon,
            max(COALESCE(p.full_name, a.display_name)) AS display_name,
            -- MP-430e: the comp level comes from the SECURITY DEFINER resolver, never
            -- from agents.contract_percentage, which MP-329 revoked from the
            -- authenticated role. This view is security_invoker, so reading that
            -- column directly made PostgREST answer 42501 for every signed-in user.
            max(lvl.pct) FILTER (WHERE lvl.provenance <> 'unknown' AND lvl.pct >= 0::numeric AND lvl.pct <= 200::numeric) AS explicit_comp,
            max(CASE WHEN EXISTS ( SELECT 1
                   FROM user_roles ur
                  WHERE ur.user_id = a.user_id AND (ur.role::text = ANY (ARRAY['admin'::text, 'super_admin'::text, 'owner'::text]))) THEN 120::numeric END) AS owner_comp
           FROM agents a
             LEFT JOIN v_agent_canonical_map m_1 ON m_1.agent_id = a.id
             LEFT JOIN profiles p ON p.id = a.user_id
             LEFT JOIN LATERAL public.fn_agent_contract_pct(a.id) lvl ON true
          GROUP BY (COALESCE(m_1.canonical_agent_id, a.id))
        )
 SELECT u.row_key,
    u.origin,
    u.agent_id AS raw_agent_id,
    COALESCE(m.canonical_agent_id, u.agent_id) AS agent_id,
        CASE
            WHEN u.origin = 'discord_external'::text THEN u.agent_name
            ELSE COALESCE(ca.display_name, u.agent_name)
        END AS agent_name,
    u.client_name,
    u.carrier,
    u.product,
    u.policy_number,
    u.annual_premium,
    u.posted_date,
    u.effective_date,
    u.status,
    u.synced_at,
        CASE
            WHEN u.origin = 'external_daily_gap'::text THEN 0::numeric
            ELSE COALESCE(ca.explicit_comp, ca.owner_comp, 60::numeric)
        END AS seller_comp_pct,
        CASE
            WHEN u.origin = 'external_daily_gap'::text THEN 0::numeric
            ELSE u.annual_premium * COALESCE(ca.explicit_comp, ca.owner_comp, 60::numeric) / 100.0
        END AS direct_estimate
   FROM v_production_unified u
     LEFT JOIN v_agent_canonical_map m ON m.agent_id = u.agent_id
     LEFT JOIN canonical_agents ca ON ca.canon = COALESCE(m.canonical_agent_id, u.agent_id)
;
