-- Access-revocation guard: catch a lockout that silently reverts.
--
-- 2026-09-07: Sam's 2026-08-10 order to lock out KJ Vaughn's team was found
-- partially reverted — KJ's login active again with a role restored, 7 team
-- logins live — while agent_access_suspensions still recorded him as suspended.
-- v_agent_access_violations reported ZERO rows throughout. Two reasons:
--
--   1. No branch covered "recorded suspended, never lifted, but not banned".
--      Branch 1 required banned_until > now(); branch 2 required the person to
--      be departed. An ACTIVE agent whose ban was lifted fell through both.
--   2. The view gated its INNER subquery on is_agency_staff() with no OR, so
--      every service-role / no-JWT reader (apex-doctor, bot-sql — the only
--      paths that can page Sam) got zero rows regardless of state. Blank read
--      as green for the life of the view.
--
-- Also adds lifted_at, without which a deliberate restore and a silent revert
-- are indistinguishable and the registry is write-only.
alter table public.agent_access_suspensions add column if not exists lifted_at timestamptz;
comment on column public.agent_access_suspensions.lifted_at is
 'Set when a suspension is deliberately lifted. NULL = still meant to be enforced.';

create or replace view public.v_agent_access_violations as
select violation, user_id, detail
from (
  select 'active_agent_locked_out'::text as violation, u.id as user_id,
         (select string_agg(a2.display_name||' ['||a2.status::text||']', ' | ') from agents a2 where a2.user_id = u.id) as detail
  from auth.users u
  where u.banned_until is not null and u.banned_until > now()
    and exists (select 1 from agents a where a.user_id = u.id and a.status = 'active')
    and not exists (select 1 from agent_access_suspensions s where s.user_id = u.id and s.lifted_at is null)
  union all
  select 'departed_can_still_sign_in'::text, d.user_id, d.agent_names
  from v_departed_logins_to_revoke d
  where not d.already_banned
  union all
  -- INNER join on auth.users deliberately: a suspension for an identity with no
  -- login (Kaeden Vaughns is a profile-only duplicate of KJ) has nothing to ban,
  -- so firing on it would pin this branch permanently red with no remedy.
  select 'suspension_lapsed'::text, s.user_id,
         coalesce((select string_agg(a3.display_name||' ['||a3.status::text||']', ' | ') from agents a3 where a3.user_id = s.user_id), '(no agent row)')
           ||' — suspended '||to_char(s.suspended_at,'YYYY-MM-DD')||' by '||coalesce(s.suspended_by,'?')||', ban is NOT in force'
  from agent_access_suspensions s
  join auth.users u2 on u2.id = s.user_id
  where s.lifted_at is null
    and (u2.banned_until is null or u2.banned_until <= now())
) v
where is_agency_staff() or auth.uid() is null;
