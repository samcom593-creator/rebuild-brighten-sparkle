-- wave-new-hire-showup — "fix new hires and track who shows up".
--
-- MEASURED over the last 14 days: 16 hires, and of those
--   11 have a login at all, 10 have ever signed in
--    6 opened any training
--    1 posted a deal
--    0 completed onboarding
--    0 booked a first appointment
-- attendance_status is set on all 16 and is therefore telling nobody anything —
-- a column where every row has the same value cannot separate who showed up
-- from who did not.
--
-- So the question "who actually showed up?" had no answer on any surface. This
-- gives it one, built only from signals that a person genuinely produces:
--   signed in, opened training, booked an appointment, posted a deal.
-- Each is an ACTION the hire took. attendance_status is deliberately excluded
-- because it is stamped for everyone and means nothing.
--
-- A hire is graded, not scored out of a made-up total:
--   no_login      — never even got an account. This is an ops failure, not the
--                   hire's: nobody can show up to a door they were not given.
--   never_signed_in
--   signed_in_only
--   engaged       — training opened or an appointment booked
--   producing     — posted a deal

begin;

create or replace view public.v_new_hire_showup as
select
  a.id                         as agent_id,
  a.display_name,
  a.created_at                 as hired_at,
  (a.created_at at time zone 'America/Phoenix')::date as hired_on,
  mgr.display_name             as recruited_by,
  a.user_id is not null        as has_login,
  u.last_sign_in_at,
  exists (select 1 from public.onboarding_progress p where p.agent_id = a.id) as opened_training,
  a.first_appointment_at is not null as booked_appointment,
  a.first_deal_at is not null        as posted_deal,
  case
    when a.user_id is null                    then 'no_login'
    when u.last_sign_in_at is null            then 'never_signed_in'
    when a.first_deal_at is not null          then 'producing'
    when a.first_appointment_at is not null
      or exists (select 1 from public.onboarding_progress p where p.agent_id = a.id)
                                              then 'engaged'
    else 'signed_in_only'
  end as showup_state
from public.agents a
left join auth.users u on u.id = a.user_id
left join public.agents mgr on mgr.id = coalesce(a.invited_by_manager_id, a.manager_id)
where a.created_at > now() - interval '90 days'
  and coalesce(a.is_deactivated, false) = false;

comment on view public.v_new_hire_showup is
  'Every hire in the last 90 days and whether they actually turned up, graded '
  'from actions they took (signed in / opened training / booked / posted). '
  'attendance_status is deliberately NOT used: it is stamped on 16 of 16 recent '
  'hires and therefore separates nobody. See migration 20260831100000.';

revoke all on public.v_new_hire_showup from anon;
grant select on public.v_new_hire_showup to authenticated;

-- Scoped read. The owner sees the whole cohort; a manager sees only the hires
-- they recruited, matching how every other surface was scoped this week.
create or replace function public.my_new_hire_showup(p_days integer default 14)
returns setof public.v_new_hire_showup
language sql
stable
security definer
set search_path = public
as $$
  select v.* from public.v_new_hire_showup v
  where v.hired_at > now() - make_interval(days => greatest(1, least(p_days, 90)))
    and (
      public.is_owner()
      or v.agent_id in (
        select a.id from public.agents a
        where coalesce(a.invited_by_manager_id, a.manager_id) in (
          select ag.id from public.agents ag where ag.user_id = auth.uid()
        )
      )
    )
  order by v.hired_at desc;
$$;

revoke all on function public.my_new_hire_showup(integer) from public, anon;
grant execute on function public.my_new_hire_showup(integer) to authenticated, service_role;

commit;
