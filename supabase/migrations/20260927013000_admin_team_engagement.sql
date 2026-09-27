-- Team engagement (2026-09-26). Sam: "fix the dashboards for my team… a lot more data
-- for these people so I can know how to help them… if they logged into their account."
--
-- One admin-only RPC that joins what the CRM never showed side by side: the agent's
-- login truth (auth.users.last_sign_in_at — readable only via SECURITY DEFINER),
-- every onboarding email the queue actually SENT (not merely enqueued), the magic
-- portal link (sent + used), Discord/course flags, and course-module progress.
-- Access: rows only for has_role(auth.uid(), 'admin'); everyone else gets zero rows.
-- A SECURITY DEFINER *view* would bypass RLS for any caller (the 2026-08-20 definer
-- view leak), so this is a function that checks the caller itself.
create or replace function public.admin_team_engagement()
returns table (
  agent_id uuid,
  display_name text,
  email text,
  phone text,
  status text,
  license_status text,
  onboarding_stage text,
  hired_at timestamptz,
  manager_name text,
  has_login boolean,
  last_sign_in_at timestamptz,
  days_since_login integer,
  portal_email_last_sent_at timestamptz,
  portal_link_used_at timestamptz,
  discord_sent_at timestamptz,
  discord_last_error text,
  course_sent_at timestamptz,
  get_licensed_sent_at timestamptz,
  has_discord_access boolean,
  has_training_course boolean,
  modules_total integer,
  modules_completed integer,
  last_module_activity_at timestamptz
)
language sql
security definer
set search_path = public
stable
as $$
  with q as (
    select agent_id,
           max(sent_at) filter (where email_kind = 'discord')      as discord_sent_at,
           max(last_error) filter (where email_kind = 'discord' and sent_at is null) as discord_last_error,
           max(sent_at) filter (where email_kind = 'course')       as course_sent_at,
           max(sent_at) filter (where email_kind = 'get_licensed') as get_licensed_sent_at
    from public.agent_onboarding_queue
    group by agent_id
  ),
  t as (
    select agent_id, max(created_at) as portal_email_last_sent_at, max(used_at) as portal_link_used_at
    from public.magic_login_tokens
    group by agent_id
  ),
  prog as (
    select agent_id,
           count(*) filter (where completed_at is not null or passed) as modules_completed,
           max(greatest(coalesce(completed_at, started_at), started_at)) as last_module_activity_at
    from public.onboarding_progress
    group by agent_id
  ),
  mods as (
    select count(*)::integer as modules_total from public.onboarding_modules where coalesce(is_active, true)
  )
  select
    a.id,
    a.display_name,
    coalesce(p.email, u.email),
    p.phone,
    a.status::text,
    a.license_status::text,
    a.onboarding_stage::text,
    a.created_at,
    m.display_name,
    (a.user_id is not null),
    u.last_sign_in_at,
    case when u.last_sign_in_at is null then null
         else floor(extract(epoch from (now() - u.last_sign_in_at)) / 86400)::integer end,
    t.portal_email_last_sent_at,
    t.portal_link_used_at,
    q.discord_sent_at,
    q.discord_last_error,
    q.course_sent_at,
    q.get_licensed_sent_at,
    coalesce(a.has_discord_access, false),
    coalesce(a.has_training_course, false),
    (select modules_total from mods),
    coalesce(prog.modules_completed, 0)::integer,
    prog.last_module_activity_at
  from public.agents a
  left join public.profiles p on p.id = a.profile_id
  left join auth.users u on u.id = a.user_id
  left join public.agents m on m.id = a.manager_id
  left join q on q.agent_id = a.id
  left join t on t.agent_id = a.id
  left join prog on prog.agent_id = a.id
  where public.has_role(auth.uid(), 'admin'::app_role)
    and coalesce(a.is_deactivated, false) = false
    and a.status::text <> 'terminated'
  order by a.created_at desc
$$;

revoke all on function public.admin_team_engagement() from public;
revoke all on function public.admin_team_engagement() from anon;
grant execute on function public.admin_team_engagement() to authenticated;

comment on function public.admin_team_engagement() is
  'Admin-only per-agent engagement: login truth, onboarding emails actually sent, portal link sent/used, Discord/course flags, module progress. Zero rows for non-admins.';
