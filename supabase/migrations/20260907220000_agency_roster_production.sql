-- 20260907220000_agency_roster_production.sql
-- Sam, 2026-09-07: "make me able to see my agencies under me with a better
-- view — I can't see them on leaderboards or anything; they're still under
-- me, just not using our main website."
--
-- MEASURED (30d): APEX Financial 10 agents / $95,539; Vantage Financial
-- 5 agents / $76,833, 28 of its 41 rows are external_daily_gap (reported by
-- the agency, attributed to no producer yet). leaderboard_board already ranks
-- 4 Vantage producers but no row says which agency it belongs to, and nothing
-- anywhere lists the agents INSIDE a sub-agency. Two changes:
--   1) agency_roster_production(p_start, p_end): one row per (agency, agent)
--      with production, comp, first hop and whether the person has a login,
--      plus one labelled row per agency for its unattributed gap.
--   2) leaderboard_board gains an `agency` column (appended; nothing else
--      changes) so the board can tag and filter by agency.

create or replace function public.agency_roster_production(p_start date, p_end date)
returns table(
  agency text,
  is_gap boolean,
  agent_id uuid,
  agent_name text,
  policies bigint,
  ap numeric,
  last_sale date,
  contract_pct numeric,
  contract_provenance text,
  has_login boolean,
  first_hop_name text
)
language sql
stable security definer
set search_path to 'public'
as $$
  with visible as (
    select c.*
    from public.mv_production_comp_truth c
    where c.posted_date >= p_start
      and c.posted_date < p_end
      and (
        public.apex_is_admin()
        or (c.agent_id is not null and public.crm_can_read_agent_scope(c.agent_id))
      )
  ), per_agent as (
    select
      v.agency,
      v.agent_id,
      min(v.agent_name) as raw_name,
      count(*)::bigint as policies,
      round(sum(v.annual_premium), 2) as ap,
      max(v.posted_date) as last_sale
    from visible v
    where v.origin is distinct from 'external_daily_gap'
    group by v.agency, v.agent_id
  ), gap as (
    select
      v.agency,
      count(*)::bigint as policies,
      round(sum(v.annual_premium), 2) as ap,
      max(v.posted_date) as last_sale
    from visible v
    where v.origin = 'external_daily_gap'
    group by v.agency
  ), sam as (
    select coalesce(array_agg(distinct coalesce(m.canonical_agent_id, a.id)), '{}'::uuid[]) as ids
    from public.agents a
    left join public.v_agent_canonical_map m on m.agent_id = a.id
    where a.user_id = auth.uid()
  )
  select
    p.agency,
    false as is_gap,
    p.agent_id,
    coalesce(pr.full_name, a.display_name, p.raw_name) as agent_name,
    p.policies,
    p.ap,
    p.last_sale,
    cp.pct as contract_pct,
    cp.provenance as contract_provenance,
    (a.user_id is not null) as has_login,
    (
      select coalesce(hp.full_name, ha.display_name)
      from public.fn_hierarchy_first_hops((select ids from sam)) h
      join public.agents ha on ha.id = h.first_hop
      left join public.profiles hp on hp.id = ha.profile_id
      where h.member = p.agent_id
      limit 1
    ) as first_hop_name
  from per_agent p
  left join public.agents a on a.id = p.agent_id
  left join public.profiles pr on pr.id = a.profile_id
  left join lateral public.fn_agent_contract_pct(p.agent_id) cp on true
  union all
  select
    g.agency,
    true as is_gap,
    null::uuid,
    'Reported by ' || g.agency || ' — not yet attributed to a producer',
    g.policies,
    g.ap,
    g.last_sale,
    null::numeric,
    null::text,
    false,
    null::text
  from gap g
  order by agency, is_gap, ap desc nulls last, agent_name;
$$;

grant execute on function public.agency_roster_production(date, date) to authenticated;

-- leaderboard_board: append `agency`. Return type changes, so drop + recreate;
-- the body is byte-for-byte the previous definition plus the agency aggregate.
drop function if exists public.leaderboard_board(date, date);
create function public.leaderboard_board(p_start date, p_end date)
returns table(agent_key text, agent_id uuid, agent_name text, avatar_url text, deals bigint, ap numeric, est_earnings numeric, lead_cost numeric, first_policy_date date, tenure_label text, weeks_with_agency integer, agency text)
language sql
stable security definer
set search_path to 'public'
as $$
  with visible as (
    select t.*
    from public.v_production_comp_truth t
    where t.origin is distinct from 'external_daily_gap'
      and (
        public.apex_is_admin()
        or (t.agent_id is not null and public.crm_can_read_agent_scope(t.agent_id))
      )
  ), grouped as (
    select
      coalesce(v.agent_id::text, 'name:' || lower(btrim(v.agent_name))) as agent_key,
      v.agent_id,
      min(v.agent_name) as raw_name,
      count(*) as deals,
      sum(v.annual_premium) as ap,
      sum(v.direct_estimate) as est_earnings,
      -- v_production_comp_truth carries no agency; the materialized truth does,
      -- keyed by the same row_key. mode() = the agency this producer's rows sit in.
      mode() within group (order by m.agency) as agency
    from visible v
    left join public.mv_production_comp_truth m on m.row_key = v.row_key
    where v.posted_date >= p_start
      and v.posted_date < p_end
    group by 1, 2
  ), lifetime as (
    select
      coalesce(t.agent_id::text, 'name:' || lower(btrim(t.agent_name))) as agent_key,
      min(t.posted_date) as first_policy_date
    from public.v_production_comp_truth t
    where t.origin is distinct from 'external_daily_gap'
      and coalesce(t.agent_id::text, 'name:' || lower(btrim(t.agent_name)))
          in (select g.agent_key from grouped g)
    group by 1
  )
  select
    g.agent_key,
    g.agent_id,
    coalesce(pr.full_name, a.display_name, g.raw_name) as agent_name,
    pr.avatar_url,
    g.deals,
    g.ap,
    g.est_earnings,
    0::numeric as lead_cost,
    l.first_policy_date,
    case
      when l.first_policy_date is null then 'New'
      when current_date - l.first_policy_date < 7 then (current_date - l.first_policy_date)::int || ' days in'
      when current_date - l.first_policy_date < 56 then ((current_date - l.first_policy_date) / 7)::int || ' weeks in'
      when current_date - l.first_policy_date < 365 then ((current_date - l.first_policy_date) / 30)::int || ' months in'
      else round(((current_date - l.first_policy_date) / 365.0)::numeric, 1)::text || ' yrs in'
    end,
    greatest(((current_date - l.first_policy_date) / 7)::int, 0),
    g.agency
  from grouped g
  left join lifetime l on l.agent_key = g.agent_key
  left join public.agents a on a.id = g.agent_id
  left join public.profiles pr on pr.id = a.profile_id
  order by g.ap desc, g.deals desc, agent_name asc;
$$;

grant execute on function public.leaderboard_board(date, date) to authenticated;
