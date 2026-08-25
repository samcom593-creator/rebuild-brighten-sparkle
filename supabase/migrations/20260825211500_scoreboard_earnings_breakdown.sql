-- Repair the dashboard earnings tile. The agents.contract_percentage column
-- historically defaulted every row to 120, so treating it as confirmed data
-- erased every agency-owner comp spread and made overrides read $0.

begin;

-- New agents start at the operating default Samuel requested. Existing values
-- are not rewritten; confirmed custom percentages remain intact.
alter table public.agents alter column contract_percentage set default 60;

create or replace function public.scoped_production_scoreboard(
  p_start date,
  p_end date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_start date := coalesce(p_start, v_today);
  v_end date := coalesce(p_end, v_today + 1);
  v_is_admin boolean := public.apex_is_admin();
  v_has_profile boolean;
  v_personal_ids uuid[];
  v_scope_ids uuid[];
  v_downline_count integer := 0;
  v_caller_comp numeric;
  v_caller_name text;
  v_out jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if v_end <= v_start then raise exception 'end date must be after start date'; end if;

  select exists(select 1 from public.agents a where a.user_id = auth.uid()) into v_has_profile;

  with caller_canon as (
    select distinct coalesce(m.canonical_agent_id, a.id) as id
    from public.agents a
    left join public.v_agent_canonical_map m on m.agent_id = a.id
    where a.user_id = auth.uid()
  )
  select coalesce(array_agg(id), '{}'::uuid[]) into v_personal_ids from caller_canon;

  -- A non-120 saved value is an explicit account edit. Legacy 120 values are
  -- placeholders except for an admin/owner account such as Samuel's.
  select
    coalesce(
      max(a.contract_percentage) filter (
        where a.contract_percentage between 0 and 200
          and a.contract_percentage <> 120
      ),
      max(a.contract_percentage) filter (
        where v_is_admin and a.contract_percentage = 120
      )
    ),
    max(coalesce(p.full_name, a.display_name))
  into v_caller_comp, v_caller_name
  from public.agents a
  left join public.profiles p on p.id = a.user_id
  where a.user_id = auth.uid();

  if v_caller_comp is null then
    select max(c.avg_comp_pct)
    into v_caller_comp
    from public.agent_comp_levels c
    where lower(btrim(c.agent_name)) = lower(btrim(v_caller_name));
  end if;
  v_caller_comp := coalesce(v_caller_comp, 60);

  if v_is_admin then
    select coalesce(array_agg(distinct coalesce(m.canonical_agent_id, a.id)), '{}'::uuid[])
      into v_scope_ids
    from public.agents a
    left join public.v_agent_canonical_map m on m.agent_id = a.id
    where not public.fn_agent_is_roster_excluded(a.id);
  else
    with recursive caller_canon as (
      select distinct coalesce(m.canonical_agent_id, a.id) as id
      from public.agents a
      left join public.v_agent_canonical_map m on m.agent_id = a.id
      where a.user_id = auth.uid()
    ), roots as (
      select a.id
      from public.agents a
      left join public.v_agent_canonical_map m on m.agent_id = a.id
      where coalesce(m.canonical_agent_id, a.id) in (select id from caller_canon)
    ), hierarchy(id) as (
      select id from roots
      union
      select child.id
      from public.agents child
      join hierarchy parent
        on child.manager_id = parent.id
        or child.invited_by_manager_id = parent.id
        or child.switched_to_manager_id = parent.id
    ), canonical_scope as (
      select distinct coalesce(m.canonical_agent_id, h.id) as id
      from hierarchy h
      left join public.v_agent_canonical_map m on m.agent_id = h.id
      where not public.fn_agent_is_roster_excluded(h.id)
    )
    select coalesce(array_agg(id), '{}'::uuid[]) into v_scope_ids from canonical_scope;
  end if;

  v_downline_count := greatest(
    coalesce(cardinality(v_scope_ids), 0) - coalesce(cardinality(v_personal_ids), 0),
    0
  );

  with production as (
    select
      u.annual_premium as ap,
      u.posted_date,
      u.synced_at,
      u.agent_name,
      coalesce(m.canonical_agent_id, u.agent_id) as canon
    from public.v_production_unified u
    left join public.v_agent_canonical_map m on m.agent_id = u.agent_id
    where u.posted_date >= v_start
      and u.posted_date < v_end
      and coalesce(m.canonical_agent_id, u.agent_id) = any(v_scope_ids)
  ), normalized as (
    select p.*,
      coalesce(
        (
          select max(a.contract_percentage)
          from public.agents a
          left join public.v_agent_canonical_map am on am.agent_id = a.id
          where coalesce(am.canonical_agent_id, a.id) = p.canon
            and a.contract_percentage between 0 and 200
            and a.contract_percentage <> 120
        ),
        (
          select max(c.avg_comp_pct)
          from public.agent_comp_levels c
          where lower(btrim(c.agent_name)) = lower(btrim(p.agent_name))
        ),
        case when p.canon = any(v_personal_ids) then v_caller_comp end,
        60
      ) as seller_comp
    from production p
  ), totals as (
    select
      coalesce(sum(ap) filter (where canon = any(v_personal_ids)), 0) as personal_ap,
      count(*) filter (where canon = any(v_personal_ids))::integer as personal_policies,
      coalesce(sum(ap), 0) as team_ap,
      count(*)::integer as team_policies,
      max(synced_at) as last_synced_at
    from normalized
  ), earnings as (
    select
      coalesce(round(sum(ap * v_caller_comp / 100.0)
        filter (where canon = any(v_personal_ids)), 2), 0) as direct,
      coalesce(round(sum(ap * greatest(v_caller_comp - seller_comp, 0) / 100.0)
        filter (where not (canon = any(v_personal_ids))), 2), 0) as override,
      coalesce(round(sum(ap * seller_comp / 100.0), 2), 0) as team_estimated
    from normalized
  )
  select jsonb_build_object(
    'as_of', v_today,
    'window', jsonb_build_object('start', v_start, 'end_exclusive', v_end),
    'has_producer_profile', v_has_profile,
    'scope_label', case
      when v_is_admin then 'Full agency'
      when v_downline_count = 0 then 'Personal book'
      else 'You + ' || v_downline_count || ' downline'
    end,
    'downline_agents', v_downline_count,
    'personal', jsonb_build_object(
      'ap', (select personal_ap from totals),
      'policies', (select personal_policies from totals)
    ),
    'team', jsonb_build_object(
      'ap', (select team_ap from totals),
      'policies', (select team_policies from totals)
    ),
    'earnings', jsonb_build_object(
      'estimated', (select direct + override from earnings),
      'direct', (select direct from earnings),
      'override', (select override from earnings),
      'team_estimated', (select team_estimated from earnings),
      'basis', 'Direct plus comp-spread override; explicit saved comp, then AgentLink average, then 60% operating default'
    ),
    'last_synced_at', (select last_synced_at from totals),
    'source', 'v_production_unified'
  ) into v_out;

  return v_out;
end;
$fn$;

revoke all on function public.scoped_production_scoreboard(date, date) from public, anon;
grant execute on function public.scoped_production_scoreboard(date, date) to authenticated, service_role;

comment on function public.scoped_production_scoreboard(date, date) is
  'Hierarchy-scoped personal/team production with direct, comp-spread override, and team estimated earnings from the unified production ledger.';

commit;
