-- OVERHAUL-recruits (2026-10-29): every recruit row carries its application date, its interview
-- booking and its Xcel pre-licensing purchase, so the New hires page can draw one progress bar per
-- person (applied, contacted, interview, licensing, licensed, contracted, first deal) and say whether
-- they bought Xcel.
--
-- Sam: "a progress bar with each applicant, adding color, seeing what stages they're on." And: a
-- clear badge when someone bought the Xcel pre-licensing course, a nudge when they should have and
-- have not, matched by email first, then phone; a name-only match is a possible match, never a
-- certainty.
--
-- What changed in recruit_pipeline_list(), and what did not:
--   * The first 27 columns, the rows and the scope are the live function's, unchanged. Proven before
--     this file was written: inside a rolled-back transaction, as Sam, the new body against the live
--     one gave 933 rows each and 0 differing rows in either direction (EXCEPT ALL over all 27).
--   * applied_at: the application this person sent. An applicant's own; for a hire, the application
--     they were hired from, else one sent from their profile email (the same match the resident-state
--     fallback already used). 161 of 213 hires have neither, and the page says so instead of a date.
--   * interview_at / interview_booked_at: the latest Licensed Call or Leader Call on Calendly
--     (interview_events, the booking truth) that was not cancelled. Onboarding calls are not interviews.
--   * xcel_match: 'email', 'phone' or 'name'. Every purchase Xcel ever reported (the daily student
--     reports, the older data export and the CSV uploads; 82 people) is matched to the person by any
--     email on file for them, then by any phone (last 10 digits), then by first and last name. The
--     strongest way wins and is the only one returned. A name match comes back as 'name' so the page
--     can say "possible match". Matches are not exclusive: two records of one person (an applicant row
--     and a second application with another email) both match the same purchase, which is what they
--     are. As Sam on 2026-10-29: 68 active people by email, 12 by phone, 5 by name only.
--   * xcel_enrolled_on, xcel_pct, xcel_completed_on, xcel_last_login_on, xcel_course: from the
--     matched purchase (earliest enrollment, furthest progress).
--   * xcel_report_on: the date of the newest daily Xcel report, so the page never says "has not
--     bought Xcel" from a report that stopped arriving.
--   * The Xcel identities are one materialized CTE (82 rows). Left un-materialized, Postgres inlined
--     the 2,491-row regex aggregation into a per-person lookup and one call ran past a minute.
--     Materialized and joined set-wise it measured 935 ms against the live function's 812 ms.
--
-- Grants: the return type changed, so the function is dropped and re-created and its grants are
-- restated exactly as they were (authenticated and service_role; never anon or PUBLIC). The scope
-- is unchanged: admins, VA managers and VAs see everyone, a manager sees routed applicants and
-- direct-report hires, everyone else gets no rows.

drop function if exists public.recruit_pipeline_list();

create function public.recruit_pipeline_list()
returns table(
  person_type text, application_id uuid, agent_id uuid, display_name text, phone text, email text, state text,
  stage_key text, stage_name text, order_index integer, entered_at timestamptz, days_in_stage numeric,
  is_stalled boolean, sla_due_at timestamptz, next_action_label text, manager_name text,
  license_status text, license_progress text, npn text, last_contacted_at timestamptz, manual_stage_key text, status text,
  instagram text, link_sent_at timestamptz, link_used_at timestamptz, last_sign_in_at timestamptz, resident_state text,
  applied_at timestamptz, interview_at timestamptz, interview_booked_at timestamptz,
  xcel_match text, xcel_enrolled_on date, xcel_pct numeric, xcel_completed_on date, xcel_last_login_on date, xcel_course text,
  xcel_report_on date)
language sql stable security definer set search_path to 'public' as $$
  with staff as (select public.apex_is_admin() or public.has_role(auth.uid(),'va_manager') or public.has_role(auth.uid(),'va') ok),
  mgr as (select public.has_role(auth.uid(),'manager') ok),
  mine as (select array_agg(id) ids from public.agents where user_id = auth.uid() and coalesce(is_deactivated,false) = false),
  -- Every Xcel pre-licensing purchase on file: the daily student reports, plus the older data
  -- export and CSV uploads.
  xcel_raw as (
    select lower(nullif(btrim(s.email), '')) as em,
           s.phone as raw_phone,
           concat_ws(' ', s.first_name, s.last_name) as raw_name,
           s.date_enrolled as enrolled_on,
           s.last_log_in as last_login_on,
           s.pct_complete::numeric as pct,
           s.date_completed as completed_on,
           nullif(btrim(s.course_name), '') as course
    from public.xcel_pre_licensing_students s
    union all
    select lower(nullif(btrim(coalesce(e.email, e.student_email)), '')),
           e.home_phone,
           coalesce(nullif(btrim(concat_ws(' ', e.first_name, e.last_name)), ''), e.student_name),
           coalesce(e.enrollment_date, e.start_date, case when e.kind = 'enrollment' then e.event_at::date end),
           null::date,
           coalesce(e.overall_pct, e.pre_licensing_pct, case when e.kind = 'completion' then 100 end)::numeric,
           coalesce(e.completion_date, e.overall_completion_date, case when e.kind = 'completion' then e.event_at::date end),
           nullif(btrim(coalesce(e.course_name, e.state_line)), '')
    from public.xcel_events e
  ),
  xcel as materialized (
    select r.em, d.ph, n.nk,
           min(r.enrolled_on) as enrolled_on, max(r.last_login_on) as last_login_on, max(r.pct) as pct,
           max(r.completed_on) as completed_on, string_agg(distinct r.course, ', ') as course
    from xcel_raw r
    cross join lateral (select regexp_replace(coalesce(r.raw_phone, ''), '\D', '', 'g') as digits) dg
    cross join lateral (select case when length(dg.digits) = 10 then dg.digits
                                    when length(dg.digits) = 11 and left(dg.digits, 1) = '1' then right(dg.digits, 10) end as ph) d
    cross join lateral (select regexp_split_to_array(btrim(regexp_replace(regexp_replace(lower(coalesce(r.raw_name, '')), '[^[:alpha:][:space:]]', '', 'g'), '\s+', ' ', 'g')), ' ') as t) tk
    cross join lateral (select case when cardinality(tk.t) >= 2 and tk.t[1] <> '' then tk.t[1] || ' ' || tk.t[cardinality(tk.t)] end as nk) n
    group by r.em, d.ph, n.nk
  ),
  base as (
    select p.id as rid, p.person_type, p.application_id, p.agent_id,
           coalesce(g.display_name, nullif(regexp_replace(btrim(concat_ws(' ', a.first_name, a.last_name)), '\s+', ' ', 'g'),''), '(no name)') as display_name,
           coalesce(nullif(pr.phone,''), nullif(a.phone,'')) as phone, coalesce(pr.email, a.email) as email, a.state,
           p.current_stage_key as stage_key, s.display_name as stage_name, s.order_index, p.entered_at,
           round(extract(epoch from now() - p.entered_at) / 86400.0, 1) as days_in_stage, coalesce(p.is_stalled,false) as is_stalled, p.sla_due_at, s.next_action_label,
           coalesce(mg.display_name, hm.display_name) as manager_name,
           coalesce(g.license_status::text, a.license_status::text) as license_status,
           coalesce(g.license_progress::text, a.license_progress::text) as license_progress,
           coalesce(nullif(g.nipr_number,''), nullif(a.nipr_number,'')) as npn,
           coalesce(a.last_contacted_at, g.updated_at) as last_contacted_at, p.manual_stage_key, p.status,
           public.fn_normalize_instagram_handle(coalesce(nullif(btrim(pr.instagram_handle),''), nullif(btrim(a.instagram_handle),''), nullif(btrim(sa.instagram_handle),''))) as instagram,
           lk.link_sent_at, lk.link_used_at, u.last_sign_in_at,
           public.fn_normalize_us_state(coalesce(
             nullif(btrim(g.metadata->>'resident_state'),''),
             nullif(btrim(sa.state),''),
             nullif(btrim(ea.state),''),
             nullif(btrim(ala.residence_state),''), nullif(btrim(ala.state),''),
             (g.license_states)[1],
             nullif(btrim(a.state),''))) as resident_state,
           coalesce(a.id, sa.id, ea.id) as k_app,
           coalesce(a.created_at, sa.created_at, ea.created_at) as applied_at,
           array_remove(array[lower(nullif(btrim(a.email), '')), lower(nullif(btrim(pr.email), '')), lower(nullif(btrim(sa.email), ''))], null) as k_emails,
           array_remove(array[
             (select case when length(x.d) = 10 then x.d when length(x.d) = 11 and left(x.d, 1) = '1' then right(x.d, 10) end from (select regexp_replace(coalesce(a.phone, ''), '\D', '', 'g') as d) x),
             (select case when length(x.d) = 10 then x.d when length(x.d) = 11 and left(x.d, 1) = '1' then right(x.d, 10) end from (select regexp_replace(coalesce(pr.phone, ''), '\D', '', 'g') as d) x),
             (select case when length(x.d) = 10 then x.d when length(x.d) = 11 and left(x.d, 1) = '1' then right(x.d, 10) end from (select regexp_replace(coalesce(sa.phone, ''), '\D', '', 'g') as d) x)], null) as k_phones,
           (select case when cardinality(t.t) >= 2 and t.t[1] <> '' then t.t[1] || ' ' || t.t[cardinality(t.t)] end
              from (select regexp_split_to_array(btrim(regexp_replace(regexp_replace(lower(coalesce(g.display_name, concat_ws(' ', a.first_name, a.last_name), '')), '[^[:alpha:][:space:]]', '', 'g'), '\s+', ' ', 'g')), ' ') as t) t) as k_name
    from public.next_step_progress p
    join public.next_step_stages s on s.stage_key = p.current_stage_key
    left join public.applications a on a.id = p.application_id
    left join public.agents g on g.id = p.agent_id
    left join public.profiles pr on pr.id = g.profile_id
    left join public.agents mg on mg.id = g.manager_id
    left join public.agents hm on hm.user_id = a.hiring_manager_user_id and hm.canonical_agent_id is null
    left join public.applications sa on sa.id = g.source_application_id
    left join lateral (select max(t.created_at) link_sent_at, max(t.used_at) link_used_at from public.magic_login_tokens t where t.agent_id = g.id) lk on true
    left join auth.users u on u.id = g.user_id
    left join lateral (select x.id, x.created_at, x.state from public.applications x where g.id is not null and pr.email is not null and lower(x.email) = lower(pr.email) and coalesce(x.is_duplicate,false) = false order by x.created_at desc limit 1) ea on true
    left join lateral (select x.residence_state, x.state from public.agentlink_agents x
                        where g.id is not null and (x.local_agent_id = g.id
                           or (g.insuracloud_user_id is not null and x.insuracloud_user_id = g.insuracloud_user_id)
                           or (g.al_user_id is not null and x.insuracloud_user_id = g.al_user_id)
                           or (pr.email is not null and lower(x.email) = lower(pr.email)))
                        order by x.updated_at desc nulls last limit 1) ala on true
    where auth.uid() is not null
      and (p.application_id is not null or (g.id is not null and g.canonical_agent_id is null and not public.is_placeholder_agent(g.agent_code, g.user_id)))
      and (a.id is null or coalesce(a.is_duplicate,false) = false)
      and (a.id is null or not exists (
            select 1 from public.agents ag
            left join public.profiles pr on pr.id = ag.profile_id
            where ag.canonical_agent_id is null
              and (ag.source_application_id = a.id
                   or (a.email is not null and pr.email is not null and lower(pr.email) = lower(a.email)))))
      and ( (select ok from staff)
            or ((select ok from mgr) and (
                  (p.agent_id is not null and exists (select 1 from public.fn_contracting_checkin_scope() sc where sc.agent_id = p.agent_id))
               or (p.application_id is not null and (a.hiring_manager_user_id = auth.uid() or a.recruiter_id = auth.uid()
                    or a.assigned_agent_id = any(coalesce((select ids from mine),'{}')) or a.referral_manager_id = any(coalesce((select ids from mine),'{}'))))))
          )
  ),
  -- Each way this person can be recognised: every email and phone on file, and the name.
  ids as (
    select b.rid, 1 as lvl, e.v from base b cross join lateral unnest(b.k_emails) as e(v)
    union all
    select b.rid, 2, ph.v from base b cross join lateral unnest(b.k_phones) as ph(v)
    union all
    select b.rid, 3, b.k_name from base b where b.k_name is not null
  ),
  -- Xcel purchases that recognise them, by email (1), phone (2) or name alone (3).
  hits as (
    select i.rid, i.lvl, x.enrolled_on, x.last_login_on, x.pct, x.completed_on, x.course
    from ids i join xcel x on x.em = i.v where i.lvl = 1
    union all
    select i.rid, i.lvl, x.enrolled_on, x.last_login_on, x.pct, x.completed_on, x.course
    from ids i join xcel x on x.ph = i.v where i.lvl = 2
    union all
    select i.rid, i.lvl, x.enrolled_on, x.last_login_on, x.pct, x.completed_on, x.course
    from ids i join xcel x on x.nk = i.v where i.lvl = 3
  ),
  -- The strongest way wins: an email match is never weakened by a phone or name match, and
  -- a name-only match is reported as 'name' so the page can say "possible match".
  matched as (
    select h.rid, (array['email', 'phone', 'name'])[h.lvl] as kind,
           min(h.enrolled_on) as enrolled_on, max(h.pct) as pct, max(h.completed_on) as completed_on,
           max(h.last_login_on) as last_login_on, string_agg(distinct h.course, ', ') as course
    from hits h
    join (select rid, min(lvl) as lvl from hits group by rid) best on best.rid = h.rid and best.lvl = h.lvl
    group by h.rid, h.lvl
  ),
  -- The latest Licensed Call or Leader Call booked on Calendly and not cancelled, and when it was booked.
  interviews as (
    select distinct on (ie.application_id) ie.application_id, ie.scheduled_at as interview_at, ie.created_at as interview_booked_at
    from public.interview_events ie
    where ie.application_id is not null and ie.canceled_at is null and ie.call_track in ('licensed', 'leader')
    order by ie.application_id, ie.scheduled_at desc nulls last, ie.created_at desc
  )
  select b.person_type, b.application_id, b.agent_id, b.display_name, b.phone, b.email, b.state,
         b.stage_key, b.stage_name, b.order_index, b.entered_at, b.days_in_stage,
         b.is_stalled, b.sla_due_at, b.next_action_label, b.manager_name,
         b.license_status, b.license_progress, b.npn, b.last_contacted_at, b.manual_stage_key, b.status,
         b.instagram, b.link_sent_at, b.link_used_at, b.last_sign_in_at, b.resident_state,
         b.applied_at,
         iv.interview_at, iv.interview_booked_at,
         m.kind, m.enrolled_on, m.pct, m.completed_on, m.last_login_on, m.course,
         (select max(r.report_date) from public.xcel_pre_licensing_reports r)
  from base b
  left join interviews iv on iv.application_id = b.k_app
  left join matched m on m.rid = b.rid
$$;

revoke all on function public.recruit_pipeline_list() from public, anon;
grant execute on function public.recruit_pipeline_list() to authenticated, service_role;

comment on function public.recruit_pipeline_list() is
  'New hires / recruit tracking list (OVERHAUL-recruits 2026-10-29). Scope: admin, VA manager and VA see everyone; a manager sees routed applicants and direct-report hires; anyone else gets no rows. xcel_match is email > phone > name; name means possible match only.';
