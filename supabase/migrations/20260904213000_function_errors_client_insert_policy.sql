-- MP-430d — every client-side error log was itself an error.
-- src/shared/api/queryClient.ts inserts into function_errors when a query
-- fails for a signed-in user (fire-and-forget observability). The table has
-- an admin-only SELECT policy and NO INSERT policy, so with RLS on, every
-- insert has failed "new row violates row-level security policy" since the
-- day it shipped — a 403 in the console of every page that ever errored, and
-- zero rows of client observability collected. Signed-in users may log their
-- own errors; user_id is stamped from the session so a row can never claim
-- to be someone else's.
alter table public.function_errors alter column user_id set default auth.uid();
drop policy if exists "Signed-in users can log their own client errors" on public.function_errors;
create policy "Signed-in users can log their own client errors"
  on public.function_errors for insert to authenticated
  with check (coalesce(user_id, auth.uid()) = auth.uid());
