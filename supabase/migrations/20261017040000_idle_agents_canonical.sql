-- PL-WIB-IDLE-AGENTS-CANONICAL
--
-- Sam's agency dashboard prints "At-Risk Producers ... 136 idle 10d+" and
-- "Producers idle 10d+ 136"; Finances prints "Idle Active Agents 136" with the
-- names. All three come from v_cfo_agent_activation_watch (the dashboard via
-- v_cfo_snapshot.idle_active_agents). The view read raw deals with no canonical
-- map, so on 2026-10-17 it listed as idle:
--   * Cari Mullen        9 deals / $20,210.04 in the last 30 days
--   * Tyler Krejcha      both of his rows (4 / $14,354 and 1 / $1,411)
--   * 6 duplicate agent rows, incl. Sam's SJAMES02, whose sales count under the
--     canonical row
-- Raw: 136 idle of 147 rows, 11 producing. Canonical: 127 idle of 140 agents,
-- 13 producing.
--
-- Roster is canonical agents only (canonical_agent_id IS NULL), the same rule as
-- v_ceo_command_center.agent_counts. "Sold" is any canonical production in the
-- last 30 Phoenix days, attributed through v_agent_canonical_map, the source
-- every other production surface reads since the 10-16 sweep. Columns, types,
-- gate, security_barrier and grants are unchanged; v_cfo_snapshot depends on
-- this view and keeps reading active_no_deals_30d.
--
-- The window stays 30 days. The dashboard labels said "10d+"; that copy is
-- corrected in AgentCommandDashboard.tsx in the same commit.
--
-- Pre-image: business-ops/website-integrity-bot/ledger/snapshots/
--            2026-10-17-v_cfo_agent_activation_watch-pre.sql
-- Proof:     business-ops/website-integrity-bot/scripts/prove-idle-agents-canonical.sh

create or replace view public.v_cfo_agent_activation_watch with (security_barrier = true) as
select * from (
  with roster as (
    select a.id, a.display_name, a.agent_code
      from public.agents a
     where a.is_deactivated is not true
       and a.canonical_agent_id is null
  ), sold as (
    select distinct coalesce(cm.canonical_agent_id, p.agent_id) as cid
      from public.v_production_canonical p
      left join public.v_agent_canonical_map cm on cm.agent_id = p.agent_id
     where p.agent_id is not null
       and p.posted_date >= (now() at time zone 'America/Phoenix')::date - 30
  ), idle as (
    select r.* from roster r where not exists (select 1 from sold s where s.cid = r.id)
  )
  select (select count(*) from roster)::integer as active_total,
         (select count(*) from idle)::integer as active_no_deals_30d,
         (select count(*) from sold)::integer as producing_30d,
         (select json_agg(json_build_object('agent_id', i.id, 'name', i.display_name, 'agent_code', i.agent_code)
                          order by i.display_name)
            from idle i) as idle_agents,
         now() as as_of
) gated
where (select public.api_is_admin_role()) or current_user in ('postgres', 'service_role', 'supabase_admin');
