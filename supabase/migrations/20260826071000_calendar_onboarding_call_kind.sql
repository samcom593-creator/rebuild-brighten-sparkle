-- Calendar: onboarding calls become their own kind on the Clients > Calendar feed
-- (Sam 2026-08-26). Full definition re-stated from prod so repo == prod.

CREATE OR REPLACE FUNCTION public.calendar_window(p_from date, p_to date, p_kinds text[] DEFAULT NULL::text[])
 RETURNS TABLE(event_id text, event_date date, event_at timestamp with time zone, kind text, title text, subtitle text, person_name text, status text, ref_id text, link text)
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  with tz as (select 'America/Phoenix'::text as z)
  select * from (
    -- 1. Interviews (interview_events is the live Calendly-fed booking truth;
    --    scheduled_interviews has been dead since May).
    select
      'interview:' || ie.id::text,
      ((ie.scheduled_at at time zone t.z))::date,
      ie.scheduled_at,
      -- Onboarding calls are their own kind on the calendar (Sam 2026-08-26);
      -- interview_events.call_track is set by trg_interview_events_classify_onboarding.
      case when ie.call_track = 'onboarding' then 'onboarding_call' else 'interview' end,
      coalesce(nullif(trim(ie.invitee_name), ''), ie.invitee_email, case when ie.call_track = 'onboarding' then 'Onboarding call' else 'Interview' end),
      coalesce(nullif(ie.call_track, ''), nullif(ie.event_type_name, ''), 'Interview'),
      coalesce(nullif(trim(ie.invitee_name), ''), ie.invitee_email),
      case
        when ie.canceled_at is not null then 'cancelled'
        when ie.outcome is not null then ie.outcome
        when ie.confirmed_at is not null then 'confirmed'
        else 'scheduled'
      end,
      ie.id::text,
      ie.calendly_event_uri
    from interview_events ie cross join tz t
    where (ie.scheduled_at at time zone t.z)::date between p_from and p_to

    union all

    -- 2. Calendar events: user-created appointments + the schedule-auto-populate
    --    feed (policy draft checks and post-test follow-ups).
    select
      'cal:' || ce.id::text,
      ((ce.starts_at at time zone t.z))::date,
      ce.starts_at,
      case ce.metadata->>'kind'
        when 'draft_date' then 'draft_date'
        when 'post_test_follow_up' then 'follow_up'
        else 'appointment'
      end,
      coalesce(nullif(ce.title, ''), 'Appointment'),
      case ce.metadata->>'kind'
        when 'draft_date' then
          nullif(concat_ws(' · ', ce.metadata->>'carrier_name', ce.metadata->>'policy_status'), '')
        when 'post_test_follow_up' then
          nullif('Day ' || (ce.metadata->>'follow_up_day') || ' after test', 'Day  after test')
        else nullif(ce.source, '')
      end,
      ce.metadata->>'person_name',
      coalesce(ce.status, 'scheduled'),
      ce.id::text,
      null::text
    from calendar_events ce cross join tz t
    where (ce.starts_at at time zone t.z)::date between p_from and p_to
      and coalesce(ce.status, 'scheduled') <> 'cancelled'

    union all

    -- 3. Recruiting follow-ups owed (applications.next_action_at).
    select
      'follow:' || a.id::text,
      ((a.next_action_at at time zone t.z))::date,
      a.next_action_at,
      'follow_up'::text,
      coalesce(nullif(trim(concat_ws(' ', a.first_name, a.last_name)), ''), a.email, 'Applicant'),
      coalesce(nullif(a.next_action_type, ''), nullif(a.status::text, ''), 'Next action'),
      coalesce(nullif(trim(concat_ws(' ', a.first_name, a.last_name)), ''), a.email),
      coalesce(a.status::text, 'pending'),
      a.id::text,
      null::text
    from applications a cross join tz t
    where a.terminated_at is null
      and a.next_action_at is not null
      and (a.next_action_at at time zone t.z)::date between p_from and p_to

    union all

    -- 4. Onboarding / licensing milestones (exam booked, course started,
    --    licensed, contracted, start date).
    select
      'ms:' || m.id::text || ':' || m.slug,
      m.d,
      m.d::timestamp at time zone t.z,
      'milestone'::text,
      m.label || ': ' || m.person,
      m.detail,
      m.person,
      'milestone',
      m.id::text,
      null::text
    from tz t cross join lateral (
      select a.id, v.slug, v.label, v.detail, v.d,
             coalesce(nullif(trim(concat_ws(' ', a.first_name, a.last_name)), ''), a.email, 'Applicant') as person
      from applications a
      cross join lateral (values
        ('exam',       'Exam',       'Licensing exam booked', coalesce(a.test_scheduled_date::date, (a.exam_scheduled_at at time zone 'America/Phoenix')::date)),
        ('course',     'Course',     'Pre-licensing course started', (a.course_started_at at time zone 'America/Phoenix')::date),
        ('licensed',   'Licensed',   'License issued',        (a.licensed_at at time zone 'America/Phoenix')::date),
        ('contracted', 'Contracted', 'Carrier contracting complete', (a.contracted_at at time zone 'America/Phoenix')::date),
        ('start',      'Start date', 'Onboarding start',      a.start_date::date)
      ) as v(slug, label, detail, d)
      where a.terminated_at is null and v.d is not null
    ) m
    where m.d between p_from and p_to

    union all

    -- 5. Policy effective dates from the production book (agentlink_book is the
    --    source of truth, NOT the legacy deals table; dead policies excluded).
    select
      'pol:' || b.deal_key,
      b.effective_date,
      b.effective_date::timestamp at time zone t.z,
      'policy_effective'::text,
      coalesce(nullif(trim(b.client_name), ''),
               nullif(trim(concat_ws(' ', b.client_first_name, b.client_last_name)), ''),
               'Policy'),
      nullif(concat_ws(' · ', b.carrier, b.agent_name), ''),
      coalesce(nullif(trim(b.client_name), ''), nullif(trim(concat_ws(' ', b.client_first_name, b.client_last_name)), '')),
      coalesce(b.status, 'active'),
      b.deal_key,
      null::text
    from agentlink_book b cross join tz t
    where b.is_dead is not true
      and b.effective_date between p_from and p_to

    union all

    -- 6. Client callbacks owed (agentlink_clients.callback_date).
    select
      'cb:' || c.id::text,
      c.callback_date,
      c.callback_date::timestamp at time zone t.z,
      'callback'::text,
      coalesce(nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), c.phone, 'Client'),
      coalesce(nullif(c.callback_time, ''), 'Callback owed'),
      coalesce(nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), c.phone),
      'callback',
      c.id::text,
      null::text
    from agentlink_clients c cross join tz t
    where c.callback_date between p_from and p_to

    union all

    -- 7. Client birthdays (annual recurrence, clamped so Feb 29 lands on Feb 28
    --    in non-leap years instead of dropping out of the calendar entirely).
    select
      'bday:' || c.id::text || ':' || y.yr::text,
      b.bd,
      b.bd::timestamp at time zone t.z,
      'birthday'::text,
      coalesce(nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), 'Client'),
      'Turns ' || (y.yr - extract(year from c.date_of_birth)::int)::text,
      coalesce(nullif(trim(concat_ws(' ', c.first_name, c.last_name)), ''), 'Client'),
      'birthday',
      c.id::text,
      null::text
    from tz t
    cross join generate_series(extract(year from p_from)::int, extract(year from p_to)::int) as y(yr)
    join agentlink_clients c on c.date_of_birth is not null
    cross join lateral (
      select make_date(
        y.yr,
        extract(month from c.date_of_birth)::int,
        least(
          extract(day from c.date_of_birth)::int,
          extract(day from (make_date(y.yr, extract(month from c.date_of_birth)::int, 1) + interval '1 month - 1 day'))::int
        )
      ) as bd
    ) b
    where b.bd between p_from and p_to
  ) q(event_id, event_date, event_at, kind, title, subtitle, person_name, status, ref_id, link)
  where p_kinds is null or q.kind = any(p_kinds)
  order by q.event_date, q.event_at;
$function$
;
