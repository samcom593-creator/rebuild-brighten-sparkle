-- Headline and rows use the same deduped AgentLink + native production view.
create or replace function public.leaderboard_book_hero()
returns table(total_ap numeric, producers bigint, deal_count bigint, prior_ap numeric, day_of_month integer, days_in_month integer)
language sql stable security definer set search_path to 'public' as $$
  with nowp as (select (now() at time zone 'America/Phoenix')::date d),
  bounds as (
    select date_trunc('month', d)::date cur_start,
      (date_trunc('month', d) + interval '1 month')::date cur_end,
      (date_trunc('month', d) - interval '1 month')::date prior_start,
      date_trunc('month', d)::date prior_end,
      extract(day from d)::int dom,
      extract(day from (date_trunc('month', d) + interval '1 month - 1 day'))::int dim
    from nowp
  ), cur as (
    select coalesce(sum(u.annual_premium), 0) ap, count(*) dc,
      count(distinct coalesce(m.canonical_agent_id::text, u.agent_id::text, 'name:' || lower(trim(u.agent_name)))) prod
    from public.v_production_unified u
    left join public.v_agent_canonical_map m on m.agent_id = u.agent_id
    cross join bounds
    where u.posted_date >= bounds.cur_start and u.posted_date < bounds.cur_end
  ), prior as (
    select coalesce(sum(u.annual_premium), 0) ap
    from public.v_production_unified u cross join bounds
    where u.posted_date >= bounds.prior_start and u.posted_date < bounds.prior_end
  )
  select cur.ap, cur.prod, cur.dc, prior.ap, bounds.dom, bounds.dim from cur, prior, bounds;
$$;

create or replace function public.leaderboard_board(p_start date, p_end date)
returns table(agent_key text, agent_id uuid, agent_name text, avatar_url text, deals bigint, ap numeric, est_earnings numeric, lead_cost numeric, first_policy_date date, tenure_label text, weeks_with_agency integer)
language sql stable security definer set search_path to 'public' as $$
  with scoped as (
    select u.agent_name, u.annual_premium, u.posted_date,
      coalesce(m.canonical_agent_id, u.agent_id) as canon
    from public.v_production_unified u
    left join public.v_agent_canonical_map m on m.agent_id = u.agent_id
    where u.posted_date >= p_start and u.posted_date < p_end
  ), grouped as (
    select coalesce(canon::text, 'name:' || lower(trim(agent_name))) as agent_key,
      canon as agent_id, min(agent_name) as raw_name, count(*) as deals,
      sum(annual_premium) as ap, min(posted_date) as first_policy_date
    from scoped group by 1, 2
  )
  select g.agent_key, g.agent_id,
    coalesce(pr.full_name, a.display_name, g.raw_name) as agent_name,
    pr.avatar_url, g.deals, g.ap,
    round(g.ap * coalesce(comp.avg_comp_pct, 63) / 100.0) as est_earnings,
    coalesce((select value::numeric from public.system_settings where key = 'board_lead_cost'), 750) as lead_cost,
    g.first_policy_date,
    case
      when g.first_policy_date is null then 'New'
      when current_date - g.first_policy_date < 7 then (current_date - g.first_policy_date)::int || ' days in'
      when current_date - g.first_policy_date < 56 then ((current_date - g.first_policy_date) / 7)::int || ' weeks in'
      when current_date - g.first_policy_date < 365 then ((current_date - g.first_policy_date) / 30)::int || ' months in'
      else round(((current_date - g.first_policy_date) / 365.0)::numeric, 1)::text || ' yrs in'
    end,
    greatest(((current_date - g.first_policy_date) / 7)::int, 0)
  from grouped g
  left join public.agents a on a.id = g.agent_id
  left join public.profiles pr on pr.id = a.profile_id
  left join public.agent_comp_levels comp on comp.agent_name = g.raw_name
  order by g.ap desc, g.deals desc, agent_name asc;
$$;

revoke all on function public.leaderboard_book_hero() from public, anon;
revoke all on function public.leaderboard_board(date, date) from public, anon;
grant execute on function public.leaderboard_book_hero() to authenticated;
grant execute on function public.leaderboard_board(date, date) to authenticated;
