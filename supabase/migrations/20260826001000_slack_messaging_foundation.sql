-- Slack messaging foundation for APEX OS.
--
-- APEX remains canonical: Slack installations, identities, destinations,
-- routing rules, and provider receipts live here, while business state stays in
-- the existing recruiting, contracting, training, and production tables.
-- Tokens and signing secrets are never stored in these rows. Only references to
-- the deployment secret store are allowed.

create table if not exists public.messaging_workspace_installations (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'slack' check (provider = 'slack'),
  integration_account_id uuid references public.integration_accounts(id) on delete set null,
  environment text not null default 'production'
    check (environment in ('sandbox', 'staging', 'production')),
  workspace_id text not null check (length(btrim(workspace_id)) > 0),
  enterprise_id text,
  workspace_name text,
  bot_user_id text,
  bot_token_secret_ref text,
  refresh_token_secret_ref text,
  signing_secret_ref text,
  granted_scopes text[] not null default '{}',
  installed_by uuid references auth.users(id) on delete set null,
  status text not null default 'not_configured'
    check (status in ('not_configured', 'active', 'degraded', 'revoked', 'disabled')),
  installed_at timestamptz,
  rotated_at timestamptz,
  revoked_at timestamptz,
  last_verified_at timestamptz,
  last_error_redacted text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, environment, workspace_id),
  check (bot_token_secret_ref is null or bot_token_secret_ref !~ '^xox[a-z]-'),
  check (refresh_token_secret_ref is null or refresh_token_secret_ref !~ '^xox[a-z]-'),
  check (signing_secret_ref is null or length(signing_secret_ref) <= 255),
  check (status <> 'revoked' or revoked_at is not null)
);

create table if not exists public.messaging_identity_links (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.messaging_workspace_installations(id) on delete cascade,
  slack_user_id text not null check (length(btrim(slack_user_id)) > 0),
  auth_user_id uuid references auth.users(id) on delete set null,
  agent_id uuid references public.agents(id) on delete set null,
  match_method text not null default 'manual'
    check (match_method in ('manual', 'oauth', 'email_claim', 'admin_verified', 'system')),
  verification_status text not null default 'pending'
    check (verification_status in ('pending', 'verified', 'conflict', 'revoked')),
  linked_by uuid references auth.users(id) on delete set null,
  linked_at timestamptz not null default now(),
  verified_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (installation_id, slack_user_id),
  check (auth_user_id is not null or agent_id is not null),
  check (verification_status <> 'verified' or verified_at is not null),
  check (verification_status <> 'revoked' or revoked_at is not null)
);

create unique index if not exists messaging_identity_verified_auth_unique
  on public.messaging_identity_links (installation_id, auth_user_id)
  where verification_status = 'verified' and auth_user_id is not null;

create unique index if not exists messaging_identity_verified_agent_unique
  on public.messaging_identity_links (installation_id, agent_id)
  where verification_status = 'verified' and agent_id is not null;

create table if not exists public.messaging_destinations (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.messaging_workspace_installations(id) on delete cascade,
  channel_id text not null check (length(btrim(channel_id)) > 0),
  channel_name text,
  purpose text not null check (purpose ~ '^[a-z0-9][a-z0-9_]{1,63}$'),
  scope_type text not null default 'organization'
    check (scope_type in ('organization', 'agency', 'manager', 'personal')),
  scope_key text,
  agency_owner_user_id uuid references auth.users(id) on delete set null,
  manager_agent_id uuid references public.agents(id) on delete set null,
  privacy_level text not null default 'restricted'
    check (privacy_level in ('public', 'private', 'restricted', 'direct')),
  is_enabled boolean not null default true,
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, installation_id),
  check (scope_type = 'organization' or scope_key is not null),
  check (scope_type <> 'agency' or agency_owner_user_id is not null),
  check (scope_type <> 'manager' or manager_agent_id is not null)
);

create unique index if not exists messaging_destination_semantic_unique
  on public.messaging_destinations (
    installation_id,
    purpose,
    scope_type,
    coalesce(scope_key, '')
  );

create index if not exists messaging_destinations_channel_idx
  on public.messaging_destinations (installation_id, channel_id)
  where is_enabled;

create table if not exists public.messaging_route_rules (
  id uuid primary key default gen_random_uuid(),
  installation_id uuid not null references public.messaging_workspace_installations(id) on delete cascade,
  event_type text not null check (length(btrim(event_type)) > 0),
  destination_id uuid not null,
  audience_scope text not null default 'destination'
    check (audience_scope in ('destination', 'organization', 'agency', 'manager', 'actor', 'subject')),
  hierarchy_rule jsonb not null default '{}'::jsonb,
  template_version integer not null default 1 check (template_version > 0),
  priority smallint not null default 5 check (priority between 0 and 9),
  quiet_hours_start time,
  quiet_hours_end time,
  quiet_hours_timezone text not null default 'America/Chicago',
  batch_policy text not null default 'instant'
    check (batch_policy in ('instant', 'hourly_digest', 'daily_digest', 'manual')),
  is_enabled boolean not null default true,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (installation_id, event_type, destination_id, audience_scope),
  constraint messaging_route_destination_installation_fk
    foreign key (destination_id, installation_id)
    references public.messaging_destinations(id, installation_id) on delete restrict,
  check ((quiet_hours_start is null) = (quiet_hours_end is null))
);

create index if not exists messaging_route_rules_event_idx
  on public.messaging_route_rules (installation_id, event_type, priority)
  where is_enabled;

create table if not exists public.messaging_delivery_receipts (
  id uuid primary key default gen_random_uuid(),
  outbox_event_id uuid not null references public.outbox_events(id) on delete restrict,
  installation_id uuid not null references public.messaging_workspace_installations(id) on delete restrict,
  destination_id uuid not null,
  provider text not null default 'slack' check (provider = 'slack'),
  idempotency_key text not null check (length(btrim(idempotency_key)) > 0),
  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'delivered', 'retrying', 'dead_letter', 'suppressed')),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  channel_id text,
  message_ts text,
  provider_response_hash text,
  last_error_redacted text,
  retry_after_seconds integer check (retry_after_seconds is null or retry_after_seconds >= 0),
  correlation_id uuid not null default gen_random_uuid(),
  template_version integer not null default 1 check (template_version > 0),
  claimed_at timestamptz,
  delivered_at timestamptz,
  next_attempt_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (installation_id, idempotency_key),
  unique (outbox_event_id, destination_id),
  constraint messaging_receipt_destination_installation_fk
    foreign key (destination_id, installation_id)
    references public.messaging_destinations(id, installation_id) on delete restrict,
  check (status <> 'delivered' or (channel_id is not null and message_ts is not null and delivered_at is not null))
);

create unique index if not exists messaging_delivery_provider_receipt_unique
  on public.messaging_delivery_receipts (installation_id, channel_id, message_ts)
  where channel_id is not null and message_ts is not null;

create index if not exists messaging_delivery_work_idx
  on public.messaging_delivery_receipts (status, next_attempt_at, created_at)
  where status in ('pending', 'retrying');

create index if not exists messaging_delivery_outbox_idx
  on public.messaging_delivery_receipts (outbox_event_id, created_at desc);

create or replace function public.fn_touch_messaging_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_messaging_installations_touch on public.messaging_workspace_installations;
create trigger trg_messaging_installations_touch
  before update on public.messaging_workspace_installations
  for each row execute function public.fn_touch_messaging_updated_at();

drop trigger if exists trg_messaging_identity_links_touch on public.messaging_identity_links;
create trigger trg_messaging_identity_links_touch
  before update on public.messaging_identity_links
  for each row execute function public.fn_touch_messaging_updated_at();

drop trigger if exists trg_messaging_destinations_touch on public.messaging_destinations;
create trigger trg_messaging_destinations_touch
  before update on public.messaging_destinations
  for each row execute function public.fn_touch_messaging_updated_at();

drop trigger if exists trg_messaging_route_rules_touch on public.messaging_route_rules;
create trigger trg_messaging_route_rules_touch
  before update on public.messaging_route_rules
  for each row execute function public.fn_touch_messaging_updated_at();

drop trigger if exists trg_messaging_delivery_receipts_touch on public.messaging_delivery_receipts;
create trigger trg_messaging_delivery_receipts_touch
  before update on public.messaging_delivery_receipts
  for each row execute function public.fn_touch_messaging_updated_at();

alter table public.messaging_workspace_installations enable row level security;
alter table public.messaging_identity_links enable row level security;
alter table public.messaging_destinations enable row level security;
alter table public.messaging_route_rules enable row level security;
alter table public.messaging_delivery_receipts enable row level security;

drop policy if exists messaging_workspace_installations_admin_read
  on public.messaging_workspace_installations;
create policy messaging_workspace_installations_admin_read
  on public.messaging_workspace_installations for select to authenticated
  using (public.apex_is_admin());

drop policy if exists messaging_identity_links_scoped_read
  on public.messaging_identity_links;
create policy messaging_identity_links_scoped_read
  on public.messaging_identity_links for select to authenticated
  using (public.apex_is_admin() or auth_user_id = auth.uid());

drop policy if exists messaging_destinations_admin_read
  on public.messaging_destinations;
create policy messaging_destinations_admin_read
  on public.messaging_destinations for select to authenticated
  using (public.apex_is_admin());

drop policy if exists messaging_route_rules_admin_read
  on public.messaging_route_rules;
create policy messaging_route_rules_admin_read
  on public.messaging_route_rules for select to authenticated
  using (public.apex_is_admin());

drop policy if exists messaging_delivery_receipts_admin_read
  on public.messaging_delivery_receipts;
create policy messaging_delivery_receipts_admin_read
  on public.messaging_delivery_receipts for select to authenticated
  using (public.apex_is_admin());

grant select on public.messaging_workspace_installations,
  public.messaging_identity_links,
  public.messaging_destinations,
  public.messaging_route_rules,
  public.messaging_delivery_receipts to authenticated;

grant all on public.messaging_workspace_installations,
  public.messaging_identity_links,
  public.messaging_destinations,
  public.messaging_route_rules,
  public.messaging_delivery_receipts to service_role;

revoke all on function public.fn_touch_messaging_updated_at() from public, anon, authenticated;

comment on table public.messaging_workspace_installations is
  'Slack workspace metadata and secret-store references. Raw OAuth tokens and signing secrets are forbidden.';
comment on table public.messaging_identity_links is
  'Verified Slack-to-APEX identity map used for server-side authorization.';
comment on table public.messaging_destinations is
  'Verified Slack channel or DM destinations keyed by semantic purpose and hierarchy scope.';
comment on table public.messaging_route_rules is
  'Canonical APEX event-to-Slack routing policy. Business records remain authoritative in APEX.';
comment on table public.messaging_delivery_receipts is
  'Idempotent Slack delivery state with provider channel/message receipts and retry evidence.';
