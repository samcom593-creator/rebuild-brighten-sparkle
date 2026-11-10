create table if not exists public.agent_recruiting_systems (
  agent_id uuid primary key references public.agents(id) on delete cascade,
  enrolled boolean not null default false,
  plan text not null default 'standard_500' check (plan in ('standard_500','legacy_400','custom')),
  monthly_price numeric(10,2) not null default 500,
  weekly_payment numeric(10,2) generated always as (round(monthly_price / 4.0, 2)) stored,
  instagram_username text,
  instagram_password text,
  notes text,
  updated_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.agent_recruiting_systems enable row level security;
drop policy if exists ars_admin_all on public.agent_recruiting_systems;
create policy ars_admin_all on public.agent_recruiting_systems for all to authenticated
  using (has_role((select auth.uid()), 'admin'::app_role)) with check (has_role((select auth.uid()), 'admin'::app_role));
drop policy if exists ars_manager_all on public.agent_recruiting_systems;
create policy ars_manager_all on public.agent_recruiting_systems for all to authenticated
  using (has_role((select auth.uid()), 'manager'::app_role)) with check (has_role((select auth.uid()), 'manager'::app_role));
revoke all on public.agent_recruiting_systems from anon;
grant select, insert, update, delete on public.agent_recruiting_systems to authenticated;

alter table public.getting_started_progress
  add column if not exists completed_ahl_onboarding timestamptz,
  add column if not exists contracted_ahl_sent timestamptz,
  add column if not exists contracted_ethos_sent timestamptz,
  add column if not exists contracted_chubb_sent timestamptz;

create table if not exists public.carrier_hierarchy_exemptions (
  carrier text not null,
  root_agent_id uuid not null references public.agents(id) on delete cascade,
  note text,
  primary key (carrier, root_agent_id)
);
alter table public.carrier_hierarchy_exemptions enable row level security;
drop policy if exists che_read_authed on public.carrier_hierarchy_exemptions;
create policy che_read_authed on public.carrier_hierarchy_exemptions for select to authenticated using (true);
drop policy if exists che_admin_write on public.carrier_hierarchy_exemptions;
create policy che_admin_write on public.carrier_hierarchy_exemptions for all to authenticated
  using (has_role((select auth.uid()), 'admin'::app_role)) with check (has_role((select auth.uid()), 'admin'::app_role));
revoke all on public.carrier_hierarchy_exemptions from anon;
grant select on public.carrier_hierarchy_exemptions to authenticated;

insert into public.carrier_hierarchy_exemptions (carrier, root_agent_id, note) values
 ('american_home_life', '136ee983-afa8-45a6-8ba4-8a88104b8b09', 'OB (Obiajulu Ifediora) hierarchy has no AHL (Sam, 2026-11-10)'),
 ('american_home_life', 'a60e70c5-f2d4-4a3d-bcdb-0002327f8e3f', 'Chudi Ifediora hierarchy has no AHL (Sam, 2026-11-10)')
on conflict do nothing;

create or replace function public.api_my_ahl_exempt()
returns boolean language sql stable security definer set search_path = public as $$
  with recursive up(id, mgr, inv, d) as (
    select a.id, a.manager_id, a.invited_by_manager_id, 0
    from agents a where a.user_id = auth.uid()
    union
    select p.id, p.manager_id, p.invited_by_manager_id, up.d + 1
    from up join agents p on p.id in (up.mgr, up.inv)
    where up.d < 12 and p.id <> up.id
  )
  select exists (
    select 1 from up
    join carrier_hierarchy_exemptions e on e.root_agent_id = up.id
    where e.carrier = 'american_home_life'
  );
$$;
revoke all on function public.api_my_ahl_exempt() from public, anon;
grant execute on function public.api_my_ahl_exempt() to authenticated;
select 'features applied' as done;
