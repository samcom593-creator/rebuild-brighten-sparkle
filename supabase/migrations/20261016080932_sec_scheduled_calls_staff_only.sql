-- apex_scheduled_calls holds the prospects on Sam's calendar (prospect_name, prospect_phone,
-- prospect_email, outcome notes). Its read policy was `auth.uid() IS NOT NULL`, so every
-- login, applicants included, could read all of them. Readers that need it are staff (admin,
-- managers, VAs, recruiters) and the service-role functions gcal-sync and daily-brief, which
-- bypass row security. The admin ALL policy is unchanged.
drop policy if exists scheduled_calls_authenticated_read on public.apex_scheduled_calls;
drop policy if exists scheduled_calls_staff_read on public.apex_scheduled_calls;
create policy scheduled_calls_staff_read on public.apex_scheduled_calls
  for select to authenticated
  using ((select public.api_is_staff()));
