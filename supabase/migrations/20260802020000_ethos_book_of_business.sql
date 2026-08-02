-- Sam's Ethos / Prosperity book of business.
-- This source is intentionally separate from AgentLink so AgentLink syncs can
-- never overwrite it and source-specific actions stay honest in the UI.

create table if not exists public.ethos_book_policies (
  id uuid primary key default gen_random_uuid(),
  owner_agent_id uuid not null references public.agents(id) on delete restrict,
  source_agent_names text[] not null default '{}'::text[],
  client_first_name text not null,
  client_last_name text not null default '',
  client_address text,
  client_phone text,
  client_email text,
  client_dob date,
  face_amount numeric check (face_amount is null or face_amount >= 0),
  raw_status text not null default 'Inforce',
  effective_date date,
  product_sold text,
  policy_number text not null,
  monthly_premium numeric check (monthly_premium is null or monthly_premium >= 0),
  annual_premium numeric check (annual_premium is null or annual_premium >= 0),
  carrier_name text not null default 'Prosperity',
  source_file_name text not null,
  source_file_sha256 text not null,
  source_row_numbers integer[] not null default '{}'::integer[],
  source_payload jsonb not null default '{}'::jsonb,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint ethos_book_policy_owner_unique unique (owner_agent_id, policy_number)
);

create index if not exists ethos_book_policies_effective_date_idx
  on public.ethos_book_policies (effective_date desc);
create index if not exists ethos_book_policies_status_idx
  on public.ethos_book_policies (raw_status);
create index if not exists ethos_book_policies_carrier_idx
  on public.ethos_book_policies (carrier_name);
create index if not exists ethos_book_policies_source_agents_idx
  on public.ethos_book_policies using gin (source_agent_names);

alter table public.ethos_book_policies enable row level security;

drop policy if exists ethos_book_admin_all on public.ethos_book_policies;
create policy ethos_book_admin_all
  on public.ethos_book_policies
  for all
  to authenticated
  using (public.has_role(auth.uid(), 'admin'::public.app_role))
  with check (public.has_role(auth.uid(), 'admin'::public.app_role));

drop policy if exists ethos_book_owner_read on public.ethos_book_policies;
create policy ethos_book_owner_read
  on public.ethos_book_policies
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.agents a
      where a.id = ethos_book_policies.owner_agent_id
        and a.user_id = auth.uid()
    )
  );

revoke all on table public.ethos_book_policies from anon;
grant select on table public.ethos_book_policies to authenticated;
grant all on table public.ethos_book_policies to service_role;

do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'ethos_book_policies'
  ) then
    alter publication supabase_realtime add table public.ethos_book_policies;
  end if;
end;
$$;

comment on table public.ethos_book_policies is
  'Imported Ethos carrier book, stored separately from AgentLink snapshots. One row per owner + policy; split-credit Ethos agents are retained in source_agent_names.';
comment on column public.ethos_book_policies.source_agent_names is
  'Ethos writing-agent names from source column A. Multiple names indicate split credit on one policy.';
comment on column public.ethos_book_policies.source_payload is
  'Auditable source fields from the imported CSV; never exposed to anonymous users.';
