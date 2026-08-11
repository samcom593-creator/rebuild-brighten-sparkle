-- APEX unified operating-system foundation.
--
-- Additive only: legacy agents/applications/deals remain in place while new
-- workflows link to them. No production data is rewritten by this migration.
-- Rollback is documented in docs/migration-backfill-plan.md and must only be
-- used before any of these tables contain production records.

create or replace function public.apex_has_any_role(p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      and ur.role::text = any(p_roles)
  );
$$;

create or replace function public.apex_is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.apex_has_any_role(array['admin', 'super_admin', 'owner']);
$$;

create or replace function public.apex_can_read_agent(p_agent_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with recursive my_agents as (
    select a.id
    from public.agents a
    where a.user_id = auth.uid()
  ), downline as (
    select a.id
    from public.agents a
    where a.manager_id in (select id from my_agents)
    union
    select child.id
    from public.agents child
    join downline parent on child.manager_id = parent.id
  )
  select
    public.apex_is_admin()
    or p_agent_id in (select id from my_agents)
    or (
      public.apex_has_any_role(array['manager'])
      and p_agent_id in (select id from downline)
    );
$$;

grant execute on function public.apex_has_any_role(text[]) to authenticated;
grant execute on function public.apex_is_admin() to authenticated;
grant execute on function public.apex_can_read_agent(uuid) to authenticated;

create table if not exists public.people (
  id uuid primary key default gen_random_uuid(),
  auth_user_id uuid unique references auth.users(id) on delete set null,
  legal_first_name text,
  legal_last_name text,
  preferred_name text,
  email_normalized text,
  phone_normalized text,
  active_state text not null default 'provisional'
    check (active_state in ('provisional', 'active', 'inactive', 'archived')),
  archive_reason text,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (email_normalized is null or email_normalized = lower(trim(email_normalized))),
  check ((active_state = 'archived') = (archived_at is not null))
);

create unique index if not exists people_email_unique
  on public.people(email_normalized) where email_normalized is not null;
create index if not exists people_phone_idx
  on public.people(phone_normalized) where phone_normalized is not null;

create table if not exists public.external_identities (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id) on delete restrict,
  provider text not null,
  external_id text not null,
  status text not null default 'active'
    check (status in ('pending', 'active', 'inactive', 'conflict', 'archived')),
  source text not null default 'system',
  raw_source_hash text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, external_id)
);

create index if not exists external_identities_person_idx
  on public.external_identities(person_id, provider);

create table if not exists public.team_memberships (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.people(id) on delete restrict,
  agent_id uuid unique references public.agents(id) on delete set null,
  role text not null
    check (role in ('agent', 'manager', 'recruiter', 'contracting_assistant', 'admin', 'owner', 'va', 'va_manager')),
  manager_person_id uuid references public.people(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'active', 'inactive', 'offboarded')),
  effective_from date not null default current_date,
  effective_to date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  check (manager_person_id is null or manager_person_id <> person_id)
);

create index if not exists team_memberships_manager_idx
  on public.team_memberships(manager_person_id, status);
create index if not exists team_memberships_active_idx
  on public.team_memberships(person_id, effective_from, effective_to)
  where status = 'active';

create table if not exists public.manager_hierarchy (
  id uuid primary key default gen_random_uuid(),
  manager_person_id uuid not null references public.people(id) on delete restrict,
  downline_person_id uuid not null references public.people(id) on delete restrict,
  effective_from date not null,
  effective_to date,
  source text not null default 'apex',
  created_at timestamptz not null default now(),
  check (manager_person_id <> downline_person_id),
  check (effective_to is null or effective_to >= effective_from),
  unique(manager_person_id, downline_person_id, effective_from)
);

create index if not exists manager_hierarchy_downline_idx
  on public.manager_hierarchy(downline_person_id, effective_from, effective_to);

create or replace function public.apex_can_read_person(p_person_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    public.apex_is_admin()
    or exists (
      select 1 from public.people p
      where p.id = p_person_id and p.auth_user_id = auth.uid()
    )
    or exists (
      select 1 from public.team_memberships tm
      where tm.person_id = p_person_id
        and tm.agent_id is not null
        and public.apex_can_read_agent(tm.agent_id)
    );
$$;

grant execute on function public.apex_can_read_person(uuid) to authenticated;

create table if not exists public.integration_accounts (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  environment text not null default 'production'
    check (environment in ('sandbox', 'staging', 'production')),
  display_name text not null,
  status text not null default 'not_configured'
    check (status in ('not_configured', 'healthy', 'degraded', 'failed', 'disabled')),
  config_reference text,
  last_checked_at timestamptz,
  last_success_at timestamptz,
  last_error_redacted text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(provider, environment, display_name)
);

create table if not exists public.integration_capabilities (
  id uuid primary key default gen_random_uuid(),
  integration_account_id uuid not null references public.integration_accounts(id) on delete cascade,
  capability text not null,
  support_state text not null default 'not_configured'
    check (support_state in ('supported', 'not_configured', 'unsupported')),
  verified_at timestamptz,
  verification_source text,
  notes text,
  unique(integration_account_id, capability)
);

create table if not exists public.integration_events (
  id uuid primary key default gen_random_uuid(),
  integration_account_id uuid references public.integration_accounts(id) on delete set null,
  provider_event_id text,
  event_type text not null,
  payload_hash text not null,
  raw_status text,
  normalized_status text,
  correlation_id uuid not null default gen_random_uuid(),
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  last_error_redacted text,
  unique(integration_account_id, provider_event_id, payload_hash)
);

create table if not exists public.outbox_events (
  id uuid primary key default gen_random_uuid(),
  aggregate_type text not null,
  aggregate_id uuid not null,
  event_type text not null,
  destination text,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'delivered', 'manual_action_required', 'failed', 'dead_letter')),
  attempts integer not null default 0 check (attempts >= 0),
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  processed_at timestamptz,
  last_error_redacted text,
  idempotency_key text not null unique,
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists outbox_events_work_idx
  on public.outbox_events(status, available_at, created_at)
  where status in ('pending', 'failed');

create table if not exists public.delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  outbox_event_id uuid not null references public.outbox_events(id) on delete cascade,
  attempt_number integer not null check (attempt_number > 0),
  status text not null check (status in ('started', 'delivered', 'retryable_failure', 'permanent_failure')),
  provider_message_id text,
  http_status integer,
  error_redacted text,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  unique(outbox_event_id, attempt_number)
);

create table if not exists public.dead_letter_events (
  id uuid primary key default gen_random_uuid(),
  outbox_event_id uuid not null unique references public.outbox_events(id) on delete restrict,
  reason text not null,
  operator_action text,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.metric_definitions (
  id text primary key,
  display_name text not null,
  business_meaning text not null,
  source_relation text not null,
  amount_field text,
  date_field text not null,
  timezone text not null default 'America/Chicago',
  included_statuses text[] not null default '{}',
  excluded_statuses text[] not null default '{}',
  filters jsonb not null default '{}'::jsonb,
  hierarchy_rule text,
  formula text not null,
  formula_version integer not null default 1,
  owner text not null,
  last_validated_at timestamptz,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.production_ledger (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete restrict,
  agent_id uuid not null references public.agents(id) on delete restrict,
  entry_type text not null check (entry_type in ('approved_alp', 'issued_alp', 'in_force_alp', 'chargeback', 'reversal', 'correction')),
  amount numeric(14,2) not null,
  effective_date date not null,
  status text not null default 'qualifying' check (status in ('qualifying', 'pending', 'reversed', 'voided')),
  source text not null default 'apex_deal',
  formula_version integer not null default 1,
  correlation_id uuid not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  reversed_at timestamptz,
  reversal_reason text,
  unique(deal_id, entry_type)
);

create index if not exists production_ledger_agent_date_idx
  on public.production_ledger(agent_id, effective_date desc)
  where status = 'qualifying';

create table if not exists public.deal_status_history (
  id uuid primary key default gen_random_uuid(),
  deal_id uuid not null references public.deals(id) on delete restrict,
  from_status text,
  to_status text not null,
  reason text,
  actor_id uuid references auth.users(id) on delete set null,
  actor_role text,
  request_id text,
  correlation_id uuid not null,
  deal_version integer not null,
  created_at timestamptz not null default now(),
  unique(deal_id, deal_version)
);

create table if not exists public.deal_drafts (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key uuid not null,
  current_section text not null default 'client',
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'draft' check (status in ('draft', 'submitted', 'abandoned')),
  deal_id uuid references public.deals(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_user_id, idempotency_key)
);

create index if not exists deal_drafts_owner_updated_idx
  on public.deal_drafts(owner_user_id, updated_at desc) where status = 'draft';

create table if not exists public.deal_attachments (
  id uuid primary key default gen_random_uuid(),
  draft_id uuid references public.deal_drafts(id) on delete cascade,
  deal_id uuid references public.deals(id) on delete restrict,
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  object_path text not null unique,
  original_file_name text not null,
  mime_type text not null check (mime_type in ('image/jpeg', 'image/png', 'image/webp', 'application/pdf')),
  size_bytes bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  scan_status text not null default 'pending'
    check (scan_status in ('pending', 'clean', 'quarantined', 'failed')),
  scan_error_redacted text,
  created_at timestamptz not null default now(),
  scanned_at timestamptz,
  check (draft_id is not null or deal_id is not null)
);

create index if not exists deal_attachments_deal_idx
  on public.deal_attachments(deal_id, created_at);
create index if not exists deal_attachments_pending_scan_idx
  on public.deal_attachments(created_at) where scan_status = 'pending';

create table if not exists public.comp_rate_imports (
  id uuid primary key default gen_random_uuid(),
  source_version text not null unique,
  source_hash text not null,
  status text not null default 'received'
    check (status in ('received', 'validating', 'applied', 'partially_applied', 'rejected')),
  submitted_by text not null,
  row_count integer not null default 0,
  valid_count integer not null default 0,
  invalid_count integer not null default 0,
  error_summary jsonb not null default '[]'::jsonb,
  received_at timestamptz not null default now(),
  applied_at timestamptz
);

create table if not exists public.comp_rates (
  id uuid primary key default gen_random_uuid(),
  change_id text not null unique,
  import_id uuid not null references public.comp_rate_imports(id) on delete restrict,
  agent_id uuid not null references public.agents(id) on delete restrict,
  carrier_id uuid references public.carriers(id) on delete restrict,
  product_line text,
  rate numeric(7,6) not null check (rate >= 0 and rate <= 2.00),
  effective_from date not null,
  effective_to date,
  approval_status text not null check (approval_status in ('pending', 'approved', 'rejected')),
  approved_by text,
  change_reason text not null,
  source_version text not null,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from)
);

create index if not exists comp_rates_effective_idx
  on public.comp_rates(agent_id, carrier_id, product_line, effective_from desc);

create table if not exists public.comp_change_audit (
  id uuid primary key default gen_random_uuid(),
  comp_rate_id uuid references public.comp_rates(id) on delete restrict,
  change_id text not null,
  action text not null,
  prior_value jsonb,
  new_value jsonb not null,
  source_version text not null,
  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

create table if not exists public.apex_schema_meta (
  version text primary key,
  description text not null,
  applied_at timestamptz not null default now()
);

insert into public.apex_schema_meta(version, description)
values ('20260811220000', 'APEX unified OS foundation')
on conflict (version) do nothing;

insert into public.metric_definitions(
  id, display_name, business_meaning, source_relation, amount_field, date_field,
  included_statuses, filters, hierarchy_rule, formula, owner, last_validated_at
)
values
  ('submitted_premium_mtd', 'Submitted premium MTD', 'Premium safely submitted during the current Central-time calendar month.', 'deals', 'annualized_paid_premium', 'submitted_at', array['submitted','needs_review','approved','issued','in_force'], '{"window":"mtd"}', 'effective-dated writing-agent hierarchy', 'sum annualized_paid_premium for qualifying distinct deals', 'owner', now()),
  ('approved_alp_mtd', 'Approved / placed ALP MTD', 'Qualifying approved, issued, or in-force ALP in the Central-time month.', 'production_ledger', 'amount', 'effective_date', array['qualifying'], '{"entry_types":["approved_alp","issued_alp","in_force_alp"],"window":"mtd"}', 'effective-dated writing-agent hierarchy', 'sum qualifying production ledger amount', 'owner', now()),
  ('deals_mtd', 'Deals MTD', 'Distinct qualifying deals in the current Central-time calendar month.', 'deals', null, 'submitted_at', array['submitted','needs_review','approved','issued','in_force'], '{"window":"mtd"}', 'effective-dated writing-agent hierarchy', 'count distinct deal id', 'owner', now()),
  ('active_producers', 'Active producers', 'Distinct agents with qualifying production-ledger activity in the selected window.', 'production_ledger', null, 'effective_date', array['qualifying'], '{}', 'effective-dated writing-agent hierarchy', 'count distinct agent_id', 'owner', now()),
  ('average_per_producer', 'Average per producer', 'Qualifying ALP divided by active producers.', 'production_ledger', 'amount', 'effective_date', array['qualifying'], '{}', 'effective-dated writing-agent hierarchy', 'sum qualifying ALP / nullif(count distinct agent_id, 0)', 'owner', now()),
  ('estimated_income', 'Estimated income', 'Qualifying ALP multiplied by the effective spreadsheet-controlled compensation rate.', 'production_ledger + comp_rates', 'amount', 'effective_date', array['qualifying'], '{"label":"estimate"}', 'effective-dated writing-agent hierarchy', 'sum ledger amount * effective comp rate', 'owner', now()),
  ('carrier_share', 'Carrier share', 'Individual-carrier qualifying ALP divided by all-carrier qualifying ALP; aggregate rows are excluded.', 'production_ledger + deals + carriers', 'amount', 'effective_date', array['qualifying'], '{"exclude_carrier_names":["Combined"]}', 'effective-dated writing-agent hierarchy', 'carrier qualifying ALP / nullif(total qualifying ALP, 0)', 'owner', now())
on conflict (id) do update set
  display_name = excluded.display_name,
  business_meaning = excluded.business_meaning,
  source_relation = excluded.source_relation,
  amount_field = excluded.amount_field,
  date_field = excluded.date_field,
  timezone = excluded.timezone,
  included_statuses = excluded.included_statuses,
  filters = excluded.filters,
  hierarchy_rule = excluded.hierarchy_rule,
  formula = excluded.formula,
  owner = excluded.owner,
  last_validated_at = excluded.last_validated_at,
  updated_at = now();

alter table public.people enable row level security;
alter table public.external_identities enable row level security;
alter table public.team_memberships enable row level security;
alter table public.manager_hierarchy enable row level security;
alter table public.integration_accounts enable row level security;
alter table public.integration_capabilities enable row level security;
alter table public.integration_events enable row level security;
alter table public.outbox_events enable row level security;
alter table public.delivery_attempts enable row level security;
alter table public.dead_letter_events enable row level security;
alter table public.metric_definitions enable row level security;
alter table public.production_ledger enable row level security;
alter table public.deal_status_history enable row level security;
alter table public.deal_drafts enable row level security;
alter table public.deal_attachments enable row level security;
alter table public.comp_rate_imports enable row level security;
alter table public.comp_rates enable row level security;
alter table public.comp_change_audit enable row level security;
alter table public.apex_schema_meta enable row level security;

create policy people_scoped_read on public.people for select to authenticated
  using (public.apex_can_read_person(id));
create policy people_admin_write on public.people for all to authenticated
  using (public.apex_is_admin()) with check (public.apex_is_admin());

create policy external_identities_scoped_read on public.external_identities for select to authenticated
  using (public.apex_can_read_person(person_id));
create policy external_identities_admin_write on public.external_identities for all to authenticated
  using (public.apex_is_admin()) with check (public.apex_is_admin());

create policy team_memberships_scoped_read on public.team_memberships for select to authenticated
  using (public.apex_can_read_person(person_id));
create policy team_memberships_admin_write on public.team_memberships for all to authenticated
  using (public.apex_is_admin()) with check (public.apex_is_admin());

create policy manager_hierarchy_scoped_read on public.manager_hierarchy for select to authenticated
  using (public.apex_can_read_person(manager_person_id) or public.apex_can_read_person(downline_person_id));
create policy manager_hierarchy_admin_write on public.manager_hierarchy for all to authenticated
  using (public.apex_is_admin()) with check (public.apex_is_admin());

create policy integration_accounts_admin on public.integration_accounts for all to authenticated
  using (public.apex_is_admin()) with check (public.apex_is_admin());
create policy integration_capabilities_admin on public.integration_capabilities for all to authenticated
  using (public.apex_is_admin()) with check (public.apex_is_admin());
create policy integration_events_admin_read on public.integration_events for select to authenticated
  using (public.apex_is_admin());
create policy outbox_events_admin_read on public.outbox_events for select to authenticated
  using (public.apex_is_admin());
create policy delivery_attempts_admin_read on public.delivery_attempts for select to authenticated
  using (public.apex_is_admin());
create policy dead_letter_events_admin on public.dead_letter_events for all to authenticated
  using (public.apex_is_admin()) with check (public.apex_is_admin());

create policy metric_definitions_read on public.metric_definitions for select to authenticated using (is_active);
create policy metric_definitions_admin_write on public.metric_definitions for all to authenticated
  using (public.apex_is_admin()) with check (public.apex_is_admin());

create policy production_ledger_scoped_read on public.production_ledger for select to authenticated
  using (public.apex_can_read_agent(agent_id));
create policy deal_status_history_scoped_read on public.deal_status_history for select to authenticated
  using (exists (select 1 from public.deals d where d.id = deal_id));

create policy deal_drafts_owner on public.deal_drafts for all to authenticated
  using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
create policy deal_drafts_admin_read on public.deal_drafts for select to authenticated
  using (public.apex_is_admin());
create policy deal_attachments_owner_read on public.deal_attachments for select to authenticated
  using (
    owner_user_id = auth.uid()
    or public.apex_is_admin()
    or (deal_id is not null and exists (
      select 1 from public.deals d
      where d.id = deal_id and public.apex_can_read_agent(d.agent_id)
    ))
  );
create policy deal_attachments_owner_insert on public.deal_attachments for insert to authenticated
  with check (owner_user_id = auth.uid());
create policy deal_attachments_owner_delete_draft on public.deal_attachments for delete to authenticated
  using (owner_user_id = auth.uid() and deal_id is null);

create policy comp_rate_imports_admin_read on public.comp_rate_imports for select to authenticated
  using (public.apex_is_admin());
create policy comp_rates_scoped_read on public.comp_rates for select to authenticated
  using (public.apex_can_read_agent(agent_id));
create policy comp_change_audit_admin_read on public.comp_change_audit for select to authenticated
  using (public.apex_is_admin());

create policy apex_schema_meta_public_read on public.apex_schema_meta for select to anon, authenticated
  using (true);

grant select on public.metric_definitions, public.apex_schema_meta to anon, authenticated;
grant select on public.people, public.external_identities, public.team_memberships,
  public.manager_hierarchy, public.integration_accounts, public.integration_capabilities,
  public.integration_events, public.outbox_events, public.delivery_attempts,
  public.dead_letter_events, public.production_ledger, public.deal_status_history,
  public.comp_rate_imports, public.comp_rates, public.comp_change_audit to authenticated;
grant select, insert, update on public.deal_drafts to authenticated;
grant select, insert, delete on public.deal_attachments to authenticated;

comment on table public.comp_rates is
  'Read-only website compensation source. Rows may only be written by the protected spreadsheet sync service.';
comment on table public.outbox_events is
  'Transactional integration queue. Payloads must remain redacted and must never contain client PII.';
comment on table public.production_ledger is
  'Canonical official production events; dashboards aggregate this relation for approved/placed metrics.';
