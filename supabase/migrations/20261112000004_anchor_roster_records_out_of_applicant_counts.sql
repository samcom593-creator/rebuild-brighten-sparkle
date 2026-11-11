-- MP-ONBOARD-ANCHOR (2026-11-12) FIX 2/2: Xcel roster records out of the applicant counts that read
-- public.applications directly (20261112000003 fixed v_applications_real and its 22 readers).
--
-- The 8 records PKG3 created on 2026-11-11 (tags {xcel_roster,pkg3}) are course students with an owner,
-- not applications. Three readers that bypass v_applications_real still counted them as new applicants:
--   1. v_course_proof_funnel (doctor #43 front door): unlicensed_apps_14d / unlicensed_apps_post_cutoff_14d.
--      Measured: post-cutoff 9, of which 8 roster rows -> a false #43 WARN ("9 unlicensed applicants since
--      the gate shipped and 0 receipts, 0 licensing-call bookings"). The threshold is 5.
--   2. home_conversion_people: the "Applied" block of the owner Home conversion strip (today vs yesterday).
--      Only that block changes. Bought Xcel, Passed the test and Newly licensed still count roster people,
--      because those are real progress by real people.
--   3. apex_admin_operations_snapshot_uncached: the recruiting totals on the Operations page.
-- Not changed: v_recruit_funnel_applications (the funnel snapshot's source) already excludes source ~* 'xcel'.
-- Course lane, owner tasks and the next-step ladder read public.applications directly and are untouched.
-- The tag (not source = 'xcel_roster') keeps three 2026-08-29 rows with that source exactly as they were.
--
-- ROLLBACK: re-apply the pre-images in business-ops/2026-11-11-onboarding-anchor/receipts/
--   (v_course_proof_funnel.preimage.sql, home_conversion_people.preimage.sql,
--    apex_admin_operations_snapshot_uncached.preimage.sql).

create or replace view public.v_course_proof_funnel with (security_invoker = true) as
 WITH cutoff AS (
         SELECT COALESCE(( SELECT NULLIF(system_settings.value, ''::text)::timestamp with time zone AS "nullif"
                   FROM system_settings
                  WHERE system_settings.key = 'wp2_front_door_cutoff'::text), now()) AS at
        )
 SELECT (( SELECT count(*) AS count
           FROM applications a
          WHERE a.created_at > (now() - '14 days'::interval) AND COALESCE(a.record_type, 'application'::text) = 'application'::text AND NOT COALESCE(a.is_duplicate, false) AND a.license_status::text = 'unlicensed'::text AND NOT COALESCE(a.tags @> ARRAY['xcel_roster'::text], false)))::integer AS unlicensed_apps_14d,
    (( SELECT count(DISTINCT p.application_id) AS count
           FROM licensing_course_proofs p
          WHERE p.submitted_at > (now() - '14 days'::interval)))::integer AS proofs_14d,
    (( SELECT count(*) AS count
           FROM interview_events e
          WHERE e.created_at > (now() - '14 days'::interval) AND e.canceled_at IS NULL AND (e.event_type_name ~~* '%licensing call%'::text OR e.call_track = 'licensing'::text)))::integer AS licensing_call_bookings_14d,
    (( SELECT count(*) AS count
           FROM licensing_self_reports s
          WHERE s.created_at > (now() - '14 days'::interval)))::integer AS self_reports_14d,
    (( SELECT count(*) AS count
           FROM ( SELECT DISTINCT ON (p.application_id) p.application_id,
                    p.submitted_at
                   FROM licensing_course_proofs p
                  ORDER BY p.application_id, p.submitted_at) fp,
            cutoff c
          WHERE fp.submitted_at > c.at AND fp.submitted_at < (now() - '00:05:00'::interval) AND (NOT (EXISTS ( SELECT 1
                   FROM applications a
                  WHERE a.id = fp.application_id AND a.course_proof_submitted_at IS NOT NULL)) OR NOT (EXISTS ( SELECT 1
                   FROM bot_alerts b
                  WHERE b.event_type = 'course_proof_submitted'::text AND b.action_link ~~ ('%application='::text || fp.application_id::text))))))::integer AS proofs_without_alert,
    (( SELECT count(*) AS count
           FROM bot_alerts b,
            cutoff c
          WHERE b.event_type = 'course_proof_submitted'::text AND b.created_at > c.at AND b.created_at < (now() - '01:00:00'::interval) AND b.sent_at IS NULL))::integer AS proof_alerts_undelivered_1h,
    (( SELECT count(*) AS count
           FROM outreach_queue q
          WHERE q.template_key = 'applicant-onboarding-v2'::text AND q.status = 'pending'::text))::integer AS roadmap_rows_pending,
    (( SELECT count(*) AS count
           FROM pg_trigger t
          WHERE t.tgname ~~ 'trg_calendly_for_unlicensed%'::text))::integer AS roadmap_triggers_live,
    ( SELECT c.at
           FROM cutoff c) AS cutoff_at,
    (( SELECT count(*) AS count
           FROM applications a,
            cutoff c
          WHERE a.created_at > GREATEST(now() - '14 days'::interval, c.at) AND COALESCE(a.record_type, 'application'::text) = 'application'::text AND NOT COALESCE(a.is_duplicate, false) AND a.license_status::text = 'unlicensed'::text AND NOT COALESCE(a.tags @> ARRAY['xcel_roster'::text], false)))::integer AS unlicensed_apps_post_cutoff_14d;

CREATE OR REPLACE FUNCTION public.home_conversion_people(p_today date DEFAULT NULL::date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
       and not coalesce(a.tags @> array['xcel_roster']::text[], false)
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
$function$;

CREATE OR REPLACE FUNCTION public.apex_admin_operations_snapshot_uncached()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_recruiting jsonb;
  v_onboarding jsonb;
  v_contracting jsonb;
  v_sales jsonb;
  v_readymode jsonb;
  v_support jsonb;
begin
  if auth.uid() is null or not public.apex_is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'active', count(*),
    'new', count(*) filter (where status::text = 'new'),
    'uncontacted', count(*) filter (where contacted_at is null and closed_at is null),
    'uncontacted_48h', count(*) filter (where contacted_at is null and closed_at is null and created_at < now() - interval '48 hours'),
    'interview', count(*) filter (where status::text = 'interview'),
    'contracting', count(*) filter (where status::text = 'contracting'),
    'hired', count(*) filter (where closed_at is not null)
  ) into v_recruiting
  from public.applications
  where record_type = 'application' and terminated_at is null
    and not coalesce(tags @> array['xcel_roster']::text[], false);

  select jsonb_build_object(
    'stalled', count(*) filter (where next_missing_step not like 'COMPLETE%'),
    'intake_missing', count(*) filter (where next_missing_step like '1.%'),
    'npn_comp_missing', count(*) filter (where next_missing_step like '2.%'),
    'carrier_contracting', count(*) filter (where next_missing_step like '3.%'),
    'appointment_missing', count(*) filter (where next_missing_step like '4.%'),
    'discord_missing', count(*) filter (where next_missing_step like '5.%'),
    'training_missing', count(*) filter (where next_missing_step like '6.%'),
    'launch_missing', count(*) filter (where next_missing_step like '7.%'),
    'first_sale_missing', count(*) filter (where next_missing_step like '8.%'),
    'complete', count(*) filter (where next_missing_step like 'COMPLETE%')
  ) into v_onboarding from public.v_onboarding_sequence;

  select jsonb_build_object(
    'total', count(*),
    'active', count(*) filter (where lower(coalesce(status,'')) = 'active'),
    'pending', count(*) filter (where lower(coalesce(status,'')) in ('requested','submitted','pending','agent_action_required')),
    'issues', count(*) filter (where lower(coalesce(status,'')) in ('issue','declined','error'))
  ) into v_contracting from public.apex_carrier_contracts;

  select jsonb_build_object(
    'expected_to_sell', count(*),
    'sold_today', count(*) filter (where pulse = 'sold_today'),
    'not_selling', count(*) filter (where pulse <> 'sold_today'),
    'people', coalesce((
      select jsonb_agg(to_jsonb(x)) from (
        select vp.agent_id, vp.agent_name, vp.leg, vp.pulse, vp.business_days_quiet,
          vp.last_sale, vp.deals_mtd, vp.ap_mtd,
          coalesce(p.phone, '') as phone, coalesce(p.email, '') as email
        from public.v_producer_pulse vp
        left join public.agents a on a.id = vp.agent_id
        left join public.profiles p on p.id = a.profile_id
        where vp.pulse <> 'sold_today'
        order by case vp.pulse when 'cold' then 0 when 'slipping' then 1 when 'quiet' then 2 else 3 end,
          vp.business_days_quiet desc nulls last, vp.agent_name
        limit 12
      ) x
    ), '[]'::jsonb)
  ) into v_sales from public.v_producer_pulse;

  select coalesce(to_jsonb(h), '{}'::jsonb) || jsonb_build_object(
    'sync_enabled', coalesce((select value::text::boolean from public.system_settings where key='readymode_sync_enabled'), false)
  ) into v_readymode
  from public.v_readymode_ingest_health h
  limit 1;

  select jsonb_build_object(
    'open', count(*) filter (where status in ('open','in_progress','waiting_on_requester')),
    'urgent', count(*) filter (where status in ('open','in_progress','waiting_on_requester') and priority = 'urgent')
  ) into v_support from public.support_requests;

  return jsonb_build_object(
    'as_of', now(), 'recruiting', coalesce(v_recruiting, '{}'::jsonb),
    'onboarding', coalesce(v_onboarding, '{}'::jsonb),
    'contracting', coalesce(v_contracting, '{}'::jsonb),
    'sales', coalesce(v_sales, '{}'::jsonb),
    'readymode', coalesce(v_readymode, '{}'::jsonb),
    'support', coalesce(v_support, '{}'::jsonb)
  );
end;
$function$;
