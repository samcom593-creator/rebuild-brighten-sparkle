-- PL-WIB-ACTIVATIONS-CANONICAL
--
-- Sam's agency dashboard, Activations tab: "Recent activations · avg first-30d
-- ALP" ranks every agent whose first deal landed this month or last month by
-- the premium they posted in their first 30 days. It reads
-- v_recent_activations_alp, which summed raw deals. Deals posted from Discord
-- never land in deals, so on 2026-10-17 the panel printed:
--   Tyler Krejcha   $0 / 0 deals  (canonical 4 / $14,354, activated 09-23)
--   Tyler Krejcha   $0 / 0 deals  (canonical 1 / $1,411,  activated 10-01)
-- and ranked both rows last. Tyler is the same person on two canonical rows;
-- that is the open duplicate-login merge, not this view.
--
-- The window now reads v_production_canonical through v_agent_canonical_map,
-- the source every production surface uses since the 10-16 sweep, on Phoenix
-- dates: the first deal's Phoenix day through day 30. That also moves Edwin
-- Ac-lumor from 34 / $53,891 to 37 / $58,646: three deals he posted on
-- 10-07 at 14:03 Phoenix, his day 30, fell 3.5 hours past the old
-- timestamp cutoff. The status filter is the canonical one (dead statuses
-- out) instead of active/submitted only.
--
-- Unchanged: the activation set (agents.first_deal_at, canonical since
-- 43c1f396), the month bucket, columns, types, rank, security_invoker and
-- grants.
--
-- Pre-image: business-ops/website-integrity-bot/ledger/snapshots/
--            2026-10-17-v_recent_activations_alp-pre.sql
-- Proof:     business-ops/website-integrity-bot/scripts/prove-activations-canonical.sh

create or replace view public.v_recent_activations_alp with (security_invoker = true) as
with canonical_agents as (
  select a.id as agent_id, a.display_name, a.contracted_at, a.first_deal_at
    from public.agents a
   where a.canonical_agent_id is null
), activations as (
  select a.agent_id, a.display_name, a.contracted_at, a.first_deal_at,
         date_trunc('month', a.first_deal_at) as activation_month,
         (a.first_deal_at at time zone 'America/Phoenix')::date as first_deal_day
    from canonical_agents a
   where a.first_deal_at is not null
     and a.first_deal_at >= (date_trunc('month', now()) - interval '1 month')
), window_alp as (
  select act.agent_id, act.display_name, act.first_deal_at, act.activation_month,
         coalesce(sum(p.annual_premium), 0)::numeric as first_30d_alp,
         count(p.row_key) as first_30d_deals
    from activations act
    left join public.v_agent_canonical_map m on m.canonical_agent_id = act.agent_id
    left join public.v_production_canonical p
           on p.agent_id = m.agent_id
          and p.posted_date >= act.first_deal_day
          and p.posted_date <= act.first_deal_day + 30
   group by act.agent_id, act.display_name, act.first_deal_at, act.activation_month
)
select agent_id, display_name, first_deal_at, activation_month, first_30d_alp, first_30d_deals,
       rank() over (partition by activation_month order by first_30d_alp desc) as rank_in_month
  from window_alp
 order by activation_month desc, first_30d_alp desc;
