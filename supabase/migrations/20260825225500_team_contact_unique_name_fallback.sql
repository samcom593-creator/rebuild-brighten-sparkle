-- Recover legacy contact details when an agent has no profile/auth contact but
-- exactly one APEX application has the same normalized legal name. Ambiguous
-- names fail closed and stay visibly marked "not on file".

begin;

create or replace function public.crm_agent_contacts()
returns table(agent_id uuid, full_name text, email text, phone text)
language sql
stable
security definer
set search_path = public, auth
as $function$
with base as (
  select
    a.id,
    a.source_application_id,
    a.display_name,
    nullif(btrim(coalesce(pu.full_name, pp.full_name)), '') as profile_name,
    nullif(btrim(coalesce(pu.email, pp.email)), '') as profile_email,
    nullif(btrim(coalesce(pu.phone, pp.phone)), '') as profile_phone,
    nullif(btrim(au.email::text), '') as auth_email,
    nullif(btrim(au.phone::text), '') as auth_phone,
    nullif(btrim(au.raw_user_meta_data ->> 'phone'), '') as auth_meta_phone,
    lower(regexp_replace(btrim(coalesce(pu.full_name, pp.full_name, a.display_name)), '\s+', ' ', 'g')) as name_key
  from public.agents a
  left join public.profiles pu on pu.user_id = a.user_id
  left join public.profiles pp on pp.id = a.profile_id
  left join auth.users au on au.id = a.user_id
  where public.crm_can_read_roster()
    and public.crm_can_read_agent_scope(a.id)
    and coalesce(a.is_inactive, false) = false
    and coalesce(a.is_deactivated, false) = false
    and not public.fn_agent_is_roster_excluded(a.id)
)
select
  b.id,
  coalesce(
    b.profile_name,
    nullif(btrim(concat_ws(' ', ap.first_name, ap.last_name)), ''),
    nullif(btrim(b.display_name), ''),
    'Name not on file'
  ),
  coalesce(b.profile_email, b.auth_email, nullif(btrim(ap.email), '')),
  coalesce(b.profile_phone, b.auth_phone, b.auth_meta_phone, nullif(btrim(ap.phone), ''))
from base b
left join lateral (
  select x.first_name, x.last_name, x.email, x.phone
  from public.applications x
  where x.id = b.source_application_id
     or (
       coalesce(b.profile_email, b.auth_email) is not null
       and lower(btrim(x.email)) = lower(coalesce(b.profile_email, b.auth_email))
     )
     or (
       b.name_key <> ''
       and (coalesce(b.profile_email, b.auth_email) is null or coalesce(b.profile_phone, b.auth_phone, b.auth_meta_phone) is null)
       and lower(regexp_replace(btrim(concat_ws(' ', x.first_name, x.last_name)), '\s+', ' ', 'g')) = b.name_key
       and 1 = (
         select count(*)
         from public.applications only_match
         where lower(regexp_replace(btrim(concat_ws(' ', only_match.first_name, only_match.last_name)), '\s+', ' ', 'g')) = b.name_key
       )
     )
  order by
    (x.id = b.source_application_id) desc,
    (coalesce(b.profile_email, b.auth_email) is not null and lower(btrim(x.email)) = lower(coalesce(b.profile_email, b.auth_email))) desc,
    (nullif(btrim(x.phone), '') is not null) desc,
    x.updated_at desc nulls last
  limit 1
) ap on true;
$function$;

comment on function public.crm_agent_contacts() is
  'Role-scoped Team contacts. Profile/Auth wins, then direct/email application, then one unambiguous exact-name APEX application.';

revoke all on function public.crm_agent_contacts() from public, anon;
grant execute on function public.crm_agent_contacts() to authenticated;

commit;
