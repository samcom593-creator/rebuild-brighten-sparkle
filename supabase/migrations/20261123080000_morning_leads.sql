-- MP-MORNING-LEADS (2026-11-23, Sam, 12:20 AM before a production push): "make sure every person licensed
-- [has leads] for tomorrow morning ... everyone must start writing."
--
-- Measured first (52 active licensed agent records, 45 after the owner, 5 blocked logins and 1 with no login):
--   * 6 hold 10 or more unworked leads. 39 hold none.
--   * The starter pack reaches only hires of the last 45 days, once, ever: 3 people whose pack is used up and
--     every licensed agent older than 45 days were outside it.
--   * 28 have no licence state in agents, the application or the contract profile. AgentLink's own agent
--     record and the profile supply a home state for 7 of them; 21 have none anywhere.
--
-- What this adds:
--   1. fn_agent_lead_states(agent): one place that answers "which states can this agent be given leads in",
--      strongest record first.
--   2. fn_morning_lead_candidates(): every active licensed agent and why they would or would not get leads.
--   3. fn_grant_morning_leads(): tops every eligible agent up to 25 unworked leads, state matched, from the
--      same clean tier A/B inventory the starter pack uses. Someone who does not work their leads never gets
--      more; someone who burns through them is refilled within the hour.
--   4. fn_morning_leads_announce(): one email per agent per day, with the one-tap login to My Leads.
--   5. Cron apex-morning-leads: 06:45 to 16:45 Phoenix, Monday to Saturday. Switch: morning_leads_enabled.
--   6. owner_licensed_leads_board(): the owner's view of who is blocked and what unblocks them.
--   7. Saving a state or marking an interview on the owner's list grants that person's leads at once.
--   8. fn_agent_interview_state: a call whose time passed more than 14 days ago counts as held when the
--      person signed in after it. Results are recorded on about 2 in 100 calls, so "no result" on an old
--      call says nothing; on a recent one it is the person still waiting.

alter table public.hire_lane_email_outbox drop constraint if exists hire_lane_email_outbox_kind_check;
alter table public.hire_lane_email_outbox add constraint hire_lane_email_outbox_kind_check
  check (kind = any (array['starter_pack', 'contracting_request', 'recruit_page', 'recruit_digest', 'morning_leads']));

insert into public.system_settings (key, value)
select 'morning_leads_enabled', 'true'
 where not exists (select 1 from public.system_settings s where s.key = 'morning_leads_enabled');

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
                    and (ie.outcome in ('completed', 'hired', 'contracted', 'passed')
                         or ie.scheduled_at < a.created_at
                         -- an old call with no result recorded counts as held when the person kept using
                         -- the portal after it (results are recorded on about 2 calls in 100)
                         or (ie.scheduled_at < now() - interval '14 days'
                             and exists (select 1 from auth.users u
                                          where u.id = a.user_id and u.last_sign_in_at > ie.scheduled_at))))
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

-- Strongest record first. A state the agent or staff wrote down beats one inferred from where they live.
create or replace function public.fn_agent_lead_states(p_agent_id uuid)
returns table(states text[], source text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with a as (
    select g.id, g.license_states, g.source_application_id, g.profile_id, g.al_user_id, g.insuracloud_user_id,
           (select lower(btrim(pr.email)) from public.profiles pr where pr.id = g.profile_id) as email
      from public.agents g
     where g.id = p_agent_id
  ), app as (
    select coalesce(
             (select ap.id from public.applications ap, a where ap.id = a.source_application_id),
             (select ap.id from public.applications ap, a
               where a.email is not null and lower(btrim(ap.email)) = a.email
                 and coalesce(ap.is_duplicate, false) = false
               order by ap.created_at desc limit 1)) as application_id
  ), src as (
    select 1 as ord, 'agents.license_states'::text as source,
           (select array_agg(distinct upper(btrim(x)) order by upper(btrim(x)))
              from a, unnest(coalesce(a.license_states, '{}'::text[])) x
             where upper(btrim(x)) in (select z.state from public.us_state_timezones z)) as states
    union all
    select 2, 'contracting_intake.license_states',
           (select array_agg(distinct upper(btrim(x)) order by upper(btrim(x)))
              from (select ci.license_states from public.contracting_intakes ci, a
                     where ci.agent_id = a.id and ci.license_states is not null
                     order by ci.updated_at desc nulls last limit 1) q, unnest(q.license_states) x
             where upper(btrim(x)) in (select z.state from public.us_state_timezones z))
    union all
    select 3, 'application.licensed_states',
           (select array_agg(distinct upper(btrim(x)) order by upper(btrim(x)))
              from public.applications ap, app, unnest(coalesce(ap.licensed_states, '{}'::text[])) x
             where ap.id = app.application_id
               and upper(btrim(x)) in (select z.state from public.us_state_timezones z))
    union all
    select 4, 'application.state',
           (select array[upper(btrim(ap.state))] from public.applications ap, app
             where ap.id = app.application_id
               and upper(btrim(ap.state)) in (select z.state from public.us_state_timezones z))
    union all
    select 5, 'contract_profile.resident_state',
           (select array[upper(btrim(cp.resident_state))] from public.agent_contract_profile cp, a
             where cp.agent_id = a.id
               and upper(btrim(cp.resident_state)) in (select z.state from public.us_state_timezones z))
    union all
    select 6, 'agentlink.residence_state',
           (select array[upper(btrim(coalesce(nullif(btrim(g.residence_state), ''), g.state)))]
              from public.agentlink_agents g, a
             where (g.local_agent_id = a.id
                    or (a.al_user_id is not null and g.insuracloud_user_id = a.al_user_id)
                    or (a.insuracloud_user_id is not null and g.insuracloud_user_id = a.insuracloud_user_id)
                    or (a.email is not null and lower(btrim(g.email)) = a.email))
               and upper(btrim(coalesce(nullif(btrim(g.residence_state), ''), g.state)))
                   in (select z.state from public.us_state_timezones z)
             order by g.updated_at desc nulls last limit 1)
    union all
    select 7, 'profile.state',
           (select array[upper(btrim(pr.state))] from public.profiles pr, a
             where pr.id = a.profile_id
               and upper(btrim(pr.state)) in (select z.state from public.us_state_timezones z))
  )
  select s.states, s.source from src s where s.states is not null order by s.ord limit 1
$function$;
revoke all on function public.fn_agent_lead_states(uuid) from public, anon, authenticated;

create or replace function public.fn_morning_lead_candidates()
returns table(agent_id uuid, user_id uuid, first_name text, full_name text, mode text, last_sign_in_at timestamptz,
              license_states text[], state_source text, new_leads integer, live_leads integer,
              eligible boolean, reason text)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with pop as (
    select a.id, a.user_id, coalesce(a.account_mode, 'agent') as mode,
           coalesce(nullif(btrim(a.display_name), ''),
                    (select nullif(btrim(pr.full_name), '') from public.profiles pr where pr.id = a.profile_id),
                    'there') as full_name,
           (select u.last_sign_in_at from auth.users u where u.id = a.user_id) as last_sign_in_at
      from public.agents a
     where a.status::text = 'active'
       and coalesce(a.is_deactivated, false) = false
       and coalesce(a.is_inactive, false) = false
       and (a.canonical_agent_id is null or a.canonical_agent_id = a.id)
       and a.license_status::text = 'licensed'
       and coalesce(a.account_mode, 'agent') <> 'admin'
       and (a.user_id is null or not public.is_placeholder_agent(a.agent_code, a.user_id))
       and not public.fn_agent_is_roster_excluded(a.id)
  )
  select p.id, p.user_id,
         coalesce(nullif(split_part(btrim(p.full_name), ' ', 1), ''), 'there'),
         p.full_name, p.mode, p.last_sign_in_at,
         st.states, st.source, ld.new_leads, ld.live_leads,
         v.reason is null, coalesce(v.reason, 'ready')
    from pop p
    left join lateral public.fn_agent_lead_states(p.id) st on true
    cross join lateral (
      select count(*) filter (where i.status = 'new')::int as new_leads, count(*)::int as live_leads
        from public.lead_bundle_grants g
        join public.lead_bundles b on b.id = g.bundle_id and b.archived_at is null
        join public.lead_bundle_items i on i.bundle_id = b.id and i.removed_at is null
       where g.user_id = p.user_id and g.revoked_at is null
    ) ld
    cross join lateral (
      select case
        when p.user_id is null then 'no_login'
        when public.fn_agent_is_suspended(p.id) then 'suspended'
        when public.fn_user_login_blocked(p.user_id) then 'login_banned'
        when public.fn_agent_interview_state(p.id) in ('upcoming', 'missed', 'never') then 'not_interviewed_yet'
        when ld.new_leads >= 10 then 'has_leads'
        when st.states is null then 'license_state_unknown'
        else null end as reason
    ) v
$function$;
revoke all on function public.fn_morning_lead_candidates() from public, anon, authenticated;

create or replace function public.fn_grant_morning_leads(
  p_dry_run boolean default true, p_limit integer default 10, p_only_agent uuid default null)
returns table(agent_id uuid, first_name text, license_states text[], leads_added integer, decision text, reason text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  c record;
  v_granted integer := 0;
  v_cap integer := greatest(0, least(coalesce(p_limit, 10), 100));
  v_need integer;
  v_bundle uuid;
  v_n integer;
  v_day text := to_char(now() at time zone 'America/Phoenix', 'Mon DD');
begin
  if not p_dry_run then
    -- one live run at a time: two concurrent runs must not hand the same agent two batches
    perform pg_advisory_xact_lock(hashtextextended('fn_grant_morning_leads', 7));
  end if;

  for c in
    select * from public.fn_morning_lead_candidates() k
     where p_only_agent is null or k.agent_id = p_only_agent
     order by k.eligible desc, k.last_sign_in_at desc nulls last
  loop
    agent_id := c.agent_id;
    first_name := c.first_name;
    license_states := c.license_states;
    leads_added := 0;

    if not c.eligible then
      decision := 'skip';
      reason := c.reason;
      return next;
      continue;
    end if;
    if v_granted >= v_cap then
      decision := 'deferred_limit';
      reason := 'p_limit reached; eligible again on the next run';
      return next;
      continue;
    end if;

    v_need := greatest(1, 25 - c.new_leads);
    if p_dry_run then
      decision := 'would_grant';
      leads_added := v_need;
      reason := 'up to ' || v_need || ' leads in ' || array_to_string(c.license_states, ', ') || ' (states from ' || c.state_source || ')';
      v_granted := v_granted + 1;
      return next;
      continue;
    end if;

    insert into public.lead_bundles (name, format, criteria, note, created_by)
    values ('Morning leads · ' || c.first_name || ' · ' || v_day,
            'client_leads',
            jsonb_build_object('pool', 'morning_batch', 'morning_batch', true, 'agent_id', c.agent_id,
                               'states', to_jsonb(c.license_states), 'state_source', c.state_source,
                               'tiers', jsonb_build_array('A', 'B'), 'limit', v_need,
                               'granted_by', 'fn_grant_morning_leads'),
            null, null)
    returning id into v_bundle;

    insert into public.lead_bundle_items
      (bundle_id, lead_id, source_kind, phone10, first_name, last_name, email, state, age,
       quality_tier, quality_reason, status, attrs)
    select v_bundle, e.lead_id, e.source, e.phone10, e.first_name, e.last_name, e.email, e.state, e.age,
           e.tier, e.tags, 'new',
           coalesce(e.flags, '{}'::jsonb) || jsonb_build_object('lead_age_days', e.lead_age_days,
                                                                'under_9mo', e.under_9mo,
                                                                'pool', e.source,
                                                                'morning_batch', true)
      from public.fn_starter_pack_inventory(c.license_states, v_need) e
    on conflict (phone10) where (removed_at is null) do nothing;
    get diagnostics v_n = row_count;

    if v_n < 5 then
      -- not enough clean leads in this agent's states for a batch worth opening
      delete from public.lead_bundles where id = v_bundle;
      decision := 'skip';
      reason := 'only ' || v_n || ' clean tier A/B lead(s) in ' || array_to_string(c.license_states, ', ');
      leads_added := 0;
      return next;
      continue;
    end if;

    insert into public.lead_bundle_grants (bundle_id, user_id, granted_by, note)
    values (v_bundle, c.user_id, null, 'morning leads (automatic)');
    insert into public.lead_bundle_events (bundle_id, user_id, actor, action, detail)
    values (v_bundle, null, null, 'created',
            jsonb_build_object('items', v_n, 'morning_batch', true, 'states', to_jsonb(c.license_states))),
           (v_bundle, c.user_id, null, 'granted',
            jsonb_build_object('agent_id', c.agent_id, 'items', v_n, 'morning_batch', true));

    v_granted := v_granted + 1;
    decision := 'granted';
    leads_added := v_n;
    reason := v_n || ' leads in ' || array_to_string(c.license_states, ', ') || '; bundle ' || v_bundle::text;
    return next;
  end loop;
end;
$function$;
revoke all on function public.fn_grant_morning_leads(boolean, integer, uuid) from public, anon, authenticated;

-- One email per agent per Phoenix day, for a batch landed in the last 30 hours. Leads granted overnight are
-- announced by the first morning run, so nobody is emailed at midnight.
create or replace function public.fn_morning_leads_announce(p_dry_run boolean default true, p_only_agent uuid default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  r record;
  v_day text := to_char(now() at time zone 'America/Phoenix', 'YYYY-MM-DD');
  v_id uuid;
  v_out jsonb := '[]'::jsonb;
  v_subject text;
  v_text text;
  v_html text;
begin
  for r in
    select k.agent_id, k.user_id, k.first_name, k.new_leads
      from public.fn_morning_lead_candidates() k
     where k.user_id is not null
       and (p_only_agent is null or k.agent_id = p_only_agent)
       and k.new_leads > 0
       and k.reason not in ('suspended', 'login_banned')
       and exists (select 1 from public.lead_bundle_grants g
                     join public.lead_bundles b on b.id = g.bundle_id and b.archived_at is null
                    where g.user_id = k.user_id and g.revoked_at is null
                      and coalesce(b.criteria ->> 'morning_batch', '') = 'true'
                      and b.created_at >= now() - interval '30 hours')
       and not exists (select 1 from public.hire_lane_email_outbox o
                        where o.dedupe_key = 'morning_leads:' || k.agent_id::text || ':' || v_day)
  loop
    if p_dry_run then
      v_out := v_out || jsonb_build_array(jsonb_build_object('agent_id', r.agent_id, 'first_name', r.first_name, 'leads', r.new_leads));
      continue;
    end if;
    v_subject := r.first_name || ', ' || r.new_leads || ' leads are in My Leads for you today';
    v_text := r.first_name || ', ' || r.new_leads || ' leads matched to your state are in My Leads. '
           || 'Call them from your phone between 8 AM and 7 PM their time, and log each call.' || E'\n\n'
           || 'Open My Leads: {{login_link}}' || E'\n\n' || 'Sam';
    v_html := '<p>' || public.fn_pkg2_html_escape(r.first_name) || ', ' || r.new_leads
           || ' leads matched to your state are in My Leads. '
           || 'Call them from your phone between 8 AM and 7 PM their time, and log each call.</p>'
           || '<p><a href="{{login_link}}" style="display:inline-block;padding:10px 18px;background:#EDB81D;color:#0a0f1a;'
           || 'text-decoration:none;border-radius:6px;font-weight:600;">Open My Leads</a></p>'
           || '<p>Sam</p>';
    v_id := public.fn_hire_lane_email_enqueue(
      'morning_leads', 'morning_leads:' || r.agent_id::text || ':' || v_day, r.user_id, r.agent_id,
      v_subject, v_text, v_html, null, 'leads', jsonb_build_object('leads', r.new_leads));
    v_out := v_out || jsonb_build_array(jsonb_build_object('agent_id', r.agent_id, 'first_name', r.first_name,
                                                           'leads', r.new_leads, 'queued', v_id is not null));
  end loop;
  return jsonb_build_object('dry_run', p_dry_run, 'day', v_day, 'emails', v_out);
end;
$function$;
revoke all on function public.fn_morning_leads_announce(boolean, uuid) from public, anon, authenticated;

create or replace function public.fn_morning_leads_cron()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_rows jsonb;
  v_mail jsonb;
begin
  if coalesce(lower(btrim((select s.value from public.system_settings s where s.key = 'morning_leads_enabled'))), 'false') <> 'true' then
    return jsonb_build_object('skipped', 'morning_leads_enabled is not true', 'at', now());
  end if;
  select coalesce(jsonb_agg(jsonb_build_object('first_name', g.first_name, 'decision', g.decision,
                                               'leads', g.leads_added, 'reason', g.reason))
                    filter (where g.decision <> 'skip'), '[]'::jsonb)
    into v_rows
    from public.fn_grant_morning_leads(false, 100) g;
  v_mail := public.fn_morning_leads_announce(false);
  return jsonb_build_object('ran', true, 'granted', v_rows, 'mail', v_mail, 'at', now());
end;
$function$;
revoke all on function public.fn_morning_leads_cron() from public, anon, authenticated;

-- The owner's view: everyone licensed, whether they hold leads, and the one thing that unblocks each.
create or replace function public.owner_licensed_leads_board()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
set statement_timeout to '30s'
as $function$
declare
  v_uid uuid := auth.uid();
  v_rows jsonb;
begin
  if v_uid is null or not public.has_role(v_uid, 'admin'::public.app_role) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  select coalesce(jsonb_agg(jsonb_build_object(
           'agent_id', k.agent_id,
           'name', k.full_name,
           'phone', ph.phone,
           'phone_state_hint', case when k.license_states is null then
                                 (select ac.state from public.us_area_codes ac where ac.area_code::text = left(ph.phone, 3) limit 1) end,
           'last_sign_in_at', k.last_sign_in_at,
           'license_states', k.license_states,
           'state_source', k.state_source,
           'new_leads', k.new_leads,
           'live_leads', k.live_leads,
           'reason', k.reason
         ) order by k.last_sign_in_at desc nulls last), '[]'::jsonb)
    into v_rows
    from public.fn_morning_lead_candidates() k
    left join lateral (
      -- a self-enrolled applicant's number is on the application or the booking, not the profile
      select nullif(right(regexp_replace(coalesce(
               nullif(pr.phone, ''), nullif(ap.phone, ''),
               (select ie.invitee_phone from public.interview_events ie
                 where ie.application_id = a.source_application_id and ie.invitee_phone is not null
                 order by ie.scheduled_at desc limit 1), ''), '\D', '', 'g'), 10), '') as phone
        from public.agents a
        left join public.profiles pr on pr.id = a.profile_id
        left join public.applications ap on ap.id = a.source_application_id
       where a.id = k.agent_id
    ) ph on true;
  return jsonb_build_object(
    'enabled', coalesce(lower(btrim((select s.value from public.system_settings s where s.key = 'morning_leads_enabled'))), 'false') = 'true',
    'rows', v_rows);
end;
$function$;
revoke all on function public.owner_licensed_leads_board() from public, anon;
grant execute on function public.owner_licensed_leads_board() to authenticated;

-- Saving a state or marking an interview is the moment that person becomes eligible: grant then, not at :45.
create or replace function public.fn_morning_leads_grant_one(p_agent_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v jsonb;
begin
  if coalesce(lower(btrim((select s.value from public.system_settings s where s.key = 'morning_leads_enabled'))), 'false') <> 'true' then
    return jsonb_build_object('decision', 'skip', 'reason', 'morning leads are switched off');
  end if;
  select jsonb_build_object('decision', g.decision, 'leads', g.leads_added, 'reason', g.reason)
    into v
    from public.fn_grant_morning_leads(false, 1, p_agent_id) g
   limit 1;
  -- Tell only this person, and only in waking hours: a save at 1 AM is announced by the 06:45 run instead.
  if v ->> 'decision' = 'granted'
     and extract(hour from now() at time zone 'America/Phoenix') between 6 and 19 then
    perform public.fn_morning_leads_announce(false, p_agent_id);
  end if;
  return coalesce(v, jsonb_build_object('decision', 'skip', 'reason', 'not a licensed active agent'));
exception when others then
  -- the save that called this must never fail because a grant did
  return jsonb_build_object('decision', 'error', 'reason', sqlerrm);
end;
$function$;
revoke all on function public.fn_morning_leads_grant_one(uuid) from public, anon, authenticated;

create or replace function public.owner_monday_rollcall_set_states(p_agent_id uuid, p_states text[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '30s'
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
  return jsonb_build_object('ok', true, 'states', to_jsonb(v_states), 'leads', public.fn_morning_leads_grant_one(p_agent_id));
end;
$function$;
revoke all on function public.owner_monday_rollcall_set_states(uuid, text[]) from public, anon;
grant execute on function public.owner_monday_rollcall_set_states(uuid, text[]) to authenticated;

create or replace function public.owner_monday_rollcall_mark(
  p_agent_id uuid, p_mark text, p_note text default null, p_monday date default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '30s'
as $function$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_monday date;
  v_name text;
  v_id uuid;
  v_leads jsonb;
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
  if p_mark = 'interviewed' then
    v_leads := public.fn_morning_leads_grant_one(p_agent_id);
  end if;
  return jsonb_build_object('ok', true, 'id', v_id, 'monday', v_monday, 'leads', v_leads);
end;
$function$;
revoke all on function public.owner_monday_rollcall_mark(uuid, text, text, date) from public, anon;
grant execute on function public.owner_monday_rollcall_mark(uuid, text, text, date) to authenticated;

select cron.schedule('apex-morning-leads', '45 13-23 * * 1-6', 'select public.fn_morning_leads_cron()');
