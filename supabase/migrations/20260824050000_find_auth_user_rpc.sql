-- auth_user_id_by_email — exact lookup instead of paging the whole auth table.
--
-- Sam, Monday morning: "adding agents not working, this is literally the most
-- important function." It was returning
--   findAuthUserByEmail failed on page 1: Database error finding users
--
-- MEASURED against prod: GoTrue's /auth/v1/admin/users endpoint returns 500
-- "Database error finding users" for ANY read past offset 200, at every page
-- size:  per_page=50/100/200 page 1 OK · per_page=300+ 500 · per_page=100 page 3+
-- 500 · per_page=200 page 2 500. The boundary is the offset, not the size, and
-- the rows either side of position 200 are unremarkable (no nulls, no SSO, no
-- anonymous, no deleted). It is a platform-side failure in that endpoint, not
-- our data — and with 542 auth users, EVERY paginating caller hits it.
--
-- That took down add-agent, create-new-agent-account, setup-agent-password and
-- create-agent-from-leaderboard. consume-invite-token survived only because its
-- 200-row page never crossed the boundary.
--
-- Paging a table to find one row was always the weak design; the ceiling just
-- made it fail loudly. This asks the database the actual question. One row, no
-- pagination, no ceiling, and it cannot be broken by a table that grows.
create or replace function public.auth_user_id_by_email(p_email text)
returns uuid
language sql
stable
security definer
set search_path to 'auth', 'public'
as $$
  select u.id
  from auth.users u
  where lower(u.email) = lower(btrim(p_email))
  order by u.created_at desc
  limit 1;
$$;

revoke all on function public.auth_user_id_by_email(text) from public, anon, authenticated;
-- service_role only: this answers "does an account exist for this email", which
-- no browser client has any reason to ask.
grant execute on function public.auth_user_id_by_email(text) to service_role;
