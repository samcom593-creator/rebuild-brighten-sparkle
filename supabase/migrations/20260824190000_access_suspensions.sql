-- wave-departed-access part 2 — tell a deliberate suspension apart from an accident.
--
-- The invariant shipped in 20260824180000 went red on 5 logins whose agent row
-- is `active` but whose login is banned. One of those was mine to fix (the
-- MATTHEW ANDUHA duplicate-row collision, already reversed). The other four are
-- KJ Vaughn, Xaviar Watts, Charles Reese, Daniel Gonzalez and XAGENT10 — Sam
-- revoked KJ and his whole team on 2026-08-10 ON PURPOSE, keeping their agent
-- rows active so their production history stayed intact.
--
-- So the guard was correct about the STATE and wrong about the VERDICT: it
-- graded intent it had no way to see, and would have sat permanently red on
-- five rows nobody should "fix". That is the failure mode this codebase keeps
-- rediscovering — a true alert nobody can act on costs what a false one costs.
--
-- The missing fact was never recorded anywhere the database could read: the
-- decision lived in a session ledger. This table records it, so the invariant
-- can grade on the one thing that actually matters — a lockout NOBODY
-- authorised.

begin;

create table if not exists public.agent_access_suspensions (
  user_id      uuid primary key,
  suspended_at timestamptz not null default now(),
  reason       text not null,
  suspended_by text
);

alter table public.agent_access_suspensions enable row level security;

drop policy if exists agent_access_suspensions_staff on public.agent_access_suspensions;
create policy agent_access_suspensions_staff
  on public.agent_access_suspensions for all
  to authenticated
  using (public.is_agency_staff())
  with check (public.is_agency_staff());

comment on table public.agent_access_suspensions is
  'Deliberate access suspensions for people whose agent row stays active (so '
  'their production history is preserved). Without this, v_agent_access_violations '
  'cannot tell an intentional lockout from an offboarding accident.';

-- Seed the known-deliberate set. Recorded from the 2026-08-10 revocation, whose
-- receipts are in business-ops/access-revocations/2026-08-10-kj-TEAM-ROLLBACK.sql.
-- Only rows that are ALREADY banned with an ALREADY active agent row are seeded:
-- this records history, it does not suspend anybody.
insert into public.agent_access_suspensions (user_id, suspended_at, reason, suspended_by)
select u.id,
       '2026-08-10T00:00:00Z'::timestamptz,
       'KJ Vaughn team revocation (Sam, 2026-08-10). Agent rows deliberately left active to preserve production history.',
       'sam'
from auth.users u
where u.banned_until is not null and u.banned_until > now()
  and exists (select 1 from public.agents a where a.user_id = u.id and a.status = 'active')
on conflict (user_id) do nothing;

-- Regrade: an authorised suspension is context, not a violation.
create or replace view public.v_agent_access_violations as
select * from (
  -- 1. A banned login with an active agent row that NOBODY recorded a reason
  --    for. This is the offboarding accident — someone who is here cannot get
  --    in, and no one decided that.
  select
    'active_agent_locked_out'::text as violation,
    u.id as user_id,
    (select string_agg(a2.display_name || ' [' || a2.status::text || ']', ' | ')
       from public.agents a2 where a2.user_id = u.id) as detail
  from auth.users u
  where u.banned_until is not null and u.banned_until > now()
    and exists (select 1 from public.agents a where a.user_id = u.id and a.status = 'active')
    and not exists (select 1 from public.agent_access_suspensions s where s.user_id = u.id)

  union all

  -- 2. A fully-departed, dormant login that can still sign in.
  select
    'departed_can_still_sign_in'::text,
    d.user_id,
    d.agent_names
  from public.v_departed_logins_to_revoke d
  where not d.already_banned
) v
where public.is_agency_staff();

comment on view public.v_agent_access_violations is
  'Empty means healthy. active_agent_locked_out fires only for a lockout with no '
  'recorded reason in agent_access_suspensions — a deliberate suspension is '
  'context, not an alarm, or the guard sits permanently red on intended state.';

revoke all on public.v_agent_access_violations from anon;
grant select on public.v_agent_access_violations to authenticated;

commit;
