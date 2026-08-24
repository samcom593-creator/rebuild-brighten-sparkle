-- wave-departed-access — people who left could still sign in.
--
-- MEASURED before acting: of 183 agent records, 50 are terminated and 63
-- inactive. 39 terminated and 41 inactive agents could STILL LOG IN, and all 80
-- still held a role. Terminated agents showed ZERO production and ZERO sign-ins
-- in 90 days, so that group is unambiguous. "Inactive" is not: 9 of the 63 had
-- signed in within 90 days and 1 had produced, so inactive rows are only
-- revoked when the person is genuinely dormant on BOTH signals. Being wrong
-- here locks a working agent out of their own book.
--
-- THE BUG IN THE FIRST PASS, and the reason this view exists.
-- The first criteria keyed on AGENT ROWS. One login can carry more than one
-- agent row — MATTHEW ANDUHA has an `active` row and a `Matthew Anduha`
-- `inactive` row on the same user_id — so matching the inactive row banned the
-- shared login and locked out the active person. Caught by an
-- "active agents accidentally banned (must be 0)" check that came back 1, then
-- reversed. A login may only be revoked when EVERY agent row on it has
-- departed, which is what this view encodes. Same identity-collision family as
-- the .maybeSingle() waves: the unit of truth is the LOGIN, not the row you
-- happened to match.

begin;

create or replace view public.v_departed_logins_to_revoke as
select * from (
  select
    u.id as user_id,
    string_agg(distinct a.display_name, ' | ') as agent_names,
    string_agg(distinct a.status::text, ',')   as statuses,
    max(u.last_sign_in_at)                     as last_sign_in_at,
    (u.banned_until is not null and u.banned_until > now()) as already_banned
  from auth.users u
  join public.agents a on a.user_id = u.id
  where
    -- EVERY agent row on this login must be departed. A single active row
    -- protects the whole login.
    not exists (
      select 1 from public.agents a2
      where a2.user_id = u.id and a2.status = 'active'
    )
    -- Dormant on both signals: no recent sign-in AND no recent production.
    and (u.last_sign_in_at is null or u.last_sign_in_at < now() - interval '90 days')
    and not exists (
      select 1 from public.agentlink_book b
      where b.agent_id = a.id and b.posted_date > current_date - 90
    )
  group by u.id, u.banned_until
) t
where public.is_agency_staff();

comment on view public.v_departed_logins_to_revoke is
  'Logins whose every agent row has departed and who are dormant on both '
  'sign-in and production. Keyed on the LOGIN, never on a single agent row - '
  'one login can carry several rows and an active one must protect the whole '
  'login. See migration 20260824180000.';

revoke all on public.v_departed_logins_to_revoke from anon;
grant select on public.v_departed_logins_to_revoke to authenticated;

-- ─── The invariant ───────────────────────────────────────────────────────────
-- Two things must never be true. Returns a row per violation, so an empty
-- result is the healthy state and a monitor can grade on count(*).
create or replace view public.v_agent_access_violations as
select * from (
  -- 1. A banned login that still has an active agent row: someone who is here
  --    cannot get in. This is the failure the first pass actually caused.
  select
    'active_agent_locked_out'::text as violation,
    u.id as user_id,
    (select string_agg(a2.display_name || ' [' || a2.status::text || ']', ' | ')
       from public.agents a2 where a2.user_id = u.id) as detail
  from auth.users u
  where u.banned_until is not null and u.banned_until > now()
    and exists (select 1 from public.agents a where a.user_id = u.id and a.status = 'active')

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
  'Empty means healthy. active_agent_locked_out is the more urgent of the two: '
  'it means offboarding banned a login that a current agent still needs.';

revoke all on public.v_agent_access_violations from anon;
grant select on public.v_agent_access_violations to authenticated;

commit;
