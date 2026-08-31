begin;

-- Attribution conflicts. MEASURED on 44 hires in 90 days: 10 carry an
-- invited_by_manager_id that disagrees with manager_id, and manager_id is
-- "Samuel James" on ALL TEN while invited_by holds the real recruiter (KJ
-- Vaughn x5, Aisha Kebbeh, Chudi Ifediora). manager_id is defaulting to the
-- owner, which is why his recruiting numbers look inflated and everyone else's
-- look empty. Three of the ten show Samuel James against Samuel James — the
-- same person under two different agent rows.
--
-- invited_by_manager_id is treated as the truth throughout (recruiting
-- milestones, show-up tracking) because it records who actually recruited. This
-- view does NOT rewrite manager_id: hierarchy drives override and commission,
-- so an automated rewrite would move money on a guess. It makes the conflict
-- visible so it can be decided.
create or replace view public.v_agent_manager_conflicts as
select
  a.id                as agent_id,
  a.display_name,
  a.created_at        as hired_at,
  a.invited_by_manager_id,
  i.display_name      as recruited_by_says,
  a.manager_id,
  m.display_name      as manager_id_says,
  (i.id = m.id)       as same_person_different_rows
from public.agents a
join public.agents i on i.id = a.invited_by_manager_id
join public.agents m on m.id = a.manager_id
where a.invited_by_manager_id <> a.manager_id
  and coalesce(a.is_deactivated, false) = false;

comment on view public.v_agent_manager_conflicts is
  'Agents whose invited_by_manager_id and manager_id name different uplines. '
  'invited_by is treated as truth everywhere else because it records who '
  'actually recruited; manager_id defaults to the owner. Deliberately does NOT '
  'auto-correct — hierarchy drives override, so a rewrite moves money.';

revoke all on public.v_agent_manager_conflicts from anon;
grant select on public.v_agent_manager_conflicts to authenticated;

-- Provisioning must not cement a disputed upline. An account created while the
-- manager is in dispute inherits whichever value happens to be there.
create or replace view public.v_agent_account_gaps as
select
  a.id                       as agent_id,
  a.display_name,
  a.created_at               as hired_at,
  a.status::text             as status,
  mgr.display_name           as recruited_by,
  coalesce(nullif(trim(p.email), ''), nullif(trim(ap.email), '')) as resolvable_email,
  case
    when a.invited_by_manager_id is not null
     and a.manager_id is not null
     and a.invited_by_manager_id <> a.manager_id
      then 'manager_in_dispute'
    when coalesce(nullif(trim(p.email), ''), nullif(trim(ap.email), '')) is not null
      then 'fixable_now'
    else 'needs_an_email'
  end as gap_kind
from public.agents a
left join public.profiles p      on p.id = a.profile_id
left join public.applications ap on ap.id = a.source_application_id
left join public.agents mgr      on mgr.id = coalesce(a.invited_by_manager_id, a.manager_id)
where a.user_id is null
  and coalesce(a.is_deactivated, false) = false
  and a.status::text <> 'terminated';

comment on view public.v_agent_account_gaps is
  'Agents with no login, split by what is actually blocking them. fixable_now '
  'can be provisioned unattended. needs_an_email cannot be fixed by any '
  'automation. manager_in_dispute is held back deliberately: creating the '
  'account would cement whichever upline happens to be on the row, and upline '
  'drives override. See migration 20260831110000.';

commit;
