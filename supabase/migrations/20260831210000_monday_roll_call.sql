-- MP-339: the Monday roll call — who is new, who still is not in Discord, and
-- who we physically cannot reach.
--
-- Sam wants one list on the dashboard: the people who should be joining today.
-- The useful version is not "who was hired recently" — it is "who was hired
-- recently AND is not in yet AND can actually be contacted", because those are
-- three different follow-up actions and lumping them produces a list nobody can
-- work.
--
-- MEASURED on the live roster the morning this shipped: 16 active hires in 14
-- days, has_discord_access = false on ALL SIXTEEN, and 5 of them (Jontay
-- Taylor plus KJ Vaughn's four from 08-20) have no email and no phone anywhere
-- — not on the profile, not on the source application. A blast cannot reach
-- them; only their manager can. That is why reachability is a column and not a
-- filter: dropping them would hide the exact people most likely to be lost.
--
-- Also surfaces undeliverable addresses. Johnathan Carter's email is
-- "@gmai.com" — one letter off gmail.com — so every onboarding email sent to
-- him has silently bounced. A roll call that counts him as "emailed" is the
-- fake-success disease in a new costume.

begin;

create or replace function public.my_onboarding_roll_call(p_days integer default 14)
returns table(
  agent_id uuid,
  display_name text,
  hired_on date,
  days_since_hire integer,
  license_status text,
  onboarding_stage text,
  manager_name text,
  email text,
  phone text,
  has_login boolean,
  in_discord boolean,
  email_deliverable boolean,
  reachable boolean,
  blocker text
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with caller as (
    select coalesce(public.fn_canonical_agent_id(a.id), a.id) as id
    from public.agents a
    where a.user_id = auth.uid()
      and coalesce(a.is_deactivated, false) = false
    limit 1
  ), scope as (
    -- Admin sees the whole roster; a manager sees exactly their downline, using
    -- the same walk the override is paid on so "who do I see" and "who is mine"
    -- cannot drift apart.
    select a.id from public.agents a where public.apex_is_admin()
    union
    select h.member from caller c, lateral public.fn_hierarchy_first_hops(array[c.id]) h
  ), base as (
    select
      a.id,
      a.display_name,
      a.created_at::date as hired_on,
      (current_date - a.created_at::date)::integer as days_since_hire,
      a.license_status::text as license_status,
      coalesce(a.onboarding_stage::text, 'not_started') as onboarding_stage,
      coalesce(m.display_name, 'Unassigned') as manager_name,
      nullif(btrim(coalesce(p.email, ap.email, '')), '') as email,
      nullif(btrim(coalesce(p.phone, ap.phone, '')), '') as phone,
      (a.user_id is not null) as has_login,
      coalesce(a.has_discord_access, false) as in_discord
    from public.agents a
    left join public.agents m on m.id = a.manager_id
    left join public.profiles p on p.id = a.profile_id
    left join public.applications ap on ap.id = a.source_application_id
    join scope s on s.id = a.id
    where a.status = 'active'
      and coalesce(a.is_deactivated, false) = false
      and coalesce(a.is_inactive, false) = false
      and a.created_at >= current_date - greatest(coalesce(p_days, 14), 1)
      and not public.fn_agent_is_roster_excluded(a.id)
  )
  select
    b.id, b.display_name, b.hired_on, b.days_since_hire,
    b.license_status, b.onboarding_stage, b.manager_name,
    b.email, b.phone, b.has_login, b.in_discord,
    -- Not a validity check on the whole address: a typo'd well-known provider
    -- is the failure that actually happens here and the one worth naming.
    (b.email is not null and split_part(b.email, '@', 2) not in
       ('gmai.com','gmial.com','gmail.co','gmaill.com','yaho.com','hotmial.com','outlok.com','iclou.com')
    ) as email_deliverable,
    (b.email is not null or b.phone is not null) as reachable,
    case
      when b.email is null and b.phone is null then 'no contact on file — only the manager can reach them'
      when b.email is not null and split_part(b.email, '@', 2) in
        ('gmai.com','gmial.com','gmail.co','gmaill.com','yaho.com','hotmial.com','outlok.com','iclou.com')
        then 'email address looks mistyped — mail to it is bouncing'
      when not b.has_login then 'no login yet — account was never provisioned'
      when not b.in_discord then 'not in Discord yet'
      else 'ready'
    end as blocker
  from base b
  order by b.in_discord, b.hired_on desc, b.display_name;
$function$;

comment on function public.my_onboarding_roll_call(integer) is
  'MP-339: Monday roll call. New hires scoped to the caller (admin = all, '
  'manager = own downline), with the three distinct blockers separated: no '
  'contact on file, mistyped email, no login, not in Discord. Unreachable '
  'people are reported, never filtered out — they are the ones most likely to '
  'be lost.';

revoke all on function public.my_onboarding_roll_call(integer) from public;
grant execute on function public.my_onboarding_roll_call(integer) to authenticated;

commit;
