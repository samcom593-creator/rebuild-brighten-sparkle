-- MP-ONBOARD-ANCHOR-PKG1 (2026-11-12) 8/9: public.v_onboarding_owned_people.
--
-- WHAT
--   One row per lower-cased email address that the onboarding lane owns, with the reason(s):
--     'suspended'          a login (profile or auth email) with an open
--                          agent_access_suspensions row or a live login ban
--                          (fn_email_is_suspended's rule). This view is an EXCLUSION list,
--                          so a banned person is listed here, never left out: whoever
--                          anti-joins it can then never message them;
--     'agent'              anyone with an agents row (any status), by profile email (user_id
--                          or profile_id) or auth email;
--     'xcel_student'       active Xcel students (v_xcel_identity_rollup.is_active) that are
--                          matched to an application/agent or appear in the latest report,
--                          by their Xcel email and their matched application's email;
--     'recent_application' every application created on/after 2026-11-08 19:00Z
--                          (fn_lane_ladder_cutoff(), asserted equal below).
--   Columns: email_lower text, reason text (comma list in priority order suspended, agent,
--   xcel_student, recent_application).
-- WHY
--   The Book-of-Business reactivation session (peer 13) mails pre-cutoff applicants and
--   anti-joins this view, so nobody the onboarding lane is already working gets a second,
--   conflicting message (message_map 4e: one reactivation recipient was already an agent,
--   25 were mid-course), and nobody banned gets one at all (DECISIONS.md "Banned people").
-- SECURITY
--   Service role only. The rows come from a SECURITY DEFINER function (it reads auth.users,
--   which service_role cannot select directly); the view is security_invoker over it.
--   anon and authenticated have no SELECT on the view and no EXECUTE on the function.
-- ROLLBACK
--   drop view public.v_onboarding_owned_people; drop function public.fn_onboarding_owned_people();

do $mig$
begin
  if public.fn_lane_ladder_cutoff() <> timestamptz '2026-11-08 19:00:00+00' then
    raise exception 'PKG1: fn_lane_ladder_cutoff() moved off 2026-11-08 19:00Z; v_onboarding_owned_people (c) must be re-derived';
  end if;
end
$mig$;

create or replace function public.fn_onboarding_owned_people()
returns table (email_lower text, reason text)
language sql
stable
security definer
set search_path = public
as $$
  with latest_report as (
    select max(r.report_date) as report_date from public.xcel_pre_licensing_reports r
  ), banned_logins as (
    select s.user_id as id from public.agent_access_suspensions s where s.lifted_at is null
    union
    select u.id from auth.users u where u.banned_until > now()
  ), src as (
    -- (0) suspended or banned logins: listed so an anti-join excludes them
    select lower(btrim(p.email)) as e, 0 as prio, 'suspended' as why
      from public.profiles p join banned_logins b on b.id = p.user_id
    union all
    select lower(btrim(u.email)), 0, 'suspended'
      from auth.users u join banned_logins b on b.id = u.id
    union all
    -- (a) anyone with an agent row
    select lower(btrim(p.email)), 1, 'agent'
      from public.agents g join public.profiles p on p.user_id = g.user_id
    union all
    select lower(btrim(p.email)), 1, 'agent'
      from public.agents g join public.profiles p on p.id = g.profile_id
    union all
    select lower(btrim(u.email)), 1, 'agent'
      from public.agents g join auth.users u on u.id = g.user_id
    union all
    -- (b) active Xcel students, matched or in the latest report
    select x.email_key, 2, 'xcel_student'
      from public.v_xcel_identity_rollup x, latest_report lr
     where x.is_active and (x.is_linked or x.last_seen_report = lr.report_date)
    union all
    select lower(btrim(a.email)), 2, 'xcel_student'
      from public.v_xcel_identity_rollup x
      join latest_report lr on true
      join public.applications a on a.id = x.application_id
     where x.is_active and (x.is_linked or x.last_seen_report = lr.report_date)
    union all
    -- (c) applications created on/after 2026-11-08 19:00Z
    select lower(btrim(a.email)), 3, 'recent_application'
      from public.applications a
     where a.created_at >= public.fn_lane_ladder_cutoff()
  )
  select s.e as email_lower,
         string_agg(s.why, ',' order by s.prio) as reason
    from (select distinct e, prio, why from src where e is not null and e <> '' and e like '%@%') s
   group by s.e
$$;

comment on function public.fn_onboarding_owned_people() is
  'MP-ONBOARD-ANCHOR-PKG1: emails the onboarding lane owns or that must never be messaged (suspended or banned logins, agent rows, active Xcel students, applications since 2026-11-08 19:00Z). Service role only; read through v_onboarding_owned_people.';

revoke all on function public.fn_onboarding_owned_people() from public, anon, authenticated;
grant execute on function public.fn_onboarding_owned_people() to service_role;

create or replace view public.v_onboarding_owned_people
with (security_invoker = true) as
select o.email_lower, o.reason
  from public.fn_onboarding_owned_people() o;

comment on view public.v_onboarding_owned_people is
  'MP-ONBOARD-ANCHOR-PKG1: one row per email the onboarding lane owns or that must never be messaged (reason: suspended, agent, xcel_student, recent_application). The BoB reactivation runner anti-joins it on email_lower. Service role only.';

revoke all on public.v_onboarding_owned_people from public, anon, authenticated;
grant select on public.v_onboarding_owned_people to service_role;
