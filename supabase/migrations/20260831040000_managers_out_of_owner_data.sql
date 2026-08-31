-- wave-manager-scope — "i dont want managers seeing my stuff at all" (Sam).
--
-- MEASURED as a real manager (Obiajulu, user 80010a1e) before changing anything:
--   is_agency_staff()              true
--   v_cfo_snapshot                 1 row   (agency financial summary)
--   v_commission_grid              22 rows
--   v_unlicensed_all               1,042   (the ENTIRE recruit roster, Sam's included)
--   v_business_analytics_summary   1 row
--   v_ceo_command_center           1 row
--   carrier_policies               89 rows (every agent's, not just downline)
--
-- The cause is mine. is_agency_staff() was written on 2026-08-24 to gate agency
-- views away from plain agents, and it defined "staff" as admin OR manager OR
-- va_manager. That correctly stopped rank-and-file agents and simultaneously
-- handed all 7 managers the owner's view of the business.
--
-- THE SPLIT
--   is_agency_staff()  = admin, va_manager, va   ← managers removed
--   Managers keep everything their job needs, because that access never came
--   from this predicate: deals, agentlink_book and applications are scoped by
--   their OWN RLS policies to the manager's downline and attribution. A manager
--   still sees their team. They stop seeing the agency.
--
-- VAs stay in because the recruit queues they work all day (v_unlicensed_all,
-- v_hot_licensing_prospects, the call queues) are gated by this predicate.
-- Removing them would take away their job, not a privilege.
--
-- DELIBERATE CAPABILITY LOSS, stated rather than hidden: managers also lose
-- production_period_totals and get_just_hired_30d, which are gated on this
-- predicate alone and return agency-wide numbers with no downline scoping.
-- That is the point of the change, not a side effect.
--
-- reset_quiz_attempts is the one exception restored explicitly: resetting a
-- failed course attempt is downline coaching, not the owner's data.

begin;

create or replace function public.is_agency_staff()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = auth.uid()
      -- 'manager' deliberately absent. See migration 20260831040000.
      and ur.role in ('admin', 'va_manager', 'va')
  );
$$;

comment on function public.is_agency_staff() is
  'admin / va_manager / va. Managers are deliberately EXCLUDED: this predicate '
  'gates agency-wide and owner-level data, and a manager''s legitimate access '
  'to their downline comes from per-table RLS, not from here. See migration '
  '20260831040000_managers_out_of_owner_data.sql.';

-- Downline coaching stays with managers.
create or replace function public.reset_quiz_attempts(p_agent_id uuid, p_module_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  n integer;
begin
  -- Managers are excluded from is_agency_staff() now, but resetting a failed
  -- course attempt for someone on your team is coaching, not owner data.
  if not (public.is_agency_staff() or public.has_role(auth.uid(), 'manager'::app_role)) then
    raise exception 'not_authorized: only a manager or admin can reset quiz attempts'
      using errcode = '42501';
  end if;

  update public.onboarding_progress
     set attempts = 0, score = null, answers = null
   where agent_id = p_agent_id
     and module_id = p_module_id
     and coalesce(passed, false) = false;

  get diagnostics n = row_count;
  return n;
end
$$;

revoke all on function public.reset_quiz_attempts(uuid, uuid) from public, anon;
grant execute on function public.reset_quiz_attempts(uuid, uuid) to authenticated, service_role;

-- carrier_policies: the manager policy had NO downline filter, so every manager
-- read all 89 rows — every agent's carrier book, Sam's included. Scoped to the
-- manager's own downline, matching how deals and agentlink_book already work.
drop policy if exists carrier_policies_manager_read on public.carrier_policies;
create policy carrier_policies_manager_read
  on public.carrier_policies for select
  to authenticated
  using (
    public.has_role((select auth.uid()), 'manager'::app_role)
    and agent_id in (select agent_id from public.my_downline_agent_ids())
  );

commit;
