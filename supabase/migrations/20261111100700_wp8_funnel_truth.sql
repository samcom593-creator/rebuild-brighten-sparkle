-- WP8 (onboarding audit 2026-11-10): funnel truth and monitoring spine.
--
-- Findings: FUNNEL-3/4/5/6/8/9/10, ACTIVATION-11, HUMAN-3 (verifier corrections applied).
-- Every funnel view this project had was wrong in a different way (status columns nobody
-- maintains, batch-stamped contacted_at, point-in-time stage populations read as
-- conversions, backfill rows inflating bookings ~10x). This migration ships ONE cohort
-- funnel Sam can trust, an inflow alarm, canonical owned-link UTMs, and the deprecation
-- notices on the views it replaces.
--
-- Design rules held here:
--   * One application exclusion set, single-sourced in v_recruit_funnel_applications:
--     record_type='application', not is_duplicate, not an Xcel roster import / CSV
--     backfill, not synthetic test traffic. The cohort snapshot AND the inflow alarm read it.
--   * Stage keys mirror src/lib/recruitJourney.ts (recruit_funnel_stage_keys() below;
--     src/tests/lib/recruitJourney.test.ts asserts parity against THIS file).
--   * Identity joins are source_application_id, then a UNIQUE email/phone match. Never a
--     name match (the name sketch gave 33 matches including a pre-existing false hire).
--   * Columns other packages are adding (applications.human_first_contact_at /
--     course_proof_submitted_at, interview_events.is_backfill_duplicate, agents.origin)
--     are read through to_jsonb(row)->>'col', so this compiles before they land and adopts
--     them the moment they do, without a rebuild. Until then the snapshot reads the rows
--     those columns cache (manual application_contact_log rows, licensing_course_proofs).
--   * First-deal cells are 'unprovable', never 'no deal', while a production origin the
--     window depends on is DARK/DYING in v_production_origin_freshness.
--   * Admin-gated: the snapshot is revoked from anon/authenticated; the cohort and inflow
--     views carry the same gate as v_application_conversion_funnel minus the manager role
--     (WHERE api_is_admin_role() OR current_user IN postgres/service_role/supabase_admin).
--   * No sends. Nothing here enqueues or posts anything. The one data write that could have
--     reached a person (first_deal_at on an agent) is forward-only, see section 7.

-- =====================================================================================
-- 0) Stage vocabulary (parity with src/lib/recruitJourney.ts RECRUIT_STEPS keys)
-- =====================================================================================
create or replace function public.recruit_funnel_stage_keys()
returns text[]
language sql
immutable
set search_path to 'public'
as $function$
  select array['applied','contacted','interview','licensing','licensed','contracted','first_deal']::text[]
$function$;
comment on function public.recruit_funnel_stage_keys() is
  'WP8: the seven recruit steps, in order, exactly as src/lib/recruitJourney.ts RECRUIT_STEPS. mat_recruit_funnel_person carries one <key>_at column per key. Parity is asserted by src/tests/lib/recruitJourney.test.ts against the migration that defines this function.';

-- =====================================================================================
-- 1) The one application set (PII-free: ids, times, lane, channel)
-- =====================================================================================
drop view if exists public.v_recruit_funnel_cohort;
drop view if exists public.v_recruit_funnel_freshness;
drop materialized view if exists public.mat_recruit_funnel_person;
drop view if exists public.v_inflow_alert;
drop function if exists public.fn_inflow_alert_asof(date);
drop view if exists public.v_inflow_by_channel_weekly;
drop view if exists public.v_recruit_funnel_applications;

create view public.v_recruit_funnel_applications
with (security_barrier = true) as
select a.id as application_id,
       a.created_at as applied_at,
       date_trunc('month', a.created_at at time zone 'America/Phoenix')::date as cohort_month,
       date_trunc('week', a.created_at at time zone 'America/Phoenix')::date as cohort_week,
       case lower(coalesce(a.license_status::text, ''))
         when 'licensed' then 'licensed'
         when 'pending' then 'pending'
         else 'unlicensed' end as lane,
       coalesce(nullif(lower(btrim(a.utm_source)), ''), nullif(lower(btrim(a.referral_source)), ''), 'unknown') as channel,
       case when nullif(btrim(a.utm_source), '') is not null then 'utm'
            when nullif(btrim(a.referral_source), '') is not null then 'self_reported'
            else 'unknown' end as channel_kind
from public.applications a
where a.record_type = 'application'
  and not coalesce(a.is_duplicate, false)
  and coalesce(a.referral_source, '') !~* '^xcel'
  and coalesce(a.source, '') !~* 'xcel|import|backfill'
  and coalesce(a.utm_source, '') !~* '^test'
  and ((select public.api_is_admin_role()) or current_user = any (array['postgres','service_role','supabase_admin']::name[]));
comment on view public.v_recruit_funnel_applications is
  'WP8: the ONE recruit application set every funnel number reads. Excludes interview_booking/test record types, is_duplicate, Xcel roster imports and CSV backfills (referral_source ^xcel, source xcel|import|backfill) and synthetic utm_source test_*. lane = self-reported license_status (licensed/pending/unlicensed). channel = utm_source, else the self-reported referral_source, else unknown; channel_kind says which. Admin/service only.';
revoke all on public.v_recruit_funnel_applications from public, anon, authenticated;
grant select on public.v_recruit_funnel_applications to service_role;

-- =====================================================================================
-- 2) Per-person snapshot: mat_recruit_funnel_person
-- =====================================================================================
create table if not exists public.recruit_funnel_snapshot_meta (
  id boolean primary key default true check (id),
  started_at timestamptz,
  refreshed_at timestamptz,
  rows integer,
  duration_ms integer,
  last_error text,
  error_at timestamptz
);
insert into public.recruit_funnel_snapshot_meta (id) values (true) on conflict (id) do nothing;
revoke all on public.recruit_funnel_snapshot_meta from public, anon, authenticated;
grant select on public.recruit_funnel_snapshot_meta to service_role;

create materialized view public.mat_recruit_funnel_person as
with params as (
  select (now() at time zone 'America/Phoenix')::date as today
),
app as (
  select f.*,
         nullif(lower(btrim(a.email)), '') as em,
         (select case when length(x.d) = 10 then x.d when length(x.d) = 11 and left(x.d, 1) = '1' then right(x.d, 10) end
            from (select regexp_replace(coalesce(a.phone, ''), '\D', '', 'g') as d) x) as ph,
         a.licensed_at as app_licensed_at,
         a.course_purchased_at,
         a.course_started_at,
         (to_jsonb(a) ->> 'human_first_contact_at')::timestamptz as human_first_contact_col,
         (to_jsonb(a) ->> 'course_proof_submitted_at')::timestamptz as course_proof_col
  from public.v_recruit_funnel_applications f
  join public.applications a on a.id = f.application_id
),
-- Agent rows that can be a recruit's hire. Merged duplicates fold onto their canonical id.
agent_rows as (
  select g.id,
         coalesce(g.canonical_agent_id, g.id) as cid,
         g.source_application_id,
         nullif(lower(btrim(p.email)), '') as em,
         (select case when length(x.d) = 10 then x.d when length(x.d) = 11 and left(x.d, 1) = '1' then right(x.d, 10) end
            from (select regexp_replace(coalesce(p.phone, ''), '\D', '', 'g') as d) x) as ph
  from public.agents g
  left join public.profiles p on p.id = g.profile_id
  where not public.is_placeholder_agent(g.agent_code, g.user_id)
),
cand as (
  select app.application_id, r.cid, 1 as prio, 'source_application_id'::text as method
    from app join agent_rows r on r.source_application_id = app.application_id
  union all
  select app.application_id, r.cid, 2, 'email' from app join agent_rows r on r.em = app.em where app.em is not null
  union all
  select app.application_id, r.cid, 2, 'phone' from app join agent_rows r on r.ph = app.ph where app.ph is not null
),
best as (select application_id, min(prio) as prio from cand group by 1),
link as (
  -- source_application_id wins; otherwise the email/phone match must name ONE person.
  select c.application_id,
         case when count(distinct c.cid) = 1 then (array_agg(c.cid))[1] end as cid,
         count(distinct c.cid)::int as n_candidates,
         string_agg(distinct c.method, '+') as method
  from cand c join best b on b.application_id = c.application_id and b.prio = c.prio
  group by c.application_id
),
agent_group as (
  select coalesce(g.canonical_agent_id, g.id) as cid, min(g.created_at) as first_created
  from public.agents g group by 1
),
canon as (
  select g.id as cid, g.user_id, g.licensed_at as agent_licensed_at,
         lower(coalesce(g.license_status::text, '')) as agent_license_status
  from public.agents g where g.canonical_agent_id is null
),
-- Human contact: the rows WP3's human_first_contact_at caches (manual contact log).
contact as (
  select l.application_id, min(l.logged_at) as first_manual_contact_at
  from public.application_contact_log l
  where coalesce(l.is_manual, false)
  group by 1
),
-- Bookings exactly as recruit_pipeline_list counts them (Licensed Call / Leader Call, not
-- cancelled), matched by application id or the same email, one row per person, so the
-- 136 Jul-Aug Leader Call rows that belong to 7 people count as 7.
iv as (
  select app.application_id,
         min(least(ie.created_at, coalesce(ie.scheduled_at, ie.created_at))) as booked_at,
         min(ie.scheduled_at) filter (where ie.scheduled_at <= now()) as first_held_at,
         min(ie.scheduled_at) filter (where ie.outcome in ('completed', 'hired')) as attended_at,
         count(*)::int as booking_rows
  from app
  join public.interview_events ie
    on ie.application_id = app.application_id
    or (app.em is not null and lower(btrim(ie.invitee_email)) = app.em)
  where ie.canceled_at is null
    and ie.call_track in ('licensed', 'leader')
    and not coalesce((to_jsonb(ie) ->> 'is_backfill_duplicate')::boolean, false)
    and least(ie.created_at, coalesce(ie.scheduled_at, ie.created_at)) >= app.applied_at - interval '14 days'
  group by app.application_id
),
proof as (
  select p.application_id, min(p.submitted_at) as proof_at
  from public.licensing_course_proofs p group by 1
),
-- Xcel enrollment by email or phone only (never the name).
xcel_raw as (
  select nullif(lower(btrim(s.email)), '') as em,
         (select case when length(x.d) = 10 then x.d when length(x.d) = 11 and left(x.d, 1) = '1' then right(x.d, 10) end
            from (select regexp_replace(coalesce(s.phone, ''), '\D', '', 'g') as d) x) as ph,
         s.date_enrolled as enrolled_on
  from public.xcel_pre_licensing_students s
  union all
  select nullif(lower(btrim(coalesce(e.email, e.student_email))), ''),
         (select case when length(x.d) = 10 then x.d when length(x.d) = 11 and left(x.d, 1) = '1' then right(x.d, 10) end
            from (select regexp_replace(coalesce(e.home_phone, ''), '\D', '', 'g') as d) x),
         coalesce(e.enrollment_date, e.start_date, case when e.kind = 'enrollment' then e.event_at::date end)
  from public.xcel_events e
),
xcel as (
  select app.application_id, min(x.enrolled_on) as xcel_enrolled_on
  from app
  join xcel_raw x on (app.em is not null and x.em = app.em) or (app.ph is not null and x.ph = app.ph)
  where x.enrolled_on is not null
  group by app.application_id
),
marks as (
  select coalesce(g.canonical_agent_id, g.id) as cid, min(m.confirmed_at) as contract_marked_at
  from public.contract_review_marks m join public.agents g on g.id = m.agent_id
  group by 1
),
prod as (
  select coalesce(cm.canonical_agent_id, m.agent_id) as cid, m.posted_date, m.origin
  from public.mat_production_unified m
  left join public.v_agent_canonical_map cm on cm.agent_id = m.agent_id
  where m.agent_id is not null
    and m.agent_id <> '00000000-0000-0000-0000-00000000a008'::uuid
    and m.posted_date is not null
),
-- Production truth: deals after a DARK origin's last post (or inside a DYING origin's
-- last 30 days) are invisible, so a 60/90-day window that reaches past that day cannot
-- prove "no deal". Only origins that attribute deals to a real agent count: an origin
-- whose rows all sit on the Vantage placeholder (external_daily_gap) can never hold a
-- recruit's deal, so its darkness hides nothing here.
truth as (
  select min(case f.verdict
               when 'DARK' then f.last_posted
               when 'DYING' then least(f.last_posted, p.today - 30) end) as suspect_since,
         string_agg(f.origin || ':' || f.verdict, ', ' order by f.origin)
           filter (where f.verdict in ('DARK', 'DYING')) as degraded_origins
  from public.v_production_origin_freshness f
  cross join params p
  where exists (select 1 from prod pr where pr.origin = f.origin)
),
person as (
  select app.application_id, app.applied_at, app.cohort_month, app.cohort_week, app.lane, app.channel, app.channel_kind,
         app.app_licensed_at, app.course_purchased_at, app.course_started_at,
         app.human_first_contact_col, app.course_proof_col,
         l.cid as agent_id,
         case when l.application_id is null then 'none'
              when l.cid is null then 'ambiguous'
              else l.method end as agent_match,
         coalesce(l.n_candidates, 0) as agent_candidates,
         ag.first_created as agent_created_at,
         (ag.first_created is not null and ag.first_created < app.applied_at - interval '3 days') as preexisting,
         cn.agent_licensed_at, cn.agent_license_status,
         (u.last_sign_in_at is not null) as ever_logged_in,
         c.first_manual_contact_at,
         iv.booked_at, iv.first_held_at, iv.attended_at, coalesce(iv.booking_rows, 0) as booking_rows,
         pf.proof_at, x.xcel_enrolled_on,
         mk.contract_marked_at,
         fd.first_deal_date, fd.first_deal_origin
  from app
  left join link l on l.application_id = app.application_id
  left join agent_group ag on ag.cid = l.cid
  left join canon cn on cn.cid = l.cid
  left join auth.users u on u.id = cn.user_id
  left join contact c on c.application_id = app.application_id
  left join iv on iv.application_id = app.application_id
  left join proof pf on pf.application_id = app.application_id
  left join xcel x on x.application_id = app.application_id
  left join marks mk on mk.cid = l.cid
  left join lateral (
    select pr.posted_date as first_deal_date, pr.origin as first_deal_origin
    from prod pr
    where pr.cid = l.cid
      and pr.posted_date >= (app.applied_at at time zone 'America/Phoenix')::date
    order by pr.posted_date, pr.origin
    limit 1
  ) fd on l.cid is not null
),
staged as (
  select p.*,
         case when not p.preexisting and p.agent_id is not null then p.agent_created_at end as hired_at
  from person p
),
stages as (
  select s.*,
         -- step 1..7, mirroring recruitJourney.ts
         s.applied_at as applied_at_s,
         least(s.human_first_contact_col, s.first_manual_contact_at) as contacted_at_s,
         s.booked_at as interview_at_s,
         case when s.lane = 'licensed' then null
              else least(s.proof_at, s.course_proof_col, s.course_purchased_at, s.course_started_at,
                         (s.xcel_enrolled_on::timestamp at time zone 'America/Phoenix'),
                         case when s.hired_at is not null and s.agent_license_status <> 'licensed' then s.hired_at end)
         end as licensing_at_s,
         case when s.lane = 'licensed' then s.first_held_at   -- licensed by their own word + the interview has happened
              else least(s.app_licensed_at,
                         case when s.hired_at is not null and s.agent_license_status = 'licensed'
                              then coalesce(s.agent_licensed_at, s.hired_at) end)
         end as licensed_at_s,
         case when s.hired_at is not null and s.agent_license_status = 'licensed' then s.hired_at end as contracted_at_s,
         case when s.hired_at is not null and s.first_deal_date is not null
              then (s.first_deal_date::timestamp at time zone 'America/Phoenix') end as first_deal_at_s
  from staged s
)
select st.application_id,
       st.cohort_month,
       st.cohort_week,
       st.lane,
       st.channel,
       st.channel_kind,
       st.applied_at_s as applied_at,
       st.contacted_at_s as contacted_at,
       st.interview_at_s as interview_at,
       st.licensing_at_s as licensing_at,
       st.licensed_at_s as licensed_at,
       st.contracted_at_s as contracted_at,
       st.first_deal_at_s as first_deal_at,
       st.attended_at,
       st.hired_at,
       st.agent_id,
       st.agent_match,
       st.agent_candidates,
       st.preexisting,
       st.ever_logged_in,
       st.contract_marked_at,
       st.booking_rows,
       st.first_deal_date,
       st.first_deal_origin,
       -- first deal within N days of APPLYING (the recruit funnel's own clock). A dark
       -- production origin can only hide a deal from someone who HAS an agent row, so
       -- 'unprovable' applies to hires; nobody else can carry a deal in any origin.
       case when st.agent_match = 'ambiguous' then 'ambiguous_identity'
            when st.preexisting then 'excluded_preexisting'
            when st.first_deal_at_s is not null and st.first_deal_date <= (st.applied_at at time zone 'America/Phoenix')::date + 60 then 'yes'
            when (st.applied_at at time zone 'America/Phoenix')::date + 60 > pr.today then 'window_open'
            when st.hired_at is not null and t.suspect_since is not null
                 and (st.applied_at at time zone 'America/Phoenix')::date + 60 > t.suspect_since then 'unprovable'
            else 'no' end as deal60_state,
       case when st.agent_match = 'ambiguous' then 'ambiguous_identity'
            when st.preexisting then 'excluded_preexisting'
            when st.first_deal_at_s is not null and st.first_deal_date <= (st.applied_at at time zone 'America/Phoenix')::date + 90 then 'yes'
            when (st.applied_at at time zone 'America/Phoenix')::date + 90 > pr.today then 'window_open'
            when st.hired_at is not null and t.suspect_since is not null
                 and (st.applied_at at time zone 'America/Phoenix')::date + 90 > t.suspect_since then 'unprovable'
            else 'no' end as deal90_state,
       -- first deal within 60 days of the HIRE (agent row), for hires only
       case when st.hired_at is null then null
            when st.first_deal_date is not null and st.first_deal_date <= (st.hired_at at time zone 'America/Phoenix')::date + 60 then 'yes'
            when (st.hired_at at time zone 'America/Phoenix')::date + 60 > pr.today then 'window_open'
            when t.suspect_since is not null and (st.hired_at at time zone 'America/Phoenix')::date + 60 > t.suspect_since then 'unprovable'
            else 'no' end as hire_deal60_state,
       t.suspect_since as truth_suspect_since,
       t.degraded_origins,
       now() as snapshot_at
from stages st
cross join params pr
cross join truth t
with data;

create unique index if not exists mat_recruit_funnel_person_app on public.mat_recruit_funnel_person (application_id);
create index if not exists mat_recruit_funnel_person_cohort on public.mat_recruit_funnel_person (cohort_month, lane);
comment on materialized view public.mat_recruit_funnel_person is
  'WP8: one row per recruit application (v_recruit_funnel_applications), PII-free. <step>_at columns follow src/lib/recruitJourney.ts: applied; contacted = first MANUAL application_contact_log row (or applications.human_first_contact_at once WP3 adds it); interview = first Licensed/Leader Call booking, not cancelled, per person; licensing = course proof / course purchase / Xcel enrollment by email or phone / hired while unlicensed (unlicensed + pending lanes only); licensed = licensed lane: the interview has happened (recruitJourney rule), other lanes: a license stamp; contracted = hired as an agent who is licensed; first_deal = first mat_production_unified deal on/after applying via canonical id. Agent link = source_application_id, else a UNIQUE email/phone match (never a name); an agent row created >3 days before the application is preexisting and earns no hire or deal. deal60/deal90 = first deal within N days of applying: yes/no/window_open/unprovable (window overlaps a DARK/DYING production origin)/excluded. Refreshed nightly at 03:20 UTC after next_step_recompute_all. Read it only through v_recruit_funnel_cohort.';
revoke all on public.mat_recruit_funnel_person from public, anon, authenticated;
grant select on public.mat_recruit_funnel_person to service_role;

create or replace function public.refresh_recruit_funnel_snapshot()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare t0 timestamptz := clock_timestamp(); n integer; ms integer;
begin
  update public.recruit_funnel_snapshot_meta set started_at = t0 where id;
  refresh materialized view concurrently public.mat_recruit_funnel_person;
  select count(*)::int into n from public.mat_recruit_funnel_person;
  ms := (extract(epoch from (clock_timestamp() - t0)) * 1000)::int;
  update public.recruit_funnel_snapshot_meta
     set refreshed_at = clock_timestamp(), rows = n, duration_ms = ms, last_error = null
   where id;
  return jsonb_build_object('rows', n, 'duration_ms', ms);
exception when others then
  update public.recruit_funnel_snapshot_meta set last_error = sqlerrm, error_at = now() where id;
  return jsonb_build_object('error', sqlerrm);
end
$function$;
revoke all on function public.refresh_recruit_funnel_snapshot() from public, anon, authenticated;
grant execute on function public.refresh_recruit_funnel_snapshot() to service_role;

-- The migration's own build counts as the first refresh.
update public.recruit_funnel_snapshot_meta
   set refreshed_at = now(), started_at = now(), rows = (select count(*)::int from public.mat_recruit_funnel_person),
       duration_ms = null, last_error = null
 where id;

-- Freshness: one row in every state (never blank-green): never / error / stale / fresh.
-- Owner-run (reads cron.job); granted to service_role only, no PII.
create view public.v_recruit_funnel_freshness as
select m.refreshed_at, m.started_at, m.rows, m.duration_ms, m.last_error, m.error_at,
       round((extract(epoch from (now() - m.refreshed_at)) / 3600)::numeric, 1) as age_hours,
       case when m.refreshed_at is null then 'never'
            when m.last_error is not null and (m.error_at is null or m.error_at > m.refreshed_at) then 'error'
            when now() - m.refreshed_at > interval '48 hours' then 'stale'
            else 'fresh' end as verdict,
       (select count(*)::int from cron.job where jobname = 'wp8-recruit-funnel-refresh' and active) as cron_active
from public.recruit_funnel_snapshot_meta m;
revoke all on public.v_recruit_funnel_freshness from public, anon, authenticated;
grant select on public.v_recruit_funnel_freshness to service_role;

-- Nightly, 20 minutes after next_step_recompute_all (cron 25, 03:00 UTC, measured ~2.5s).
do $cron$
begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'wp8-recruit-funnel-refresh';
  perform cron.schedule('wp8-recruit-funnel-refresh', '20 3 * * *', 'select public.refresh_recruit_funnel_snapshot()');
end
$cron$;

-- =====================================================================================
-- 3) v_recruit_funnel_cohort (admin-gated)
-- =====================================================================================
create view public.v_recruit_funnel_cohort
with (security_barrier = true) as
with today as (select (now() at time zone 'America/Phoenix')::date as d),
-- Which stage writers are alive, read from their own receipts at query time.
src as (
  select
    coalesce((select max(l.logged_at) from public.application_contact_log l where coalesce(l.is_manual, false)), 'epoch'::timestamptz)
      < now() - interval '30 days' as source_dead_contacted,
    (with past as (
       select ie.outcome from public.interview_events ie
       where ie.canceled_at is null and ie.call_track in ('licensed', 'leader')
         and ie.scheduled_at between now() - interval '30 days' and now() - interval '2 hours')
     select count(*) = 0 or count(*) filter (where outcome is not null)::numeric / count(*) < 0.2 from past) as source_dead_attended,
    coalesce((select max(r.report_date) from public.xcel_pre_licensing_reports r), date '1970-01-01')
      < (select d from today) - 7 as source_dead_licensing,
    coalesce(greatest((select max(a.licensed_at) from public.applications a), (select max(g.licensed_at) from public.agents g)), 'epoch'::timestamptz)
      < now() - interval '60 days' as source_dead_licensed,
    coalesce((select max(g.created_at) from public.agents g), 'epoch'::timestamptz)
      < now() - interval '30 days' as source_dead_contracted
),
base as (
  select f.*,
         (f.first_deal_at is not null) as r7,
         (f.contracted_at is not null or f.first_deal_at is not null) as r6,
         (f.licensed_at is not null or f.contracted_at is not null or f.first_deal_at is not null) as r5,
         (f.licensing_at is not null or f.licensed_at is not null or f.contracted_at is not null or f.first_deal_at is not null) as r4
  from public.mat_recruit_funnel_person f
),
reach as (
  select b.*,
         (b.interview_at is not null or b.r4) as r3,
         (b.contacted_at is not null or b.interview_at is not null or b.r4) as r2
  from base b
),
agg as (
  select r.cohort_month,
         r.lane,
         case when grouping(r.channel) = 1 then '(all)' else r.channel end as channel,
         count(*)::int as applications,
         -- reached = on this step or further, the same positional reading the recruit bar uses
         count(*) filter (where r.r2)::int as reached_contacted,
         count(*) filter (where r.r3)::int as reached_interview,
         case when r.lane = 'licensed' then null else count(*) filter (where r.r4)::int end as reached_licensing,
         count(*) filter (where r.r5)::int as reached_licensed,
         count(*) filter (where r.r6)::int as reached_contracted,
         count(*) filter (where r.r7)::int as reached_first_deal,
         -- raw evidence, no positional inference
         count(*) filter (where r.contacted_at is not null)::int as human_contacted,
         count(*) filter (where r.interview_at is not null)::int as booked_people,
         sum(r.booking_rows)::int as booking_rows,
         count(*) filter (where r.attended_at is not null)::int as attended,
         count(*) filter (where r.hired_at is not null)::int as hired_any,
         count(*) filter (where r.hired_at is not null and r.ever_logged_in)::int as hired_logged_in,
         count(*) filter (where r.contract_marked_at is not null)::int as contract_marked,
         count(*) filter (where r.agent_match = 'ambiguous')::int as ambiguous_identity,
         count(*) filter (where r.preexisting)::int as preexisting_agents,
         -- median days per transition (only where both ends exist and in order)
         round((percentile_cont(0.5) within group (order by extract(epoch from (r.contacted_at - r.applied_at)) / 86400)
                filter (where r.contacted_at >= r.applied_at))::numeric, 1) as med_days_applied_to_contacted,
         round((percentile_cont(0.5) within group (order by extract(epoch from (r.interview_at - r.applied_at)) / 86400)
                filter (where r.interview_at >= r.applied_at))::numeric, 1) as med_days_applied_to_interview,
         round((percentile_cont(0.5) within group (order by extract(epoch from (r.licensing_at - r.applied_at)) / 86400)
                filter (where r.licensing_at >= r.applied_at))::numeric, 1) as med_days_applied_to_licensing,
         round((percentile_cont(0.5) within group (order by extract(epoch from (r.licensed_at - r.licensing_at)) / 86400)
                filter (where r.licensed_at >= r.licensing_at))::numeric, 1) as med_days_licensing_to_licensed,
         round((percentile_cont(0.5) within group (order by extract(epoch from (r.contracted_at - r.applied_at)) / 86400)
                filter (where r.contracted_at >= r.applied_at))::numeric, 1) as med_days_applied_to_contracted,
         round((percentile_cont(0.5) within group (order by extract(epoch from (r.first_deal_at - r.hired_at)) / 86400)
                filter (where r.first_deal_at >= r.hired_at))::numeric, 1) as med_days_hired_to_first_deal,
         count(*) filter (where r.deal60_state = 'yes')::int as deal60_yes,
         count(*) filter (where r.deal60_state = 'no')::int as deal60_no,
         count(*) filter (where r.deal60_state = 'unprovable')::int as deal60_unprovable,
         count(*) filter (where r.deal60_state = 'window_open')::int as deal60_window_open,
         count(*) filter (where r.deal90_state = 'yes')::int as deal90_yes,
         count(*) filter (where r.deal90_state = 'no')::int as deal90_no,
         count(*) filter (where r.deal90_state = 'unprovable')::int as deal90_unprovable,
         count(*) filter (where r.deal90_state = 'window_open')::int as deal90_window_open,
         count(*) filter (where r.hire_deal60_state = 'yes')::int as hire_deal60_yes,
         count(*) filter (where r.hire_deal60_state = 'no')::int as hire_deal60_no,
         count(*) filter (where r.hire_deal60_state = 'unprovable')::int as hire_deal60_unprovable,
         count(*) filter (where r.hire_deal60_state = 'window_open')::int as hire_deal60_window_open,
         max(r.truth_suspect_since) as truth_suspect_since,
         max(r.degraded_origins) as degraded_origins,
         max(r.snapshot_at) as snapshot_at
  from reach r
  group by grouping sets ((r.cohort_month, r.lane, r.channel), (r.cohort_month, r.lane))
),
graded as (
  select a.*,
         case when a.deal60_window_open > 0 then 'window_open'
              when a.deal60_unprovable > 0 then 'unprovable'
              when a.deal60_yes + a.deal60_no = 0 then 'no_eligible'
              else 'measured' end as deal60_state,
         case when a.deal90_window_open > 0 then 'window_open'
              when a.deal90_unprovable > 0 then 'unprovable'
              when a.deal90_yes + a.deal90_no = 0 then 'no_eligible'
              else 'measured' end as deal90_state,
         case when a.hire_deal60_window_open > 0 then 'window_open'
              when a.hire_deal60_unprovable > 0 then 'unprovable'
              when a.hire_deal60_yes + a.hire_deal60_no = 0 then 'no_eligible'
              else 'measured' end as hire_deal60_state
  from agg a
)
select g.cohort_month, g.lane, g.channel,
       g.applications,
       g.reached_contacted, g.reached_interview, g.reached_licensing, g.reached_licensed, g.reached_contracted, g.reached_first_deal,
       g.human_contacted, g.booked_people, g.booking_rows, g.attended, g.hired_any, g.hired_logged_in, g.contract_marked,
       g.ambiguous_identity, g.preexisting_agents,
       g.med_days_applied_to_contacted, g.med_days_applied_to_interview, g.med_days_applied_to_licensing,
       g.med_days_licensing_to_licensed, g.med_days_applied_to_contracted, g.med_days_hired_to_first_deal,
       g.deal60_state,
       case when g.deal60_state = 'measured' then round(g.deal60_yes::numeric / (g.deal60_yes + g.deal60_no), 3) end as deal60_rate,
       g.deal60_yes, g.deal60_no, g.deal60_unprovable, g.deal60_window_open,
       g.deal90_state,
       case when g.deal90_state = 'measured' then round(g.deal90_yes::numeric / (g.deal90_yes + g.deal90_no), 3) end as deal90_rate,
       g.deal90_yes, g.deal90_no, g.deal90_unprovable, g.deal90_window_open,
       g.hire_deal60_state,
       case when g.hire_deal60_state = 'measured' then round(g.hire_deal60_yes::numeric / (g.hire_deal60_yes + g.hire_deal60_no), 3) end as hire_deal60_rate,
       g.hire_deal60_yes, g.hire_deal60_no, g.hire_deal60_unprovable, g.hire_deal60_window_open,
       (g.truth_suspect_since is not null) as production_truth_degraded,
       g.truth_suspect_since, g.degraded_origins,
       s.source_dead_contacted, s.source_dead_attended, s.source_dead_licensing, s.source_dead_licensed, s.source_dead_contracted,
       g.snapshot_at
from graded g
cross join src s
where (select public.api_is_admin_role())
   or current_user = any (array['postgres','service_role','supabase_admin']::name[]);
comment on view public.v_recruit_funnel_cohort is
  'WP8: THE recruit funnel. One row per (Phoenix cohort_month, self-reported lane, channel) plus a channel=''(all)'' rollup per month+lane. reached_* = people on that step or further (the recruit bar''s positional reading, stage definitions in mat_recruit_funnel_person); human_contacted / booked_people / attended are raw evidence (booked_people counts distinct people; booking_rows shows the raw row count). deal60/deal90 = first deal within N days of applying; hire_deal60 = within 60 days of the agent row. *_state: measured (rate filled) / window_open / unprovable (a production origin was DARK/DYING inside the window: the yes count is a floor, never read it as no-deal) / no_eligible. source_dead_* flags a stage whose writer has no fresh receipt. Admin/service only; agents and the manager role read 0 rows.';
revoke all on public.v_recruit_funnel_cohort from public, anon, authenticated;
grant select on public.v_recruit_funnel_cohort to authenticated, service_role;

-- =====================================================================================
-- 4) Inflow alarm
-- =====================================================================================
create view public.v_inflow_by_channel_weekly
with (security_barrier = true) as
select f.cohort_week as week_start,
       f.channel,
       min(f.channel_kind) as channel_kind,
       count(*)::int as applications,
       count(*) filter (where f.lane = 'licensed')::int as licensed,
       count(*) filter (where f.lane = 'pending')::int as pending,
       count(*) filter (where f.lane = 'unlicensed')::int as unlicensed,
       (f.cohort_week + 7 <= (now() at time zone 'America/Phoenix')::date) as is_complete_week
from public.v_recruit_funnel_applications f
where (select public.api_is_admin_role())
   or current_user = any (array['postgres','service_role','supabase_admin']::name[])
group by f.cohort_week, f.channel;
comment on view public.v_inflow_by_channel_weekly is
  'WP8: recruit applications per Phoenix week (Monday start) per channel, from the one application set (v_recruit_funnel_applications). Weeks with zero applications have no row; fn_inflow_alert_asof fills them. Admin/service only.';
revoke all on public.v_inflow_by_channel_weekly from public, anon, authenticated;
grant select on public.v_inflow_by_channel_weekly to authenticated, service_role;

create or replace function public.fn_inflow_alert_asof(p_asof date default null)
returns table (
  as_of date,
  last_full_week_start date,
  last_4wk_total integer,
  last_4wk_avg numeric,
  trailing_12wk_total integer,
  trailing_12wk_avg numeric,
  ratio numeric,
  baseline_26wk_avg numeric,
  ratio_vs_26wk numeric,
  verdict text,
  weekly_last_16 jsonb,
  channel_drops jsonb
)
language sql
stable
security invoker
set search_path to 'public'
as $function$
  with p as (
    select coalesce(p_asof, (now() at time zone 'America/Phoenix')::date) as d
  ),
  wk as (
    select p.d, date_trunc('week', p.d)::date as cur_week from p
  ),
  w as (
    select v.week_start, v.channel, v.applications from public.v_inflow_by_channel_weekly v
  ),
  series as (
    select gs::date as week_start
    from wk, generate_series((wk.cur_week - 7 * 30)::timestamp, (wk.cur_week - 7)::timestamp, interval '7 days') gs
  ),
  filled as (
    select s.week_start, coalesce(sum(w.applications), 0)::int as n
    from series s left join w on w.week_start = s.week_start
    group by s.week_start
  ),
  win as (
    select
      coalesce(sum(f.n) filter (where f.week_start >= wk.cur_week - 28), 0)::int as last4,
      coalesce(sum(f.n) filter (where f.week_start >= wk.cur_week - 7 * 16 and f.week_start < wk.cur_week - 28), 0)::int as trail12,
      coalesce(sum(f.n) filter (where f.week_start >= wk.cur_week - 7 * 30 and f.week_start < wk.cur_week - 28), 0)::int as base26,
      jsonb_agg(jsonb_build_object('week', f.week_start, 'n', f.n) order by f.week_start)
        filter (where f.week_start >= wk.cur_week - 7 * 16) as last16
    from filled f, wk
  ),
  ch as (
    select w.channel,
           coalesce(sum(w.applications) filter (where w.week_start >= wk.cur_week - 28 and w.week_start < wk.cur_week), 0)::int as last4,
           coalesce(sum(w.applications) filter (where w.week_start >= wk.cur_week - 7 * 16 and w.week_start < wk.cur_week - 28), 0)::int as trail12
    from w, wk
    group by w.channel
  )
  select wk.d,
         wk.cur_week - 7,
         win.last4,
         round(win.last4 / 4.0, 2),
         win.trail12,
         round(win.trail12 / 12.0, 2),
         case when win.trail12 > 0 then round((win.last4 / 4.0) / (win.trail12 / 12.0), 3) end,
         round(win.base26 / 26.0, 2),
         case when win.base26 > 0 then round((win.last4 / 4.0) / (win.base26 / 26.0), 3) end,
         case when win.trail12 < 12 then 'insufficient_data'
              when (win.last4 / 4.0) < 0.5 * (win.trail12 / 12.0) then 'drop'
              else 'ok' end,
         win.last16,
         coalesce((select jsonb_agg(jsonb_build_object('channel', ch.channel, 'last_4wk', ch.last4,
                                                       'trailing_12wk_per_4wk', round(ch.trail12 / 3.0, 1))
                                    order by ch.trail12 desc)
                   from ch where ch.trail12 >= 6 and (ch.last4 / 4.0) < 0.5 * (ch.trail12 / 12.0)), '[]'::jsonb)
  from wk, win
$function$;
comment on function public.fn_inflow_alert_asof(date) is
  'WP8: the inflow alarm as of a date (default: today, Phoenix). last 4 COMPLETE weeks vs the 12 complete weeks before them; verdict drop when the 4-week average is under 50% of the trailing 12-week average, insufficient_data when the trailing window holds < 12 applications. baseline_26wk / ratio_vs_26wk are context (a 12-week baseline normalises to a cliff ~16 weeks after it). Backtest: select * from fn_inflow_alert_asof(''2026-08-10''). Invoker: reads the admin-gated weekly view, so a non-admin gets insufficient_data, never numbers.';
revoke all on function public.fn_inflow_alert_asof(date) from public, anon;
grant execute on function public.fn_inflow_alert_asof(date) to authenticated, service_role;

create view public.v_inflow_alert
with (security_invoker = true) as
select * from public.fn_inflow_alert_asof(null);
comment on view public.v_inflow_alert is
  'WP8: one row, today''s inflow alarm (see fn_inflow_alert_asof). apex-doctor drop-in #49 WARNs on verdict=drop.';
revoke all on public.v_inflow_alert from public, anon, authenticated;
grant select on public.v_inflow_alert to authenticated, service_role;

-- =====================================================================================
-- 5) Owned-link UTMs (N9: Sam pastes these into the surfaces only he controls)
-- =====================================================================================
-- Capture already works (e4d4a4ae, 2026-08-04): utm_* lands on 12/36 Aug, 21/31 Sep,
-- 22/31 Oct applications. The gap is Sam's own links. Sources/mediums that are already
-- live in applications.utm_* are kept verbatim so history stays continuous
-- (sell4daddy/hub/join_the_team x7, sell4daddy/funnel/insurance x20, instagram/dm/
-- recruiting_dm x4 from manychat-webhook:153). Insert-only: never overwrites an edit.
insert into public.system_settings (key, value, updated_at)
values ('owned_link_utms', $json${
  "version": 1,
  "set_by": "WP8 onboarding audit 2026-11-10",
  "rule": "Every link Sam controls points at one of these URLs, unchanged. applications.utm_source/utm_medium/utm_campaign then name the surface for every application that came through it. v_inflow_by_channel_weekly groups by utm_source.",
  "apply_base": "https://apex-financial.org/apply",
  "links": {
    "ig_bio":            {"surface": "Instagram bio link (@sell4daddy)", "url": "https://apex-financial.org/apply?utm_source=ig&utm_medium=bio&utm_campaign=recruiting", "utm_source": "ig", "utm_medium": "bio", "utm_campaign": "recruiting", "status": "not_placed", "placed_by": "Sam (N9)", "note": "19 applications Jul-Oct carry ig/social with no campaign; this replaces that untagged-campaign link"},
    "ig_story":          {"surface": "Instagram story link sticker", "url": "https://apex-financial.org/apply?utm_source=ig&utm_medium=story&utm_campaign=recruiting", "utm_source": "ig", "utm_medium": "story", "utm_campaign": "recruiting", "status": "not_placed", "placed_by": "Sam (N9)"},
    "sell4daddy_hub":    {"surface": "sell4daddy link hub, Join the team button", "url": "https://apex-financial.org/apply?utm_source=sell4daddy&utm_medium=hub&utm_campaign=join_the_team", "utm_source": "sell4daddy", "utm_medium": "hub", "utm_campaign": "join_the_team", "status": "live", "note": "already live: 7 applications 10-16..11-04"},
    "sell4daddy_funnel": {"surface": "sell4daddy insurance funnel", "url": "https://apex-financial.org/apply?utm_source=sell4daddy&utm_medium=funnel&utm_campaign=insurance", "utm_source": "sell4daddy", "utm_medium": "funnel", "utm_campaign": "insurance", "status": "live", "note": "already live: 20 applications 09-27..10-15"},
    "snapchat_profile":  {"surface": "Snapchat profile link", "url": "https://apex-financial.org/apply?utm_source=snapchat&utm_medium=social&utm_campaign=recruiting", "utm_source": "snapchat", "utm_medium": "social", "utm_campaign": "recruiting", "status": "not_placed", "placed_by": "Sam (N9)", "note": "19 applications carry snapchat/social with no campaign; this adds the campaign"},
    "tiktok_bio":        {"surface": "TikTok bio link", "url": "https://apex-financial.org/apply?utm_source=tiktok&utm_medium=bio&utm_campaign=recruiting", "utm_source": "tiktok", "utm_medium": "bio", "utm_campaign": "recruiting", "status": "not_placed", "placed_by": "Sam (N9)"},
    "manychat_comment":  {"surface": "ManyChat comment-trigger flow reply link", "url": "https://apex-financial.org/apply?utm_source=instagram&utm_medium=manychat&utm_campaign=comment_trigger", "utm_source": "instagram", "utm_medium": "manychat", "utm_campaign": "comment_trigger", "status": "not_placed", "placed_by": "Sam (N9): ManyChat flows are not API-readable on this plan"},
    "dm_brain":          {"surface": "manychat-webhook inbound DM routing reply", "url": "https://apex-financial.org/apply?utm_source=instagram&utm_medium=dm&utm_campaign=recruiting_dm", "utm_source": "instagram", "utm_medium": "dm", "utm_campaign": "recruiting_dm", "status": "live_in_code", "note": "supabase/functions/manychat-webhook/index.ts:153 already emits this (source varies by platform)"}
  }
}$json$, now())
on conflict (key) do nothing;

-- =====================================================================================
-- 6) Deprecate the four wrong funnel views (no behaviour change) + flag the bulk entries
-- =====================================================================================
-- Preimage (comments before this migration): v_application_conversion_funnel NULL;
-- v_next_step_funnel_health NULL; v_funnel_by_source NULL; v_applications_real =
-- 'Canonical application set: public.applications minus interview-booking backfills and
-- test rows. INTERNAL ONLY (definer-security, not granted to anon/authenticated) so the
-- definer dashboards that read it keep their prior RLS posture. Frontend must filter the
-- base table with record_type = ''application''.'
comment on view public.v_application_conversion_funnel is
  'DEPRECATED (WP8 2026-11-10): counts batch-stamped contacted_at (98.5% "contacted" vs ~3% logged human contact), unmaintained status values and legacy ica_paid, and includes is_duplicate rows. Use v_recruit_funnel_cohort. Readers: src/pages/StaleRecovery.tsx (its tiles also read columns this view never had).';
comment on view public.v_next_step_funnel_health is
  'DEPRECATED (WP8 2026-11-10) as a conversion source: conversion_to_next_pct divides the CURRENT population of the next stage by this stage''s population, so it is a point-in-time ratio, never a cohort conversion (passed_exam read 100% on 3 vs 36). in_stage/stalled remain valid population counts. For conversion use v_recruit_funnel_cohort.';
comment on view public.v_funnel_by_source is
  'DEPRECATED (WP8 2026-11-10): moved_past_new reads applications.status, which nothing has maintained since ~July (status=new on 172/178 apps in 120d). Use v_recruit_funnel_cohort (by channel) or v_inflow_by_channel_weekly.';
comment on view public.v_applications_real is
  'DEPRECATED (WP8 2026-11-10) for funnel counting: its column list is frozen at creation (lacks columns added since, e.g. last_contact_outcome, recruiting_owner_user_id) and it keeps is_duplicate and Xcel-import rows. The funnel''s one application set is v_recruit_funnel_applications. Previous description, still true: Canonical application set: public.applications minus interview-booking backfills and test rows. INTERNAL ONLY (definer-security, not granted to anon/authenticated) so the definer dashboards that read it keep their prior RLS posture. Frontend must filter the base table with record_type = ''application''.';

-- manual_interview_entries: 83 rows typed 'new', created one per minute 2026-06-01..06-18
-- with scheduled_at = created_at, created_by NULL, and 0 calls / outcomes / confirmations /
-- Resend ids / hires (measured 2026-11-10). They inflate any June "booked" count (~76 vs
-- ~16 real). Additive flag, no deletes.
-- Preimage constraint manual_interview_entries_type_chk:
--   CHECK ((interview_type = ANY (ARRAY['licensed_prospect','licensed_call','leader_call',
--   'unlicensed_lead','final_expense_review','callback','general','new','reviewing',
--   'interview','contracting','approved','rejected','no_pickup','lead','registered',
--   'attended','attended_no_show','paid','onboarding','producing','lapsed','disqualified',
--   'quick_qualified'])))
-- Preimage rows (all interview_type='new', ordered by created_at):
--   1a84b501-7d61-46bc-ad4e-4d3d230bf8c6 ec82501e-ff6c-471e-b512-ebf1eeb58918 f0e053da-29b6-4c14-a8c1-33bf1defa533
--   c91c0baf-f6ee-4eb2-bb94-8f88e5a14233 a9dbe5b9-d84e-4689-97b8-1da7cc452ef4 48cd8c48-2d6e-4b96-9cc1-e6a1b2c45ac9
--   4c628dfc-3870-4aca-a9aa-2d43c7986222 50787c6a-d2c7-42f9-b4d2-768cab9e63bb 80cf14fb-8b69-4e0a-afce-0556456ab227
--   72887e5f-3832-4fba-b451-8f13779f640c a34ea995-9c63-4cb3-8b32-d3a5a5c6aee3 d0e2cd8d-fe04-4447-9a2c-90ff1f5da39b
--   5c197393-bdd2-4c6b-87c4-ea6b9bb20e28 4cf35700-fc04-48ae-82a7-48fe14a85f2c e2a3722d-3eb0-43c7-a7f3-78ea654fbb97
--   3bda0016-f179-4a3e-b9e8-6618e178a5fd cbbaa6a0-01ad-4cb4-b12d-6dbddf98928d 0a6759cf-15da-41e2-807a-004564392279
--   3069358a-7475-4a42-b47a-a8b5dd901e60 e21460db-2cd4-4bba-a28b-103d19685809 ecfe4f28-2b27-4406-9b68-4dbbda955645
--   be3dd4a0-5328-4cda-b339-d17b0b860140 76683bb7-2785-44c0-9951-89f48a38c78a 8b4f85ab-f3bb-48c8-9111-74494b73b654
--   5701680d-5027-4ff8-90a7-be4d09115817 0d7ebc79-78b0-4cfd-8caf-806b05136801 3a5b4dab-4796-4639-b0a1-3da8593f9c80
--   74d14e53-41dd-4fc9-bebc-bb5377c1cd75 03bc9482-7b0e-4db0-bd03-f6a31170fcb1 8e0831f5-fd22-443e-9034-238e4afae961
--   7a082545-bb70-4dba-bfea-f51429ba9772 1b46ade2-b22d-42d4-990f-e1318db7bc81 d07e8f51-e498-4489-954b-c8018b529027
--   ff0dac38-199a-4c67-9c81-eb9b89a25568 3e6a1fc2-7cd6-490d-8026-af287245c410 2c9316d6-1994-4bde-bfca-d4ad6c560ea6
--   9097c1d6-366a-48a0-8717-ba2196627a77 203d2060-5a5f-4a6b-a80a-d07b47d5e7b1 71646c93-4705-4032-b57a-5f8b04ad5974
--   2efccf9b-2f97-4801-bd34-98fddfe57dff f2c95d59-5fff-4de3-a3c4-2fa9fb73227d e273fd30-2aa0-4759-b763-753268f09810
--   8fc45bdc-f8ec-4525-bd79-153469d4a95f 81d35907-7f55-4b87-827b-68daa735289d 63fce3af-49c8-4c4b-9253-7b161bb7a2a3
--   381f9579-174d-451a-b5c9-1ab5ae99a801 c67dba21-a310-4760-945b-6392b527c4cc 19a2b16c-6b45-4854-8c03-350c70770ec7
--   61ce38bd-b051-4bdf-b41f-c3efec1251c9 d690a32b-623a-48cb-841f-9d5c78f57272 16b1b6d2-ddf1-4f69-8f95-f322ff386a05
--   5a588208-d2be-4d5c-82cc-886ff48d65c2 0bc0a15c-d4eb-4fca-aca9-3ba557a2f085 5a983af9-2f29-4499-b86d-1a6895ac79b5
--   b8e1002b-0d73-472e-a438-370e321ed104 26480402-cd19-4790-b0be-a24bad6dc9fb 58dc0b8b-a57f-4340-a738-da8a52c5adac
--   c788f100-1d53-47e4-8f1f-bdf18c3c11b3 c91b815b-e462-432c-b81d-aad80c7c3a1b 882ab8f7-a372-4479-b1fb-b09981645512
--   8c7e4813-fd2b-4e06-9848-0633d51670bd 2153fca7-d92f-42fe-ac34-e953fcba0768 793d1c7c-761d-4d02-9054-0639b6e399f9
--   0a384458-6be8-4264-a800-f5568b04e1d5 bdf3ff21-0cc1-4e8a-be0d-db56fb263685 3b74d534-8343-4ab5-9206-cfff54bfa4a1
--   abb1bf33-b214-4a0d-b041-9ee7ab29d03d 4d29ee82-1c6b-4def-8a02-4c1ef5c51068 b303f436-b9c8-4af9-8a6c-e535da725b23
--   8a0484df-3d6b-414a-8155-6e39c332e014 227f5655-6dbf-4e2d-b1d9-f281e38928a6 8a0d00fd-61b8-4a9c-a71d-ff2c64ae1c20
--   e4d26d43-985f-4662-8cd8-e69c46629503 07415af4-6a93-4478-8577-0719baf77f22 82c7d5dc-cba0-4441-91a4-883c5bbc7b1f
--   933c37cb-16b8-4e27-aa9d-d637cf13987d e5c20339-8004-419e-aaed-dd5aca8c952b fadf694e-164e-4df8-8524-95e321bf945d
--   b6e35ce9-41c2-4cd0-bed6-c4911d900a12 eb3c8337-ff57-4be8-a91c-6d657a4e795e bc39dfce-76a9-436e-999b-9940fb05a318
--   1600c1a4-a0a0-444d-b198-8f7aa9500784 2f96180b-6b74-4aee-a086-fd1fa568728e
do $preimage$
begin
  if to_regclass('public.ops_preimage_snapshots') is not null
     and not exists (select 1 from public.ops_preimage_snapshots where reason = 'wp8_manual_interview_entries_bulk_unverified') then
    insert into public.ops_preimage_snapshots (reason, payload)
    select 'wp8_manual_interview_entries_bulk_unverified',
           jsonb_build_object(
             'constraint', (select pg_get_constraintdef(c.oid) from pg_constraint c
                             where c.conrelid = 'public.manual_interview_entries'::regclass
                               and c.conname = 'manual_interview_entries_type_chk'),
             'rows', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'interview_type', m.interview_type,
                                                                  'created_at', m.created_at) order by m.created_at)
                               from public.manual_interview_entries m
                               where m.interview_type = 'new'), '[]'::jsonb));
  end if;
end
$preimage$;

alter table public.manual_interview_entries drop constraint if exists manual_interview_entries_type_chk;
alter table public.manual_interview_entries add constraint manual_interview_entries_type_chk
  check (interview_type = any (array['licensed_prospect','licensed_call','leader_call','unlicensed_lead',
    'final_expense_review','callback','general','new','reviewing','interview','contracting','approved',
    'rejected','no_pickup','lead','registered','attended','attended_no_show','paid','onboarding',
    'producing','lapsed','disqualified','quick_qualified','bulk_unverified']::text[]));

update public.manual_interview_entries m
   set interview_type = 'bulk_unverified'
 where m.interview_type = 'new'
   and m.created_at >= timestamptz '2026-06-01 00:00:00+00'
   and m.created_at <  timestamptz '2026-06-19 00:00:00+00'
   and m.created_by is null
   and m.called_at is null and m.called_outcome is null
   and m.confirmation_sent_at is null and m.resend_message_id is null
   and m.hired_at is null and m.passed_at is null and m.contracted_at is null
   and m.no_show_at is null and m.contacted_at is null;
comment on column public.manual_interview_entries.interview_type is
  'Interview kind. ''bulk_unverified'' (WP8 2026-11-10) marks the 83 rows bulk-created 2026-06-01..06-18 with no call, outcome or confirmation ever recorded; never count them as bookings. Original value ''new'' is in ops_preimage_snapshots reason=wp8_manual_interview_entries_bulk_unverified.';

-- =====================================================================================
-- 7) fn_reconcile_first_deal_at reads the unified production truth (forward-only)
-- =====================================================================================
-- Before: it read v_production_canonical only, while v_production_origin_freshness and
-- every funnel read mat_production_unified. The difference is the agentcloud_producer
-- origin (Vantage producers reported through the AgentCloud API). Measured 2026-11-10:
-- switching the source changes exactly ONE agent (first deal 2026-09-05, first_deal_at
-- NULL, unlicensed, from the 2026-08-20 bulk import). Writing that would move their
-- next_step stage to first_deal, whose cadence (day:1,3,7,14,21,28) would queue a
-- Telegram/SMS/email nudge about a two-month-old milestone. So: the canonical source is
-- read exactly as before, and unified rows from origins the canonical view does not carry
-- count only for deals posted on/after 2026-11-10 (forward-only). The historical gap is
-- listed for a human in v_first_deal_reconcile_backlog, never written.
--
-- Preimage (live definition before this migration):
-- CREATE OR REPLACE FUNCTION public.fn_reconcile_first_deal_at(p_apply boolean DEFAULT true)
--  RETURNS TABLE(agent_id uuid, display_name text, was timestamp with time zone, now_is timestamp with time zone, applied boolean, error text)
--  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
-- AS $function$
-- DECLARE
--   r record;
-- BEGIN
--   FOR r IN
--     WITH canon AS (
--       SELECT COALESCE(cm.canonical_agent_id, p.agent_id) AS aid, min(p.posted_date) AS first_posted
--         FROM public.v_production_canonical p
--         LEFT JOIN public.v_agent_canonical_map cm ON cm.agent_id = p.agent_id
--        WHERE p.agent_id IS NOT NULL
--          AND p.posted_date BETWEEN DATE '2020-01-01' AND current_date + 1
--        GROUP BY 1
--     )
--     SELECT a.id, a.display_name, a.first_deal_at AS was, c.first_posted::timestamptz AS target
--       FROM public.agents a
--       JOIN canon c ON c.aid = a.id
--      WHERE a.canonical_agent_id IS NULL
--        AND (a.first_deal_at IS NULL OR a.first_deal_at::date > c.first_posted)
--      ORDER BY a.display_name
--   LOOP
--     agent_id := r.id; display_name := r.display_name; was := r.was; now_is := r.target;
--     applied := false; error := NULL;
--     IF p_apply THEN
--       BEGIN
--         UPDATE public.agents a
--            SET first_deal_at = r.target, updated_at = now()
--          WHERE a.id = r.id
--            AND (a.first_deal_at IS NULL OR a.first_deal_at > r.target);
--         applied := FOUND;
--       EXCEPTION WHEN others THEN
--         error := SQLERRM;
--       END;
--     END IF;
--     RETURN NEXT;
--   END LOOP;
-- END;
-- $function$
do $preimage$
begin
  if to_regclass('public.ops_preimage_snapshots') is not null
     and not exists (select 1 from public.ops_preimage_snapshots where reason = 'wp8_fn_reconcile_first_deal_at') then
    insert into public.ops_preimage_snapshots (reason, payload)
    values ('wp8_fn_reconcile_first_deal_at',
            jsonb_build_object('definition', pg_get_functiondef('public.fn_reconcile_first_deal_at(boolean)'::regprocedure),
                               'cron', (select jsonb_build_object('jobid', j.jobid, 'schedule', j.schedule, 'command', j.command)
                                        from cron.job j where j.jobname = 'first-deal-at-reconcile')));
  end if;
end
$preimage$;

create or replace function public.fn_first_deal_unified_cutoff()
returns date
language sql
immutable
set search_path to 'public'
as $function$
  select date '2026-11-10'
$function$;
comment on function public.fn_first_deal_unified_cutoff() is
  'WP8: deals from production origins that v_production_canonical does not carry (agentcloud_producer) set agents.first_deal_at only when posted on/after this date, so the reconcile never fires a first-deal nudge about an old milestone. Single source for fn_reconcile_first_deal_at and v_first_deal_reconcile_backlog.';

create or replace function public.fn_reconcile_first_deal_at(p_apply boolean default true)
returns table(agent_id uuid, display_name text, was timestamp with time zone, now_is timestamp with time zone, applied boolean, error text)
language plpgsql
security definer
set search_path to 'public'
as $function$
DECLARE
  r record;
BEGIN
  FOR r IN
    WITH src AS (
      -- canonical truth, exactly as before
      SELECT p.agent_id, p.posted_date
        FROM public.v_production_canonical p
       WHERE p.agent_id IS NOT NULL
         AND p.posted_date BETWEEN DATE '2020-01-01' AND current_date + 1
      UNION ALL
      -- unified-only origins (agentcloud_producer), forward-only
      SELECT m.agent_id, m.posted_date
        FROM public.mat_production_unified m
       WHERE m.agent_id IS NOT NULL
         AND m.agent_id <> '00000000-0000-0000-0000-00000000a008'::uuid
         AND m.origin NOT IN ('apex_native', 'agentlink', 'discord_external', 'external_daily_gap')
         AND m.posted_date BETWEEN public.fn_first_deal_unified_cutoff() AND current_date + 1
    ),
    canon AS (
      SELECT COALESCE(cm.canonical_agent_id, s.agent_id) AS aid, min(s.posted_date) AS first_posted
        FROM src s
        LEFT JOIN public.v_agent_canonical_map cm ON cm.agent_id = s.agent_id
       GROUP BY 1
    )
    SELECT a.id, a.display_name, a.first_deal_at AS was, c.first_posted::timestamptz AS target
      FROM public.agents a
      JOIN canon c ON c.aid = a.id
     WHERE a.canonical_agent_id IS NULL
       AND (a.first_deal_at IS NULL OR a.first_deal_at::date > c.first_posted)
     ORDER BY a.display_name
  LOOP
    agent_id := r.id; display_name := r.display_name; was := r.was; now_is := r.target;
    applied := false; error := NULL;
    IF p_apply THEN
      BEGIN
        UPDATE public.agents a
           SET first_deal_at = r.target, updated_at = now()
         WHERE a.id = r.id
           AND (a.first_deal_at IS NULL OR a.first_deal_at > r.target);
        applied := FOUND;
      EXCEPTION WHEN others THEN
        error := SQLERRM;
      END;
    END IF;
    RETURN NEXT;
  END LOOP;
END;
$function$;
comment on function public.fn_reconcile_first_deal_at(boolean) is
  'Hourly (cron first-deal-at-reconcile). Moves agents.first_deal_at earlier to the first deal on record. Source (WP8 2026-11-10): v_production_canonical, plus mat_production_unified rows from origins canonical does not carry (agentcloud_producer) posted on/after fn_first_deal_unified_cutoff(). Older unified-only first deals are listed in v_first_deal_reconcile_backlog for a human, never written (writing them would fire next-step first-deal nudges about old milestones).';

drop view if exists public.v_first_deal_reconcile_backlog;
create view public.v_first_deal_reconcile_backlog
with (security_barrier = true) as
with u as (
  select coalesce(cm.canonical_agent_id, m.agent_id) as aid, min(m.posted_date) as first_posted,
         string_agg(distinct m.origin, ', ') as origins
  from public.mat_production_unified m
  left join public.v_agent_canonical_map cm on cm.agent_id = m.agent_id
  where m.agent_id is not null
    and m.agent_id <> '00000000-0000-0000-0000-00000000a008'::uuid
    and m.posted_date between date '2020-01-01' and current_date + 1
  group by 1
)
select a.id as agent_id,
       split_part(coalesce(a.display_name, ''), ' ', 1) as first_name,
       a.status::text as status,
       a.license_status::text as license_status,
       a.first_deal_at,
       u.first_posted as unified_first_deal,
       u.origins,
       (a.license_status::text <> 'licensed') as producing_while_not_licensed
from public.agents a
join u on u.aid = a.id
where a.canonical_agent_id is null
  and (a.first_deal_at is null or a.first_deal_at::date > u.first_posted)
  and u.first_posted < public.fn_first_deal_unified_cutoff()
  and ((select public.api_is_admin_role()) or current_user = any (array['postgres','service_role','supabase_admin']::name[]));
comment on view public.v_first_deal_reconcile_backlog is
  'WP8: agents whose first deal in mat_production_unified predates their first_deal_at (or who have none), from before fn_first_deal_unified_cutoff(). Staged for a human, never auto-written. producing_while_not_licensed = a compliance question for Sam, not a relabel (ACTIVATION-11). Admin/service only; first name only.';
revoke all on public.v_first_deal_reconcile_backlog from public, anon, authenticated;
grant select on public.v_first_deal_reconcile_backlog to authenticated, service_role;

-- =====================================================================================
-- 8) Agent provenance ratchet (soft: a count, never a RAISE on insert)
-- =====================================================================================
create or replace function public.fn_agent_provenance_anchor()
returns timestamptz
language sql
immutable
set search_path to 'public'
as $function$
  select timestamptz '2026-11-10 22:00:00+00'
$function$;
comment on function public.fn_agent_provenance_anchor() is
  'WP8: agent rows created after this instant must carry provenance (source_application_id, or agents.origin once WP5 adds it). Single source for v_agent_provenance_ratchet and apex-doctor #49.';

drop view if exists public.v_agent_provenance_ratchet;
create view public.v_agent_provenance_ratchet
with (security_barrier = true) as
with g as (
  select a.id, a.created_at, a.source_application_id, a.al_user_id,
         nullif(btrim(to_jsonb(a) ->> 'origin'), '') as origin
  from public.agents a
  where a.canonical_agent_id is null
    and not public.is_placeholder_agent(a.agent_code, a.user_id)
)
select public.fn_agent_provenance_anchor() as anchor,
       exists (select 1 from information_schema.columns c
               where c.table_schema = 'public' and c.table_name = 'agents' and c.column_name = 'origin') as origin_column_present,
       (select count(*)::int from g where g.created_at >= public.fn_agent_provenance_anchor()) as created_since_anchor,
       (select count(*)::int from g where g.created_at >= public.fn_agent_provenance_anchor()
          and g.source_application_id is null and g.origin is null) as missing_provenance_since_anchor,
       (select count(*)::int from g where g.created_at >= public.fn_agent_provenance_anchor()
          and g.source_application_id is null and g.origin is null and g.al_user_id is null) as missing_excluding_imports_since_anchor,
       (select count(*)::int from g where g.created_at >= timestamptz '2026-03-01 00:00:00+00'
          and g.created_at < public.fn_agent_provenance_anchor()
          and g.source_application_id is null and g.origin is null) as backlog_missing_since_march
where (select public.api_is_admin_role())
   or current_user = any (array['postgres','service_role','supabase_admin']::name[]);
comment on view public.v_agent_provenance_ratchet is
  'WP8 (FUNNEL-6): one row. Agent rows created since fn_agent_provenance_anchor() with neither source_application_id nor agents.origin (origin is read through to_jsonb so this adopts WP5''s column when it lands; origin_column_present says whether it has). A soft ratchet: it counts, it never blocks a hire. backlog_missing_since_march is context, not graded. Admin/service only.';
revoke all on public.v_agent_provenance_ratchet from public, anon, authenticated;
grant select on public.v_agent_provenance_ratchet to authenticated, service_role;

-- Constants the gated views call: a view's functions run with the CALLER's EXECUTE right.
revoke all on function public.recruit_funnel_stage_keys() from public, anon;
revoke all on function public.fn_first_deal_unified_cutoff() from public, anon;
revoke all on function public.fn_agent_provenance_anchor() from public, anon;
grant execute on function public.recruit_funnel_stage_keys() to authenticated, service_role;
grant execute on function public.fn_first_deal_unified_cutoff() to authenticated, service_role;
grant execute on function public.fn_agent_provenance_anchor() to authenticated, service_role;
