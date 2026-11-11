-- MP-ONBOARD-ANCHOR-PKG1 (2026-11-12) 1/9: package cutoff anchor + suspension helper.
--
-- WHAT
--   * system_settings 'anchor_pkg1_cutoff_at', written ONCE at apply time (on conflict do
--     nothing), read through fn_anchor_pkg1_cutoff(). Missing or garbled reads as
--     'infinity', so every gate that uses it fails closed (nothing fires). The value is the
--     fixed format YYYY-MM-DDTHH24:MI:SSZ (UTC); v_next_step_current reads the same key inline
--     with the same strict pattern (20261112000140), because views that authenticated users
--     read sit on top of it and may not call this service-role-only function.
--   * fn_email_is_suspended(email): true when the address belongs to a login (profiles.email
--     or auth.users.email) with an open agent_access_suspensions row (lifted_at is null) OR a
--     live login ban (auth.users.banned_until in the future). 122 logins are banned today and
--     68 of them have no open suspension row (Aisha's ban on 2026-11-11 is one), so the ban
--     must count on its own (DECISIONS.md 2026-11-11 21:20Z).
-- WHY
--   Everything this package switches on that runs by itself (post-call message, no-show
--   re-arm, re-application as live record, retry drain) is forward-only from the moment it
--   is applied, like the wp*_cutoff keys. No sender read agent_access_suspensions: Luiza
--   (KJ team, suspended 09-07) got 10 numbers reminders after her ban, and 41 active ladder
--   rows belonged to suspended users (message_map F12). PKG1's senders ask this function.
-- ROLLBACK
--   drop function public.fn_email_is_suspended(text); drop function public.fn_anchor_pkg1_cutoff();
--   delete from public.system_settings where key = 'anchor_pkg1_cutoff_at';
--   (only after the later PKG1 migrations are rolled back: they call both functions)

insert into public.system_settings (key, value, updated_at)
values ('anchor_pkg1_cutoff_at', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'), now())
on conflict (key) do nothing;

create or replace function public.fn_anchor_pkg1_cutoff()
returns timestamptz
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v text;
begin
  select s.value into v from public.system_settings s where s.key = 'anchor_pkg1_cutoff_at';
  if v is null or v !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$' then
    return 'infinity'::timestamptz; -- missing or garbled: nothing this package gates can fire
  end if;
  return v::timestamptz;
exception when others then
  return 'infinity'::timestamptz;   -- a value that matches the pattern but is not a date
end
$$;

comment on function public.fn_anchor_pkg1_cutoff() is
  'MP-ONBOARD-ANCHOR-PKG1 forward-only anchor (system_settings.anchor_pkg1_cutoff_at, set at apply time, format YYYY-MM-DDTHH24:MI:SSZ). Gates the call_booked post-call message, the no-show re-arm, re-application-as-live-record and the retry drain. Missing or garbled = infinity (nothing fires).';

revoke all on function public.fn_anchor_pkg1_cutoff() from public, anon, authenticated;
grant execute on function public.fn_anchor_pkg1_cutoff() to service_role;

create or replace function public.fn_email_is_suspended(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with logins as (
    select p.user_id as id from public.profiles p
     where p.user_id is not null and lower(btrim(p.email)) = lower(btrim(p_email))
    union
    select u.id from auth.users u
     where lower(btrim(u.email)) = lower(btrim(p_email))
  )
  select case
    when nullif(lower(btrim(coalesce(p_email, ''))), '') is null then false
    else exists (select 1 from public.agent_access_suspensions s
                  where s.lifted_at is null and s.user_id in (select id from logins))
      or exists (select 1 from auth.users u
                  where u.id in (select id from logins) and u.banned_until > now())
  end
$$;

comment on function public.fn_email_is_suspended(text) is
  'MP-ONBOARD-ANCHOR-PKG1: true when the address belongs to a login (profile or auth email) with an open agent_access_suspensions row or a live login ban (auth.users.banned_until in the future). Service role only.';

revoke all on function public.fn_email_is_suspended(text) from public, anon, authenticated;
grant execute on function public.fn_email_is_suspended(text) to service_role;
