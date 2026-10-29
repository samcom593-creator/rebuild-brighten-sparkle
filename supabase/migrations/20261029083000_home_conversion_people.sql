-- OVERHAUL-home (2026-10-29): Home's conversion numbers and its roster number, each with the list of
-- people it counts, from one admin-only function.
--
-- Sam: "the roster being 68 is just not accurate. Give me better stats and make it easier for me to
-- convert." The 68 was count(*) of v_apex_roster: every agent row in status 'active', whether or not
-- they had sold anything, so 59 of the 68 were "No sale yet". Its "Producing" number (9) read the
-- AgentLink book only (v_agentlink_book_scoped), which stopped receiving deals when the agency left
-- AgentLink: measured 2026-10-29, v_apex_roster had 0 agents with a deal in the last 30 days while the
-- unified book Home's production numbers read had 11.
--
-- home_conversion_people(p_today) returns {as_of, today, week_start, prior_week_start, month_start,
-- xcel_report_on, people[]}. Every number on the Home strip is the length of one slice of people[]
-- (kind + period), so a number and the list it opens are the same rows by construction.
--
--   applied           real applications received on the Phoenix business day (record_type
--                     'application', not a duplicate). period 'prior' is the day before.
--   interview_booked  a Licensed Call or Leader Call booked that day and not cancelled
--                     (interview_events, the booking truth; onboarding calls are not interviews),
--                     one row per person per day. 'prior' is the day before.
--   xcel_bought       a student's first Xcel enrolment ever (daily student reports, the older export
--                     and CSV uploads), in the last 7 days; 'prior' is the 7 days before. A student is
--                     one email, else one phone, else one name. xcel_report_on is the newest daily
--                     report, so the page can say when the Xcel feed has gone quiet.
--   passed_test       the first time anything recorded the person as past the state exam (the
--                     licensing milestone captured on a license-progress change to passed test, the
--                     exam-passed stamp, the licensing student record, a next-step advance to Passed
--                     Exam), in the last 7 days; 'prior' the 7 days before. One person per email.
--   licensed          newly licensed: the person's records first say licensed more than an hour after
--                     we first had them (application or hire), in the last 7 days; 'prior' the 7 days
--                     before. Someone who applied licensed never counts. how = 'booking' when the
--                     license came from booking the licensed call (fn_auto_license_from_licensed_booking).
--   first_deal        a producer whose first posted deal ever is in the last 7 days; 'prior' the 7
--                     days before. Production is read the way apex_home_dashboard reads it: the
--                     unified book, one canonical agent per person, roster-excluded producers out.
--   selling           THE ROSTER NUMBER: licensed agents on the roster (v_apex_roster's own gate:
--                     real, active, not excluded, not deactivated) with at least one posted deal in
--                     the last 30 days of that same book. 11 for Sam on 2026-10-29.
--
-- Access: administrators only (apex_is_admin(), which reads user_roles for auth.uid()); anyone else
-- gets 42501, and anon and PUBLIC cannot execute it. p_today must be within a day of the server's
-- Phoenix date. Measured against production in a rolled-back transaction: the production and roster
-- part ran in 358 ms.

create or replace function public.home_conversion_people(p_today date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_server_today date := (now() at time zone 'America/Phoenix')::date;
  v_today date := coalesce(p_today, (now() at time zone 'America/Phoenix')::date);
  v_week_start date;
  v_prior_week_start date;
  v_month_start date;
  v_out jsonb;
begin
  if auth.uid() is null or not public.apex_is_admin() then
    raise exception 'Administrator access required' using errcode = '42501';
  end if;
  -- The page sends its Phoenix business day. A day either side covers a browser clock that
  -- crosses midnight before or after the server; anything further is a wrong call, not a view.
  if abs(v_today - v_server_today) > 1 then
    raise exception 'Invalid business day' using errcode = '22023';
  end if;
  v_week_start := v_today - 6;
  v_prior_week_start := v_today - 13;
  v_month_start := v_today - 29;

  with
  -- Applied: every real application received on the business day (and the day before, for
  -- the comparison). Interview-only rows and test rows are not applications; duplicates are
  -- the same person twice.
  applied as (
    select 'applied'::text as kind,
           case when x.d = v_today then 'current' else 'prior' end as period,
           nullif(regexp_replace(btrim(concat_ws(' ', a.first_name, a.last_name)), '\s+', ' ', 'g'), '') as name,
           a.created_at as at, x.d as on_date, a.id as application_id, null::uuid as agent_id,
           jsonb_build_object('license', a.license_status::text) as extra
      from public.applications a
      cross join lateral (select (a.created_at at time zone 'America/Phoenix')::date as d) x
     where a.record_type = 'application'
       and coalesce(a.is_duplicate, false) = false
       and a.created_at >= ((v_today - 1)::timestamp at time zone 'America/Phoenix')
       and a.created_at < ((v_today + 1)::timestamp at time zone 'America/Phoenix')
  ),
  -- Interviews booked: a Licensed Call or Leader Call that came in on the business day and is
  -- still on (not cancelled). Calendly and the desks both write interview_events, the booking
  -- truth. Onboarding calls are not interviews. One row per person per day.
  booked as (
    select distinct on (coalesce(ie.application_id::text, lower(nullif(btrim(ie.invitee_email), '')), ie.id::text), x.d)
           'interview_booked'::text as kind,
           case when x.d = v_today then 'current' else 'prior' end as period,
           coalesce(nullif(regexp_replace(btrim(concat_ws(' ', a.first_name, a.last_name)), '\s+', ' ', 'g'), ''),
                    nullif(btrim(ie.invitee_name), '')) as name,
           ie.created_at as at, x.d as on_date, ie.application_id, ie.agent_id,
           jsonb_build_object('track', ie.call_track, 'starts_at', ie.scheduled_at) as extra
      from public.interview_events ie
      left join public.applications a on a.id = ie.application_id
      cross join lateral (select (ie.created_at at time zone 'America/Phoenix')::date as d) x
     where ie.call_track in ('licensed', 'leader')
       and ie.canceled_at is null
       and ie.created_at >= ((v_today - 1)::timestamp at time zone 'America/Phoenix')
       and ie.created_at < ((v_today + 1)::timestamp at time zone 'America/Phoenix')
     order by coalesce(ie.application_id::text, lower(nullif(btrim(ie.invitee_email), '')), ie.id::text), x.d, ie.created_at desc
  ),
  -- Bought Xcel: the first time Xcel ever reported this student enrolled (the daily student
  -- reports, the older data export and the CSV uploads), so a re-enrolment of an old student is
  -- not a new purchase. A student is one email, else one phone, else one name.
  xcel_raw as (
    select lower(nullif(btrim(s.email), '')) as em, s.phone as raw_phone,
           nullif(btrim(concat_ws(' ', s.first_name, s.last_name)), '') as raw_name,
           s.date_enrolled as enrolled_on, nullif(btrim(s.course_name), '') as course, s.application_id
      from public.xcel_pre_licensing_students s
    union all
    select lower(nullif(btrim(coalesce(e.email, e.student_email)), '')), e.home_phone,
           coalesce(nullif(btrim(concat_ws(' ', e.first_name, e.last_name)), ''), nullif(btrim(e.student_name), '')),
           coalesce(e.enrollment_date, e.start_date, case when e.kind = 'enrollment' then e.event_at::date end),
           nullif(btrim(coalesce(e.course_name, e.state_line)), ''), null::uuid
      from public.xcel_events e
  ),
  xcel_keyed as (
    select r.*, coalesce(r.em, 'phone:' || d.ph, 'name:' || lower(r.raw_name)) as ident
      from xcel_raw r
      cross join lateral (select regexp_replace(coalesce(r.raw_phone, ''), '\D', '', 'g') as digits) dg
      cross join lateral (select case when length(dg.digits) = 10 then dg.digits
                                      when length(dg.digits) = 11 and left(dg.digits, 1) = '1' then right(dg.digits, 10) end as ph) d
     where r.enrolled_on is not null
  ),
  xcel_first as (
    select distinct on (k.ident) k.ident, k.enrolled_on, k.raw_name, k.course, k.em, k.application_id
      from xcel_keyed k
     where k.ident is not null
     order by k.ident, k.enrolled_on, k.application_id nulls last, k.course nulls last
  ),
  xcel as (
    select 'xcel_bought'::text as kind,
           case when f.enrolled_on >= v_week_start then 'current' else 'prior' end as period,
           f.raw_name as name, null::timestamptz as at, f.enrolled_on as on_date,
           coalesce(f.application_id, (
             select x.id from public.applications x
              where f.em is not null and lower(btrim(x.email)) = f.em
                and x.record_type = 'application' and coalesce(x.is_duplicate, false) = false
              order by x.created_at desc limit 1)) as application_id,
           null::uuid as agent_id,
           jsonb_build_object('course', f.course) as extra
      from xcel_first f
     where f.enrolled_on between v_prior_week_start and v_today
  ),
  -- Passed the test: the first time anything recorded this person as past the state exam:
  -- the licensing milestone captured when their license progress changed to passed test, the
  -- exam-passed stamp the licensing tracker writes, the licensing student record, or the
  -- next-step engine advancing them to Passed Exam. Counted on the day of the first one.
  pass_events as (
    select m.application_id, m.created_at as at from public.licensing_milestone_events m
     where m.milestone_type = 'passed_exam' and m.application_id is not null
    union all
    select a.id, a.exam_passed_at from public.applications a where a.exam_passed_at is not null
    union all
    select s.application_id, s.exam_passed_at from public.licensing_students s
     where s.exam_passed_at is not null and s.application_id is not null
    union all
    select e.application_id, e.created_at from public.next_step_events e
     where e.to_stage = 'passed_exam' and e.event_type = 'advance' and e.application_id is not null
  ),
  pass_people as (
    select distinct on (coalesce(lower(nullif(btrim(a.email), '')), a.id::text))
           a.id, a.first_name, a.last_name, a.license_status, p.at
      from (select application_id, min(at) as at from pass_events group by application_id) p
      join public.applications a on a.id = p.application_id
     where a.record_type = 'application' and coalesce(a.is_duplicate, false) = false
     order by coalesce(lower(nullif(btrim(a.email), '')), a.id::text), p.at
  ),
  passed as (
    select 'passed_test'::text as kind,
           case when x.d >= v_week_start then 'current' else 'prior' end as period,
           nullif(regexp_replace(btrim(concat_ws(' ', pp.first_name, pp.last_name)), '\s+', ' ', 'g'), '') as name,
           pp.at, x.d as on_date, pp.id as application_id, null::uuid as agent_id,
           jsonb_build_object('license', pp.license_status::text) as extra
      from pass_people pp
      cross join lateral (select (pp.at at time zone 'America/Phoenix')::date as d) x
     where x.d between v_prior_week_start and v_today
  ),
  -- Newly licensed: people whose records first say licensed more than an hour after we first
  -- had them (an application or a hire), so someone who applied already licensed never counts.
  -- One person is one email across their applications and their agent profile.
  lic_records as (
    select coalesce(lower(nullif(btrim(a.email), '')), 'application:' || a.id::text) as ident,
           a.id as application_id, null::uuid as agent_id,
           nullif(regexp_replace(btrim(concat_ws(' ', a.first_name, a.last_name)), '\s+', ' ', 'g'), '') as name,
           a.created_at as intake_at, a.licensed_at
      from public.applications a
     where a.record_type = 'application' and coalesce(a.is_duplicate, false) = false
    union all
    select coalesce(lower(nullif(btrim(p.email), '')), 'agent:' || g.id::text),
           g.source_application_id, g.id, nullif(btrim(g.display_name), ''),
           g.created_at, g.licensed_at
      from public.agents g
      left join public.profiles p on p.id = g.profile_id
     where g.canonical_agent_id is null
       and coalesce(g.is_deactivated, false) = false
       and not public.is_placeholder_agent(g.agent_code, g.user_id)
  ),
  lic_people as (
    select r.ident,
           min(r.intake_at) as intake_at,
           min(r.licensed_at) as licensed_at,
           (array_agg(r.agent_id order by r.agent_id is null, r.intake_at) filter (where r.agent_id is not null))[1] as agent_id,
           (array_agg(r.application_id order by r.intake_at desc) filter (where r.application_id is not null))[1] as application_id,
           (array_agg(r.name order by r.agent_id is null, r.intake_at) filter (where r.name is not null))[1] as name
      from lic_records r
     group by r.ident
    having min(r.licensed_at) is not null
  ),
  licensed as (
    select 'licensed'::text as kind,
           case when x.d >= v_week_start then 'current' else 'prior' end as period,
           lp.name, lp.licensed_at as at, x.d as on_date, lp.application_id, lp.agent_id,
           jsonb_build_object('how', case when exists (
             select 1 from public.next_step_events e
              where e.application_id = lp.application_id and e.event_type = 'auto_licensed_from_booking')
             then 'booking' else 'record' end) as extra
      from lic_people lp
      cross join lateral (select (lp.licensed_at at time zone 'America/Phoenix')::date as d) x
     where lp.licensed_at > lp.intake_at + interval '1 hour'
       and x.d between v_prior_week_start and v_today
  ),
  -- Production, read exactly as Home's production numbers read it (apex_home_dashboard):
  -- the unified book, one canonical agent per person, roster-excluded producers left out.
  scoped as (
    select coalesce(m.canonical_agent_id, b.agent_id) as canon, b.posted_date, b.annual_premium as ap
      from public.v_production_unified b
      left join public.v_agent_canonical_map m on m.agent_id = b.agent_id
     where b.agent_id is not null
       and not public.fn_agent_is_roster_excluded(coalesce(m.canonical_agent_id, b.agent_id))
  ),
  per_agent as (
    select s.canon,
           min(s.posted_date) as first_on,
           max(s.posted_date) filter (where s.posted_date <= v_today) as last_on,
           count(*) filter (where s.posted_date between v_month_start and v_today) as deals_30d,
           coalesce(sum(s.ap) filter (where s.posted_date between v_month_start and v_today), 0) as ap_30d
      from scoped s
     group by s.canon
  ),
  -- First deals: a producer whose first posted deal ever falls in the window.
  first_deals as (
    select 'first_deal'::text as kind,
           case when pa.first_on >= v_week_start then 'current' else 'prior' end as period,
           nullif(btrim(g.display_name), '') as name, null::timestamptz as at, pa.first_on as on_date,
           null::uuid as application_id, pa.canon as agent_id,
           jsonb_build_object('ap', (select round(coalesce(sum(s.ap), 0)) from scoped s
                                      where s.canon = pa.canon and s.posted_date = pa.first_on)) as extra
      from per_agent pa
      join public.agents g on g.id = pa.canon
     where pa.first_on between v_prior_week_start and v_today
       and not public.is_placeholder_agent(g.agent_code, g.user_id)
  ),
  -- Selling agents (the roster number): licensed agents on the roster (v_apex_roster's own
  -- gate: real, active, not excluded) with at least one posted deal in the last 30 days.
  selling as (
    select 'selling'::text as kind, 'current'::text as period,
           nullif(btrim(r.display_name), '') as name, null::timestamptz as at, pa.last_on as on_date,
           null::uuid as application_id, r.id as agent_id,
           jsonb_build_object('deals', pa.deals_30d, 'ap', round(pa.ap_30d)) as extra
      from public.v_apex_roster r
      join per_agent pa on pa.canon = r.id
     where r.license_status::text = 'licensed'
       and pa.deals_30d > 0
  ),
  people as (
    select * from applied
    union all select * from booked
    union all select * from xcel
    union all select * from passed
    union all select * from licensed
    union all select * from first_deals
    union all select * from selling
  )
  select jsonb_build_object(
    'as_of', now(),
    'today', v_today,
    'week_start', v_week_start,
    'prior_week_start', v_prior_week_start,
    'month_start', v_month_start,
    'xcel_report_on', (select max(r.report_date) from public.xcel_pre_licensing_reports r),
    'people', coalesce((
      select jsonb_agg(
               jsonb_build_object('kind', p.kind, 'period', p.period, 'name', p.name, 'at', p.at, 'on', p.on_date,
                                  'application_id', p.application_id, 'agent_id', p.agent_id) || coalesce(p.extra, '{}'::jsonb)
               order by p.kind, p.period, p.on_date desc, p.at desc nulls last, p.name)
        from people p), '[]'::jsonb)
  ) into v_out;

  return v_out;
end;
$$;

revoke all on function public.home_conversion_people(date) from public, anon;
grant execute on function public.home_conversion_people(date) to authenticated, service_role;

comment on function public.home_conversion_people(date) is
  'Home conversion strip and roster number (OVERHAUL-home 2026-10-29): people per kind (applied, interview_booked, xcel_bought, passed_test, licensed, first_deal, selling) and period (current, prior). Admin only. Each Home number is the count of one slice, so a number equals the list it opens.';
