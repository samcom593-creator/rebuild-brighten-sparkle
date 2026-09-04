-- MP-415: a verified Discord sale keeps the name used by the writing producer.
--
-- Canonical identity is still required for de-duplication, hierarchy scope, and
-- comp resolution. It is not presentation identity. The distinction matters
-- for AgentLink identity 352: the canonical APEX row is the departed KJ Vaughn,
-- while the verified Vantage #daily-sales message names Kaeden Vaughns as the
-- writer. v_production_comp_truth previously replaced Kaeden with KJ, so Sam's
-- live "Who sold" table attributed Kaeden's $2,007 policy to a departed agent.
--
-- Preserve the raw, source-attested name only for named Discord production.
-- Every other source retains canonical display-name behavior, and agent_id
-- remains canonical everywhere so visibility and commission math do not move.

begin;

create or replace view public.v_production_comp_truth
with (security_invoker = on) as
with canonical_agents as (
  select
    coalesce(m.canonical_agent_id, a.id) as canon,
    max(coalesce(p.full_name, a.display_name)) as display_name,
    max(a.contract_percentage) filter (
      where a.contract_percentage between 0 and 200
        and a.contract_percentage <> 120
    ) as explicit_comp,
    max(a.contract_percentage) filter (
      where a.contract_percentage = 120
        and exists (
          select 1 from public.user_roles ur
          where ur.user_id = a.user_id
            and ur.role::text in ('admin', 'super_admin', 'owner')
        )
    ) as owner_comp
  from public.agents a
  left join public.v_agent_canonical_map m on m.agent_id = a.id
  left join public.profiles p on p.id = a.user_id
  group by 1
), comp_by_name as (
  select lower(btrim(agent_name)) as name_key, max(avg_comp_pct) as avg_comp_pct
  from public.agent_comp_levels
  where avg_comp_pct between 0 and 200
  group by 1
)
select
  u.row_key,
  u.origin,
  u.agent_id as raw_agent_id,
  coalesce(m.canonical_agent_id, u.agent_id) as agent_id,
  case
    when u.origin = 'discord_external' then u.agent_name
    else coalesce(ca.display_name, u.agent_name)
  end as agent_name,
  u.client_name,
  u.carrier,
  u.product,
  u.policy_number,
  u.annual_premium,
  u.posted_date,
  u.effective_date,
  u.status,
  u.synced_at,
  case when u.origin = 'external_daily_gap' then 0::numeric
    else coalesce(ca.explicit_comp, cbn.avg_comp_pct, ca.owner_comp, 60)::numeric end
    as seller_comp_pct,
  case when u.origin = 'external_daily_gap' then 0::numeric
    else u.annual_premium * coalesce(ca.explicit_comp, cbn.avg_comp_pct, ca.owner_comp, 60) / 100.0 end
    as direct_estimate
from public.v_production_unified u
left join public.v_agent_canonical_map m on m.agent_id = u.agent_id
left join canonical_agents ca on ca.canon = coalesce(m.canonical_agent_id, u.agent_id)
left join comp_by_name cbn on cbn.name_key = lower(btrim(u.agent_name));

grant select on public.v_production_comp_truth to authenticated, service_role;

comment on view public.v_production_comp_truth is
  'Canonical deduped production with one resolved comp percentage and per-deal direct estimate. Named Discord rows preserve the source-attested writing-agent name; canonical identity remains the scope, de-duplication, and comp key.';

commit;
