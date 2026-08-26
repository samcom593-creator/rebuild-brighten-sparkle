-- Vantage's 2026-08-25 Discord total was reported before the individual
-- policies reached AgentLink. Preserve that source truth without manufacturing
-- policy identities: a daily snapshot contributes only the positive gap versus
-- canonical AgentLink/APEX rows and automatically shrinks to zero as they sync.

begin;

create table if not exists public.production_external_daily_snapshots (
  id uuid primary key default gen_random_uuid(),
  agency_name text not null,
  business_date date not null,
  reported_policies integer not null check (reported_policies >= 0),
  reported_alp numeric(14,2) not null check (reported_alp >= 0),
  source text not null,
  external_ref text not null,
  reported_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (agency_name, business_date, source)
);

alter table public.production_external_daily_snapshots enable row level security;
drop policy if exists production_external_daily_snapshots_admin_read
  on public.production_external_daily_snapshots;
create policy production_external_daily_snapshots_admin_read
  on public.production_external_daily_snapshots
  for select to authenticated
  using (public.apex_is_admin());

revoke all on public.production_external_daily_snapshots from public, anon, authenticated;
grant select on public.production_external_daily_snapshots to authenticated;
grant select, insert, update on public.production_external_daily_snapshots to service_role;

insert into public.production_external_daily_snapshots (
  agency_name, business_date, reported_policies, reported_alp,
  source, external_ref, metadata
) values (
  'Vantage Financial', date '2026-08-25', 8, 14078.00,
  'discord_vantage_owner_report', 'owner-directive-2026-08-25-14078-8',
  jsonb_build_object(
    'provenance', 'owner-reported Discord Daily Sales total',
    'attribution', 'agency aggregate pending individual policy sync'
  )
)
on conflict (agency_name, business_date, source) do update set
  reported_policies = excluded.reported_policies,
  reported_alp = excluded.reported_alp,
  external_ref = excluded.external_ref,
  metadata = excluded.metadata,
  reported_at = now(),
  updated_at = now();

do $$
begin
  alter publication supabase_realtime add table public.production_external_daily_snapshots;
exception when duplicate_object then null;
end $$;

-- Freeze the actual row-level production union as the canonical base. External
-- daily snapshots never overwrite it and never invent client or policy data.
create or replace view public.v_production_canonical
with (security_invoker = on) as
select
  b.deal_key::text as row_key, 'agentlink'::text as origin,
  b.agent_id, b.agent_name, b.client_name, b.carrier, b.product,
  b.policy_number, b.annual_premium, b.posted_date, b.effective_date, b.status,
  b.imported_at as synced_at
from public.v_agentlink_book_scoped b
where b.is_dead is not true
union all
select
  d.id::text, 'apex_native'::text, d.agent_id,
  coalesce(ag.display_name, 'Agent'),
  btrim(coalesce(d.client_first_name, '') || ' ' || coalesce(d.client_last_name, '')),
  c.name, d.product_sold, d.policy_number, d.annual_premium,
  coalesce(d.posted_at::date, d.created_at::date), d.effective_date, d.status,
  d.created_at
from public.deals d
left join public.agents ag on ag.id = d.agent_id
left join public.carriers c on c.id = d.carrier_id
where d.agent_id is not null
  and d.annual_premium is not null
  and d.source = 'apex_native'
  and lower(coalesce(d.status, '')) not in (
    'lapsed', 'cancelled', 'charged_back', 'withdrawn', 'not_taken', 'declined'
  )
  and not public.fn_agent_is_roster_excluded(d.agent_id)
  and not exists (
    select 1 from public.v_agentlink_book_scoped b
    where nullif(btrim(coalesce(b.policy_number, '')), '') is not null
      and lower(btrim(b.policy_number)) = lower(btrim(coalesce(d.policy_number, '')))
  )
  and not exists (
    select 1 from public.v_agentlink_book_scoped b2
    where b2.agent_id = d.agent_id
      and b2.annual_premium = d.annual_premium
      and b2.effective_date = d.effective_date
      and lower(btrim(coalesce(b2.client_name, ''))) =
          lower(btrim(coalesce(d.client_first_name, '') || ' ' || coalesce(d.client_last_name, '')))
  );

grant select on public.v_production_canonical to authenticated, service_role;

-- Reserved, non-login attribution row for an agency aggregate. This is not KJ's
-- account and grants no access, routing, manager rights, alerts, or credentials.
create or replace function public.fn_agent_subagency(p_agent_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select coalesce(public.fn_canonical_agent_id(p_agent_id), p_agent_id) as canonical_id
  )
  select case
    when p_agent_id is null then null
    when p_agent_id = '00000000-0000-0000-0000-00000000a008'::uuid then 'vantage'
    when target.canonical_id = '431dff0d-7c82-4134-a85e-457e5226fc7f'::uuid then 'vantage'
    when exists (
      select 1
      from public.agents a
      left join public.v_agent_canonical_map manager_map on manager_map.agent_id = a.manager_id
      where a.id in (p_agent_id, target.canonical_id)
        and coalesce(manager_map.canonical_agent_id, a.manager_id) =
          '431dff0d-7c82-4134-a85e-457e5226fc7f'::uuid
    ) then 'vantage'
    else null
  end
  from target;
$$;

revoke all on function public.fn_agent_subagency(uuid) from public, anon;
grant execute on function public.fn_agent_subagency(uuid) to authenticated, service_role;

create or replace view public.v_external_production_gap
with (security_invoker = on) as
with reported as (
  select agency_name, business_date,
    max(reported_policies)::integer as reported_policies,
    max(reported_alp)::numeric as reported_alp,
    max(updated_at) as synced_at
  from public.production_external_daily_snapshots
  group by agency_name, business_date
), canonical as (
  select
    case when public.fn_agent_subagency(c.agent_id) = 'vantage'
      then 'Vantage Financial' else 'APEX Financial' end as agency_name,
    c.posted_date as business_date,
    count(*)::integer as canonical_policies,
    coalesce(sum(c.annual_premium), 0)::numeric as canonical_alp
  from public.v_production_canonical c
  group by 1, 2
)
select
  r.agency_name,
  r.business_date,
  r.reported_policies,
  r.reported_alp,
  coalesce(c.canonical_policies, 0)::integer as canonical_policies,
  coalesce(c.canonical_alp, 0)::numeric as canonical_alp,
  greatest(r.reported_policies - coalesce(c.canonical_policies, 0), 0)::integer as gap_policies,
  greatest(r.reported_alp - coalesce(c.canonical_alp, 0), 0)::numeric as gap_alp,
  r.synced_at
from reported r
left join canonical c using (agency_name, business_date)
where r.reported_policies > coalesce(c.canonical_policies, 0)
  and r.reported_alp > coalesce(c.canonical_alp, 0);

grant select on public.v_external_production_gap to authenticated, service_role;

-- Expand only the unresolved count into deterministic anonymous rows so every
-- existing count/sum consumer reaches the reported agency total. The aggregate
-- disappears automatically as canonical rows catch up.
create or replace view public.v_production_unified
with (security_invoker = on) as
select * from public.v_production_canonical
union all
select
  'external-gap:' || lower(replace(g.agency_name, ' ', '-')) || ':' ||
    g.business_date::text || ':' || series.n::text as row_key,
  'external_daily_gap'::text as origin,
  case when g.agency_name = 'Vantage Financial'
    then '00000000-0000-0000-0000-00000000a008'::uuid else null::uuid end as agent_id,
  g.agency_name || ' (unattributed)' as agent_name,
  null::text as client_name,
  null::text as carrier,
  null::text as product,
  null::text as policy_number,
  (g.gap_alp / nullif(g.gap_policies, 0))::numeric as annual_premium,
  g.business_date as posted_date,
  null::date as effective_date,
  'reported_external'::text as status,
  g.synced_at
from public.v_external_production_gap g
cross join lateral generate_series(1, g.gap_policies) as series(n)
where g.gap_policies > 0 and g.gap_alp > 0;

grant select on public.v_production_unified to authenticated, service_role;

-- Never estimate commission from an unattributed agency summary. Production is
-- visible immediately; earnings remain zero until individual policies sync.
create or replace view public.v_production_comp_truth
with (security_invoker = on) as
with canonical_agents as (
  select
    coalesce(m.canonical_agent_id, a.id) as canon,
    max(coalesce(p.full_name, a.display_name)) as display_name,
    max(a.contract_percentage) filter (
      where a.contract_percentage between 0 and 200
        and a.contract_percentage <> 120
    ) as explicit_comp,
    max(a.contract_percentage) filter (
      where a.contract_percentage = 120
        and exists (
          select 1 from public.user_roles ur
          where ur.user_id = a.user_id
            and ur.role::text in ('admin', 'super_admin', 'owner')
        )
    ) as owner_comp
  from public.agents a
  left join public.v_agent_canonical_map m on m.agent_id = a.id
  left join public.profiles p on p.id = a.user_id
  group by 1
), comp_by_name as (
  select lower(btrim(agent_name)) as name_key, max(avg_comp_pct) as avg_comp_pct
  from public.agent_comp_levels
  where avg_comp_pct between 0 and 200
  group by 1
)
select
  u.row_key,
  u.origin,
  u.agent_id as raw_agent_id,
  coalesce(m.canonical_agent_id, u.agent_id) as agent_id,
  coalesce(ca.display_name, u.agent_name) as agent_name,
  u.client_name,
  u.carrier,
  u.product,
  u.policy_number,
  u.annual_premium,
  u.posted_date,
  u.effective_date,
  u.status,
  u.synced_at,
  case when u.origin = 'external_daily_gap' then 0::numeric
    else coalesce(ca.explicit_comp, cbn.avg_comp_pct, ca.owner_comp, 60)::numeric end
    as seller_comp_pct,
  case when u.origin = 'external_daily_gap' then 0::numeric
    else u.annual_premium * coalesce(ca.explicit_comp, cbn.avg_comp_pct, ca.owner_comp, 60) / 100.0 end
    as direct_estimate
from public.v_production_unified u
left join public.v_agent_canonical_map m on m.agent_id = u.agent_id
left join canonical_agents ca on ca.canon = coalesce(m.canonical_agent_id, u.agent_id)
left join comp_by_name cbn on cbn.name_key = lower(btrim(u.agent_name));

grant select on public.v_production_comp_truth to authenticated, service_role;

-- CRM headline now reads the same deduplicated, gap-aware ledger as the home,
-- IMO split, and leaderboards. Non-admin users remain hierarchy scoped.
create or replace function public.crm_today_production()
returns table (
  today_alp numeric,
  today_policies integer,
  selling_streak_days integer,
  business_date date
)
language sql
security definer
set search_path = public
set timezone = 'America/Phoenix'
stable
as $$
  with eligible_deals as (
    select
      u.posted_date as sold_on,
      coalesce(u.annual_premium, 0)::numeric as annual_premium
    from public.v_production_unified u
    where (
      u.origin = 'external_daily_gap' and public.apex_is_admin()
    ) or (
      u.origin <> 'external_daily_gap'
      and not public.fn_agent_is_roster_excluded(u.agent_id)
      and (
        public.apex_can_read_agent(u.agent_id)
        or public.crm_can_read_agent_scope(u.agent_id)
      )
    )
  ), today as (
    select coalesce(sum(annual_premium), 0)::numeric as alp, count(*)::integer as policies
    from eligible_deals
    where sold_on = current_date
  ), selling_days as (
    select distinct sold_on
    from eligible_deals
    where sold_on <= current_date
  ), streak as (
    select count(*)::integer as days
    from (
      select sold_on, sold_on + row_number() over (order by sold_on desc)::integer as island
      from selling_days
    ) ranked
    where island = current_date + 1
      and exists (select 1 from selling_days where sold_on = current_date)
  )
  select today.alp, today.policies, coalesce(streak.days, 0), current_date
  from today cross join streak;
$$;

revoke all on function public.crm_today_production() from public, anon;
grant execute on function public.crm_today_production() to authenticated, service_role;

comment on view public.v_external_production_gap is
  'Positive, deduplicating gap between an owner-reported daily agency snapshot and canonical AgentLink/APEX policy rows.';
comment on function public.crm_today_production() is
  'Hierarchy-scoped Phoenix-day production from the unified ledger; admin totals include unreconciled external agency snapshots without estimating commission.';

commit;
