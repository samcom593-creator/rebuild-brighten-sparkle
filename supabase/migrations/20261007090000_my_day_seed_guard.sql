-- My Day seeding (2026-10-07): the defaults are Sam's own routine, so only an admin is
-- seeded, and two first opens at once (two tabs, a double tap) can no longer both see
-- zero tasks and each copy the 111 defaults. The page is admin-only as well.
create or replace function public.day_plan_ensure_seeded()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare n integer;
begin
  if auth.uid() is null then return 0; end if;
  if not public.has_role(auth.uid(), 'admin'::public.app_role) then return 0; end if;
  -- One seeding per user at a time; the second caller waits, then sees the rows.
  perform pg_advisory_xact_lock(hashtext('day_plan_seed:' || auth.uid()::text));
  select count(*) into n from public.day_plan_tasks where user_id = auth.uid();
  if n > 0 then return n; end if;
  insert into public.day_plan_tasks (user_id, weekday, start_min, duration_min, title, detail, category, sort)
    select auth.uid(), weekday, start_min, duration_min, title, detail, category, sort from public.day_plan_defaults;
  get diagnostics n = row_count;
  return n;
end $function$;
