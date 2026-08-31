-- wave-onboarding-accounts — make "hired" and "has an account" the same thing.
--
-- MEASURED. Account provisioning has been degrading since May:
--   2026-03  56 hired, 54 got a login
--   2026-04  16 hired, 15
--   2026-05  30 hired, 30   <- last month that worked
--   2026-06  26 hired, 17
--   2026-07   2 hired,  0
--   2026-08  18 hired, 13
--
-- The tell is exact: of 77 agents created in 4 months, EVERY ONE of the 17
-- without a login also has NO profile row (0/17), while 39 of the 60 with a
-- login have one. Account creation makes auth user + profile + agent together;
-- the failing path writes an agent row alone.
--
-- And the account-less split into two groups that need OPPOSITE responses:
--   HAS an email (Kayla Maiten, Jerald Winborne, Zach Hurkmans) — these came
--     from real applications and should have been provisioned automatically.
--     A sweep can fix them.
--   NO email anywhere (the rest, including all four hires KJ added on
--     2026-08-19) — created as roster rows with no contact information at all.
--     No sweep can invent an email; a human has to supply one.
--
-- Reporting both as "no account" hid that difference, which is why it went
-- unfixed for three months: the fixable ones were buried in a pile that looked
-- entirely unfixable.

begin;

create or replace view public.v_agent_account_gaps as
select
  a.id                       as agent_id,
  a.display_name,
  a.created_at               as hired_at,
  a.status::text             as status,
  mgr.display_name           as recruited_by,
  -- Any address we could actually send an invite to, in preference order.
  coalesce(nullif(trim(p.email), ''), nullif(trim(ap.email), '')) as resolvable_email,
  case
    when coalesce(nullif(trim(p.email), ''), nullif(trim(ap.email), '')) is not null
      then 'fixable_now'      -- an address exists; provisioning can run unattended
    else 'needs_an_email'     -- nobody can be invited to an address that does not exist
  end as gap_kind
from public.agents a
left join public.profiles p      on p.id = a.profile_id
left join public.applications ap on ap.id = a.source_application_id
left join public.agents mgr      on mgr.id = coalesce(a.invited_by_manager_id, a.manager_id)
where a.user_id is null
  and coalesce(a.is_deactivated, false) = false
  and a.status::text <> 'terminated';

comment on view public.v_agent_account_gaps is
  'Agents with no login, split by whether an invite is even possible. '
  'fixable_now has a resolvable email and can be provisioned unattended; '
  'needs_an_email cannot be fixed by any automation and needs a human to supply '
  'a contact address. Reporting both as "no account" is why this went unfixed '
  'for three months. See migration 20260831110000.';

revoke all on public.v_agent_account_gaps from anon;
grant select on public.v_agent_account_gaps to authenticated;

-- Scoped read: owner sees every gap, a manager sees only the people they
-- recruited, consistent with every other surface scoped this week.
create or replace function public.my_agent_account_gaps()
returns setof public.v_agent_account_gaps
language sql
stable
security definer
set search_path = public
as $$
  select g.* from public.v_agent_account_gaps g
  where public.is_owner()
     or g.agent_id in (
       select a.id from public.agents a
       where coalesce(a.invited_by_manager_id, a.manager_id) in (
         select ag.id from public.agents ag where ag.user_id = auth.uid()
       )
     )
  order by g.hired_at desc;
$$;

revoke all on function public.my_agent_account_gaps() from public, anon;
grant execute on function public.my_agent_account_gaps() to authenticated, service_role;

commit;
