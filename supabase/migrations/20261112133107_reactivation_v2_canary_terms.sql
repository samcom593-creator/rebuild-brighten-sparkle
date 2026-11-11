-- 20261112133107_reactivation_v2_canary_terms.sql
-- MP-BOB-CONVERSION v2: the canary terms ANCHOR signed off on 2026-11-11, enforced by the engine itself rather than
-- by whoever remembers them (recorded in ~/business-ops/2026-11-11-onboarding-anchor/decisions/DECISIONS.md).
-- Hand-applied with bot-sql and recorded in schema_migrations; every statement is safe to run twice (R-M3).
--
--   1. Canary at reactivation_daily_cap = 5 for two qualifying local (America/Phoenix) days.
--   2. Ramp 5 -> 15 -> 25 only after a qualifying day: at least 3 sends that day, every one settled with a provider
--      id (no held "maybe sent" rows), 0 bounces, 0 complaints, 0 sends to anyone the gate should have refused, the
--      breaker closed, and the reply reader completed a sweep within the hour. Never above 25 automatically: going
--      further is the BoB lane's call under Sam's mandate.
--   3. While the cap is 25 or below, ANY bounce, complaint or gate miss on a v2 send sets the cap to 0 and opens the
--      breaker. It is raised again only after a fix: set system_settings.reactivation_incident_ack to the fix time
--      (only sends after it count), then set the cap back to 5.
--
-- A gate miss is judged with time on its side wherever the data has a clock (an agent row created BEFORE the send,
-- an application filed after the cutoff BEFORE the send, an opt-out BEFORE the send), so a person who converts
-- BECAUSE of the email is never counted as a miss. Producer rosters have no clock and producers do not appear
-- overnight, so any match counts. v_onboarding_owned_people has no clock either and is checked at claim time,
-- seconds before every send, by fn_reactivation_gate.

begin;

insert into public.system_settings (key, value) values
  ('reactivation_incident_ack', ''),
  ('reactivation_ramp_state', ''),
  ('reactivation_ramp_log', '')
on conflict (key) do nothing;

create or replace function public.fn_reactivation_incidents()
returns table(bounced integer, complained integer, gate_misses integer, since timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare v_since timestamptz;
begin
  begin
    v_since := nullif(btrim((select s.value from public.system_settings s where s.key = 'reactivation_incident_ack')), '')::timestamptz;
  exception when others then
    v_since := null;   -- an unreadable ack acknowledges nothing
  end;
  return query
  with sends as (
    select m.application_id, lower(btrim(m.recipient)) as email, m.sent_at, m.external_id,
           public.fn_reactivation_phone10(a.phone) as phone10, a.email_consent_given
      from public.next_step_messages m
      join public.applications a on a.id = m.application_id
     where m.stage_key like 'reactivation\_v2\_%' escape '\' and m.fallback_of_id is null and m.sent_at is not null
       and m.sent_at >= coalesce(v_since, '-infinity'::timestamptz)
  )
  select
    (select count(*)::int from sends s join public.email_events e on e.resend_id = s.external_id where e.last_event = 'bounced'),
    (select count(*)::int from sends s join public.email_events e on e.resend_id = s.external_id where e.last_event = 'complained'),
    (select count(*)::int from sends s
      where s.email_consent_given is not true
         or exists (select 1 from public.email_unsubscribes u where lower(u.email) = s.email and u.unsubscribed_at < s.sent_at)
         or exists (select 1 from public.agents g where g.source_application_id = s.application_id and g.created_at < s.sent_at)
         or exists (select 1 from public.profiles pr
                     where (lower(btrim(pr.email)) = s.email
                            or (s.phone10 is not null and public.fn_reactivation_phone10(pr.phone) = s.phone10))
                       and exists (select 1 from public.agents g
                                    where (g.user_id = pr.user_id or g.profile_id = pr.id) and g.created_at < s.sent_at))
         or exists (select 1 from public.agentlink_roster r
                     where (r.approval_status = 'approved' or coalesce(r.total_contracts, 0) > 0 or r.producer_active is true)
                       and (lower(btrim(r.email)) = s.email
                            or (s.phone10 is not null and public.fn_reactivation_phone10(r.phone) = s.phone10)))
         or exists (select 1 from public.ethos_roster r
                     where lower(btrim(r.email)) = s.email
                        or (s.phone10 is not null and public.fn_reactivation_phone10(r.phone) = s.phone10))
         or exists (select 1 from public.applications a2
                     where lower(btrim(a2.email)) = s.email and a2.created_at >= public.fn_lane_ladder_cutoff()
                       and a2.created_at < s.sent_at)),
    v_since;
end $$;

-- Claim: the canary rule runs right after the cap check, before anything else can send.
create or replace function public.fn_reactivation_canary_guard(p_cap integer)
returns text language plpgsql security definer set search_path = public as $$
declare v record;
begin
  if p_cap > 25 then
    return null;
  end if;
  select * into v from public.fn_reactivation_incidents();
  if v.bounced = 0 and v.complained = 0 and v.gate_misses = 0 then
    return null;
  end if;
  update public.system_settings set value = '0', updated_at = now() where key = 'reactivation_daily_cap';
  perform public.fn_reactivation_trip(
    'canary incident: ' || v.bounced || ' bounced, ' || v.complained || ' complained, ' || v.gate_misses
      || ' sent to someone the gate should have refused; cap set to 0. After the fix set reactivation_incident_ack, then the cap',
    null);
  return 'paused_incident';
end $$;

-- The nightly ramp (pg_cron 01:30 UTC = 18:30 Phoenix, after the last recipient window closes at 16:59 Pacific).
create or replace function public.fn_reactivation_ramp_evaluate(p_now timestamptz default now())
returns text language plpgsql security definer set search_path = public as $$
declare
  v_cap int; v_day date := (p_now at time zone 'America/Phoenix')::date;
  v_state text; v_step int; v_days int := 0; v_last date;
  v_sent int; v_noid int; v_unsettled int; v_inc record; v_b record; v_poll timestamptz;
  v_need int; v_next int; v_ok boolean; v_why text := ''; v_out text;
begin
  select case when btrim(s.value) ~ '^[0-9]{1,6}$' then btrim(s.value)::int else 0 end into v_cap
    from public.system_settings s where s.key = 'reactivation_daily_cap';
  v_cap := coalesce(v_cap, 0);
  if v_cap not in (5, 15) then
    v_out := 'no ramp: cap ' || v_cap || ' is not an automatic step (5 or 15)';
  else
    select s.value into v_state from public.system_settings s where s.key = 'reactivation_ramp_state';
    begin
      v_step := nullif(split_part(coalesce(v_state, ''), '|', 1), '')::int;
      v_days := coalesce(nullif(split_part(coalesce(v_state, ''), '|', 2), '')::int, 0);
      v_last := nullif(split_part(coalesce(v_state, ''), '|', 3), '')::date;
    exception when others then
      v_step := null; v_days := 0; v_last := null;
    end;
    if v_step is distinct from v_cap then
      v_days := 0;   -- the cap moved (by hand, by a ramp or by an incident reset): count afresh at this step
    end if;
    if v_last = v_day and v_step = v_cap then
      return 'already evaluated ' || v_day;
    end if;
    select count(*) into v_sent from public.next_step_messages m
     where m.stage_key like 'reactivation\_v2\_%' escape '\' and m.fallback_of_id is null and m.sent_at is not null
       and (m.sent_at at time zone 'America/Phoenix')::date = v_day;
    select count(*) into v_noid from public.next_step_messages m
     where m.stage_key like 'reactivation\_v2\_%' escape '\' and m.sent_at is not null
       and (m.sent_at at time zone 'America/Phoenix')::date = v_day
       and (m.external_id is null or btrim(m.external_id) = '');
    select count(*) into v_unsettled from public.reactivation_sequence q
     where (q.status = 'active' and q.claimed_at is not null and q.claimed_at < p_now - interval '15 minutes')
        or (q.status = 'held' and q.stop_reason in ('sent_but_unrecorded', 'already_sent_unadvanced', 'unverified_provider',
                                                     'claim_stale_unverified', 'unverified_timeout', 'unverified_transport')
            or (q.status = 'held' and q.stop_reason like 'unverified\_%' escape '\'));
    select * into v_inc from public.fn_reactivation_incidents();
    select * into v_b from public.fn_reactivation_breaker_state();
    v_poll := public.fn_reactivation_reply_last_ok();
    if v_sent < 3 then v_why := v_why || ' only ' || v_sent || ' sent;'; end if;
    if v_noid > 0 then v_why := v_why || ' ' || v_noid || ' without a provider id;'; end if;
    if v_unsettled > 0 then v_why := v_why || ' ' || v_unsettled || ' unsettled claim(s);'; end if;
    if v_inc.bounced + v_inc.complained + v_inc.gate_misses > 0 then v_why := v_why || ' incidents open;'; end if;
    if v_b.is_open then v_why := v_why || ' breaker open;'; end if;
    if v_poll is null or v_poll < p_now - interval '1 hour' then v_why := v_why || ' reply reader not current;'; end if;
    v_ok := v_why = '';
    if v_ok then
      v_days := v_days + 1;
    end if;
    v_need := case v_cap when 5 then 2 else 1 end;
    if v_ok and v_days >= v_need then
      v_next := case v_cap when 5 then 15 else 25 end;
      update public.system_settings set value = v_next::text, updated_at = now() where key = 'reactivation_daily_cap';
      v_out := 'ramped ' || v_cap || ' -> ' || v_next || ' after ' || v_days || ' qualifying day(s)';
      v_step := v_next; v_days := 0;
    elsif v_ok then
      v_out := 'qualifying day ' || v_days || '/' || v_need || ' at cap ' || v_cap || ' (' || v_sent || ' sent)';
      v_step := v_cap;
    else
      v_out := 'day did not qualify at cap ' || v_cap || ':' || v_why;
      v_step := v_cap;
    end if;
    insert into public.system_settings (key, value, updated_at)
    values ('reactivation_ramp_state', v_step || '|' || v_days || '|' || v_day, now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;
  insert into public.system_settings (key, value, updated_at)
  values ('reactivation_ramp_log', to_char(p_now at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || ' ' || left(v_out, 300), now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return v_out;
end $$;

-- Wire the canary guard into the claim (only the guard call is new; the rest is 20261112131529's body).
create or replace function public.fn_reactivation_claim_next()
returns table(application_id uuid, touch smallint, track text, variant text, email text, first_name text,
              last_name text, reason text)
language plpgsql security definer set search_path = public as $$
declare
  v_cap int; v_sent_today int; v_n int; v_bounced int; v_complained int;
  v_cov_n int; v_cov_hit int; v_sent7 int; v_stop7 int; v_fail1h int;
  v_poll timestamptz; v_b record; v_guard text;
  r record; v_gate text; v_track text; v_variant text;
begin
  select coalesce(nullif(btrim(s.value), '')::int, 0) into v_cap from public.system_settings s where s.key = 'reactivation_daily_cap';
  v_cap := coalesce(v_cap, 0);
  if v_cap <= 0 then
    return query select null::uuid, null::smallint, null::text, null::text, null::text, null::text, null::text, 'paused_cap_0'::text;
    return;
  end if;
  v_guard := public.fn_reactivation_canary_guard(v_cap);
  if v_guard is not null then
    return query select null::uuid, null::smallint, null::text, null::text, null::text, null::text, null::text, v_guard;
    return;
  end if;
  select * into v_b from public.fn_reactivation_breaker_state();
  if v_b.is_open then
    return query select null::uuid, null::smallint, null::text, null::text, null::text, null::text, null::text,
                        ('paused_breaker: ' || coalesce(v_b.reason, '?'))::text;
    return;
  end if;
  if exists (select 1 from public.reactivation_sequence s where s.status = 'active' and s.claimed_at is not null) then
    return query select null::uuid, null::smallint, null::text, null::text, null::text, null::text, null::text, 'claim_outstanding'::text;
    return;
  end if;
  v_poll := public.fn_reactivation_reply_last_ok();
  if v_poll is null or v_poll < now() - interval '24 hours' then
    return query select null::uuid, null::smallint, null::text, null::text, null::text, null::text, null::text, 'paused_reply_reader_stale'::text;
    return;
  end if;
  select count(*) into v_sent_today from public.next_step_messages m
   where m.stage_key like 'reactivation\_v2\_%' escape '\' and m.fallback_of_id is null and m.sent_at is not null
     and (m.sent_at at time zone 'America/Phoenix')::date = (now() at time zone 'America/Phoenix')::date;
  if v_sent_today >= v_cap then
    return query select null::uuid, null::smallint, null::text, null::text, null::text, null::text, null::text, 'daily_cap_reached'::text;
    return;
  end if;
  select count(*), count(*) filter (where e.last_event = 'bounced'), count(*) filter (where e.last_event = 'complained')
    into v_n, v_bounced, v_complained
    from public.next_step_messages m join public.email_events e on e.resend_id = m.external_id
   where m.stage_key like 'reactivation\_v2\_%' escape '\' and m.sent_at >= now() - interval '14 days';
  if v_complained > 0 then
    perform public.fn_reactivation_trip('spam complaint on a reactivation email', null);
    return query select null::uuid, null::smallint, null::text, null::text, null::text, null::text, null::text, 'paused_complaint'::text;
    return;
  end if;
  if v_n >= 25 and v_bounced::numeric / v_n >= 0.08 then
    perform public.fn_reactivation_trip('bounce rate ' || v_bounced || ' of ' || v_n || ' in 14 days', null);
    return query select null::uuid, null::smallint, null::text, null::text, null::text, null::text, null::text, 'paused_bounce_8pct'::text;
    return;
  end if;
  select count(*), count(e.resend_id) into v_cov_n, v_cov_hit
    from public.next_step_messages m left join public.email_events e on e.resend_id = m.external_id
   where m.stage_key like 'reactivation\_v2\_%' escape '\' and m.fallback_of_id is null and m.sent_at is not null
     and m.sent_at >= now() - interval '7 days' and m.sent_at < now() - interval '2 hours';
  if v_cov_n >= 5 and v_cov_hit::numeric / v_cov_n < 0.5 then
    perform public.fn_reactivation_trip('events_blind: ' || v_cov_hit || ' of ' || v_cov_n || ' sends have a provider event', null);
    return query select null::uuid, null::smallint, null::text, null::text, null::text, null::text, null::text, 'paused_events_blind'::text;
    return;
  end if;
  select count(*) into v_sent7 from public.next_step_messages m
   where m.stage_key like 'reactivation\_v2\_%' escape '\' and m.fallback_of_id is null and m.sent_at >= now() - interval '7 days';
  select count(*) into v_stop7 from public.reactivation_replies r
   where r.classification = 'stop' and r.created_at >= now() - interval '7 days'
     and exists (select 1 from public.next_step_messages m
                  where m.stage_key like 'reactivation\_v2\_%' escape '\' and m.sent_at is not null
                    and (m.application_id = r.application_id or lower(btrim(m.recipient)) = r.email_lower));
  if v_sent7 >= 20 and v_stop7::numeric / v_sent7 >= 0.05 then
    perform public.fn_reactivation_trip('stop_rate: ' || v_stop7 || ' STOP replies on ' || v_sent7 || ' sends in 7 days', null);
    return query select null::uuid, null::smallint, null::text, null::text, null::text, null::text, null::text, 'paused_stop_rate'::text;
    return;
  end if;
  select count(*) into v_fail1h from public.next_step_messages m
   where m.stage_key like 'reactivation\_v2\_%' escape '\' and m.failed_at >= now() - interval '1 hour'
     and coalesce((m.metadata->>'retryable')::boolean, false);
  if v_fail1h >= 3 then
    perform public.fn_reactivation_trip(v_fail1h || ' retryable send failures in 1 hour', interval '1 hour');
    return query select null::uuid, null::smallint, null::text, null::text, null::text, null::text, null::text, 'paused_failures'::text;
    return;
  end if;

  for r in
    select s.application_id, s.current_touch, s.track, s.variant, s.enrolled_at, a.email, a.first_name, a.last_name, a.state
      from public.reactivation_sequence s join public.applications a on a.id = s.application_id
     where s.status = 'active' and s.next_due_at <= now() and s.claimed_at is null
     order by s.current_touch desc, s.next_due_at
     limit 40
       for update of s skip locked
  loop
    if not public.fn_reactivation_in_window(r.state) then continue; end if;
    v_gate := public.fn_reactivation_gate(r.application_id, r.enrolled_at);
    if v_gate is null then
      update public.reactivation_sequence set claimed_at = now(), claim_request_id = null, updated_at = now()
       where reactivation_sequence.application_id = r.application_id;
      return query select r.application_id, (r.current_touch + 1)::smallint, r.track, r.variant, r.email::text,
                          r.first_name::text, r.last_name::text, 'claimed'::text;
      return;
    elsif v_gate like 'hold:%' then
      update public.reactivation_sequence set next_due_at = now() + interval '6 hours', last_error = v_gate, updated_at = now()
       where reactivation_sequence.application_id = r.application_id;
    else
      update public.reactivation_sequence set status = 'stopped', stop_reason = v_gate, claimed_at = null, updated_at = now()
       where reactivation_sequence.application_id = r.application_id;
    end if;
  end loop;

  for r in
    select c.application_id, c.email, c.first_name, c.last_name, c.state, c.track
      from public.v_reactivation_cohort c
     where not exists (select 1 from public.reactivation_sequence s
                        where s.application_id = c.application_id or s.email_lower = lower(btrim(c.email)))
     order by c.send_rank
     limit 40
  loop
    if not public.fn_reactivation_in_window(r.state) then continue; end if;
    v_gate := public.fn_reactivation_gate(r.application_id, null);
    v_track := coalesce(r.track, public.fn_reactivation_track(r.application_id));
    v_variant := public.fn_reactivation_variant(r.application_id);
    insert into public.reactivation_sequence (application_id, email_lower, track, variant, current_touch, next_due_at,
                                              status, stop_reason, enrolled_from, claimed_at)
    values (r.application_id, lower(btrim(r.email)), v_track, v_variant, 0,
            case when v_gate like 'hold:%' then now() + interval '6 hours' else now() end,
            case when v_gate is null or v_gate like 'hold:%' then 'active' else 'stopped' end,
            case when v_gate is null or v_gate like 'hold:%' then null else v_gate end,
            'cohort', case when v_gate is null then now() else null end)
    on conflict do nothing;
    if v_gate is null and found then
      return query select r.application_id, 1::smallint, v_track, v_variant, r.email::text,
                          r.first_name::text, r.last_name::text, 'claimed_new'::text;
      return;
    end if;
  end loop;
  return query select null::uuid, null::smallint, null::text, null::text, null::text, null::text, null::text, 'nothing_due'::text;
end $$;

-- Health gains the incident and ramp state (every earlier column unchanged, in order).
create or replace view public.v_reactivation_health with (security_invoker = true) as
select
  (select coalesce(nullif(btrim(s.value), '')::int, 0) from public.system_settings s where s.key = 'reactivation_daily_cap') as daily_cap,
  (select count(*) from public.reactivation_sequence) as enrolled,
  (select count(*) from public.reactivation_sequence where status = 'active') as active,
  (select count(*) from public.reactivation_sequence where status = 'active' and next_due_at <= now()) as due_now,
  (select count(*) from public.reactivation_sequence where status = 'stopped') as stopped,
  (select count(*) from public.reactivation_sequence where status = 'completed') as completed,
  (select count(*) from public.reactivation_sequence where status = 'held') as held,
  (select count(*) from public.v_reactivation_cohort c
    where not exists (select 1 from public.reactivation_sequence s
                       where s.application_id = c.application_id or s.email_lower = lower(btrim(c.email)))) as not_yet_enrolled,
  (select count(*) from public.next_step_messages
    where stage_key like 'reactivation\_v2\_%' escape '\' and fallback_of_id is null and sent_at is not null
      and (sent_at at time zone 'America/Phoenix')::date = (now() at time zone 'America/Phoenix')::date) as sent_today,
  (select max(sent_at) from public.next_step_messages where stage_key like 'reactivation\_v2\_%' escape '\') as last_send_at,
  (select count(*) from public.next_step_messages m join public.email_events e on e.resend_id = m.external_id
    where m.stage_key like 'reactivation\_v2\_%' escape '\' and m.sent_at >= now() - interval '14 days') as events_14d,
  (select count(*) from public.next_step_messages m join public.email_events e on e.resend_id = m.external_id
    where m.stage_key like 'reactivation\_v2\_%' escape '\' and m.sent_at >= now() - interval '14 days'
      and e.last_event = 'bounced') as bounced_14d,
  (select count(*) from public.next_step_messages m join public.email_events e on e.resend_id = m.external_id
    where m.stage_key like 'reactivation\_v2\_%' escape '\' and m.sent_at >= now() - interval '14 days'
      and e.last_event = 'complained') as complained_14d,
  (select count(*) from public.reactivation_sequence where status = 'active' and claimed_at < now() - interval '15 minutes') as stale_claims,
  (select count(*) from public.reactivation_sequence where status = 'active' and last_error is not null) as retrying,
  (select count(*) from public.reactivation_replies) as replies_total,
  (select max(created_at) from public.reactivation_replies) as last_reply_at,
  (select count(*) from public.next_step_messages m
    where m.stage_key like 'reactivation\_v2\_%' escape '\' and m.sent_at is not null
      and (m.external_id is null or btrim(m.external_id) = '')) as sent_without_provider_id,
  (select count(*) from public.next_step_messages m
     join public.email_unsubscribes u on lower(u.email) = lower(btrim(m.recipient))
    where m.stage_key like 'reactivation\_v2\_%' escape '\' and m.sent_at is not null and u.unsubscribed_at < m.sent_at) as sent_after_unsubscribe,
  (select count(*) from public.next_step_messages m join public.applications a on a.id = m.application_id
    where m.stage_key like 'reactivation\_v2\_%' escape '\' and m.sent_at is not null
      and a.email_consent_given is not true) as sent_without_email_consent,
  (select count(*) from public.next_step_stages st where st.stage_key like 'reactivation\_v2\_%' escape '\') as stage_rows_loaded,
  (select count(*) from cron.job where jobname = 'reactivation-send-tick' and active) as cron_tick_active,
  -- appended 2026-11-12 (review fix wave)
  (select s.value from public.system_settings s where s.key = 'reactivation_breaker') as breaker,
  (select b.is_open from public.fn_reactivation_breaker_state() b) as breaker_open,
  (select s.value from public.system_settings s where s.key = 'reactivation_last_tick') as last_tick,
  (select case when btrim(s.value) ~ '^[0-9]{1,6}$' then btrim(s.value)::int else null end
     from public.system_settings s where s.key = 'reactivation_tick_error_streak') as tick_error_streak,
  public.fn_reactivation_reply_last_ok() as reply_last_ok,
  (select s.value from public.system_settings s where s.key = 'reactivation_reply_last_beat') as reply_last_beat,
  (select count(*) from public.reactivation_sequence where status = 'active' and claimed_at is not null) as claim_outstanding,
  (select coalesce(jsonb_object_agg(h.k, h.n), '{}'::jsonb)
     from (select coalesce(stop_reason, '?') as k, count(*) as n
             from public.reactivation_sequence where status = 'held' group by 1) h) as held_by_reason,
  (select count(*) from public.next_step_messages m
    where m.stage_key like 'reactivation\_v2\_%' escape '\' and m.fallback_of_id is null and m.sent_at is not null
      and m.sent_at >= now() - interval '7 days' and m.sent_at < now() - interval '2 hours') as coverage_sends,
  (select count(e.resend_id) from public.next_step_messages m left join public.email_events e on e.resend_id = m.external_id
    where m.stage_key like 'reactivation\_v2\_%' escape '\' and m.fallback_of_id is null and m.sent_at is not null
      and m.sent_at >= now() - interval '7 days' and m.sent_at < now() - interval '2 hours') as coverage_with_event,
  (select count(*) from public.next_step_messages m
    where m.stage_key like 'reactivation\_v2\_%' escape '\' and m.fallback_of_id is null
      and m.sent_at >= now() - interval '7 days') as sent_7d,
  (select count(*) from public.reactivation_replies r
    where r.classification = 'stop' and r.created_at >= now() - interval '7 days') as stops_7d,
  (select count(*) from public.reactivation_replies r
    where r.stop_ambiguous and r.created_at >= now() - interval '7 days') as ambiguous_7d,
  (select count(*) from public.reactivation_replies r
    where r.notified_at is null and r.push_title is not null and r.created_at < now() - interval '30 minutes') as unnotified_replies,
  -- appended 2026-11-12 (canary terms)
  (select i.bounced from public.fn_reactivation_incidents() i) as incident_bounced,
  (select i.complained from public.fn_reactivation_incidents() i) as incident_complained,
  (select i.gate_misses from public.fn_reactivation_incidents() i) as gate_misses,
  (select i.since from public.fn_reactivation_incidents() i) as incident_since,
  (select s.value from public.system_settings s where s.key = 'reactivation_ramp_state') as ramp_state,
  (select s.value from public.system_settings s where s.key = 'reactivation_ramp_log') as ramp_log;

select cron.schedule('reactivation-ramp-evaluate', '30 1 * * *', $cron$select public.fn_reactivation_ramp_evaluate()$cron$);

revoke all on function public.fn_reactivation_incidents() from public, anon, authenticated;
revoke all on public.v_reactivation_health from public, anon, authenticated;
grant select on public.v_reactivation_health to service_role;
revoke all on function public.fn_reactivation_canary_guard(integer) from public, anon, authenticated;
revoke all on function public.fn_reactivation_ramp_evaluate(timestamptz) from public, anon, authenticated;
revoke all on function public.fn_reactivation_claim_next() from public, anon, authenticated;
grant execute on function public.fn_reactivation_incidents(), public.fn_reactivation_canary_guard(integer),
                         public.fn_reactivation_ramp_evaluate(timestamptz), public.fn_reactivation_claim_next()
  to service_role;

commit;
