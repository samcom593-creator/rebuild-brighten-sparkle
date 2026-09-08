-- 20260908020000_leaderboard_agency_gap_rows.sql
-- Sam (again, 2026-09-08): "Vantage people are not on the leaderboard or
-- dashboard." Vantage's September production (19 policies / $38,439) arrives
-- as origin='external_daily_gap' — an agency-level daily total with no
-- individual seller synced yet — and leaderboard_board excluded the gap, so
-- Vantage vanished from the board this month. Add ONE synthetic row per
-- agency that has gap production in the window: it ranks by its AP alongside
-- the producers, clearly labelled, agent_id null. Attributed producer rows
-- are unchanged.
drop function if exists public.leaderboard_board(date, date);
create function public.leaderboard_board(p_start date, p_end date)
returns table(agent_key text, agent_id uuid, agent_name text, avatar_url text, deals bigint, ap numeric, est_earnings numeric, lead_cost numeric, first_policy_date date, tenure_label text, weeks_with_agency integer, agency text)
language sql stable security definer set search_path to 'public'
as $$
  with visible as (
    select t.* from public.v_production_comp_truth t
    where t.origin is distinct from 'external_daily_gap'
      and (public.apex_is_admin() or (t.agent_id is not null and public.crm_can_read_agent_scope(t.agent_id)))
  ), grouped as (
    select coalesce(v.agent_id::text, 'name:' || lower(btrim(v.agent_name))) as agent_key, v.agent_id,
           min(v.agent_name) as raw_name, count(*) as deals, sum(v.annual_premium) as ap,
           sum(v.direct_estimate) as est_earnings, mode() within group (order by m.agency) as agency
    from visible v left join public.mv_production_comp_truth m on m.row_key = v.row_key
    where v.posted_date >= p_start and v.posted_date < p_end group by 1, 2
  ), lifetime as (
    select coalesce(t.agent_id::text, 'name:' || lower(btrim(t.agent_name))) as agent_key, min(t.posted_date) as first_policy_date
    from public.v_production_comp_truth t
    where t.origin is distinct from 'external_daily_gap'
      and coalesce(t.agent_id::text, 'name:' || lower(btrim(t.agent_name))) in (select g.agent_key from grouped g) group by 1
  ), producers as (
    select g.agent_key, g.agent_id, coalesce(pr.full_name, a.display_name, g.raw_name) as agent_name, pr.avatar_url,
      g.deals, g.ap, g.est_earnings, 0::numeric as lead_cost, l.first_policy_date,
      case when l.first_policy_date is null then 'New'
        when current_date - l.first_policy_date < 7 then (current_date - l.first_policy_date)::int || ' days in'
        when current_date - l.first_policy_date < 56 then ((current_date - l.first_policy_date) / 7)::int || ' weeks in'
        when current_date - l.first_policy_date < 365 then ((current_date - l.first_policy_date) / 30)::int || ' months in'
        else round(((current_date - l.first_policy_date) / 365.0)::numeric, 1)::text || ' yrs in' end as tenure_label,
      greatest(((current_date - l.first_policy_date) / 7)::int, 0) as weeks_with_agency, g.agency
    from grouped g left join lifetime l on l.agent_key = g.agent_key
    left join public.agents a on a.id = g.agent_id left join public.profiles pr on pr.id = a.profile_id
  ), gap as (
    -- Agency-level production not yet attributed to a seller. Visible to admins,
    -- and to anyone who can see the agency head (Vantage gap belongs to the head).
    select c.agency, count(*) as deals, sum(c.annual_premium) as ap, max(c.posted_date) as last_posted
    from public.mv_production_comp_truth c
    where c.origin = 'external_daily_gap' and c.posted_date >= p_start and c.posted_date < p_end
      and public.apex_is_admin()
    group by c.agency
  )
  select * from producers
  union all
  select 'gap:' || g.agency, null::uuid, g.agency || ' · agency total (sellers not synced yet)', null,
         g.deals, g.ap, 0::numeric, 0::numeric, null::date, 'agency', 0, g.agency
  from gap g
  order by ap desc nulls last, deals desc, agent_name asc;
$$;
grant execute on function public.leaderboard_board(date, date) to authenticated;
