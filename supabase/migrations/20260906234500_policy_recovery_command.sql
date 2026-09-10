-- APEX Recovery Command: manager-owned recovery workflow layered over the
-- immutable Ethos and AgentLink source records. Source facts stay in their
-- existing tables; this table stores only APEX workflow, assignment, controls,
-- and frozen score snapshots.

begin;

create table if not exists public.policy_recovery_cases (
  id uuid primary key default gen_random_uuid(),
  source_type text not null check (source_type in ('ETHOS', 'AGENTLINK', 'CRM', 'CARRIER')),
  source_id text not null,
  source_owner_agent_id uuid not null references public.agents(id) on delete restrict,
  customer_state text check (customer_state is null or customer_state ~ '^[A-Z]{2}$'),
  assigned_agent_id uuid references public.agents(id) on delete restrict,
  workflow_status text not null default 'NEW' check (workflow_status in (
    'NEW', 'TRIAGE', 'ASSIGNED', 'ATTEMPTED', 'CONTACTED',
    'REAPPLICATION_STARTED', 'SUBMITTED', 'ISSUED', 'PREMIUM_PAYING',
    'NOT_INTERESTED', 'UNREACHABLE', 'SUPPRESSED', 'DUPLICATE',
    'INELIGIBLE', 'DECEASED', 'CLOSED_OTHER'
  )),
  disposition text,
  suppression_status text not null default 'CLEAR'
    check (suppression_status in ('CLEAR', 'SUPPRESSED', 'NEEDS_REVIEW')),
  compliance_status text not null default 'CLEAR'
    check (compliance_status in ('CLEAR', 'NEEDS_REVIEW', 'APPROVED', 'REJECTED')),
  contact_basis_confirmed boolean not null default false,
  probable_duplicate boolean not null default false,
  first_assigned_at timestamptz,
  last_attempt_at timestamptz,
  next_follow_up_at timestamptz,
  next_action text,
  calculated_score smallint not null default 0 check (calculated_score between 0 and 100),
  calculated_band text not null default 'D' check (calculated_band in ('A', 'B', 'C', 'D')),
  score_confidence text not null default 'low' check (score_confidence in ('complete', 'partial', 'low')),
  score_version text not null default 'recovery-v1',
  score_components jsonb not null default '[]'::jsonb,
  manual_priority_band text check (manual_priority_band is null or manual_priority_band in ('A', 'B', 'C', 'D')),
  manual_priority_reason text,
  version integer not null default 1 check (version > 0),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  updated_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_type, source_id),
  check ((manual_priority_band is null) = (manual_priority_reason is null)),
  check (manual_priority_reason is null or length(btrim(manual_priority_reason)) >= 8),
  check ((assigned_agent_id is null and first_assigned_at is null) or assigned_agent_id is not null)
);

create index if not exists policy_recovery_cases_owner_idx
  on public.policy_recovery_cases (source_owner_agent_id, workflow_status);
create index if not exists policy_recovery_cases_assignee_idx
  on public.policy_recovery_cases (assigned_agent_id, workflow_status)
  where assigned_agent_id is not null;
create index if not exists policy_recovery_cases_priority_idx
  on public.policy_recovery_cases (calculated_band, calculated_score desc, updated_at desc);

create table if not exists public.policy_recovery_score_snapshots (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.policy_recovery_cases(id) on delete restrict,
  score smallint not null check (score between 0 and 100),
  band text not null check (band in ('A', 'B', 'C', 'D')),
  confidence text not null check (confidence in ('complete', 'partial', 'low')),
  score_version text not null,
  components jsonb not null,
  captured_by uuid references auth.users(id) on delete set null default auth.uid(),
  captured_at timestamptz not null default now()
);

create index if not exists policy_recovery_score_snapshots_case_idx
  on public.policy_recovery_score_snapshots (case_id, captured_at desc);

create table if not exists public.policy_recovery_notes (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.policy_recovery_cases(id) on delete restrict,
  author_user_id uuid not null default auth.uid() references auth.users(id) on delete restrict,
  body text not null check (length(btrim(body)) between 1 and 4000),
  created_at timestamptz not null default now()
);

create index if not exists policy_recovery_notes_case_idx
  on public.policy_recovery_notes (case_id, created_at desc);

create table if not exists public.policy_recovery_audit_events (
  id uuid primary key default gen_random_uuid(),
  case_id uuid not null references public.policy_recovery_cases(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete set null default auth.uid(),
  action text not null,
  before_state jsonb,
  after_state jsonb,
  created_at timestamptz not null default now()
);

create index if not exists policy_recovery_audit_case_idx
  on public.policy_recovery_audit_events (case_id, created_at desc);

create or replace function public.apex_recovery_case_visible(p_case_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.policy_recovery_cases c
    where c.id = p_case_id
      and (
        public.apex_is_admin()
        or (
          public.apex_has_any_role(array['manager'])
          and public.apex_can_read_agent(c.source_owner_agent_id)
        )
        or exists (
          select 1
          from public.agents a
          where a.id = c.assigned_agent_id
            and a.user_id = auth.uid()
        )
      )
  );
$$;

revoke all on function public.apex_recovery_case_visible(uuid) from public, anon;
grant execute on function public.apex_recovery_case_visible(uuid) to authenticated;

create or replace function public.apex_recovery_prepare_case()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_states text[];
begin
  if tg_op = 'UPDATE' then
    new.version := old.version + 1;
    new.updated_at := now();
    new.updated_by := auth.uid();
  end if;

  if new.assigned_agent_id is distinct from case when tg_op = 'UPDATE' then old.assigned_agent_id else null end then
    if new.customer_state is null then
      raise exception 'Customer state is required before assignment' using errcode = '23514';
    end if;

    select coalesce(a.license_states, '{}'::text[])
      into v_states
    from public.agents a
    where a.id = new.assigned_agent_id
      and coalesce(a.is_deactivated, false) = false
      and coalesce(a.is_inactive, false) = false;

    if not found or not (upper(new.customer_state) = any(v_states)) then
      raise exception 'Assigned agent is not active and licensed in customer state %', new.customer_state
        using errcode = '23514';
    end if;

    new.first_assigned_at := coalesce(new.first_assigned_at, now());
    if new.workflow_status in ('NEW', 'TRIAGE') then
      new.workflow_status := 'ASSIGNED';
    end if;
  end if;

  if new.workflow_status = 'ATTEMPTED' and new.last_attempt_at is null then
    new.last_attempt_at := now();
  end if;

  return new;
end;
$$;

drop trigger if exists policy_recovery_prepare_case_trigger on public.policy_recovery_cases;
create trigger policy_recovery_prepare_case_trigger
before insert or update on public.policy_recovery_cases
for each row execute function public.apex_recovery_prepare_case();

create or replace function public.apex_recovery_audit_case()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.policy_recovery_audit_events (
    case_id, actor_user_id, action, before_state, after_state
  ) values (
    new.id,
    auth.uid(),
    case when tg_op = 'INSERT' then 'CASE_CREATED' else 'CASE_UPDATED' end,
    case when tg_op = 'UPDATE' then to_jsonb(old) else null end,
    to_jsonb(new)
  );

  if tg_op = 'INSERT'
     or new.calculated_score is distinct from old.calculated_score
     or new.score_version is distinct from old.score_version
     or new.score_components is distinct from old.score_components then
    insert into public.policy_recovery_score_snapshots (
      case_id, score, band, confidence, score_version, components, captured_by
    ) values (
      new.id, new.calculated_score, new.calculated_band, new.score_confidence,
      new.score_version, new.score_components, auth.uid()
    );
  end if;

  return new;
end;
$$;

drop trigger if exists policy_recovery_audit_case_trigger on public.policy_recovery_cases;
create trigger policy_recovery_audit_case_trigger
after insert or update on public.policy_recovery_cases
for each row execute function public.apex_recovery_audit_case();

alter table public.policy_recovery_cases enable row level security;
alter table public.policy_recovery_score_snapshots enable row level security;
alter table public.policy_recovery_notes enable row level security;
alter table public.policy_recovery_audit_events enable row level security;

drop policy if exists policy_recovery_cases_read on public.policy_recovery_cases;
create policy policy_recovery_cases_read
  on public.policy_recovery_cases for select to authenticated
  using (
    public.apex_is_admin()
    or (
      public.apex_has_any_role(array['manager'])
      and public.apex_can_read_agent(source_owner_agent_id)
    )
    or exists (
      select 1 from public.agents a
      where a.id = assigned_agent_id and a.user_id = auth.uid()
    )
  );

drop policy if exists policy_recovery_cases_manager_write on public.policy_recovery_cases;
create policy policy_recovery_cases_manager_write
  on public.policy_recovery_cases for all to authenticated
  using (
    public.apex_is_admin()
    or (
      public.apex_has_any_role(array['manager'])
      and public.apex_can_read_agent(source_owner_agent_id)
    )
  )
  with check (
    public.apex_is_admin()
    or (
      public.apex_has_any_role(array['manager'])
      and public.apex_can_read_agent(source_owner_agent_id)
    )
  );

drop policy if exists policy_recovery_score_read on public.policy_recovery_score_snapshots;
create policy policy_recovery_score_read
  on public.policy_recovery_score_snapshots for select to authenticated
  using (public.apex_recovery_case_visible(case_id));

drop policy if exists policy_recovery_notes_read on public.policy_recovery_notes;
create policy policy_recovery_notes_read
  on public.policy_recovery_notes for select to authenticated
  using (public.apex_recovery_case_visible(case_id));

drop policy if exists policy_recovery_notes_add on public.policy_recovery_notes;
create policy policy_recovery_notes_add
  on public.policy_recovery_notes for insert to authenticated
  with check (
    author_user_id = auth.uid()
    and public.apex_recovery_case_visible(case_id)
  );

drop policy if exists policy_recovery_audit_read on public.policy_recovery_audit_events;
create policy policy_recovery_audit_read
  on public.policy_recovery_audit_events for select to authenticated
  using (public.apex_recovery_case_visible(case_id));

-- Managers need their recursively scoped Ethos rows in order to triage their
-- own team. The source remains read-only and apex_can_read_agent enforces scope.
drop policy if exists ethos_book_team_read on public.ethos_book_policies;
create policy ethos_book_team_read
  on public.ethos_book_policies for select to authenticated
  using (
    public.apex_is_admin()
    or (
      public.apex_has_any_role(array['manager'])
      and public.apex_can_read_agent(owner_agent_id)
    )
  );

revoke all on public.policy_recovery_cases from anon;
revoke all on public.policy_recovery_score_snapshots from anon;
revoke all on public.policy_recovery_notes from anon;
revoke all on public.policy_recovery_audit_events from anon;

grant select, insert, update on public.policy_recovery_cases to authenticated;
grant select on public.policy_recovery_score_snapshots to authenticated;
grant select, insert on public.policy_recovery_notes to authenticated;
grant select on public.policy_recovery_audit_events to authenticated;

comment on table public.policy_recovery_cases is
  'APEX Recovery Command workflow keyed to immutable carrier/CRM source rows. Premium paying is the only recovered conversion.';
comment on table public.policy_recovery_score_snapshots is
  'Append-only explainable score history. Historical snapshots are never rewritten.';
comment on table public.policy_recovery_audit_events is
  'Append-only case change history written by trigger; no client insert/update/delete grants.';

commit;
