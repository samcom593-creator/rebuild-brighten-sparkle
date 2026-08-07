-- Policy Help Center (MP-271): lead source-of-truth + delivery retry queue.
-- APPLIED to xrzweoneiieddzxogewk on 2026-08-06 via MCP apply_migration
-- (migration name: phc_leads_and_delivery_queue). Committed here so the
-- schema is rebuildable/auditable from the repo.

create table if not exists public.phc_leads (
  id uuid primary key default gen_random_uuid(),
  lead_code text not null unique,
  created_at timestamptz not null default now(),
  first_name text not null,
  phone_raw text,
  phone_e164 text not null,
  email text not null,
  state text not null,
  help_category text not null,
  current_carrier text,
  callback_time text,
  landing_url text,
  referrer text,
  first_touch_at timestamptz,
  gclid text, gbraid text, wbraid text, msclkid text, fbclid text,
  utm_source text, utm_medium text, utm_campaign text, utm_term text, utm_content text,
  device text,
  consent_given boolean not null default false,
  consent_at timestamptz,
  ip_hash text,
  user_agent text,
  status text not null default 'new'
    check (status in ('new','spam','contacted','appointment','application','issued','dead')),
  spam_reason text,
  assigned_agent text,
  first_call_at timestamptz,
  appointment_at timestamptz,
  application_at timestamptz,
  issued_at timestamptz,
  annual_premium numeric,
  notes text
);

create index if not exists idx_phc_leads_phone_recent on public.phc_leads (phone_e164, created_at desc);
create index if not exists idx_phc_leads_status on public.phc_leads (status);
create index if not exists idx_phc_leads_gclid on public.phc_leads (gclid) where gclid is not null;

create table if not exists public.phc_delivery_queue (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references public.phc_leads(id) on delete cascade,
  channel text not null check (channel in ('sheets','ntfy','email_internal','email_consumer','crm_webhook')),
  status text not null default 'pending' check (status in ('pending','ok','failed')),
  attempts int not null default 0,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_phc_queue_retry on public.phc_delivery_queue (status, created_at) where status in ('pending','failed');

alter table public.phc_leads enable row level security;
alter table public.phc_delivery_queue enable row level security;
