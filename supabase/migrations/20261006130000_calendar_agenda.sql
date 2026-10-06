-- APEX OS redesign §7 — Calendar: one event model, explicit time zones,
-- reschedule/cancel that update the SAME interview_events row.
--
-- Measured before writing (2026-10-06, bot-sql against xrzweoneiieddzxogewk):
--   * interview_events is the live booking record (271 rows, Calendly webhook +
--     reconcile). Staff "Schedule interview" wrote scheduled_interviews instead
--     (2 rows ever, last 2026-05-15) and therefore never reached the Calendar.
--   * No person/event time zone was stored anywhere.
--   * interview_events.reminder_sent_at: 0/271 ever written. The only reminder
--     cron (fn_sweep_interview_reminders, every 5 min) sweeps scheduled_interviews
--     and COMPUTES reminders at sweep time from the stored time. Onboarding calls
--     carry real calendar invites in onboarding_call_invites, and
--     trg_queue_onboarding_call_invites already re-sequences them on a
--     scheduled_at change and withdraws/cancels them on canceled_at.
--   * calendly-backfill (cron every 15 min) upserts Calendly rows on
--     calendly_event_uri and overwrites scheduled_at AND canceled_at. An in-app
--     move of a Calendly-owned booking would be silently reverted within 15
--     minutes, so the RPCs below REFUSE Calendly-owned rows and the UI hands the
--     operator the invitee's Calendly reschedule/cancel link instead.
--
-- Everything here is additive: new nullable columns, a new history table,
-- new functions, a new security_invoker view, and a create-or-replace of the
-- reminder sweep whose new branch is OFF unless
-- system_settings.calendar_interview_reminders_enabled = 'true'.

-- ─── 1. interview_events: zone, meeting link, owner ──────────────────────────
alter table public.interview_events
  add column if not exists event_tz text,
  add column if not exists meeting_link text,
  add column if not exists owner_user_id uuid references auth.users(id) on delete set null,
  add column if not exists reminder_notification_id uuid;

comment on column public.interview_events.event_tz is
  'IANA zone the time was booked in (e.g. America/New_York). NULL = unknown; the UI says so instead of assuming Phoenix.';
comment on column public.interview_events.meeting_link is
  'Join link for the meeting (https only, validated by book/reschedule RPCs).';
comment on column public.interview_events.owner_user_id is
  'Staff member who owns/runs the meeting. NULL for Calendly bookings (host = the Calendly account).';
comment on column public.interview_events.reminder_notification_id is
  'Receipt for the T-30 inbox reminder: the notifications.id the sweep actually inserted. NULL = no reminder delivered for the current time. reminder_sent_at is left untouched (never written by anything).';

create index if not exists interview_events_owner_idx
  on public.interview_events (owner_user_id, scheduled_at)
  where owner_user_id is not null;

-- ─── 2. history: every book / reschedule / cancel, person-linked or not ─────
create table if not exists public.interview_event_activity (
  id uuid primary key default gen_random_uuid(),
  interview_event_id uuid not null references public.interview_events(id) on delete cascade,
  action text not null
    constraint interview_event_activity_action_check
    check (action in ('booked', 'rescheduled', 'canceled')),
  from_at timestamptz,
  to_at timestamptz,
  event_tz text,
  reason text,
  outcome text,
  reminders_superseded integer not null default 0,
  actor_user_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists interview_event_activity_event_idx
  on public.interview_event_activity (interview_event_id, created_at desc);

alter table public.interview_event_activity enable row level security;

-- ─── 3. role + validation helpers ───────────────────────────────────────────
-- Same staff set as the interview_events_staff_write RLS policy, expressed with
-- the project's role primitives.
create or replace function public.calendar_is_scheduling_staff()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select auth.uid() is not null and (
    public.apex_is_admin()
    or public.has_role(auth.uid(), 'manager'::public.app_role)
    or public.has_role(auth.uid(), 'va_manager'::public.app_role)
    or public.has_role(auth.uid(), 'va'::public.app_role)
  );
$function$;

revoke all on function public.calendar_is_scheduling_staff() from public, anon;
grant execute on function public.calendar_is_scheduling_staff() to authenticated;

-- An agent who recruits may book an interview for an application attributed to
-- them (the scheduler is mounted on agent-facing pages). Same attribution
-- columns the applications RLS policies use.
create or replace function public.calendar_can_book_for_application(p_application_id uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select public.calendar_is_scheduling_staff()
      or (auth.uid() is not null
          and p_application_id is not null
          and exists (
            select 1
              from public.applications a
             where a.id = p_application_id
               and public.get_agent_id(auth.uid()) is not null
               and public.get_agent_id(auth.uid()) in (a.assigned_agent_id, a.recruiter_id, a.referral_manager_id)
          ));
$function$;

revoke all on function public.calendar_can_book_for_application(uuid) from public, anon;
grant execute on function public.calendar_can_book_for_application(uuid) to authenticated;

-- The person who owns a meeting can read it (staff already read every row via
-- interview_events_staff_write). Additive: no existing policy changes.
do $owner_policy$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'interview_events'
       and policyname = 'interview_events_owner_read'
  ) then
    create policy interview_events_owner_read
      on public.interview_events
      for select to authenticated
      using (owner_user_id = auth.uid());
  end if;
end
$owner_policy$;

do $policy$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'interview_event_activity'
       and policyname = 'interview_event_activity_staff_read'
  ) then
    create policy interview_event_activity_staff_read
      on public.interview_event_activity
      for select to authenticated
      using (
        public.calendar_is_scheduling_staff()
        or exists (select 1 from public.interview_events ie
                    where ie.id = interview_event_id and ie.owner_user_id = auth.uid())
      );
  end if;
end
$policy$;

create or replace function public.calendar_valid_tz(p_tz text)
returns boolean
language sql
stable
set search_path to 'public'
as $function$
  select p_tz is not null
     and exists (select 1 from pg_catalog.pg_timezone_names z where z.name = p_tz);
$function$;

grant execute on function public.calendar_valid_tz(text) to authenticated;

-- Readable from the security_invoker view without exposing system_settings.
create or replace function public.calendar_interview_reminders_enabled()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(
    (select lower(btrim(s.value)) = 'true' from public.system_settings s
      where s.key = 'calendar_interview_reminders_enabled' limit 1),
    false);
$function$;

revoke all on function public.calendar_interview_reminders_enabled() from public, anon;
grant execute on function public.calendar_interview_reminders_enabled() to authenticated;

-- Inbox reminders about an event's OLD time are marked superseded (read + a
-- metadata flag) so nobody is told "interview in 30 min" for a slot that moved
-- or was canceled. Returns how many it touched. Internal: no client grant.
create or replace function public.fn_supersede_interview_reminders(p_event_id uuid, p_reason text)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_n integer := 0;
begin
  update public.notifications n
     set read = true,
         read_at = coalesce(n.read_at, now()),
         metadata = coalesce(n.metadata, '{}'::jsonb)
                    || jsonb_build_object('superseded', true,
                                          'superseded_reason', p_reason,
                                          'superseded_at', now())
   where n.type in ('interview_upcoming_t30', 'interview_missed')
     and n.metadata->>'interview_event_id' = p_event_id::text
     and coalesce(n.metadata->>'superseded', 'false') <> 'true';
  get diagnostics v_n = row_count;
  return v_n;
end
$function$;

revoke all on function public.fn_supersede_interview_reminders(uuid, text) from public, anon, authenticated;

-- Person timeline mirror: lead_activity is what ActivityTimeline renders for an
-- application. Internal helper; never fails the scheduling write it reports on.
create or replace function public.fn_log_interview_event_activity(
  p_event public.interview_events,
  p_action text,
  p_from_at timestamptz,
  p_reason text,
  p_outcome text,
  p_superseded integer
)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_zone text := coalesce(p_event.event_tz, 'America/Phoenix');
  v_when text := to_char(p_event.scheduled_at at time zone v_zone, 'Mon DD, YYYY HH12:MI AM') || ' ' || v_zone;
begin
  insert into public.interview_event_activity
    (interview_event_id, action, from_at, to_at, event_tz, reason, outcome, reminders_superseded, actor_user_id)
  values
    (p_event.id, p_action, p_from_at, p_event.scheduled_at, p_event.event_tz, p_reason, p_outcome,
     coalesce(p_superseded, 0), auth.uid());

  if p_event.application_id is not null then
    begin
      insert into public.lead_activity
        (lead_id, actor_user_id, actor_name, actor_role, activity_type, title, details)
      values (
        p_event.application_id,
        auth.uid(),
        (select nullif(btrim(p.full_name), '') from public.profiles p where p.user_id = auth.uid() limit 1),
        (select ur.role::text from public.user_roles ur where ur.user_id = auth.uid() limit 1),
        'interview_' || p_action,
        case p_action
          when 'booked' then 'Interview booked for ' || v_when
          when 'rescheduled' then 'Interview moved to ' || v_when
          else 'Interview canceled' || coalesce(' — ' || nullif(btrim(p_reason), ''), '')
        end,
        jsonb_strip_nulls(jsonb_build_object(
          'interview_event_id', p_event.id,
          'from_at', p_from_at,
          'to_at', p_event.scheduled_at,
          'event_tz', p_event.event_tz,
          'reason', p_reason,
          'outcome', p_outcome,
          'reminders_superseded', p_superseded))
      );
    exception when others then
      raise warning 'lead_activity mirror failed for interview_event %: %', p_event.id, sqlerrm;
    end;
  end if;
end
$function$;

revoke all on function public.fn_log_interview_event_activity(public.interview_events, text, timestamptz, text, text, integer) from public, anon, authenticated;

-- ─── 4. book ────────────────────────────────────────────────────────────────
create or replace function public.book_interview_event(
  p_scheduled_at timestamptz,
  p_event_tz text,
  p_application_id uuid default null,
  p_agent_id uuid default null,
  p_invitee_name text default null,
  p_invitee_email text default null,
  p_kind text default 'interview',
  p_duration_minutes integer default 30,
  p_meeting_link text default null,
  p_notes text default null,
  p_owner_user_id uuid default null
)
returns public.interview_events
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.interview_events;
  v_app record;
  v_name text;
  v_email text;
  v_phone text;
  v_link text := nullif(btrim(coalesce(p_meeting_link, '')), '');
  v_owner uuid := coalesce(p_owner_user_id, auth.uid());
begin
  if not public.calendar_can_book_for_application(p_application_id) then
    raise exception 'not authorized to book interviews' using errcode = '42501';
  end if;
  if not public.calendar_is_scheduling_staff() then
    -- an attributed agent books for themselves, interviews only
    if p_owner_user_id is not null and p_owner_user_id is distinct from auth.uid() then
      raise exception 'only scheduling staff can book for another owner' using errcode = '42501';
    end if;
    if p_kind <> 'interview' then
      raise exception 'only scheduling staff can book onboarding calls' using errcode = '42501';
    end if;
    v_owner := auth.uid();
  end if;
  if p_scheduled_at is null then
    raise exception 'a start time is required' using errcode = '22023';
  end if;
  if not public.calendar_valid_tz(p_event_tz) then
    raise exception 'unknown time zone: %', coalesce(p_event_tz, '(none)') using errcode = '22023';
  end if;
  if p_kind not in ('interview', 'onboarding_call') then
    raise exception 'kind must be interview or onboarding_call' using errcode = '22023';
  end if;
  if p_duration_minutes is null or p_duration_minutes < 5 or p_duration_minutes > 480 then
    raise exception 'duration must be between 5 and 480 minutes' using errcode = '22023';
  end if;
  if p_scheduled_at < now() - interval '5 minutes' then
    raise exception 'cannot book a time in the past' using errcode = '22023';
  end if;
  if v_link is not null and v_link !~* '^https://[^[:space:]]+$' then
    raise exception 'meeting link must be an https:// URL' using errcode = '22023';
  end if;

  if p_application_id is not null then
    select a.id, a.first_name, a.last_name, a.email, a.phone
      into v_app
      from public.applications a
     where a.id = p_application_id;
    if not found then
      raise exception 'application % not found', p_application_id using errcode = 'P0002';
    end if;
    v_name := nullif(btrim(concat_ws(' ', v_app.first_name, v_app.last_name)), '');
    v_email := nullif(lower(btrim(v_app.email)), '');
    v_phone := v_app.phone;
  end if;
  if p_agent_id is not null and not exists (select 1 from public.agents ag where ag.id = p_agent_id) then
    raise exception 'agent % not found', p_agent_id using errcode = 'P0002';
  end if;

  v_name := coalesce(nullif(btrim(p_invitee_name), ''), v_name);
  v_email := coalesce(nullif(lower(btrim(p_invitee_email)), ''), v_email);
  if p_application_id is null and p_agent_id is null and v_email is null then
    raise exception 'book against a person: an application, an agent or an email is required' using errcode = '22023';
  end if;
  if v_owner is not null and not exists (select 1 from auth.users u where u.id = v_owner) then
    raise exception 'owner % is not a user', v_owner using errcode = 'P0002';
  end if;

  insert into public.interview_events (
    source, event_type_name, call_track, application_id, agent_id,
    invitee_name, invitee_email, invitee_phone, match_method,
    scheduled_at, ended_at, notes, event_tz, meeting_link, owner_user_id
  ) values (
    'manual',
    case when p_kind = 'onboarding_call' then 'Onboarding call (booked by staff)' else 'Interview (booked by staff)' end,
    case when p_kind = 'onboarding_call' then 'onboarding' else 'other' end,
    p_application_id, p_agent_id,
    v_name, v_email, v_phone, 'manual',
    p_scheduled_at, p_scheduled_at + make_interval(mins => p_duration_minutes),
    nullif(btrim(coalesce(p_notes, '')), ''), p_event_tz, v_link, v_owner
  )
  returning * into v_row;

  -- The old modal set applications.status = 'interview' unconditionally, which
  -- could drag a contracting/producing person backwards. Only advance early stages.
  if p_application_id is not null then
    update public.applications
       set status = 'interview'::application_status
     where id = p_application_id
       and status::text in ('new', 'reviewing', 'lead', 'no_pickup', 'quick_qualified', 'attended_no_show');
  end if;

  perform public.fn_log_interview_event_activity(v_row, 'booked', null, null, null, 0);
  return v_row;
end
$function$;

revoke all on function public.book_interview_event(timestamptz, text, uuid, uuid, text, text, text, integer, text, text, uuid) from public, anon;
grant execute on function public.book_interview_event(timestamptz, text, uuid, uuid, text, text, text, integer, text, text, uuid) to authenticated;

-- ─── 5. reschedule (same row; reminders follow) ─────────────────────────────
create or replace function public.reschedule_interview_event(
  p_id uuid,
  p_new_at timestamptz,
  p_event_tz text default null,
  p_reason text default null,
  p_duration_minutes integer default null
)
returns public.interview_events
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_old public.interview_events;
  v_row public.interview_events;
  v_tz text;
  v_minutes integer;
  v_superseded integer := 0;
begin

  select * into v_old from public.interview_events where id = p_id for update;
  if not found then
    raise exception 'interview_events row % not found', p_id using errcode = 'P0002';
  end if;
  if not (public.calendar_is_scheduling_staff() or v_old.owner_user_id = auth.uid()) then
    raise exception 'not authorized to reschedule this interview' using errcode = '42501';
  end if;
  if v_old.source = 'calendly' then
    raise exception 'calendly_owned: this booking belongs to Calendly; move it with the invitee reschedule link so Calendly, the invitee and this calendar stay in step'
      using errcode = 'P0001', hint = coalesce(v_old.reschedule_url, 'no reschedule link on file');
  end if;
  if v_old.canceled_at is not null then
    raise exception 'this interview was canceled; book a new one instead' using errcode = '22023';
  end if;
  if v_old.outcome is not null and v_old.outcome <> 'rescheduled' then
    raise exception 'an outcome (%) is already recorded for this interview', v_old.outcome using errcode = '22023';
  end if;
  if p_new_at is null then
    raise exception 'a new start time is required' using errcode = '22023';
  end if;
  if p_new_at < now() - interval '5 minutes' then
    raise exception 'cannot move an interview into the past' using errcode = '22023';
  end if;

  v_tz := coalesce(nullif(btrim(coalesce(p_event_tz, '')), ''), v_old.event_tz, 'America/Phoenix');
  if not public.calendar_valid_tz(v_tz) then
    raise exception 'unknown time zone: %', v_tz using errcode = '22023';
  end if;
  if p_new_at = v_old.scheduled_at and v_tz is not distinct from v_old.event_tz then
    raise exception 'that is already the scheduled time' using errcode = '22023';
  end if;

  v_minutes := coalesce(
    p_duration_minutes,
    case when v_old.ended_at is not null and v_old.ended_at > v_old.scheduled_at
         then round(extract(epoch from (v_old.ended_at - v_old.scheduled_at)) / 60)::integer end,
    30);
  if v_minutes < 5 or v_minutes > 480 then
    raise exception 'duration must be between 5 and 480 minutes' using errcode = '22023';
  end if;

  update public.interview_events
     set scheduled_at     = p_new_at,
         ended_at         = p_new_at + make_interval(mins => v_minutes),
         event_tz         = v_tz,
         was_rescheduled  = true,
         -- re-arm: the sweep computes reminders from scheduled_at, so the next
         -- T-30 belongs to the NEW time.
         reminder_notification_id = null,
         outcome          = case when outcome = 'rescheduled' then null else outcome end,
         outcome_at       = case when outcome = 'rescheduled' then null else outcome_at end,
         outcome_by       = case when outcome = 'rescheduled' then null else outcome_by end
   where id = p_id
  returning * into v_row;

  v_superseded := public.fn_supersede_interview_reminders(p_id, 'rescheduled');
  perform public.fn_log_interview_event_activity(v_row, 'rescheduled', v_old.scheduled_at,
                                                 nullif(btrim(coalesce(p_reason, '')), ''), null, v_superseded);
  return v_row;
end
$function$;

revoke all on function public.reschedule_interview_event(uuid, timestamptz, text, text, integer) from public, anon;
grant execute on function public.reschedule_interview_event(uuid, timestamptz, text, text, integer) to authenticated;

-- ─── 6. cancel (never deletes; records reason + optional outcome) ───────────
create or replace function public.cancel_interview_event(
  p_id uuid,
  p_reason text,
  p_outcome text default null
)
returns public.interview_events
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_old public.interview_events;
  v_row public.interview_events;
  v_superseded integer := 0;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if v_reason is null then
    raise exception 'a cancellation reason is required' using errcode = '22023';
  end if;
  if p_outcome is not null and p_outcome not in (
    'completed', 'hired', 'contracted', 'passed', 'no_show', 'no_answer',
    'rescheduled', 'bad_number', 'callback', 'not_interested', 'not_a_fit') then
    raise exception 'unknown outcome: %', p_outcome using errcode = '22023';
  end if;

  select * into v_old from public.interview_events where id = p_id for update;
  if not found then
    raise exception 'interview_events row % not found', p_id using errcode = 'P0002';
  end if;
  if not (public.calendar_is_scheduling_staff() or v_old.owner_user_id = auth.uid()) then
    raise exception 'not authorized to cancel this interview' using errcode = '42501';
  end if;
  if v_old.source = 'calendly' then
    raise exception 'calendly_owned: this booking belongs to Calendly; cancel it with the Calendly cancel link so the invitee is told and the reconcile job does not restore it'
      using errcode = 'P0001', hint = coalesce(v_old.cancel_url, 'no cancel link on file');
  end if;
  if v_old.canceled_at is not null then
    raise exception 'this interview is already canceled' using errcode = '22023';
  end if;

  update public.interview_events
     set canceled_at   = now(),
         cancel_reason = v_reason
   where id = p_id
  returning * into v_row;

  -- An outcome goes through the one disposition writer so applications.status
  -- follows the same mapping as Follow-Ups (no second rule set).
  if p_outcome is not null then
    v_row := public.cc_dispose_interview(p_id, p_outcome, null, null);
  end if;

  v_superseded := public.fn_supersede_interview_reminders(p_id, 'canceled');
  perform public.fn_log_interview_event_activity(v_row, 'canceled', v_old.scheduled_at, v_reason, p_outcome, v_superseded);
  return v_row;
end
$function$;

revoke all on function public.cancel_interview_event(uuid, text, text) from public, anon;
grant execute on function public.cancel_interview_event(uuid, text, text) to authenticated;

-- ─── 7. availability: what does the owner already have in that slot? ────────
create or replace function public.calendar_owner_conflicts(
  p_owner_user_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_exclude_event_key text default null
)
returns table (
  event_key text,
  source_table text,
  title text,
  starts_at timestamptz,
  ends_at timestamptz,
  scope text
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
begin
  if auth.uid() is null
     or (p_owner_user_id is distinct from auth.uid() and not public.calendar_is_scheduling_staff()) then
    raise exception 'not authorized to read that calendar' using errcode = '42501';
  end if;
  if p_starts_at is null or p_ends_at is null or p_ends_at <= p_starts_at then
    raise exception 'a valid time range is required' using errcode = '22023';
  end if;

  return query
  select 'interview:' || ie.id::text,
         'interview_events'::text,
         coalesce(nullif(btrim(ie.invitee_name), ''), ie.invitee_email, 'Interview'),
         ie.scheduled_at,
         coalesce(ie.ended_at, ie.scheduled_at + interval '30 minutes'),
         case when ie.owner_user_id is not null then 'owner' else 'unassigned' end
    from public.interview_events ie
   where ie.canceled_at is null
     and (ie.outcome is null or ie.outcome = 'rescheduled')
     and (ie.owner_user_id = p_owner_user_id
          or (ie.owner_user_id is null and ie.source = 'calendly'))
     and tstzrange(ie.scheduled_at, coalesce(ie.ended_at, ie.scheduled_at + interval '30 minutes'), '[)')
         && tstzrange(p_starts_at, p_ends_at, '[)')
     and ('interview:' || ie.id::text) is distinct from p_exclude_event_key
  union all
  select 'cal:' || ce.id::text,
         'calendar_events'::text,
         coalesce(nullif(ce.title, ''), 'Appointment'),
         ce.starts_at,
         coalesce(ce.ends_at, ce.starts_at + interval '30 minutes'),
         'owner'::text
    from public.calendar_events ce
   where ce.user_id = p_owner_user_id
     and coalesce(ce.status, 'scheduled') not in ('cancelled', 'canceled', 'done')
     and coalesce(ce.metadata->>'kind', '') not in ('draft_date', 'post_test_follow_up')
     and tstzrange(ce.starts_at, coalesce(ce.ends_at, ce.starts_at + interval '30 minutes'), '[)')
         && tstzrange(p_starts_at, p_ends_at, '[)')
     and ('cal:' || ce.id::text) is distinct from p_exclude_event_key
   order by 4;
end
$function$;

revoke all on function public.calendar_owner_conflicts(uuid, timestamptz, timestamptz, text) from public, anon;
grant execute on function public.calendar_owner_conflicts(uuid, timestamptz, timestamptz, text) to authenticated;

-- ─── 8. provider + reminder health, from real signals only ──────────────────
-- One row in every state (scalar subqueries). NULL means "could not measure",
-- never "zero".
create or replace function public.calendar_provider_health()
returns table (
  measured_at timestamptz,
  calendly_last_webhook_booking_at timestamptz,
  calendly_last_reconcile_at timestamptz,
  calendly_last_reconcile_status text,
  calendly_reconcile_failures_24h integer,
  google_last_synced_at timestamptz,
  google_sync_job_active boolean,
  onboarding_invites_queued integer,
  onboarding_invites_sent integer,
  onboarding_invites_failed integer,
  onboarding_invite_last_error text,
  interview_reminders_enabled boolean,
  interview_reminders_sent integer,
  ics_feed_last_polled_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_gcal_job boolean;
begin
  if not public.calendar_is_scheduling_staff() then
    raise exception 'provider health is visible to scheduling staff only' using errcode = '42501';
  end if;

  begin
    select exists (
      select 1 from cron.job j
       where j.active and j.command ilike '%gcal-sync%'
    ) into v_gcal_job;
  exception when others then
    v_gcal_job := null;  -- unknown, not "no job"
  end;

  return query
  select
    now(),
    (select max(ie.created_at) from public.interview_events ie
      where ie.source = 'calendly' and coalesce(ie.raw_payload->>'origin', '') <> 'backfill'),
    (select r.started_at from public.calendly_reconciliation_runs r order by r.started_at desc limit 1),
    (select r.status from public.calendly_reconciliation_runs r order by r.started_at desc limit 1),
    (select count(*)::integer from public.calendly_reconciliation_runs r
      where r.started_at > now() - interval '24 hours' and r.status <> 'ok'),
    (select max(coalesce(c.synced_at, c.created_at)) from public.apex_scheduled_calls c),
    v_gcal_job,
    (select count(*)::integer from public.onboarding_call_invites i where i.status = 'queued'),
    (select count(*)::integer from public.onboarding_call_invites i where i.status = 'sent'),
    (select count(*)::integer from public.onboarding_call_invites i where i.status = 'failed'),
    (select i.last_error from public.onboarding_call_invites i
      where i.status = 'failed' order by i.updated_at desc limit 1),
    public.calendar_interview_reminders_enabled(),
    (select count(*)::integer from public.interview_events ie where ie.reminder_notification_id is not null),
    (select max(t.last_accessed_at) from public.ics_feed_tokens t);
end
$function$;

revoke all on function public.calendar_provider_health() from public, anon;
grant execute on function public.calendar_provider_health() to authenticated;

-- ─── 9. the agenda view: one shape for every appointment the Calendar edits ─
create or replace view public.v_calendar_agenda
with (security_invoker = true)
as
select
  'interview:' || ie.id::text                                         as event_key,
  'interview_events'::text                                            as source_table,
  ie.id                                                               as ref_id,
  case when ie.call_track = 'onboarding' then 'onboarding_call' else 'interview' end as kind,
  coalesce(nullif(btrim(ie.invitee_name), ''), ie.invitee_email,
           case when ie.call_track = 'onboarding' then 'Onboarding call' else 'Interview' end) as title,
  coalesce(nullif(btrim(ie.invitee_name), ''), ie.invitee_email)      as person_name,
  ie.invitee_email                                                    as person_email,
  ie.application_id,
  ie.agent_id,
  ie.owner_user_id,
  ie.scheduled_at                                                     as starts_at,
  coalesce(ie.ended_at, ie.scheduled_at + interval '30 minutes')      as ends_at,
  ie.event_tz,
  ie.meeting_link,
  case
    when ie.canceled_at is not null then 'canceled'
    when ie.outcome in ('no_show', 'no_answer', 'bad_number') then 'no_show'
    when ie.outcome in ('rescheduled', 'callback') then 'rescheduled'
    when ie.outcome is not null then 'completed'
    when ie.was_rescheduled then 'rescheduled'
    else 'scheduled'
  end                                                                 as status,
  ie.outcome,
  ie.source                                                           as booking_source,
  ie.call_track,
  case
    when ie.canceled_at is not null or ie.outcome is not null then 'closed'
    when ie.call_track = 'onboarding' and not public.calendar_is_scheduling_staff() then 'not_visible'
    when ie.call_track = 'onboarding' then
      case
        when exists (select 1 from public.onboarding_call_invites i where i.booking_id = ie.id and i.status = 'failed') then 'invite_failed'
        when exists (select 1 from public.onboarding_call_invites i where i.booking_id = ie.id and i.status = 'queued') then 'invite_queued'
        when exists (select 1 from public.onboarding_call_invites i where i.booking_id = ie.id and i.status = 'sent') then 'invite_sent'
        else 'invite_none'
      end
    when ie.reminder_notification_id is not null then 'sent'
    when ie.source = 'calendly' then 'calendly_managed'
    when not public.calendar_interview_reminders_enabled() then 'off'
    when ie.owner_user_id is null then 'no_owner'
    else 'pending'
  end                                                                 as reminder_state,
  ie.reschedule_url,
  ie.cancel_url,
  ie.was_rescheduled,
  ie.cancel_reason,
  ie.notes,
  ie.updated_at
from public.interview_events ie

union all

select
  'cal:' || ce.id::text,
  'calendar_events'::text,
  ce.id,
  case ce.metadata->>'kind'
    when 'draft_date' then 'draft_date'
    when 'post_test_follow_up' then 'follow_up'
    else 'appointment'
  end,
  coalesce(nullif(ce.title, ''), 'Appointment'),
  ce.metadata->>'person_name',
  null::text,
  case when coalesce(ce.metadata->>'application_id', '') ~ '^[0-9a-fA-F-]{36}$'
       then (ce.metadata->>'application_id')::uuid end,
  null::uuid,
  ce.user_id,
  ce.starts_at,
  coalesce(ce.ends_at, ce.starts_at + interval '30 minutes'),
  nullif(ce.metadata->>'event_tz', ''),
  nullif(ce.metadata->>'meeting_link', ''),
  case coalesce(ce.status, 'scheduled')
    when 'cancelled' then 'canceled'
    when 'canceled' then 'canceled'
    when 'done' then 'completed'
    else 'scheduled'
  end,
  null::text,
  ce.source,
  null::text,
  'not_tracked'::text,
  null::text,
  null::text,
  false,
  ce.metadata->>'cancel_reason',
  ce.metadata->>'notes',
  ce.updated_at
from public.calendar_events ce;

comment on view public.v_calendar_agenda is
  'APEX OS §7: every editable appointment (interview_events + calendar_events) in one shape. security_invoker: callers see only what RLS already lets them see.';

grant select on public.v_calendar_agenda to authenticated;

-- ─── 10. reminder sweep: same body for scheduled_interviews, plus a flag-gated
--          T-30 inbox reminder for staff-booked interview_events ────────────
create or replace function public.fn_sweep_interview_reminders()
returns table(upcoming_emitted integer, missed_emitted integer)
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE r record; up int := 0; ms int := 0; v_user_id uuid; v_app_name text; v_zone text; v_nid uuid;
BEGIN
  -- Upcoming T-30 (window: 28-32 min ahead), one-shot guarded by NOT EXISTS notif of same type+interview_id
  FOR r IN
    SELECT si.id, si.application_id, si.scheduled_by, si.interview_date
      FROM public.scheduled_interviews si
     WHERE si.status = 'scheduled'
       AND si.interview_date BETWEEN now() + interval '28 minutes' AND now() + interval '32 minutes'
       AND si.scheduled_by IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.notifications n
          WHERE n.user_id = si.scheduled_by
            AND n.type = 'interview_upcoming_t30'
            AND (n.metadata->>'interview_id')::uuid = si.id
       )
  LOOP
    SELECT COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')
      INTO v_app_name FROM public.applications WHERE id = r.application_id;
    PERFORM public.fn_emit_inbox_notification(
      r.scheduled_by, 'interview_upcoming_t30',
      'Interview in 30 min: ' || COALESCE(trim(v_app_name),'applicant'),
      to_char(r.interview_date AT TIME ZONE 'America/Phoenix','Mon DD, HH12:MI AM TZ'),
      '/dashboard/applicants/' || r.application_id::text, 'high',
      jsonb_build_object('application_id', r.application_id, 'interview_id', r.id)
    );
    up := up + 1;
  END LOOP;

  -- Missed: interview_date < now() - 15 min AND status='scheduled'
  FOR r IN
    SELECT si.id, si.application_id, si.scheduled_by, si.interview_date
      FROM public.scheduled_interviews si
     WHERE si.status = 'scheduled'
       AND si.interview_date < now() - interval '15 minutes'
       AND si.scheduled_by IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM public.notifications n
          WHERE n.user_id = si.scheduled_by
            AND n.type = 'interview_missed'
            AND (n.metadata->>'interview_id')::uuid = si.id
       )
  LOOP
    SELECT COALESCE(first_name,'') || ' ' || COALESCE(last_name,'')
      INTO v_app_name FROM public.applications WHERE id = r.application_id;
    PERFORM public.fn_emit_inbox_notification(
      r.scheduled_by, 'interview_missed',
      'Missed interview: ' || COALESCE(trim(v_app_name),'applicant'),
      'Reschedule now to recover the applicant.',
      '/dashboard/applicants/' || r.application_id::text, 'high',
      jsonb_build_object('application_id', r.application_id, 'interview_id', r.id)
    );
    ms := ms + 1;
  END LOOP;

  -- APEX OS §7: staff-booked interview_events. OFF unless
  -- system_settings.calendar_interview_reminders_enabled = 'true'. Computed from
  -- scheduled_at at sweep time; reminder_notification_id (the inbox row the
  -- emitter actually returned) is the one-shot guard and the receipt, and
  -- reschedule_interview_event clears it so the reminder follows the new time.
  -- A failed emit returns NULL and leaves the row unstamped for the next tick.
  -- Calendly-owned rows are skipped: Calendly sends its own reminders.
  IF public.calendar_interview_reminders_enabled() THEN
    FOR r IN
      SELECT ie.id, ie.application_id, ie.owner_user_id, ie.scheduled_at, ie.event_tz,
             COALESCE(NULLIF(btrim(ie.invitee_name), ''), ie.invitee_email, 'your interview') AS who
        FROM public.interview_events ie
       WHERE ie.canceled_at IS NULL
         AND ie.outcome IS NULL
         AND ie.source <> 'calendly'
         AND ie.owner_user_id IS NOT NULL
         AND ie.reminder_notification_id IS NULL
         AND ie.scheduled_at BETWEEN now() + interval '28 minutes' AND now() + interval '32 minutes'
       FOR UPDATE SKIP LOCKED
    LOOP
      v_zone := COALESCE(r.event_tz, 'America/Phoenix');
      v_nid := public.fn_emit_inbox_notification(
        r.owner_user_id, 'interview_upcoming_t30',
        'Interview in 30 min: ' || r.who,
        to_char(r.scheduled_at AT TIME ZONE v_zone, 'Mon DD, HH12:MI AM') || ' ' || v_zone,
        '/dashboard/calendar', 'high',
        jsonb_build_object('interview_event_id', r.id, 'application_id', r.application_id,
                           'scheduled_at', r.scheduled_at)
      );
      IF v_nid IS NOT NULL THEN
        UPDATE public.interview_events SET reminder_notification_id = v_nid WHERE id = r.id;
        up := up + 1;
      END IF;
    END LOOP;
  END IF;

  RETURN QUERY SELECT up, ms;
END;
$function$;
