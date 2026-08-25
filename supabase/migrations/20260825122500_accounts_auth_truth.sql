-- Profiles, roles, and agent rows can outlive an auth identity. Accounts must
-- count actual logins, not those legacy records. Return only candidate IDs that
-- still exist in auth.users; caller must already be agency staff.

begin;

create or replace function public.staff_existing_auth_user_ids(p_user_ids uuid[])
returns table(user_id uuid)
language sql
stable
security definer
set search_path = auth, public
as $$
  select u.id
  from auth.users u
  where public.is_agency_staff()
    and u.id = any(coalesce(p_user_ids, '{}'::uuid[]));
$$;

revoke all on function public.staff_existing_auth_user_ids(uuid[]) from public, anon;
grant execute on function public.staff_existing_auth_user_ids(uuid[]) to authenticated, service_role;

comment on function public.staff_existing_auth_user_ids(uuid[]) is
  'Agency-staff account truth: intersects supplied role/agent IDs with live auth.users identities so deleted logins cannot inflate Accounts.';

commit;
