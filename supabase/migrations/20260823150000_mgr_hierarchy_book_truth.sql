-- v_manager_hierarchy_mtd was computed from the LEGACY public.deals table while
-- every other production surface reads agentlink_book. That is why its numbers
-- never reconciled with the leaderboard — same question, two different sources,
-- the source-parity disease of 2026-08-07. It also ranked roster-excluded agents.
--
-- Rebuilt on agentlink_book with the same semantics as leaderboard_board:
-- posted_date windows, America/Phoenix month, is_dead excluded, canonical agent
-- map applied, roster exclusions honoured. Column contract is unchanged so
-- existing consumers need no edit.
create or replace view public.v_manager_hierarchy_mtd
with (security_invoker = on) as
with bounds as (
  select date_trunc('month', (now() at time zone 'America/Phoenix'))::date as m_start,
         (date_trunc('month', (now() at time zone 'America/Phoenix')) + interval '1 month')::date as m_end
),
roster as (
  select r.id, r.display_name, r.manager_id
  from public.v_apex_roster r
),
prod as (
  select coalesce(m.canonical_agent_id, b.agent_id) as canon,
         sum(b.annual_premium) as alp,
         count(*) as deals
  from public.agentlink_book b
  left join public.v_agent_canonical_map m on m.agent_id = b.agent_id
  cross join bounds
  where b.is_dead is not true
    and not public.fn_agent_is_roster_excluded(b.agent_id)
    and b.posted_date >= bounds.m_start
    and b.posted_date <  bounds.m_end
  group by 1
)
select
  coalesce(r.manager_id, '00000000-0000-0000-0000-000000000000'::uuid) as manager_id,
  coalesce(mgr.display_name, '(direct to Sam)')                        as manager_name,
  count(*)::bigint                                                     as team_size,
  coalesce(sum(p.alp), 0)                                              as team_alp_mtd,
  coalesce(sum(p.deals), 0)::bigint                                    as team_deals_mtd,
  count(*) filter (where p.canon is not null)::bigint                  as producing_team_mtd
from roster r
left join prod p on p.canon = r.id
left join public.agents mgr on mgr.id = r.manager_id
group by 1, 2
order by 4 desc;

grant select on public.v_manager_hierarchy_mtd to authenticated;
