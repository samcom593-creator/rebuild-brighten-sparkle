-- Candidate operating layer: one SMART-goal record per subject, a shared
-- staff notes feed, and immutable licensing milestones routed through the
-- durable outbox. This migration deliberately does not create a `policies`
-- table: public.deals is APEX's canonical policy ledger and already owns the
-- composite policy identity / HTTP-200 replay receipt.

begin;

create or replace function public.apex_can_read_candidate(
  p_application_id uuid default null,
  p_agent_id uuid default null,
  p_profile_id uuid default null
)
returns boolean
language sql
stable
security definer
set search_path = public
as $function$
  select auth.uid() is not null and (
    public.apex_is_admin()
    or public.apex_has_any_role(array['manager', 'va_manager', 'va'])
    or (p_agent_id is not null and public.crm_can_read_agent_scope(p_agent_id))
    or exists (
      select 1
      from public.profiles p
      where p.id = p_profile_id and p.user_id = auth.uid()
    )
    or exists (
      select 1
      from public.applications a
      where a.id = p_application_id
        and lower(btrim(a.email)) = lower(btrim(coalesce(auth.jwt() ->> 'email', '')))
    )
  );
$function$;

revoke all on function public.apex_can_read_candidate(uuid, uuid, uuid)
  from public, anon;
grant execute on function public.apex_can_read_candidate(uuid, uuid, uuid)
  to authenticated;

create table if not exists public.candidate_smart_goals (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete cascade,
  application_id uuid references public.applications(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete cascade,
  monthly_income_goal numeric(12,2) not null default 10000.00
    check (monthly_income_goal between 0 and 10000000),
  daily_dial_target integer not null default 200
    check (daily_dial_target between 0 and 5000),
  weekly_presentation_target integer not null default 15
    check (weekly_presentation_target between 0 and 1000),
  target_first_deal_date date,
  target_full_time_date date,
  why_statement text check (why_statement is null or length(why_statement) <= 5000),
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (num_nonnulls(profile_id, application_id, agent_id) >= 1),
  check (
    target_first_deal_date is null
    or target_full_time_date is null
    or target_full_time_date >= target_first_deal_date
  )
);

create unique index if not exists candidate_smart_goals_profile_unique
  on public.candidate_smart_goals(profile_id) where profile_id is not null;
create unique index if not exists candidate_smart_goals_application_unique
  on public.candidate_smart_goals(application_id) where application_id is not null;
create unique index if not exists candidate_smart_goals_agent_unique
  on public.candidate_smart_goals(agent_id) where agent_id is not null;

create table if not exists public.candidate_notes (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references public.applications(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete cascade,
  author_id uuid references auth.users(id) on delete set null default auth.uid(),
  author_name text not null check (length(btrim(author_name)) between 1 and 160),
  author_role text not null
    check (author_role in ('sam', 'milford', 'va', 'manager', 'admin')),
  note_type text not null default 'call_log'
    check (note_type in ('call_log', 'objection', 'goal_update', 'blocker', 'general')),
  content text not null check (length(btrim(content)) between 1 and 10000),
  created_at timestamptz not null default now(),
  check (num_nonnulls(application_id, agent_id) >= 1)
);

create index if not exists candidate_notes_application_idx
  on public.candidate_notes(application_id, created_at desc)
  where application_id is not null;
create index if not exists candidate_notes_agent_idx
  on public.candidate_notes(agent_id, created_at desc)
  where agent_id is not null;

create table if not exists public.licensing_milestone_events (
  id uuid primary key default gen_random_uuid(),
  application_id uuid references public.applications(id) on delete cascade,
  agent_id uuid references public.agents(id) on delete cascade,
  candidate_name text not null check (length(btrim(candidate_name)) between 1 and 200),
  milestone_type text not null check (milestone_type in (
    'enrolled_course', 'scheduled_exam', 'passed_exam',
    'fingerprints_submitted', 'license_issued'
  )),
  exam_date date,
  state text check (state is null or state ~ '^[A-Z]{2}$'),
  source text not null default 'application_progress'
    check (source in ('application_progress', 'agent_update', 'admin', 'import')),
  created_at timestamptz not null default now(),
  check (num_nonnulls(application_id, agent_id) >= 1)
);

create unique index if not exists licensing_milestone_events_identity_unique
  on public.licensing_milestone_events(
    coalesce('application:' || application_id::text, 'agent:' || agent_id::text),
    milestone_type,
    coalesce(exam_date, date '0001-01-01'),
    coalesce(state, '')
  );

create index if not exists licensing_milestone_events_application_idx
  on public.licensing_milestone_events(application_id, created_at desc)
  where application_id is not null;
create index if not exists licensing_milestone_events_agent_idx
  on public.licensing_milestone_events(agent_id, created_at desc)
  where agent_id is not null;

create or replace function public.fn_touch_candidate_smart_goal()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
  end if;
  new.updated_at := now();
  return new;
end;
$function$;

create or replace function public.fn_stamp_candidate_note_author()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_name text;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not (
    public.apex_is_admin()
    or public.apex_has_any_role(array['manager', 'va_manager', 'va'])
  ) then
    raise exception 'Candidate notes are staff-only' using errcode = '42501';
  end if;

  select nullif(btrim(p.full_name), '') into v_name
  from public.profiles p
  where p.user_id = auth.uid()
  order by p.updated_at desc
  limit 1;

  new.author_id := auth.uid();
  new.author_name := coalesce(v_name, auth.jwt() ->> 'email', 'APEX staff');
  new.author_role := case
    when public.apex_is_admin() then 'admin'
    when public.apex_has_any_role(array['va_manager', 'va']) then 'va'
    else 'manager'
  end;
  return new;
end;
$function$;

drop trigger if exists trg_candidate_smart_goals_touch
  on public.candidate_smart_goals;
create trigger trg_candidate_smart_goals_touch
  before update on public.candidate_smart_goals
  for each row execute function public.fn_touch_candidate_smart_goal();

drop trigger if exists trg_candidate_notes_stamp_author
  on public.candidate_notes;
create trigger trg_candidate_notes_stamp_author
  before insert on public.candidate_notes
  for each row execute function public.fn_stamp_candidate_note_author();

alter table public.candidate_smart_goals enable row level security;
alter table public.candidate_notes enable row level security;
alter table public.licensing_milestone_events enable row level security;

create policy candidate_smart_goals_scoped_read
  on public.candidate_smart_goals for select to authenticated
  using (public.apex_can_read_candidate(application_id, agent_id, profile_id));

create policy candidate_smart_goals_scoped_insert
  on public.candidate_smart_goals for insert to authenticated
  with check (
    public.apex_can_read_candidate(application_id, agent_id, profile_id)
    and created_by = auth.uid()
  );

create policy candidate_smart_goals_scoped_update
  on public.candidate_smart_goals for update to authenticated
  using (public.apex_can_read_candidate(application_id, agent_id, profile_id))
  with check (public.apex_can_read_candidate(application_id, agent_id, profile_id));

create policy candidate_notes_staff_read
  on public.candidate_notes for select to authenticated
  using (
    public.apex_is_admin()
    or public.apex_has_any_role(array['manager', 'va_manager', 'va'])
  );

create policy candidate_notes_staff_insert
  on public.candidate_notes for insert to authenticated
  with check (
    author_id = auth.uid()
    and (
      public.apex_is_admin()
      or public.apex_has_any_role(array['manager', 'va_manager', 'va'])
    )
  );

create policy licensing_milestones_scoped_read
  on public.licensing_milestone_events for select to authenticated
  using (public.apex_can_read_candidate(application_id, agent_id, null));

grant select, insert, update on public.candidate_smart_goals to authenticated;
grant select, insert on public.candidate_notes to authenticated;
grant select on public.licensing_milestone_events to authenticated;
grant all on public.candidate_smart_goals, public.candidate_notes,
  public.licensing_milestone_events to service_role;

create or replace function public.fn_capture_application_licensing_milestone()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_milestone text;
  v_agent_id uuid;
begin
  if tg_op = 'UPDATE'
     and new.license_progress is not distinct from old.license_progress then
    return new;
  end if;

  v_milestone := case new.license_progress::text
    when 'course_purchased' then 'enrolled_course'
    when 'test_scheduled' then 'scheduled_exam'
    when 'passed_test' then 'passed_exam'
    when 'exam_passed' then 'passed_exam'
    when 'fingerprints_done' then 'fingerprints_submitted'
    when 'waiting_on_license' then 'fingerprints_submitted'
    when 'licensed' then 'license_issued'
    when 'in_field_training' then 'license_issued'
    else null
  end;
  if v_milestone is null then return new; end if;

  select a.id into v_agent_id
  from public.agents a
  left join public.profiles p on p.id = a.profile_id or p.user_id = a.user_id
  where a.source_application_id = new.id
     or lower(btrim(p.email)) = lower(btrim(new.email))
  order by (a.source_application_id = new.id) desc, a.created_at desc
  limit 1;

  insert into public.licensing_milestone_events(
    application_id, agent_id, candidate_name, milestone_type,
    exam_date, state, source
  ) values (
    new.id,
    v_agent_id,
    btrim(concat_ws(' ', new.first_name, new.last_name)),
    v_milestone,
    case when v_milestone = 'scheduled_exam' then new.test_scheduled_date else null end,
    case when upper(btrim(coalesce(new.state, ''))) ~ '^[A-Z]{2}$'
      then upper(btrim(new.state)) else null end,
    'application_progress'
  ) on conflict do nothing;

  return new;
end;
$function$;

drop trigger if exists trg_capture_application_licensing_milestone
  on public.applications;
create trigger trg_capture_application_licensing_milestone
  after insert or update of license_progress on public.applications
  for each row execute function public.fn_capture_application_licensing_milestone();

create or replace function public.fn_queue_licensing_milestone_slack()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  insert into public.outbox_events(
    aggregate_type, aggregate_id, event_type, destination, payload,
    idempotency_key, correlation_id
  ) values (
    'licensing_milestone', new.id, 'candidate.licensing_milestone', 'slack',
    jsonb_strip_nulls(jsonb_build_object(
      'milestoneId', new.id,
      'applicationId', new.application_id,
      'agentId', new.agent_id,
      'candidateName', new.candidate_name,
      'milestoneType', new.milestone_type,
      'examDate', new.exam_date,
      'state', new.state,
      'openUrl', 'https://apex-financial.org/dashboard/recruiting/pipeline'
    )),
    'candidate.licensing_milestone:' || new.id::text || ':slack',
    gen_random_uuid()
  ) on conflict (idempotency_key) do nothing;
  return new;
end;
$function$;

drop trigger if exists trg_queue_licensing_milestone_slack
  on public.licensing_milestone_events;
create trigger trg_queue_licensing_milestone_slack
  after insert on public.licensing_milestone_events
  for each row execute function public.fn_queue_licensing_milestone_slack();

revoke all on function public.fn_touch_candidate_smart_goal()
  from public, anon, authenticated;
revoke all on function public.fn_stamp_candidate_note_author()
  from public, anon, authenticated;
revoke all on function public.fn_capture_application_licensing_milestone()
  from public, anon, authenticated;
revoke all on function public.fn_queue_licensing_milestone_slack()
  from public, anon, authenticated;

comment on table public.candidate_smart_goals is
  'One current SMART-goal plan per candidate/agent identity, hierarchy scoped.';
comment on table public.candidate_notes is
  'Shared recruiting/coaching notes for authorized APEX staff; append-only to clients.';
comment on table public.licensing_milestone_events is
  'Immutable, deduplicated licensing milestones that feed semantic Slack routing through outbox_events.';

commit;
