-- MP-302 (2026-11-12): owner inbox cleanup.
--
-- 1. owner_email_mute        one reversible switch for notices the owner does not need a copy of
-- 2. one applicant alert     a database backstop for "one owner alert per application"
-- 3. owner_daily_overview()  the facts those notices carried, once a day, in one message
-- 4. hourly tick             sends at the Arizona time stored in system_settings
--
-- Evidence (owner inbox, 14 days to 2026-11-12, headers only): 13 "log your numbers",
-- 10 "schedule auto-fill", 5 "Are You Licensed Yet?", 12 "Just Recruited", 3 welcome copies,
-- 2 "Started the Training Course", 4 application nudges addressed to his own test rows.
-- None asked anything of him. No daily owner summary was being sent at all: the
-- apex-daily-brief-7am-ct job is inactive and no other brief is scheduled.
-- No sender named "free book" exists in this project; nothing here touches delivery to
-- applicants, agents, or people who asked for something.

set lock_timeout = '3s';

-- 1. The mute. Turn off: update ... set value = jsonb_set(value::jsonb, '{enabled}', 'false')::text.
insert into public.system_settings (key, value)
values (
  'owner_email_mute',
  '{"enabled":true,"owners":["info@kingofsales.net","sam.com593@gmail.com","sam@apex-financial.org"],"subjects":["log your numbers","log today''s numbers","schedule auto-fill","are you licensed yet","just recruited","started the training course","let''s get you licensed","your application is still open","about your application","following up on your application"]}'
)
on conflict (key) do nothing;

insert into public.system_settings (key, value) values
  ('owner_overview_enabled', 'true'),
  ('owner_overview_time_az', '07:00'),
  ('owner_overview_to', 'info@kingofsales.net'),
  ('owner_overview_last_sent', '')
on conflict (key) do nothing;

-- 2. One sent owner alert per application. Two applications already carry two sent alerts
--    each (measured before this migration); history is left as it is, so the rule starts now.
create unique index if not exists idx_email_delivery_log_one_applicant_alert
  on public.email_delivery_log (related_record_id)
  where template = 'submit-application-admin'
    and status = 'sent'
    and related_record_id is not null
    and created_at >= '2026-11-13 00:00:00+00';

-- 3. The overview's facts for one Phoenix business day (default: yesterday).
create or replace function public.owner_daily_overview(p_day date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_day date := coalesce(p_day, (now() at time zone 'America/Phoenix')::date - 1);
  v_from timestamptz;
  v_to timestamptz;
  v_out jsonb;
begin
  -- The service role (the scheduled sender) or the owner. Nobody else.
  if coalesce(auth.role(), '') <> 'service_role' and not public.is_sam() then
    raise exception 'Owner access required' using errcode = '42501';
  end if;
  v_from := v_day::timestamp at time zone 'America/Phoenix';
  v_to := (v_day + 1)::timestamp at time zone 'America/Phoenix';

  with
  apps as (
    select a.id, nullif(btrim(concat_ws(' ', a.first_name, a.last_name)), '') as name,
           (a.license_status::text = 'licensed') as licensed, a.state
      from public.applications a
     where a.record_type = 'application'
       and coalesce(a.is_duplicate, false) = false
       and not coalesce(a.tags @> array['xcel_roster']::text[], false)
       and a.created_at >= v_from and a.created_at < v_to
  ),
  booked as (
    select count(*) as n from public.interview_events ie
     where ie.call_track in ('licensed', 'leader') and ie.canceled_at is null
       and ie.created_at >= v_from and ie.created_at < v_to
  ),
  on_today as (
    select coalesce(nullif(btrim(ie.invitee_name), ''), 'Name not on file') as name, ie.scheduled_at, ie.call_track,
           ie.application_id, (nullif(btrim(ie.prep_notes), '') is null) as needs_prep
      from public.interview_events ie
     where ie.canceled_at is null
       and ie.scheduled_at >= (v_today::timestamp at time zone 'America/Phoenix')
       and ie.scheduled_at < ((v_today + 1)::timestamp at time zone 'America/Phoenix')
  ),
  open_apps as (
    select a.* from public.applications a
     where a.record_type = 'application'
       and coalesce(a.is_duplicate, false) = false
       and a.do_not_contact_at is null
       and lower(coalesce(a.status::text, '')) not in
           ('contracting','onboarding','paid','approved','producing','hired','rejected','disqualified','lapsed')
       and coalesce(a.next_step_stage_key, '') <> 'closed_lost'
       and coalesce(a.last_contact_outcome, '') <> 'not_interested'
       and not exists (select 1 from public.agents g where g.source_application_id = a.id)
  ),
  late as (
    -- A follow-up a person set (next_action_set_at) whose time has passed.
    select count(*) as n from open_apps a
     where a.next_action_set_at is not null
       and coalesce(a.next_action_due_at, a.next_review_at) < now()
  ),
  untouched as (
    select count(*) as n from open_apps a
     where a.created_at >= now() - interval '7 days' and a.last_contact_outcome_at is null
       and not coalesce(a.tags @> array['xcel_roster']::text[], false)
  ),
  hires as (
    select nullif(btrim(g.display_name), '') as name from public.agents g
     where g.canonical_agent_id is null
       and not public.is_placeholder_agent(g.agent_code, g.user_id)
       and g.created_at >= v_from and g.created_at < v_to
  ),
  not_onboarded as (
    select nullif(btrim(g.display_name), '') as name, (v_today - (g.created_at at time zone 'America/Phoenix')::date) as days
      from public.agents g
     where g.canonical_agent_id is null
       and not public.is_placeholder_agent(g.agent_code, g.user_id)
       and coalesce(g.is_deactivated, false) = false
       and g.onboarding_completed_at is null
       and g.created_at < now() - interval '3 days'
       and g.created_at >= now() - interval '30 days'
  ),
  production as (
    select count(*) as deals, coalesce(round(sum(b.annual_premium)), 0) as ap
      from public.v_production_unified b where b.posted_date = v_day
  ),
  content as (
    select count(*) filter (where d.status = 'awaiting_approval') as awaiting,
           count(*) filter (where d.status = 'failed') as failed
      from public.social_bot_drafts d
  ),
  alerts as (
    select a.subject, a.created_at from public.bot_alerts a
     where a.severity = 'critical' and a.created_at >= now() - interval '24 hours'
     order by a.created_at desc limit 5
  )
  select jsonb_build_object(
    'day', v_day,
    'today', v_today,
    'applicants', jsonb_build_object(
      'licensed', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'state', state)) from apps where licensed), '[]'::jsonb),
      'unlicensed', coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'state', state)) from apps where not licensed), '[]'::jsonb)),
    'interviews', jsonb_build_object(
      'booked', (select n from booked),
      'today', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'at', scheduled_at, 'track', call_track,
                                                              'application_id', application_id, 'needs_prep', needs_prep)
                                           order by scheduled_at) from on_today), '[]'::jsonb)),
    'followups', jsonb_build_object('late', (select n from late), 'untouched_new', (select n from untouched)),
    'hires', jsonb_build_object(
      'new', coalesce((select jsonb_agg(name) from hires), '[]'::jsonb),
      'not_onboarded', coalesce((select jsonb_agg(jsonb_build_object('name', name, 'days', days) order by days desc) from not_onboarded), '[]'::jsonb)),
    'production', (select jsonb_build_object('deals', deals, 'ap', ap) from production),
    'content', (select jsonb_build_object('awaiting_approval', awaiting, 'failed', failed) from content),
    'system', jsonb_build_object('critical_24h', coalesce((select jsonb_agg(jsonb_build_object('subject', subject, 'at', created_at)) from alerts), '[]'::jsonb))
  ) into v_out;
  return v_out;
end;
$$;

revoke all on function public.owner_daily_overview(date) from public, anon;
grant execute on function public.owner_daily_overview(date) to authenticated, service_role;

comment on function public.owner_daily_overview(date) is
  'Facts for the daily owner overview email (MP-302) for one Phoenix business day: applicants by licence, interviews booked and on today''s calendar, late follow-ups, new hires and hires not onboarded, production (annual premium posted), content awaiting approval, critical alerts. Service role or the owner only.';

-- The owner reads and changes the send time from the System page. Arizona time, HH:MM.
create or replace function public.owner_overview_settings()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select case when public.is_sam() then jsonb_build_object(
    'enabled', coalesce((select value from public.system_settings where key = 'owner_overview_enabled'), 'false') = 'true',
    'time_az', coalesce((select value from public.system_settings where key = 'owner_overview_time_az'), '07:00'),
    'to', (select value from public.system_settings where key = 'owner_overview_to'),
    'last_sent', nullif((select value from public.system_settings where key = 'owner_overview_last_sent'), ''),
    'mute_enabled', coalesce(((select value from public.system_settings where key = 'owner_email_mute')::jsonb ->> 'enabled')::boolean, false),
    'mute_subjects', coalesce((select value from public.system_settings where key = 'owner_email_mute')::jsonb -> 'subjects', '[]'::jsonb)
  ) end
$$;

create or replace function public.set_owner_overview_settings(p_time_az text default null, p_enabled boolean default null, p_mute_enabled boolean default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if not public.is_sam() then
    raise exception 'Owner access required' using errcode = '42501';
  end if;
  if p_time_az is not null then
    if p_time_az !~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' then
      raise exception 'Time must be HH:MM, Arizona time' using errcode = '22023';
    end if;
    update public.system_settings set value = p_time_az, updated_at = now() where key = 'owner_overview_time_az';
  end if;
  if p_enabled is not null then
    update public.system_settings set value = case when p_enabled then 'true' else 'false' end, updated_at = now() where key = 'owner_overview_enabled';
  end if;
  if p_mute_enabled is not null then
    update public.system_settings
       set value = jsonb_set(value::jsonb, '{enabled}', to_jsonb(p_mute_enabled))::text, updated_at = now()
     where key = 'owner_email_mute';
  end if;
  return public.owner_overview_settings();
end;
$$;

revoke all on function public.owner_overview_settings() from public, anon;
revoke all on function public.set_owner_overview_settings(text, boolean, boolean) from public, anon;
grant execute on function public.owner_overview_settings() to authenticated;
grant execute on function public.set_owner_overview_settings(text, boolean, boolean) to authenticated;

-- 4. The tick. Every hour at :05; the function sends only when the Arizona hour matches the
--    stored time and nothing has been sent for that Arizona date.
do $$
begin
  if exists (select 1 from cron.job where jobname = 'owner-daily-overview-tick') then
    perform cron.unschedule('owner-daily-overview-tick');
  end if;
  perform cron.schedule(
    'owner-daily-overview-tick',
    '5 * * * *',
    $cron$
      select net.http_post(
        url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/owner-daily-overview',
        headers := jsonb_build_object(
          'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'apex_bot_token' limit 1),
          'Content-Type', 'application/json'
        ),
        body := '{}'::jsonb,
        timeout_milliseconds := 25000
      )
      where (select value from public.system_settings where key = 'owner_overview_enabled') = 'true';
    $cron$
  );
end $$;
