-- MP-ONBOARD-ANCHOR-PKG1 (2026-11-12) 1/9: package cutoff anchor + suspension helper.
--
-- WHAT
--   * system_settings 'anchor_pkg1_cutoff_at', written ONCE at apply time (on conflict do
--     nothing), read through fn_anchor_pkg1_cutoff(). Missing or garbled reads as
--     'infinity', so every gate that uses it fails closed (nothing fires).
--   * fn_email_is_suspended(email): true when the address belongs to a login (profiles.email
--     or auth.users.email) with an open agent_access_suspensions row (lifted_at is null).
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
language sql
stable
security definer
set search_path = public
as $$
  -- Missing or garbled setting reads as 'infinity': nothing this package gates can fire.
  select coalesce((select case when value ~ '^\d{4}-\d{2}-\d{2}' then value::timestamptz end
                     from public.system_settings where key = 'anchor_pkg1_cutoff_at'),
                  'infinity'::timestamptz)
$$;

comment on function public.fn_anchor_pkg1_cutoff() is
  'MP-ONBOARD-ANCHOR-PKG1 forward-only anchor (system_settings.anchor_pkg1_cutoff_at, set at apply time). Gates the call_booked post-call message, the no-show re-arm, re-application-as-live-record and the retry drain.';

revoke all on function public.fn_anchor_pkg1_cutoff() from public, anon, authenticated;
grant execute on function public.fn_anchor_pkg1_cutoff() to service_role;

create or replace function public.fn_email_is_suspended(p_email text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select case
    when nullif(lower(btrim(coalesce(p_email, ''))), '') is null then false
    else exists (
      select 1
        from public.agent_access_suspensions s
       where s.lifted_at is null
         and s.user_id in (
           select p.user_id from public.profiles p
            where p.user_id is not null and lower(btrim(p.email)) = lower(btrim(p_email))
           union
           select u.id from auth.users u
            where lower(btrim(u.email)) = lower(btrim(p_email))))
  end
$$;

comment on function public.fn_email_is_suspended(text) is
  'MP-ONBOARD-ANCHOR-PKG1: true when the address belongs to a login (profile or auth email) with an open agent_access_suspensions row. Service role only.';

revoke all on function public.fn_email_is_suspended(text) from public, anon, authenticated;
grant execute on function public.fn_email_is_suspended(text) to service_role;
