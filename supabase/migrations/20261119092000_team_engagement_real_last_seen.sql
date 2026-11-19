-- MP-BEST-2 (2026-11-19): the team panel's "last login" becomes "last seen".
--
-- admin_team_engagement() read auth.users.last_sign_in_at, which moves on a fresh sign-in
-- and never while a session stays open. Measured on the panel's own population (130 people
-- with a login): 27 had page views more than a day newer than their last sign-in, and 7 were
-- counted "Silent 7d+" while they had been in the app that week. The other direction, a
-- sign-in newer than any page view, was 3 people and all 3 were verification sessions
-- (headless browser), not the person.
--
-- last_sign_in_at and days_since_login keep their names (the return shape and the generated
-- types do not change) and now carry: the newest page view from a real browser when there is
-- one, the sign-in time only when no page view is on record. Verification sessions are
-- excluded, so a persona check no longer makes a quiet agent look active.

create or replace function public.admin_team_engagement()
 returns table(agent_id uuid, display_name text, email text, phone text, status text, license_status text, onboarding_stage text, hired_at timestamp with time zone, manager_name text, has_login boolean, last_sign_in_at timestamp with time zone, days_since_login integer, portal_email_last_sent_at timestamp with time zone, portal_link_used_at timestamp with time zone, discord_sent_at timestamp with time zone, discord_last_error text, course_sent_at timestamp with time zone, get_licensed_sent_at timestamp with time zone, slack_joined_at timestamp with time zone, slack_joined_source text, has_training_course boolean, modules_total integer, modules_completed integer, last_module_activity_at timestamp with time zone)
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  -- discord_sent_at / discord_last_error keep their legacy names: they read
  -- agent_onboarding_queue email_kind 'discord', which is the SLACK invite email
  -- (send-agent-onboarding-email/index.ts, "legacy kind name").
  with q as (
    select agent_id,
           max(sent_at) filter (where email_kind = 'discord') as discord_sent_at,
           max(last_error) filter (where email_kind = 'discord' and sent_at is null) as discord_last_error,
           max(sent_at) filter (where email_kind = 'course') as course_sent_at,
           max(sent_at) filter (where email_kind = 'get_licensed') as get_licensed_sent_at
    from public.agent_onboarding_queue group by agent_id
  ),
  t as (select agent_id, max(created_at) as portal_email_last_sent_at, max(used_at) as portal_link_used_at from public.magic_login_tokens group by agent_id),
  prog as (
    select agent_id,
           count(*) filter (where completed_at is not null or passed) as modules_completed,
           max(greatest(coalesce(completed_at, started_at), started_at)) as last_module_activity_at
    from public.onboarding_progress group by agent_id
  ),
  mods as (select count(*)::integer as modules_total from public.onboarding_modules where coalesce(is_active, true)),
  -- the newest page view from a real browser, per login (see the header)
  seen as (
    select e.user_id, max(e.created_at) as last_seen
    from public.analytics_events e
    where e.event_name = 'navigation.page_view'
      and e.user_id is not null
      and e.created_at > now() - interval '180 days'
      and coalesce(e.user_agent, '') !~* 'headless'
    group by e.user_id
  )
  select a.id, a.display_name, coalesce(p.email, u.email), p.phone, a.status::text, a.license_status::text, a.onboarding_stage::text,
    a.created_at, m.display_name, (a.user_id is not null),
    coalesce(seen.last_seen, u.last_sign_in_at),
    case when coalesce(seen.last_seen, u.last_sign_in_at) is null then null
         else floor(extract(epoch from (now() - coalesce(seen.last_seen, u.last_sign_in_at))) / 86400)::integer end,
    t.portal_email_last_sent_at, t.portal_link_used_at,
    q.discord_sent_at, q.discord_last_error, q.course_sent_at, q.get_licensed_sent_at,
    a.slack_joined_at, a.slack_joined_source, coalesce(a.has_training_course, false),
    (select modules_total from mods), coalesce(prog.modules_completed, 0)::integer, prog.last_module_activity_at
  from public.agents a
  left join public.profiles p on p.id = a.profile_id
  left join auth.users u on u.id = a.user_id
  left join public.agents m on m.id = a.manager_id
  left join seen on seen.user_id = a.user_id
  left join q on q.agent_id = a.id
  left join t on t.agent_id = a.id
  left join prog on prog.agent_id = a.id
  where public.has_role(auth.uid(), 'admin'::app_role)
    and coalesce(a.is_deactivated, false) = false
    and a.status::text <> 'terminated'
  order by a.created_at desc
$function$;
