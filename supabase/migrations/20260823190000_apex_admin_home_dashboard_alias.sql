-- apex_admin_home_dashboard(p_start, p_end) — admin-scoped alias for
-- apex_home_dashboard.
--
-- A concurrent worker repointed AgentCloudHome at this name while only
-- apex_home_dashboard existed, so /dashboard 404'd on the RPC and rendered with
-- no numbers at all. Adding the function rather than editing their component
-- back: it fixes the live break without two workers fighting over one file, and
-- the caller's shape (no p_scope — the admin home is always agency scope) is a
-- reasonable contract.
--
-- Deliberately a WRAPPER, not a copy. A second implementation of these numbers
-- is exactly how the dashboard and the leaderboard came to disagree in the
-- first place; this one cannot drift because it has no maths of its own.
create or replace function public.apex_admin_home_dashboard(
  p_start date default null,
  p_end   date default null
) returns jsonb
language sql stable security definer
set search_path to 'public'
as $$
  select public.apex_home_dashboard('agency', p_start, p_end);
$$;

grant execute on function public.apex_admin_home_dashboard(date, date) to authenticated;
