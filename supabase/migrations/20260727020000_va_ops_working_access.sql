-- VA OPS WORKING ACCESS (2026-07-27) — applied to prod via MCP same day
-- va_manager (Milver) + va (sub-VAs) could SEE applications (applications_va_read,
-- 2026-07-14) but could not WORK anything: no application updates, no aged_leads
-- visibility, no manual interview entries, and user_roles RLS hid the VA list from
-- the assign-VA dropdown. This grants the recruiting-ops write surface.
-- Production/finance tables intentionally untouched.

-- 1) applications: VA roles can work records (status, contact, license progress).
--    DELETE stays admin-only.
create policy "applications_va_update" on public.applications
for update to authenticated
using (
  has_role((select auth.uid()), 'va'::app_role)
  or has_role((select auth.uid()), 'va_manager'::app_role)
)
with check (
  has_role((select auth.uid()), 'va'::app_role)
  or has_role((select auth.uid()), 'va_manager'::app_role)
);

-- 2) aged_leads: VA roles read + update (unlicensed queue / license push lanes).
create policy "aged_leads_va_read" on public.aged_leads
for select to authenticated
using (
  has_role((select auth.uid()), 'va'::app_role)
  or has_role((select auth.uid()), 'va_manager'::app_role)
);

create policy "aged_leads_va_update" on public.aged_leads
for update to authenticated
using (
  has_role((select auth.uid()), 'va'::app_role)
  or has_role((select auth.uid()), 'va_manager'::app_role)
)
with check (
  has_role((select auth.uid()), 'va'::app_role)
  or has_role((select auth.uid()), 'va_manager'::app_role)
);

-- 3) manual_interview_entries: VA roles see + log entries; edit only their own.
create policy "mie_va_select" on public.manual_interview_entries
for select to authenticated
using (
  has_role((select auth.uid()), 'va'::app_role)
  or has_role((select auth.uid()), 'va_manager'::app_role)
);

create policy "mie_va_insert" on public.manual_interview_entries
for insert to authenticated
with check (
  (has_role((select auth.uid()), 'va'::app_role)
   or has_role((select auth.uid()), 'va_manager'::app_role))
  and created_by = (select auth.uid())
);

create policy "mie_va_update_own" on public.manual_interview_entries
for update to authenticated
using (
  (has_role((select auth.uid()), 'va'::app_role)
   or has_role((select auth.uid()), 'va_manager'::app_role))
  and created_by = (select auth.uid())
);

-- 4) scheduled_interviews: DashboardApplicants reads this for the interview
--    badge; without it the lookup silently returns nothing for VA staff.
--    (Applied to prod as separate migration va_ops_scheduled_interviews_read.)
create policy "scheduled_interviews_va_read" on public.scheduled_interviews
for select to authenticated
using (
  has_role((select auth.uid()), 'va'::app_role)
  or has_role((select auth.uid()), 'va_manager'::app_role)
);

-- 5) user_roles: VA roles can enumerate manager/va/va_manager rows so the
--    assign-VA dropdown (UnlicensedAll "vas_and_managers" query) is not empty.
--    has_role() is SECURITY DEFINER, so no self-referencing recursion.
create policy "user_roles_va_visibility" on public.user_roles
for select to authenticated
using (
  (has_role((select auth.uid()), 'va'::app_role)
   or has_role((select auth.uid()), 'va_manager'::app_role))
  and role = any(array['va'::app_role, 'va_manager'::app_role, 'manager'::app_role])
);
