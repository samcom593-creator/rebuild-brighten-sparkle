-- Zero agent-paid lead spend and one honest recruiting-income estimate.
-- Estimates are based on canonical, deduplicated AP plus recorded comp spread
-- and qualified recruiter bounties. They are not carrier-paid commission.

begin;

insert into public.system_settings(key, value, updated_at)
values ('board_lead_cost', '0', now())
on conflict (key) do update
set value = '0', updated_at = now();

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
as $fn$
  with grouped as (
    select
      coalesce(t.agent_id::text, 'name:' || lower(btrim(t.agent_name))) as agent_key,
      t.agent_id,
      min(t.agent_name) as raw_name,
      count(*) as deals,
      sum(t.annual_premium) as ap,
      sum(t.direct_estimate) as est_earnings,
      min(t.posted_date) as first_policy_date
    from public.v_production_comp_truth t
    where t.posted_date >= p_start
      and t.posted_date < p_end
      and t.origin is distinct from 'external_daily_gap'
      and (
        public.apex_is_admin()
        or (t.agent_id is not null and public.crm_can_read_agent_scope(t.agent_id))
      )
    group by 1, 2
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
  order by g.ap desc, g.deals desc, agent_name asc;
$fn$;

create or replace function public.recruiting_income_estimate(
  p_recruiter_id uuid,
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
  v_recruiter_comp numeric := 60;
  v_recruited_ap numeric := 0;
  v_recruited_policies bigint := 0;
  v_recruited_producers bigint := 0;
  v_override numeric := 0;
  v_bounties numeric := 0;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if p_recruiter_id is null or p_start is null or p_end is null or p_end <= p_start then
    raise exception 'valid recruiter and date window required' using errcode = '22023';
  end if;
  if not (
    public.apex_is_admin()
    or public.crm_can_read_agent_scope(p_recruiter_id)
    or exists (
      select 1 from public.agents a
      where a.id = p_recruiter_id and a.user_id = auth.uid()
    )
  ) then
    raise exception 'not permitted to view this recruiting estimate' using errcode = '42501';
  end if;

  select greatest(
    coalesce(max(a.comp_percentage) filter (where a.comp_percentage between 0 and 200), 0),
    coalesce(max(a.contract_percentage) filter (where a.contract_percentage between 0 and 200), 0),
    60
  )
  into v_recruiter_comp
  from public.agents a
  where a.id = p_recruiter_id;

  with recursive hierarchy(id, path) as (
    select a.id, array[p_recruiter_id, a.id]::uuid[]
    from public.agents a
    where a.manager_id = p_recruiter_id or a.invited_by_manager_id = p_recruiter_id
    union all
    select child.id, parent.path || child.id
    from hierarchy parent
    join public.agents child
      on child.manager_id = parent.id or child.invited_by_manager_id = parent.id
    where not child.id = any(parent.path)
  ), recruited as (
    select distinct h.id from hierarchy h
    union
    select distinct a.id
    from public.agents a
    join public.applications ap on ap.id = a.source_application_id
    where coalesce(
      ap.referral_recruiter_id,
      ap.recruiter_id,
      ap.referral_manager_id,
      ap.assigned_agent_id
    ) = p_recruiter_id
    union
    select rb.recruited_agent_id
    from public.recruiter_bounties rb
    where rb.recruiter_agent_id = p_recruiter_id
  ), production as (
    select
      t.agent_id,
      t.annual_premium,
      t.seller_comp_pct
    from public.v_production_comp_truth t
    join recruited r on r.id = t.agent_id
    where t.posted_date >= p_start
      and t.posted_date < p_end
      and t.origin is distinct from 'external_daily_gap'
  )
  select
    coalesce(sum(annual_premium), 0),
    count(*),
    count(distinct agent_id),
    coalesce(sum(annual_premium * greatest(v_recruiter_comp - seller_comp_pct, 0) / 100.0), 0)
  into v_recruited_ap, v_recruited_policies, v_recruited_producers, v_override
  from production;

  select coalesce(sum(rb.amount_cents), 0) / 100.0
  into v_bounties
  from public.recruiter_bounties rb
  where rb.recruiter_agent_id = p_recruiter_id
    and rb.status <> 'reversed'
    and coalesce(rb.qualified_at, rb.created_at) >= p_start::timestamptz
    and coalesce(rb.qualified_at, rb.created_at) < p_end::timestamptz;

  return jsonb_build_object(
    'recruited_ap', round(v_recruited_ap, 2),
    'recruited_policies', v_recruited_policies,
    'recruited_producers', v_recruited_producers,
    'effective_recruiter_comp_pct', v_recruiter_comp,
    'estimated_override', round(v_override, 2),
    'qualified_bounties', round(v_bounties, 2),
    'estimated_total', round(v_override + v_bounties, 2),
    'start_date', p_start,
    'end_date_exclusive', p_end,
    'basis', 'Canonical deduplicated AP x positive comp spread, plus qualified recruiter bounties. Estimate only; not paid commission.'
  );
end;
$fn$;

revoke all on function public.recruiting_income_estimate(uuid, date, date) from public, anon;
grant execute on function public.recruiting_income_estimate(uuid, date, date) to authenticated, service_role;

comment on function public.recruiting_income_estimate(uuid, date, date) is
  'Hierarchy-authorized recruiting income estimate from canonical AP comp spread plus qualified bounties.';

commit;
