-- Mirror of a migration applied live 2026-08-06 via Supabase MCP (recorded
-- remotely as 20260806214858_hh_headhunter_v2_core). Present here so
-- `supabase db push` sees a local file for every remote version — its absence
-- broke every deploy run from 2026-08-06 20:08 onward ("Remote migration
-- versions not found in local migrations directory").
--
-- MP-272 Headhunter v2 — standalone recruiting appointment tracker
-- (~/projects/headhunter, headhunter-sand.vercel.app). All access via Next.js
-- server routes using the service role. RLS enabled with NO policies on every
-- hh_* table = anon/authenticated fully locked out.

create type hh_role as enum ('va','recruiter','executive','analytics');

create type hh_stage as enum (
  'appointment_set','confirmed','rescheduled','interview_complete',
  'hired','not_hired','unqualified','no_show','canceled'
);

create type hh_result as enum (
  'pending','qualified','follow_up','hired','not_hired','unqualified'
);

create table public.hh_users (
  id uuid primary key default gen_random_uuid(),
  email text not null unique check (email = lower(email)),
  name text not null,
  role hh_role not null,
  password_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.hh_applicants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  phone text,
  phone_normalized text generated always as (nullif(regexp_replace(coalesce(phone,''),'\D','','g'),'')) stored,
  email text,
  instagram text,
  company text,
  appointment_at timestamptz,
  calendar_event_id text,
  stage hh_stage not null default 'appointment_set',
  interview_result hh_result not null default 'pending',
  unqualified_reason text,
  notes text,
  va_id uuid references public.hh_users(id),
  recruiter_id uuid references public.hh_users(id),
  version integer not null default 1,
  archived boolean not null default false,
  merged_into uuid references public.hh_applicants(id),
  import_key text unique,
  reschedule_count integer not null default 0,
  created_by uuid references public.hh_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hh_completed_needs_outcome check (stage <> 'interview_complete' or interview_result <> 'pending'),
  constraint hh_hired_lockstep check (stage <> 'hired' or interview_result = 'hired'),
  constraint hh_not_hired_lockstep check (stage <> 'not_hired' or interview_result = 'not_hired'),
  constraint hh_unqualified_lockstep check (stage <> 'unqualified' or interview_result = 'unqualified')
);

create unique index hh_applicants_calevent_live_uniq
  on public.hh_applicants (calendar_event_id) where calendar_event_id is not null and archived = false;
create index hh_applicants_phone_idx on public.hh_applicants (phone_normalized) where phone_normalized is not null;
create index hh_applicants_email_idx on public.hh_applicants (lower(email)) where email is not null;
create index hh_applicants_instagram_idx on public.hh_applicants (lower(instagram)) where instagram is not null;
create index hh_applicants_stage_idx on public.hh_applicants (stage) where archived = false;
create index hh_applicants_va_idx on public.hh_applicants (va_id);
create index hh_applicants_appt_idx on public.hh_applicants (appointment_at);

create table public.hh_activity (
  id bigint generated always as identity primary key,
  applicant_id uuid not null references public.hh_applicants(id),
  user_id uuid references public.hh_users(id),
  user_name text,
  action text not null,
  field text,
  old_value text,
  new_value text,
  reason text,
  ip text,
  device text,
  created_at timestamptz not null default now()
);
create index hh_activity_applicant_idx on public.hh_activity (applicant_id, created_at);

create or replace function public.hh_activity_append_only() returns trigger
language plpgsql as $$
begin
  raise exception 'hh_activity is append-only';
end $$;
create trigger hh_activity_no_mutation
  before update or delete on public.hh_activity
  for each row execute function public.hh_activity_append_only();

create table public.hh_user_prefs (
  user_id uuid primary key references public.hh_users(id) on delete cascade,
  prefs jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table public.hh_import_log (
  id bigint generated always as identity primary key,
  source text not null,
  run_by uuid references public.hh_users(id),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  total integer not null default 0,
  created integer not null default 0,
  updated integer not null default 0,
  skipped integer not null default 0,
  failed integer not null default 0,
  errors jsonb not null default '[]'::jsonb
);

create table public.hh_rate_limits (
  bucket text primary key,
  count integer not null default 0,
  window_start timestamptz not null default now()
);

create or replace function public.hh_touch_applicant() returns trigger
language plpgsql as $$
begin
  new.version := old.version + 1;
  new.updated_at := now();
  return new;
end $$;
create trigger hh_applicants_touch
  before update on public.hh_applicants
  for each row execute function public.hh_touch_applicant();

create or replace function public.hh_touch_user() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;
create trigger hh_users_touch
  before update on public.hh_users
  for each row execute function public.hh_touch_user();

create or replace function public.hh_applicants_no_delete() returns trigger
language plpgsql as $$
begin
  raise exception 'hh_applicants rows are archived, never deleted';
end $$;
create trigger hh_applicants_block_delete
  before delete on public.hh_applicants
  for each row execute function public.hh_applicants_no_delete();

alter table public.hh_users enable row level security;
alter table public.hh_applicants enable row level security;
alter table public.hh_activity enable row level security;
alter table public.hh_user_prefs enable row level security;
alter table public.hh_import_log enable row level security;
alter table public.hh_rate_limits enable row level security;
