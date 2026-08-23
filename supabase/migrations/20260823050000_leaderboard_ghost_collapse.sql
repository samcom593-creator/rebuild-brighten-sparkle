-- Sam: "remove alyjah rowland" — he ranked #1 on the leaderboard with $121,082
-- while being agent_code GHOST_336, status inactive. 10 such GHOST_ rows exist
-- (AgentLink sync placeholders never linked to a real APEX identity) holding 84
-- live deals / $204,862 between them.
--
-- Deliberately NOT deleted and NOT filtered out: dropping them from the ranking
-- while leaderboard_book_hero still counts their premium would make the listed
-- producers stop summing to the headline total — the source-parity disease that
-- cost a full wave on 2026-08-07. Instead every ghost collapses into ONE
-- "Unclaimed production" row sorted last: Sam never sees a phantom name ranked
-- above his real producers, the money still reconciles, and the row is an
-- actionable merge queue rather than a silent write-off.
create or replace function public.leaderboard_board(p_start date, p_end date)
 returns table(agent_key text, agent_id uuid, agent_name text, avatar_url text, deals bigint, ap numeric, est_earnings numeric, lead_cost numeric, first_policy_date date, tenure_label text, weeks_with_agency integer)
 language sql stable security definer set search_path to 'public'
as $function$
  with first_deal as (
    select agent_name, min(posted_date) as fp
    from public.agentlink_book where is_dead is not true group by agent_name
  ),
  scoped as (
    select
      case when coalesce(ag.agent_code,'') like 'GHOST%' then 'Unclaimed production' else b.agent_name end as agent_name,
      b.annual_premium,
      case when coalesce(ag.agent_code,'') like 'GHOST%' then null::uuid
           else coalesce(m.canonical_agent_id, b.agent_id) end as canon,
      (coalesce(ag.agent_code,'') like 'GHOST%') as is_ghost
    from public.agentlink_book b
    left join public.v_agent_canonical_map m on m.agent_id = b.agent_id
    left join public.agents ag on ag.id = b.agent_id
    where b.is_dead is not true
      and b.posted_date >= p_start
      and b.posted_date < p_end
  ),
  grouped as (
    select
      case when is_ghost then 'ghost:unclaimed'
           else coalesce(canon::text, 'name:' || lower(trim(agent_name))) end as agent_key,
      case when is_ghost then null::uuid else canon end as agent_id,
      min(agent_name) as raw_name,
      count(*) as deals,
      sum(annual_premium) as ap,
      bool_or(is_ghost) as is_ghost
    from scoped
    group by 1, 2
  ),
  agent_view as (
    select distinct on (a.id) a.id, pr.full_name, a.display_name, pr.avatar_url
    from public.agents a left join public.profiles pr on pr.id = a.user_id
  )
  select
    g.agent_key,
    g.agent_id,
    case when g.is_ghost then 'Unclaimed production'
         else coalesce(agent_view.full_name, agent_view.display_name, g.raw_name) end,
    agent_view.avatar_url,
    g.deals,
    g.ap,
    round(g.ap * coalesce(comp.avg_comp_pct, 63) / 100.0) as est_earnings,
    coalesce((select value::numeric from public.system_settings where key = 'board_lead_cost'), 750) as lead_cost,
    first_deal.fp,
    case
      when g.is_ghost then 'Needs merge'
      when first_deal.fp is null then 'New'
      when (current_date - first_deal.fp) < 7 then (current_date - first_deal.fp)::int || ' days in'
      when (current_date - first_deal.fp) < 56 then ((current_date - first_deal.fp) / 7)::int || ' weeks in'
      when (current_date - first_deal.fp) < 365 then ((current_date - first_deal.fp) / 30)::int || ' months in'
      else round(((current_date - first_deal.fp) / 365.0)::numeric, 1)::text || ' yrs in'
    end as tenure_label,
    greatest(((current_date - first_deal.fp) / 7)::int, 0) as weeks_with_agency
  from grouped g
  left join first_deal on first_deal.agent_name = g.raw_name
  left join public.agent_comp_levels comp on comp.agent_name = g.raw_name
  left join agent_view on agent_view.id = g.agent_id
  order by g.is_ghost asc, g.ap desc, g.deals desc;
$function$;
