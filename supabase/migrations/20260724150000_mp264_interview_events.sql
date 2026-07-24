-- MP-264 — Interview Recovery & Scheduling Command Center
-- 2026-07-24
--
-- ROOT CAUSE THIS FIXES:
--   calendly-webhook classifyEvent() only matched seminar/exam/test/interview/
--   1on1/prospect/manager. Sam's live Calendly event types are "Licensed Call"
--   and "Leader Call " (trailing space). Every booking fell to "unknown" and
--   returned HTTP 200 having written nothing. 105 bookings between 2026-06-15
--   and 2026-08-10 produced ZERO rows. Same fake-success class as the 465
--   InsuraCloud and 198 AgentLink zombie rows.
--
--   There was also no table capable of holding an interview outcome. The old
--   write target was applications.test_scheduled_date — a single date column,
--   overwritten on every rebooking, with no outcome, notes, or history.
--
-- This migration creates that missing log, the status engine that drives the
-- recovery queue, and the capture-health view that makes a silent re-break
-- impossible.

-- ---------------------------------------------------------------------------
-- 1. interview_events — the durable interview log
-- ---------------------------------------------------------------------------
create table if not exists public.interview_events (
  id uuid primary key default gen_random_uuid(),

  -- provenance
  source            text not null default 'calendly'
                    check (source in ('calendly','manual','application','readymode')),
  calendly_event_uri   text unique,          -- idempotency key for upserts
  calendly_invitee_uri text,
  event_type_name   text,
  call_track        text check (call_track in ('licensed','leader','seminar','exam','other')),

  -- who
  application_id  uuid references public.applications(id) on delete set null,
  agent_id        uuid references public.agents(id) on delete set null,
  invitee_name    text,
  invitee_email   text,
  invitee_phone   text,
  match_method    text check (match_method in ('email','phone','manual','none')),

  -- when
  scheduled_at     timestamptz not null,
  ended_at         timestamptz,
  canceled_at      timestamptz,
  cancel_reason    text,
  confirmed_at     timestamptz,
  reminder_sent_at timestamptz,

  -- outcome — all null until Sam logs it. This is the "cleared spot" that
  -- did not exist anywhere in the product before.
  outcome         text check (outcome in
                    ('completed','hired','contracted','passed','no_show','no_answer',
                     'rescheduled','bad_number','callback','not_interested','not_a_fit')),
  outcome_at      timestamptz,
  outcome_by      uuid references auth.users(id),
  notes           text,
  va_notes        text,
  followup_due_at timestamptz,
  contacted_at    timestamptz,   -- recovery outreach sent, awaiting reply

  raw_payload jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.interview_events is
  'MP-264: durable interview log. One row per Calendly booking (or manual entry). '
  'outcome IS NULL AND canceled_at IS NULL AND scheduled_at < now() == the recovery backlog.';

create index if not exists interview_events_scheduled_idx  on public.interview_events (scheduled_at desc);
create index if not exists interview_events_open_idx       on public.interview_events (scheduled_at) where outcome is null and canceled_at is null;
create index if not exists interview_events_app_idx        on public.interview_events (application_id);
create index if not exists interview_events_phone_idx      on public.interview_events (invitee_phone);
create index if not exists interview_events_track_idx      on public.interview_events (call_track);

-- updated_at trigger (repo convention)
create or replace function public.tg_interview_events_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists interview_events_touch on public.interview_events;
create trigger interview_events_touch
  before update on public.interview_events
  for each row execute function public.tg_interview_events_touch();

-- ---------------------------------------------------------------------------
-- 2. RLS — mirrors manual_interview_entries
-- ---------------------------------------------------------------------------
alter table public.interview_events enable row level security;

drop policy if exists interview_events_admin_all on public.interview_events;
create policy interview_events_admin_all on public.interview_events
  for all to authenticated
  using (
    exists (select 1 from public.user_roles ur
             where ur.user_id = auth.uid() and ur.role::text in ('admin','manager'))
  )
  with check (
    exists (select 1 from public.user_roles ur
             where ur.user_id = auth.uid() and ur.role::text in ('admin','manager'))
  );

drop policy if exists interview_events_service on public.interview_events;
create policy interview_events_service on public.interview_events
  for all to service_role using (true) with check (true);

-- ---------------------------------------------------------------------------
-- 3. resolve_application_for_invitee — email first, phone fallback
--    Fixes the email-only matching bug. Every Calendly booking is an
--    outbound_call keyed on a phone number, and VAs routinely book with a
--    different email than the application carries.
-- ---------------------------------------------------------------------------
create or replace function public.resolve_application_for_invitee(
  p_email text,
  p_phone text
) returns table (application_id uuid, match_method text)
language plpgsql stable
security definer set search_path = public
as $$
declare
  v_id uuid;
  v_digits text := right(regexp_replace(coalesce(p_phone,''), '\D', '', 'g'), 10);
begin
  -- 1. exact email match, most recent
  if p_email is not null and p_email <> '' then
    select a.id into v_id from public.applications a
     where a.email ilike p_email
     order by a.created_at desc limit 1;
    if v_id is not null then
      return query select v_id, 'email'::text;
      return;
    end if;
  end if;

  -- 2. last-10-digit phone match, most recent
  if length(v_digits) = 10 then
    select a.id into v_id from public.applications a
     where right(regexp_replace(coalesce(a.phone,''), '\D', '', 'g'), 10) = v_digits
     order by a.created_at desc limit 1;
    if v_id is not null then
      return query select v_id, 'phone'::text;
      return;
    end if;
  end if;

  -- 3. no match — caller still stores the row. An unmatched interview is
  --    still an interview; it surfaces in the Unmatched tab.
  return query select null::uuid, 'none'::text;
end $$;

-- ---------------------------------------------------------------------------
-- 4. v_interview_pipeline — the status engine behind the recovery queue.
--    All date math in America/Chicago (Calendly returns UTC, Sam reads CDT).
--    Nothing is ever filtered out: every interview lands in exactly one bucket
--    and nothing disappears until it is completed.
-- ---------------------------------------------------------------------------
create or replace view public.v_interview_pipeline as
with base as (
  select
    ie.*,
    (ie.scheduled_at at time zone 'America/Chicago')            as scheduled_at_chicago,
    (now() at time zone 'America/Chicago')::date                as today_chi,
    (ie.scheduled_at at time zone 'America/Chicago')::date      as sched_date_chi,
    a.first_name, a.last_name, a.email as app_email, a.phone as app_phone,
    a.state, a.license_status, a.license_progress, a.status as application_status,
    a.previous_company, a.years_experience, a.previous_production,
    a.previous_team_size, a.desired_income, a.qualified_role,
    a.has_insurance_experience, a.referral_source, a.assigned_va_id,
    a.resume_url, a.ica_paid
  from public.interview_events ie
  left join public.applications a on a.id = ie.application_id
)
select
  b.*,
  coalesce(
    nullif(trim(coalesce(b.invitee_name,'')), ''),
    nullif(trim(coalesce(b.first_name,'') || ' ' || coalesce(b.last_name,'')), ''),
    b.invitee_phone,                       -- never render "Unknown"
    'No name on file'
  ) as display_name,
  coalesce(b.invitee_phone, b.app_phone)   as best_phone,
  coalesce(b.invitee_email, b.app_email)   as best_email,

  -- bucket: first match wins, top to bottom
  case
    when b.outcome in ('completed','hired','contracted','passed')      then 'completed'
    when b.outcome = 'no_show'                                          then 'no_show'
    when b.outcome in ('not_interested','not_a_fit')                    then 'not_interested'
    when b.canceled_at is not null                                      then 'canceled'
    when b.outcome in ('rescheduled','callback','bad_number')           then 'needs_reschedule'
    when b.outcome is null and b.contacted_at is not null               then 'contacted_waiting'
    when b.outcome is null and b.scheduled_at between now() and now() + interval '15 minutes'
                                                                        then 'starting_soon'
    when b.outcome is null and b.scheduled_at < now()
         and b.sched_date_chi = b.today_chi                             then 'overdue_today'
    when b.outcome is null and b.sched_date_chi = b.today_chi           then 'today'
    when b.outcome is null and b.confirmed_at is not null
         and b.scheduled_at > now()                                     then 'confirmed'
    when b.outcome is null and b.sched_date_chi = b.today_chi - 1       then 'missed_yesterday'
    when b.outcome is null and b.sched_date_chi between b.today_chi - 7 and b.today_chi - 2
                                                                        then 'missed_2_7'
    when b.outcome is null and b.sched_date_chi < b.today_chi - 7       then 'missed_7_plus'
    else 'upcoming'
  end as bucket,

  (b.outcome is null and b.canceled_at is null and b.scheduled_at < now()) as is_backlog,
  greatest(0, (b.today_chi - b.sched_date_chi))                            as days_overdue,

  -- priority_score — deterministic ordering for Catch Up mode.
  -- Real fields only. The UI surfaces the contributing reasons as text so a
  -- ranking is never presented without its basis.
  (
      case when b.sched_date_chi = b.today_chi then 1000 else 0 end
    + case when b.scheduled_at between now() and now() + interval '15 minutes' then 800 else 0 end
    + case when b.license_status::text = 'licensed' then 400 else 0 end
    + case when b.has_insurance_experience then 300 else 0 end
    + case when coalesce(b.previous_production,0) > 0 then 200 else 0 end
    + case when coalesce(b.previous_team_size,0) > 0 or b.qualified_role = 'leader' then 200 else 0 end
    + least(300, greatest(0, (b.today_chi - b.sched_date_chi)) * 10)
    + case when b.contacted_at is not null then -500 else 0 end
  ) as priority_score
from base b;

comment on view public.v_interview_pipeline is
  'MP-264 status engine. One bucket per interview, America/Chicago date math, '
  'nothing filtered out. Drives the recovery queue and Catch Up ordering.';

-- ---------------------------------------------------------------------------
-- 5. v_interview_capture_health — makes a silent re-break impossible.
--    apex-doctor fails CRITICAL when stored < received.
-- ---------------------------------------------------------------------------
create or replace view public.v_interview_capture_health as
select
  count(*) filter (where created_at > now() - interval '7 days')                            as stored_7d,
  count(*) filter (where created_at > now() - interval '7 days' and match_method = 'none')  as unmatched_7d,
  count(*) filter (where outcome is null and canceled_at is null and scheduled_at < now())  as undispositioned_backlog,
  count(*) filter (where scheduled_at > now() and canceled_at is null)                      as upcoming,
  max(created_at)                                                                            as last_capture_at,
  (now() - max(created_at))                                                                  as since_last_capture
from public.interview_events;

comment on view public.v_interview_capture_health is
  'MP-264 capture watchdog. If since_last_capture exceeds ~24h during a normal '
  'booking week, the Calendly capture path is broken again.';

-- ---------------------------------------------------------------------------
-- 6. cc_dispose_interview — single write path for logging an outcome.
--    Keeps promotion on the existing promote_applicant_to_agent path.
-- ---------------------------------------------------------------------------
create or replace function public.cc_dispose_interview(
  p_id uuid,
  p_outcome text,
  p_notes text default null,
  p_followup_due_at timestamptz default null
) returns public.interview_events
language plpgsql security definer set search_path = public
as $$
declare
  v_row public.interview_events;
begin
  update public.interview_events
     set outcome         = p_outcome,
         outcome_at      = now(),
         outcome_by      = auth.uid(),
         notes           = coalesce(p_notes, notes),
         followup_due_at = coalesce(p_followup_due_at, followup_due_at),
         contacted_at    = case when p_outcome = 'callback' then now() else contacted_at end
   where id = p_id
   returning * into v_row;

  if v_row.id is null then
    raise exception 'interview_events row % not found', p_id;
  end if;

  -- Keep the application status in step when we have a linked application.
  -- NOTE: application_status has no 'hired' value — the real enum is
  -- new/reviewing/interview/contracting/approved/rejected/no_pickup/lead/
  -- registered/attended/attended_no_show/paid/onboarding/producing/lapsed/
  -- disqualified/quick_qualified. Map onto the values that actually exist
  -- rather than inventing one and throwing at runtime.
  if v_row.application_id is not null then
    update public.applications
       set last_contacted_at = now(),
           status = case
                      when p_outcome in ('hired','contracted') then 'contracting'::application_status
                      when p_outcome = 'completed'             then 'interview'::application_status
                      when p_outcome = 'no_show'               then 'attended_no_show'::application_status
                      when p_outcome = 'no_answer'             then 'no_pickup'::application_status
                      when p_outcome in ('not_interested','not_a_fit') then 'rejected'::application_status
                      else status
                    end
     where id = v_row.application_id;
  end if;

  return v_row;
end $$;

grant execute on function public.cc_dispose_interview(uuid, text, text, timestamptz) to authenticated;
grant execute on function public.resolve_application_for_invitee(text, text) to authenticated, service_role;
