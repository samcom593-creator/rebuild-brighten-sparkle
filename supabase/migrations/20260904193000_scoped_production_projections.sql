-- MP-425: hierarchy-scoped month-end production projections.
--
-- A projection is only useful if it uses the same canonical ledger and the
-- same visibility boundary as the live scoreboard. Admins see the full IMO and
-- the APEX/Vantage split; every other producer sees only self + recursive
-- downline. Aggregate Discord gaps remain agency-level and never become a
-- fabricated producer row.

begin;

create or replace function public.scoped_production_projection()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_month_start date := date_trunc('month', v_today)::date;
  v_month_end date := (date_trunc('month', v_today) + interval '1 month')::date;
  v_elapsed_days integer := extract(day from v_today)::integer;
  v_days_in_month integer := extract(day from (v_month_end - interval '1 day'))::integer;
  v_is_admin boolean := public.apex_is_admin();
  v_has_profile boolean;
  v_personal_ids uuid[] := '{}'::uuid[];
  v_hier_ids uuid[] := '{}'::uuid[];
  v_scope_ids uuid[] := '{}'::uuid[];
  v_vantage_head constant uuid := '431dff0d-7c82-4134-a85e-457e5226fc7f';
  v_gap_visible boolean := false;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select exists(select 1 from public.agents a where a.user_id = auth.uid())
    into v_has_profile;

  select coalesce(array_agg(distinct coalesce(m.canonical_agent_id, a.id)), '{}'::uuid[])
    into v_personal_ids
  from public.agents a
  left join public.v_agent_canonical_map m on m.agent_id = a.id
  where a.user_id = auth.uid();

  select coalesce(array_agg(distinct h.member)
    filter (where not public.fn_agent_is_roster_excluded(h.member)), '{}'::uuid[])
    into v_hier_ids
  from public.fn_hierarchy_first_hops(v_personal_ids) h;

  if v_is_admin then
    select coalesce(array_agg(distinct coalesce(m.canonical_agent_id, a.id)), '{}'::uuid[])
      into v_scope_ids
    from public.agents a
    left join public.v_agent_canonical_map m on m.agent_id = a.id
    where not public.fn_agent_is_roster_excluded(a.id);
  else
    select coalesce(array_agg(distinct t.id), '{}'::uuid[])
      into v_scope_ids
    from unnest(v_personal_ids || v_hier_ids) as t(id);
  end if;

  -- A legacy aggregate Vantage snapshot is visible to the owner/admin only.
  -- It contributes to agency/IMO pace, but never to a named producer's pace.
  v_gap_visible := v_is_admin or (v_vantage_head = any(v_scope_ids));

  with production as (
    select
      c.origin,
      c.agent_id,
      c.raw_agent_id,
      c.annual_premium,
      c.posted_date,
      (c.agent_id = any(v_personal_ids) and c.origin <> 'external_daily_gap') as is_self,
      case
        when c.origin = 'external_daily_gap'
          or public.fn_agent_subagency(c.raw_agent_id) = 'vantage'
          then 'Vantage Financial'
        else 'APEX Financial'
      end as agency
    from public.v_production_comp_truth c
    where c.posted_date >= v_month_start
      and c.posted_date < v_month_end
      and (
        (c.origin <> 'external_daily_gap' and c.agent_id = any(v_scope_ids))
        or (c.origin = 'external_daily_gap' and v_gap_visible)
      )
  ), buckets as (
    select 'personal'::text as bucket, 'Personal'::text as label,
      annual_premium, posted_date
    from production where is_self
    union all
    select 'team', 'Team', annual_premium, posted_date from production
    union all
    select 'imo', 'Full IMO', annual_premium, posted_date from production
      where v_is_admin
  ), bucket_metrics as (
    select bucket, label,
      count(*)::integer as policies,
      round(coalesce(sum(annual_premium), 0), 2) as mtd_ap,
      count(distinct posted_date)::integer as active_days
    from buckets
    group by bucket, label
  ), bucket_complete as (
    select seed.bucket, seed.label,
      coalesce(m.policies, 0) as policies,
      coalesce(m.mtd_ap, 0) as mtd_ap,
      coalesce(m.active_days, 0) as active_days
    from (values ('personal', 'Personal'), ('team', 'Team'), ('imo', 'Full IMO')) seed(bucket, label)
    left join bucket_metrics m on m.bucket = seed.bucket
    where seed.bucket <> 'imo' or v_is_admin
  ), bucket_json as (
    select jsonb_object_agg(bucket, jsonb_build_object(
      'label', label,
      'mtd_ap', mtd_ap,
      'policies', policies,
      'active_days', active_days,
      'projected_ap', case
        when active_days < 3 or mtd_ap <= 0 then mtd_ap
        else round(least(greatest(mtd_ap, mtd_ap / greatest(v_elapsed_days, 1) * v_days_in_month), mtd_ap * 5), 2)
      end,
      'confidence', case when active_days >= 10 then 'high' when active_days >= 5 then 'medium' else 'low' end
    )) as value
    from bucket_complete
  ), agency_metrics as (
    select agency,
      count(*)::integer as policies,
      round(coalesce(sum(annual_premium), 0), 2) as mtd_ap,
      count(distinct posted_date)::integer as active_days
    from production
    group by agency
  ), agencies as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'agency', agency,
      'mtd_ap', mtd_ap,
      'policies', policies,
      'active_days', active_days,
      'projected_ap', case
        when active_days < 3 or mtd_ap <= 0 then mtd_ap
        else round(least(greatest(mtd_ap, mtd_ap / greatest(v_elapsed_days, 1) * v_days_in_month), mtd_ap * 5), 2)
      end,
      'confidence', case when active_days >= 10 then 'high' when active_days >= 5 then 'medium' else 'low' end
    ) order by mtd_ap desc), '[]'::jsonb) as value
    from agency_metrics
  )
  select jsonb_build_object(
    'as_of', v_today,
    'month_start', v_month_start,
    'month_end_exclusive', v_month_end,
    'elapsed_calendar_days', v_elapsed_days,
    'days_in_month', v_days_in_month,
    'has_producer_profile', v_has_profile,
    'scope_label', case
      when v_is_admin then 'Full agency'
      when cardinality(v_hier_ids) = 0 then 'Personal book'
      else 'You + ' || cardinality(v_hier_ids) || ' downline'
    end,
    'personal', coalesce((select value -> 'personal' from bucket_json), '{}'::jsonb),
    'team', coalesce((select value -> 'team' from bucket_json), '{}'::jsonb),
    'imo', case when v_is_admin then (select value -> 'imo' from bucket_json) else null end,
    'agencies', (select value from agencies),
    'basis', 'Projected month-end ALP = current MTD pace across elapsed Phoenix calendar days, capped at 5x MTD. Fewer than 3 selling days stays at MTD and is labelled low confidence.'
  ) into v_result;

  return v_result;
end;
$fn$;

revoke all on function public.scoped_production_projection() from public, anon;
grant execute on function public.scoped_production_projection() to authenticated, service_role;

comment on function public.scoped_production_projection() is
  'Hierarchy-scoped current-month personal, recursive-team, admin IMO, and agency projections from v_production_comp_truth. Uses Phoenix dates, conservative minimum history, and a 5x MTD cap.';

commit;
