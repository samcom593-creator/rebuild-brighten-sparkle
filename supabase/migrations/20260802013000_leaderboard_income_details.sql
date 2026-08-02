-- Put the AgentLink-backed earnings estimate on the canonical leaderboard.
-- Raw carrier contract percentages stay server-only: clients receive the
-- calculated estimate but never the underlying comp level.

create table if not exists public.agent_comp_levels (
  agent_name text primary key,
  insuracloud_user_id integer,
  carriers_count integer,
  avg_comp_pct numeric,
  comp_levels integer[],
  updated_at timestamptz default now()
);

alter table public.agent_comp_levels enable row level security;
revoke all on table public.agent_comp_levels from anon, authenticated;
grant all on table public.agent_comp_levels to service_role;

create or replace function public.leaderboard_board(p_start date, p_end date)
returns table(
  agent_key text,
  agent_id uuid,
  agent_name text,
  avatar_url text,
  deals bigint,
  ap numeric,
  est_earnings numeric,
  lead_cost numeric,
  first_policy_date date,
  tenure_label text,
  weeks_with_agency integer
)
language sql
stable
security definer
set search_path = public
as $$
  with first_deal as (
    select agent_name, min(posted_date) as fp
    from public.agentlink_book
    where is_dead is not true
    group by agent_name
  ),
  scoped as (
    select
      b.agent_name,
      b.annual_premium,
      coalesce(m.canonical_agent_id, b.agent_id) as canon
    from public.agentlink_book b
    left join public.v_agent_canonical_map m on m.agent_id = b.agent_id
    where b.is_dead is not true
      and b.posted_date >= p_start
      and b.posted_date < p_end
  ),
  grouped as (
    select
      coalesce(canon::text, 'name:' || lower(trim(agent_name))) as agent_key,
      canon as agent_id,
      min(agent_name) as raw_name,
      count(*) as deals,
      sum(annual_premium) as ap
    from scoped
    group by 1, 2
  ),
  agent_view as (
    select distinct on (a.id)
      a.id,
      pr.full_name,
      a.display_name,
      pr.avatar_url
    from public.agents a
    left join public.profiles pr on pr.id = a.user_id
  )
  select
    g.agent_key,
    g.agent_id,
    coalesce(agent_view.full_name, agent_view.display_name, g.raw_name),
    agent_view.avatar_url,
    g.deals,
    g.ap,
    -- Return the calculated estimate only; never return avg_comp_pct.
    round(g.ap * coalesce(comp.avg_comp_pct, 63) / 100.0) as est_earnings,
    coalesce(
      (select value::numeric from public.system_settings where key = 'board_lead_cost'),
      750
    ) as lead_cost,
    first_deal.fp,
    case
      when first_deal.fp is null then 'New'
      when (current_date - first_deal.fp) < 7
        then (current_date - first_deal.fp)::int || ' days in'
      when (current_date - first_deal.fp) < 56
        then ((current_date - first_deal.fp) / 7)::int || ' weeks in'
      when (current_date - first_deal.fp) < 365
        then ((current_date - first_deal.fp) / 30)::int || ' months in'
      else round(((current_date - first_deal.fp) / 365.0)::numeric, 1)::text || ' yrs in'
    end as tenure_label,
    greatest(((current_date - first_deal.fp) / 7)::int, 0) as weeks_with_agency
  from grouped g
  left join first_deal on first_deal.agent_name = g.raw_name
  left join public.agent_comp_levels comp on comp.agent_name = g.raw_name
  left join agent_view on agent_view.id = g.agent_id
  order by g.ap desc, g.deals desc;
$$;

revoke all on function public.leaderboard_board(date, date) from public, anon;
grant execute on function public.leaderboard_board(date, date) to authenticated, service_role;

comment on function public.leaderboard_board(date, date) is
  'Posted AgentLink production with server-calculated income estimate, fixed lead spend, and tenure. Raw contract percentages are never returned.';
