-- Sunday starter reminders read the real start plan (2026-10-07).
--
-- monday_starters() matched agents.start_date and applications.start_date. Measured:
-- agents.start_date is stamped with the day the account is created (no UI writes a
-- future value; 0 agents had one), and applications.start_date is NULL on every row,
-- so the Sunday run could never find a Monday starter. The start plan the site
-- actually records is agent_start_plans.expected_start_on / expected_start_status,
-- written by set_expected_start() from Recruit Pipeline's Expected start control.
-- Also returns the person's application id, so the text uses the carrier on file.
-- not_attending is excluded; merged duplicates and paused/deactivated agents too.

drop function if exists public.monday_starters(date);
create function public.monday_starters(p_monday date)
returns table(name text, email text, phone text, manager text, source text, application_id uuid)
language sql
stable
set search_path to 'public'
as $function$
  select a.display_name,
         nullif(p.email, ''),
         coalesce(nullif(p.phone, ''), app.phone),
         m.display_name,
         'start_plan:' || s.expected_start_status,
         coalesce(a.source_application_id, app.id)
    from agent_start_plans s
    join agents a on a.id = s.agent_id
    left join profiles p on p.id = a.profile_id
    left join agents m on m.id = a.manager_id
    left join lateral (
      select ap.id, nullif(ap.phone, '') as phone
        from applications ap
       where (a.source_application_id is not null and ap.id = a.source_application_id)
          or (nullif(p.email, '') is not null and lower(ap.email) = lower(p.email))
       order by (ap.id = a.source_application_id) desc nulls last,
                (nullif(ap.phone, '') is not null) desc,
                ap.created_at desc
       limit 1
    ) app on true
   where s.expected_start_on = p_monday
     and s.expected_start_status in ('confirmed', 'likely', 'awaiting_response')
     and a.status::text not in ('terminated', 'inactive')
     and not coalesce(a.is_inactive, false)
     and not coalesce(a.is_deactivated, false)
     and a.canonical_agent_id is null
     and coalesce(p.email, '') not like 'DEDUP_%'
$function$;
revoke all on function public.monday_starters(date) from public, anon, authenticated;
grant execute on function public.monday_starters(date) to service_role;

-- The digest went to a paused manager (is_inactive) and to merged duplicate rows.
create or replace function public.active_manager_emails()
returns table(name text, email text)
language sql
stable
set search_path to 'public'
as $function$
  select distinct on (lower(p.email)) a.display_name, p.email
    from agents a join profiles p on p.id = a.profile_id
   where a.is_manager and a.status::text = 'active'
     and not coalesce(a.is_inactive, false)
     and not coalesce(a.is_deactivated, false)
     and a.canonical_agent_id is null
     and p.email like '%@%' and p.email not like 'DEDUP_%'
   order by lower(p.email), a.display_name
$function$;
