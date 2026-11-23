-- MP-MONDAY-ROLLCALL (2026-11-22, Sam): "track who's supposed to be there Monday, based on the hires, and make a
-- very clear list on my first screen I can call ... for all these hired agents."
--
-- Measured before building:
--   * monday_starters('2026-11-23') returned nobody. It reads a hand-set "Expected start" that nobody sets, so the
--     Sunday reminder told Sam "nobody scheduled" in a week with four new agent records.
--   * The 09:15 starter-pack grant was going to hand leads to nobody: three hire-link hires have no licence state
--     on file (the hire link never asked for one) and are skipped as license_state_unknown.
--   * A licensed applicant who opens the course gets an active agent record at once (self-enroll-course, Sam's
--     2026-06-15 instruction, kept). Nothing recorded that the person had not been interviewed yet, so they were
--     queued for client leads on their next sign-in. Two such people this week: one interview missed Saturday,
--     one booked for Monday afternoon.
--
-- What this adds:
--   1. monday_rollcall_marks: the result of each roll-call call, and "interviewed" for a self-enrolled person.
--   2. fn_agent_interview_state(agent): hired_direct | interviewed | upcoming | missed | never.
--   3. owner_monday_rollcall(): one row per hire of the last 45 days, with the phone to call, what they still
--      need, their interview state, their leads state and the last mark. Admin only.
--   4. owner_monday_rollcall_mark() and owner_monday_rollcall_set_states() (admin only).
--   5. fn_starter_pack_candidates: no client leads before an interview (not_interviewed_yet).
--   6. The starter-pack grant runs hourly through the working day, so a hire whose state is filled in at 10 AM
--      has leads at 10:15, not the next morning. One pack per agent, ever, is unchanged.
--   7. fn_next_step_send_gate: the hired-stage email ("You are officially a Galaxy agent") is not sent to a
--      self-enrolled person until an interview happened. One applicant had received it three times with his
--      interview still ahead.

create table if not exists public.monday_rollcall_marks (
  id uuid primary key default gen_random_uuid(),
  monday date not null,
  agent_id uuid not null references public.agents(id) on delete cascade,
  mark text not null check (mark in ('confirmed', 'no_answer', 'texted', 'cant_make_it', 'showed', 'no_show', 'interviewed')),
  note text,
  marked_by uuid,
  marked_by_name text,
  created_at timestamptz not null default now()
);
create index if not exists monday_rollcall_marks_agent_idx on public.monday_rollcall_marks (agent_id, created_at desc);
alter table public.monday_rollcall_marks enable row level security;
revoke all on public.monday_rollcall_marks from anon, authenticated;
comment on table public.monday_rollcall_marks is
  'MP-MONDAY-ROLLCALL: one row per roll-call result. No policies: read and written only through owner_monday_rollcall*().';

-- Who decided this person is an agent? A hire link, Add Agent or an import is a person's decision. A record that
-- exists only because a licensed applicant opened the course is not, until an interview happened.
create or replace function public.fn_agent_interview_state(p_agent_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case
    when a.id is null then null
    when a.source_application_id is null then 'hired_direct'
    when coalesce(a.origin, 'application') <> 'application' then 'hired_direct'
    when coalesce(a.metadata ->> 'created_by_path', '') not in ('', 'self-enroll-course') then 'hired_direct'
    when exists (select 1 from public.monday_rollcall_marks m
                  where m.agent_id = a.id and m.mark = 'interviewed') then 'interviewed'
    when ap.status::text in ('contracting', 'onboarding', 'approved', 'paid', 'hired') then 'interviewed'
    when exists (select 1 from public.interview_events ie
                  where (ie.application_id = a.source_application_id or ie.agent_id = a.id)
                    and ie.canceled_at is null and coalesce(ie.is_backfill_duplicate, false) = false
                    and (ie.outcome in ('completed', 'hired', 'contracted', 'passed') or ie.scheduled_at < a.created_at))
      then 'interviewed'
    when exists (select 1 from public.interview_events ie
                  where (ie.application_id = a.source_application_id or ie.agent_id = a.id)
                    and ie.canceled_at is null and coalesce(ie.is_backfill_duplicate, false) = false
                    and ie.scheduled_at > now()) then 'upcoming'
    when exists (select 1 from public.interview_events ie
                  where (ie.application_id = a.source_application_id or ie.agent_id = a.id)
                    and ie.canceled_at is null and coalesce(ie.is_backfill_duplicate, false) = false
                    and ie.scheduled_at <= now()) then 'missed'
    else 'never'
  end
  from (select p_agent_id as id0) x
  left join public.agents a on a.id = x.id0
  left join public.applications ap on ap.id = a.source_application_id
$function$;
revoke all on function public.fn_agent_interview_state(uuid) from public, anon, authenticated;

create or replace function public.owner_monday_rollcall(p_monday date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_monday date;
  v_week_start timestamptz;
  v_rows jsonb;
begin
  if v_uid is null or not public.has_role(v_uid, 'admin'::public.app_role) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  -- today when today is Monday, otherwise the next Monday
  v_monday := coalesce(p_monday, v_today + ((8 - extract(isodow from v_today)::int) % 7));
  v_week_start := ((v_monday - 7)::timestamp at time zone 'America/Phoenix');

  with cand as (
    select * from public.fn_starter_pack_candidates()
  ), pop as (
    select a.id, a.user_id, a.profile_id, a.created_at, a.display_name, a.license_status::text as license_status,
           a.license_progress::text as license_progress, a.onboarding_stage, a.source_application_id,
           a.metadata, a.manager_id, a.nipr_number, a.origin
      from public.agents a
     where a.status::text = 'active'
       and coalesce(a.is_deactivated, false) = false
       and coalesce(a.is_inactive, false) = false
       and (a.canonical_agent_id is null or a.canonical_agent_id = a.id)
       and coalesce(a.account_mode, 'agent') not in ('manager', 'admin')
       and (a.user_id is null or not public.is_placeholder_agent(a.agent_code, a.user_id))
       and not public.fn_agent_is_roster_excluded(a.id)
       and not public.fn_agent_is_suspended(a.id)
       and (a.user_id is null or not public.fn_user_login_blocked(a.user_id))
       and a.created_at >= now() - interval '45 days'
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'agent_id', p.id,
           'name', coalesce(nullif(btrim(p.display_name), ''), nullif(btrim(pr.full_name), ''), 'No name on file'),
           'phone', nullif(right(regexp_replace(coalesce(nullif(pr.phone, ''), nullif(ap.phone, ''), iv.invitee_phone, ''), '\D', '', 'g'), 10), ''),
           'email', coalesce(nullif(btrim(pr.email), ''), nullif(btrim(ap.email), '')),
           'hired_at', p.created_at,
           'days_since_hire', floor(extract(epoch from now() - p.created_at) / 86400)::int,
           'this_week', p.created_at >= v_week_start,
           'how_hired', case when p.origin = 'hire_link' then 'hire_link'
                             when public.fn_agent_interview_state(p.id) = 'hired_direct' then 'added'
                             else 'self_enrolled' end,
           'interview_state', public.fn_agent_interview_state(p.id),
           'interview_at', iv.scheduled_at,
           'licensed', p.license_status = 'licensed',
           'license_step', case when p.license_status = 'licensed' then null else p.license_progress end,
           'npn_on_file', p.nipr_number is not null,
           'npn_note', nullif(btrim(coalesce(p.metadata ->> 'npn_missing_reason', '')), ''),
           'license_states', coalesce(c.license_states,
                                      case when upper(btrim(coalesce(ap.state, ''))) in (select z.state from public.us_state_timezones z)
                                           then array[upper(btrim(ap.state))] end),
           'phone_state_hint', (select ac.state from public.us_area_codes ac
                                 where ac.area_code::text = left(nullif(right(regexp_replace(coalesce(nullif(pr.phone, ''), nullif(ap.phone, ''), iv.invitee_phone, ''), '\D', '', 'g'), 10), ''), 3)
                                 limit 1),
           'leads_state', case when p.license_status <> 'licensed' and c.agent_id is null then 'not_licensed'
                               else coalesce(c.reason, 'not_licensed') end,
           'live_leads', coalesce(ld.n, 0),
           'last_sign_in_at', u.last_sign_in_at,
           'manager_name', mg.name,
           'stage', p.onboarding_stage,
           'mark', mk.mark,
           'mark_note', mk.note,
           'marked_at', mk.created_at,
           'marked_by', mk.marked_by_name
         ) order by p.created_at desc), '[]'::jsonb)
    into v_rows
    from pop p
    left join public.profiles pr on pr.id = p.profile_id
    left join public.applications ap on ap.id = p.source_application_id
    left join auth.users u on u.id = p.user_id
    left join cand c on c.agent_id = p.id
    left join lateral (
      select ie.scheduled_at, ie.invitee_phone
        from public.interview_events ie
       where (ie.application_id = p.source_application_id or ie.agent_id = p.id
              or (pr.email is not null and lower(btrim(ie.invitee_email)) = lower(btrim(pr.email))))
         and ie.canceled_at is null and coalesce(ie.is_backfill_duplicate, false) = false
       order by (ie.scheduled_at > now()) desc,
                case when ie.scheduled_at > now() then ie.scheduled_at end asc,
                ie.scheduled_at desc
       limit 1
    ) iv on true
    left join lateral (
      select count(*)::int as n
        from public.lead_bundle_grants g
        join public.lead_bundles b on b.id = g.bundle_id and b.archived_at is null
        join public.lead_bundle_items i on i.bundle_id = b.id and i.removed_at is null
       where g.user_id = p.user_id and g.revoked_at is null
    ) ld on true
    left join lateral (
      select coalesce(nullif(btrim(m.display_name), ''), mp.full_name) as name
        from public.agents m left join public.profiles mp on mp.id = m.profile_id
       where m.id = p.manager_id
    ) mg on true
    left join lateral (
      select k.mark, k.note, k.created_at, k.marked_by_name
        from public.monday_rollcall_marks k
       where k.agent_id = p.id and k.monday = v_monday and k.mark <> 'interviewed'
       order by k.created_at desc limit 1
    ) mk on true;

  return jsonb_build_object('monday', v_monday, 'is_today', v_monday = v_today, 'rows', v_rows);
end;
$function$;
revoke all on function public.owner_monday_rollcall(date) from public, anon;
grant execute on function public.owner_monday_rollcall(date) to authenticated;

create or replace function public.owner_monday_rollcall_mark(
  p_agent_id uuid, p_mark text, p_note text default null, p_monday date default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_monday date;
  v_name text;
  v_id uuid;
begin
  if v_uid is null or not public.has_role(v_uid, 'admin'::public.app_role) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if p_mark is null or p_mark not in ('confirmed', 'no_answer', 'texted', 'cant_make_it', 'showed', 'no_show', 'interviewed') then
    raise exception 'unknown result' using errcode = '22023';
  end if;
  if not exists (select 1 from public.agents a where a.id = p_agent_id) then
    raise exception 'unknown person' using errcode = '22023';
  end if;
  v_monday := coalesce(p_monday, v_today + ((8 - extract(isodow from v_today)::int) % 7));
  select nullif(btrim(pr.full_name), '') into v_name from public.profiles pr where pr.user_id = v_uid limit 1;
  insert into public.monday_rollcall_marks (monday, agent_id, mark, note, marked_by, marked_by_name)
  values (v_monday, p_agent_id, p_mark, nullif(btrim(coalesce(p_note, '')), ''), v_uid, v_name)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id, 'monday', v_monday);
end;
$function$;
revoke all on function public.owner_monday_rollcall_mark(uuid, text, text, date) from public, anon;
grant execute on function public.owner_monday_rollcall_mark(uuid, text, text, date) to authenticated;

-- The licence state a hire link never asked for. Writing it is what lets the starter-pack grant pick leads.
create or replace function public.owner_monday_rollcall_set_states(p_agent_id uuid, p_states text[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_uid uuid := auth.uid();
  v_states text[];
begin
  if v_uid is null or not public.has_role(v_uid, 'admin'::public.app_role) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select array_agg(distinct s order by s) into v_states
    from (select upper(btrim(x)) as s from unnest(coalesce(p_states, '{}'::text[])) x) q
   where q.s in (select z.state from public.us_state_timezones z);
  if v_states is null then
    raise exception 'give at least one two-letter state' using errcode = '22023';
  end if;
  update public.agents set license_states = v_states where id = p_agent_id;
  if not found then
    raise exception 'unknown person' using errcode = '22023';
  end if;
  return jsonb_build_object('ok', true, 'states', to_jsonb(v_states));
end;
$function$;
revoke all on function public.owner_monday_rollcall_set_states(uuid, text[]) from public, anon;
grant execute on function public.owner_monday_rollcall_set_states(uuid, text[]) to authenticated;

-- 5. No client leads before an interview. The live definition, restated with one new branch.
CREATE OR REPLACE FUNCTION public.fn_starter_pack_candidates()
 RETURNS TABLE(agent_id uuid, user_id uuid, first_name text, hired_at timestamp with time zone, days_since_hire integer, license_states text[], state_source text, eligible boolean, reason text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with pop as (
    select a.id, a.user_id, a.created_at, a.license_states, a.source_application_id, a.account_mode,
           coalesce(nullif(split_part(btrim(coalesce(a.display_name, '')), ' ', 1), ''), 'there') as first_name,
           (select u.last_sign_in_at from auth.users u where u.id = a.user_id) as last_sign_in_at,
           (select lower(btrim(pr.email)) from public.profiles pr where pr.id = a.profile_id) as profile_email
      from public.agents a
     where a.status::text = 'active'
       and coalesce(a.is_deactivated, false) = false
       and coalesce(a.is_inactive, false) = false
       and (a.canonical_agent_id is null or a.canonical_agent_id = a.id)
       and a.user_id is not null
       and not public.is_placeholder_agent(a.agent_code, a.user_id)
       and not public.fn_agent_is_roster_excluded(a.id)
       and (a.license_status::text = 'licensed' or public.fn_license_stage_rank(a.license_progress) >= 8)
       and a.created_at >= now() - interval '45 days'
  ), app as (
    -- the application on file: the linked one, else the newest non-duplicate application with the login's email
    select p.id as agent_id,
           coalesce(
             (select ap.id from public.applications ap where ap.id = p.source_application_id),
             (select ap.id from public.applications ap
               where p.profile_email is not null and lower(btrim(ap.email)) = p.profile_email
                 and coalesce(ap.is_duplicate, false) = false
               order by ap.created_at desc limit 1)) as application_id
      from pop p
  ), states as (
    select p.id as agent_id,
           (select array_agg(distinct upper(btrim(x)) order by upper(btrim(x)))
              from unnest(coalesce(p.license_states, '{}'::text[])) x
             where upper(btrim(x)) in (select z.state from public.us_state_timezones z)) as s_agent,
           (select array_agg(distinct upper(btrim(x)) order by upper(btrim(x)))
              from public.applications ap, unnest(coalesce(ap.licensed_states, '{}'::text[])) x
             where ap.id = app.application_id
               and upper(btrim(x)) in (select z.state from public.us_state_timezones z)) as s_app_licensed,
           (select array[upper(btrim(ap.state))]
              from public.applications ap
             where ap.id = app.application_id
               and upper(btrim(ap.state)) in (select z.state from public.us_state_timezones z)) as s_app_state,
           (select array[upper(btrim(cp.resident_state))]
              from public.agent_contract_profile cp
             where cp.agent_id = p.id
               and upper(btrim(cp.resident_state)) in (select z.state from public.us_state_timezones z)) as s_resident
      from pop p
      join app on app.agent_id = p.id
  )
  select p.id,
         p.user_id,
         p.first_name,
         p.created_at,
         floor(extract(epoch from now() - p.created_at) / 86400)::int,
         coalesce(st.s_agent, st.s_app_licensed, st.s_app_state, st.s_resident),
         case when st.s_agent is not null then 'agents.license_states'
              when st.s_app_licensed is not null then 'application.licensed_states'
              when st.s_app_state is not null then 'application.state'
              when st.s_resident is not null then 'contract_profile.resident_state'
              else null end,
         v.reason is null,
         coalesce(v.reason, 'ready')
    from pop p
    join states st on st.agent_id = p.id
    cross join lateral (
      select case
        when coalesce(p.account_mode, 'agent') in ('manager', 'admin') then 'manager_seat'
        when public.fn_agent_is_suspended(p.id) then 'suspended'
        when public.fn_user_login_blocked(p.user_id) then 'login_banned'
        when public.fn_agent_interview_state(p.id) in ('upcoming', 'missed', 'never') then 'not_interviewed_yet'
        when p.last_sign_in_at is null or p.last_sign_in_at < p.created_at then 'not_signed_in_since_hire'
        when exists (select 1 from public.lead_bundle_grants g
                       join public.lead_bundles b on b.id = g.bundle_id and b.archived_at is null
                      where g.user_id = p.user_id and g.revoked_at is null) then 'has_live_lead_bundle'
        when exists (select 1 from public.lead_bundle_grants g
                       join public.lead_bundles b on b.id = g.bundle_id
                      where g.user_id = p.user_id and coalesce(b.criteria ->> 'starter_pack', '') = 'true') then 'starter_pack_already_given'
        when coalesce(st.s_agent, st.s_app_licensed, st.s_app_state, st.s_resident) is null then 'license_state_unknown'
        else null end as reason
    ) v
$function$;

-- 6. Hourly through the working day (07:15 to 16:15 Phoenix) instead of once at 09:15.
select cron.schedule('apex-starter-pack-daily', '15 14-23 * * *', 'select public.fn_starter_pack_cron()');

-- 7. "You are officially a Galaxy agent" waits for an interview. The live send gate, restated with one new rule
--    (1b). Proven in a rolled-back run: a self-enrolled person with a missed interview -> skip not_interviewed_yet;
--    a hire-link hire -> send.
CREATE OR REPLACE FUNCTION public.fn_next_step_send_gate(p_message_id uuid, p_email text DEFAULT NULL::text, p_reserve boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  m          record;
  a          record;
  v_email    text := lower(btrim(coalesce(p_email, '')));
  v_zones    text[];
  v_zone     text;
  v_day      date;
  v_variant  text;
  v_copy     jsonb;
  v_license  text;
  v_track    text;
  v_next     timestamptz;
  v_cap      jsonb;
begin
  select n.id, n.application_id, n.agent_id, n.stage_key, n.metadata, n.sent_at, n.failed_at
    into m
    from public.next_step_messages n
   where n.id = p_message_id;
  if not found then
    return jsonb_build_object('action', 'skip', 'reason', 'message_not_found');
  end if;
  if m.sent_at is not null then
    return jsonb_build_object('action', 'skip', 'reason', 'already_sent');
  end if;
  if m.failed_at is not null then
    return jsonb_build_object('action', 'skip', 'reason', 'already_failed');
  end if;

  v_zones := public.fn_next_step_send_zones(m.application_id, m.agent_id);
  v_zone  := coalesce(v_zones[1], 'America/Chicago');

  -- per-step copy: the variant ('rearm') wins over the cadence step ('hour72', ...)
  v_variant := coalesce(nullif(m.metadata->>'variant', ''), nullif(m.metadata->>'step', ''));
  if v_variant is not null then
    select jsonb_build_object('subject', c.email_subject, 'body', c.email_body, 'key', c.stage_key || ':' || c.step_key)
      into v_copy
      from public.next_step_step_copy c
     where c.stage_key = m.stage_key and c.step_key = v_variant;
  end if;

  if m.application_id is not null then
    select x.email, x.email_bounced_at, x.do_not_contact_at, x.is_duplicate, x.terminated_at,
           x.closed_at, x.license_status::text as license_status
      into a
      from public.applications x
     where x.id = m.application_id;
    if not found then
      return jsonb_build_object('action', 'skip', 'reason', 'application_not_found');
    end if;
    if v_email = '' then
      v_email := lower(btrim(coalesce(a.email, '')));
    end if;
    v_license := a.license_status;
    select ie.call_track into v_track
      from public.interview_events ie
     where ie.application_id = m.application_id and ie.canceled_at is null
       and not coalesce(ie.is_backfill_duplicate, false)
       and coalesce(ie.call_track, '') not in ('other', 'onboarding')
     order by ie.scheduled_at desc nulls last, ie.created_at desc
     limit 1;
  end if;

  -- 1. nobody with an open suspension or a live login ban
  if v_email <> '' and public.fn_email_is_suspended(v_email) then
    return jsonb_build_object('action', 'skip', 'reason', 'suspended');
  end if;
  if m.agent_id is not null and exists (
       select 1 from public.agents g
        where g.id = m.agent_id
          and (exists (select 1 from public.agent_access_suspensions s
                        where s.user_id = g.user_id and s.lifted_at is null)
               or exists (select 1 from auth.users u
                           where u.id = g.user_id and u.banned_until > now()))) then
    return jsonb_build_object('action', 'skip', 'reason', 'suspended');
  end if;

  -- 1b. MP-MONDAY-ROLLCALL (2026-11-22): the hired stage opens "You are officially a Galaxy agent". A licensed
  -- applicant who opened the course has an agent record before anyone has interviewed them; two such people were
  -- sent that line (one three times, with his interview still ahead). It waits for the interview.
  if m.agent_id is not null and m.stage_key = 'hired'
     and public.fn_agent_interview_state(m.agent_id) in ('upcoming', 'missed', 'never') then
    return jsonb_build_object('action', 'skip', 'reason', 'not_interviewed_yet');
  end if;

  -- 2. opt-outs
  if v_email <> '' and exists (select 1 from public.email_unsubscribes u where lower(btrim(u.email)) = v_email) then
    return jsonb_build_object('action', 'skip', 'reason', 'unsubscribed');
  end if;
  if v_email <> '' and exists (
       select 1 from public.email_suppressions s
        where s.email = v_email and s.last_event = 'suppressed' and s.last_seen_at >= now() - interval '30 days') then
    return jsonb_build_object('action', 'skip', 'reason', 'suppressed');
  end if;

  -- 3. applicant-stage rows
  if m.application_id is not null then
    if a.email_bounced_at is not null then
      return jsonb_build_object('action', 'skip', 'reason', 'email_bounced');
    end if;
    if a.do_not_contact_at is not null then
      return jsonb_build_object('action', 'skip', 'reason', 'do_not_contact');
    end if;
    if coalesce(a.is_duplicate, false) then
      return jsonb_build_object('action', 'skip', 'reason', 'duplicate_record');
    end if;
    if a.terminated_at is not null or a.closed_at is not null then
      return jsonb_build_object('action', 'skip', 'reason', 'closed_record');
    end if;
    -- C8 (applicant-lane mail to people who are already agents) is about the applicant
    -- LADDER: the stages a person derives into as an applicant. A row another package queues
    -- under its own template stage (PKG3's exam push reaches course finishers, hired or not)
    -- is that package's call, so it is not refused here.
    if m.stage_key in ('applied', 'watched_vsl', 'completed_application', 'contacted', 'licensed_book_call',
                       'call_booked', 'booked_seminar', 'attended_seminar', 'started_prelicense',
                       'finished_prelicense', 'exam_scheduled', 'passed_exam')
       and (public.fn_application_has_agent(m.application_id)
            or (v_email <> '' and exists (
                  select 1 from public.agents g
                    left join public.profiles p on p.user_id = g.user_id
                    left join public.profiles pp on pp.id = g.profile_id
                    left join auth.users u on u.id = g.user_id
                   where lower(btrim(p.email)) = v_email or lower(btrim(pp.email)) = v_email
                      or lower(btrim(u.email)) = v_email))) then
      return jsonb_build_object('action', 'skip', 'reason', 'has_agent_row');
    end if;
  end if;

  -- 4. a SWEEP step whose person has moved on. metadata.cadence is written only by
  --    fn_next_step_nudge_sweep (every sweep row carries it; no other sender's row does), so
  --    rows queued by other senders through this dispatcher are never judged here.
  if m.metadata ? 'cadence' and exists (
       select 1 from public.next_step_progress p
        where ((m.application_id is not null and p.application_id = m.application_id)
            or (m.agent_id is not null and p.agent_id = m.agent_id))
          and (p.current_stage_key is distinct from m.stage_key or p.status <> 'active')) then
    return jsonb_build_object('action', 'skip', 'reason', 'stage_changed');
  end if;

  -- 5. one automated next-step email per recipient per local day: defer, never drop
  if v_email <> '' then
    v_day := (now() at time zone v_zone)::date;
    if coalesce(p_reserve, false) then
      -- serialize the live send path per recipient: a second row for this address waits
      -- here until this call commits, then sees the reservation stamped below
      perform pg_advisory_xact_lock(hashtextextended('next_step_daily_cap:' || v_email, 0));
    end if;
    if exists (select 1 from public.next_step_messages c
                where c.channel = 'email' and c.sent_at is not null and c.id <> m.id
                  and lower(c.recipient) = v_email
                  and c.sent_at >= now() - interval '36 hours'
                  and (c.sent_at at time zone v_zone)::date = v_day)
    or exists (select 1 from public.email_delivery_log l
                where l.template = 'submit-application-applicant' and l.status = 'sent'
                  and lower(btrim(l.recipient_email)) = v_email
                  and l.sent_at >= now() - interval '36 hours'
                  and (l.sent_at at time zone v_zone)::date = v_day)
    or exists (select 1 from public.next_step_messages c
                where c.id <> m.id and c.fallback_of_id is null and c.failed_at is null
                  and c.metadata ? 'cap'
                  and c.metadata->'cap'->>'email' = v_email
                  and c.metadata->'cap'->>'day' = v_day::text
                  and (c.sent_at is not null
                       or (c.metadata->'cap'->>'at')::timestamptz >= now() - interval '30 minutes')) then
      v_next := (((v_day + 1)::timestamp + interval '8 hours') at time zone v_zone);
      return jsonb_build_object('action', 'defer', 'reason', 'daily_cap', 'not_before', v_next, 'zone', v_zone,
                                'copy', v_copy, 'license_status', v_license, 'call_track', v_track);
    end if;
    if coalesce(p_reserve, false) then
      v_cap := jsonb_build_object('email', v_email, 'day', v_day::text, 'zone', v_zone, 'at', now());
      update public.next_step_messages n
         set metadata = coalesce(n.metadata, '{}'::jsonb) || jsonb_build_object('cap', v_cap)
       where n.id = m.id;
    end if;
  end if;

  return jsonb_build_object('action', 'send', 'zone', v_zone, 'copy', v_copy,
                            'license_status', v_license, 'call_track', v_track, 'cap', v_cap);
end
$function$;
