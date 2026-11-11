-- 20261112131529_reactivation_v2_review_fixes.sql
-- MP-BOB-CONVERSION v2: the adversarial review's fix wave, applied BEFORE the campaign is armed (BoB chat,
-- session 3c262e62). The campaign stays PAUSED: system_settings.reactivation_daily_cap is not touched here and
-- nothing in this file sends anything. Hand-applied with bot-sql and recorded in schema_migrations; every
-- statement is safe to run twice (R-M3). Each block names the finding it closes.
--
--   SF-1/DS-1  A provider refusal is scoped by the send function (metadata.scope). Only a refusal about THIS
--              address stops this person. An account-level refusal (quota, key, sender, provider down) releases
--              the claim untouched and opens the breaker, instead of permanently stopping one person per tick.
--   SF-2       Single flight: one email in flight at a time, and every claim is settled from pg_net's own answer
--              (net._http_response) before the next: "never reached the provider" releases the claim and opens the
--              breaker, "may have been sent" HOLDS the person. Nothing is ever resent blind.
--   SF-3       Every tick records its result (system_settings reactivation_last_tick); an exception is caught,
--              recorded and counted (reactivation_tick_error_streak), never silent.
--   SF-4       No new email goes out while the reply reader has not completed a sweep in 24 hours.
--   SF-6       The bounce/complaint brakes only work if provider events arrive, so low event coverage opens the
--              breaker; so does a STOP rate of 5% or more.
--   SF-8       Health shows held rows by reason.
--   WP-1..4    Agents and producers excluded by address OR phone (agents/profiles, agentlink_roster, ethos_roster);
--              a sibling application that progressed stops the sequence; the person's own status, terminated_at
--              and contracted_at are re-checked at every touch.
--   DS-3       An out-of-office is not a reply.
--   DS-4       A real v1 email counts as touch 1 for every track (34 people were set up for four emails).
--   CONV-5     Enrolment order: track warmth, then the newest application first.
--   CONV-6     Track reads course/exam progress before the self-reported license answer.
--   CONV-8/DS-5 Bookings by any sibling or by the same invitee count, anchored on the FIRST campaign email. And
--              interview_events.created_at is an IMPORT time (a backfill stamped April meetings 2026-11-09), so a
--              booking counts as "since the campaign" only when the meeting itself is on or after the anchor too.
--
-- The breaker (system_settings reactivation_breaker) is '' when closed, else '<until>|<reason>' where <until> is
-- an ISO time (auto-reopens) or 'infinity' (a human clears it by setting the value to ''). Its reason is the root
-- cause: a later, shorter trip never overwrites an open one.

begin;

-- 1. Columns and settings ------------------------------------------------------------------------------
alter table public.reactivation_replies
  add column if not exists subtype text,
  add column if not exists stop_ambiguous boolean not null default false,
  add column if not exists matched_by text,
  add column if not exists sequences_stopped integer,
  add column if not exists push_title text,
  add column if not exists push_body text,
  add column if not exists push_priority text,
  add column if not exists push_attempts integer not null default 0,
  add column if not exists last_push_error text;

alter table public.reactivation_sequence
  add column if not exists last_http_status integer,
  add column if not exists claim_reconciled_at timestamptz;

insert into public.system_settings (key, value) values
  ('reactivation_breaker', ''),
  ('reactivation_last_tick', ''),
  ('reactivation_tick_error_streak', '0'),
  ('reactivation_reply_last_ok', ''),
  ('reactivation_reply_last_beat', '')
on conflict (key) do nothing;

-- 2. Small pure helpers ---------------------------------------------------------------------------------
-- The ten digits that identify a US phone, or NULL when the value cannot identify anyone (junk, placeholders).
create or replace function public.fn_reactivation_phone10(p text)
returns text language sql immutable set search_path = public as $$
  select case when d ~ '^[2-9][0-9]{2}[2-9][0-9]{6}$' and d !~ '^([0-9])\1{9}$'
                   and d not in ('2345678901', '2223334444', '5555555555') then d end
    from (select right(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), 10) as d) x
$$;

-- CONV-6: what the person has DONE outranks what they ticked on the form ("pending" while still in the course).
create or replace function public.fn_reactivation_track_of(
  p_license_status text, p_license_progress text, p_exam_passed_at timestamptz,
  p_course_started_at timestamptz, p_course_purchased_at timestamptz, p_stage text)
returns text language sql immutable set search_path = public as $$
  select case
    when p_license_progress in ('licensed', 'in_field_training') or p_license_status = 'licensed' then 'T_LICENSED'
    when p_license_progress in ('passed_test', 'exam_passed', 'fingerprints_done', 'waiting_fingerprints', 'waiting_on_license')
      or p_exam_passed_at is not null or p_stage = 'passed_exam' then 'T_PENDING'
    when p_license_progress in ('finished_course', 'test_scheduled', 'failed_test')
      or p_stage in ('finished_prelicense', 'exam_scheduled') then 'T_COURSE_DONE'
    when p_license_progress = 'course_purchased' or p_course_started_at is not null or p_course_purchased_at is not null
      or p_stage = 'started_prelicense' then 'T_IN_COURSE'
    when p_license_status = 'pending' then 'T_PENDING'
    else 'T_COLD' end
$$;

create or replace function public.fn_reactivation_track_warmth(p_track text)
returns integer language sql immutable set search_path = public as $$
  select case p_track when 'T_LICENSED' then 1 when 'T_PENDING' then 2 when 'T_COURSE_DONE' then 3
                      when 'T_IN_COURSE' then 4 else 5 end
$$;

create or replace function public.fn_reactivation_track(p_application_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select public.fn_reactivation_track_of(a.license_status::text, a.license_progress::text, a.exam_passed_at,
                                          a.course_started_at, a.course_purchased_at, p.current_stage_key)
    from public.applications a
    left join public.next_step_progress p on p.application_id = a.id
   where a.id = p_application_id
$$;

-- 3. Breaker and reply-reader freshness ----------------------------------------------------------------
create or replace function public.fn_reactivation_breaker_state()
returns table(is_open boolean, until_at timestamptz, reason text)
language plpgsql stable security definer set search_path = public as $$
declare v text; v_until timestamptz;
begin
  select btrim(s.value) into v from public.system_settings s where s.key = 'reactivation_breaker';
  if v is null or v = '' then
    return query select false, null::timestamptz, null::text;
    return;
  end if;
  begin
    v_until := split_part(v, '|', 1)::timestamptz;
  exception when others then
    -- an unreadable breaker is an OPEN breaker: someone typed it, someone clears it
    return query select true, 'infinity'::timestamptz, ('unreadable breaker value: ' || left(v, 80))::text;
    return;
  end;
  return query select v_until > now(), v_until, nullif(substr(v, strpos(v, '|') + 1), '');
end $$;

create or replace function public.fn_reactivation_trip(p_reason text, p_for interval default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_cur record;
  v_until timestamptz := case when p_for is null then 'infinity'::timestamptz else now() + p_for end;
begin
  select * into v_cur from public.fn_reactivation_breaker_state();
  -- an equal-or-longer trip is already open: keep it, and keep its reason (the root cause)
  if v_cur.is_open and v_cur.until_at >= v_until then
    return;
  end if;
  insert into public.system_settings (key, value, updated_at)
  values ('reactivation_breaker',
          case when p_for is null then 'infinity' else to_char(v_until at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') end
            || '|' || left(regexp_replace(coalesce(p_reason, 'unspecified'), '[\r\n|]+', ' ', 'g'), 200),
          now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
end $$;

create or replace function public.fn_reactivation_reply_last_ok()
returns timestamptz language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  select btrim(s.value) into v from public.system_settings s where s.key = 'reactivation_reply_last_ok';
  if v is null or v = '' then
    return null;
  end if;
  return v::timestamptz;
exception when others then
  return null;
end $$;

-- Called by the laptop reply poller after every run. p_ok = a sweep completed end to end.
create or replace function public.fn_reactivation_reply_reader_beat(p_ok boolean, p_detail text default null)
returns void language plpgsql security definer set search_path = public as $$
declare v_now text := to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"');
begin
  insert into public.system_settings (key, value, updated_at)
  values ('reactivation_reply_last_beat',
          v_now || ' ' || left(regexp_replace(coalesce(nullif(btrim(p_detail), ''), case when p_ok then 'ok' else 'not_ok' end),
                                              '[\r\n]+', ' ', 'g'), 200),
          now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  if p_ok then
    insert into public.system_settings (key, value, updated_at) values ('reactivation_reply_last_ok', v_now, now())
    on conflict (key) do update set value = excluded.value, updated_at = now();
  end if;
end $$;

-- 4. The per-person gate (WP-1..4, DS-3, CONV-8/DS-5) -----------------------------------------------------
create or replace function public.fn_reactivation_gate(p_application_id uuid, p_since timestamptz default null)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  a record; v_email text; v_phone10 text; v_cut timestamptz := public.fn_lane_ladder_cutoff();
  v_ok boolean; v_owned boolean; v_sib uuid[]; v_anchor timestamptz; v_reason text;
begin
  select ap.id, ap.email, ap.phone, ap.status::text as status, ap.terminated_at, ap.contracted_at, ap.duplicate_of,
         ap.email_consent_given, ap.do_not_contact_at, ap.created_at, ap.email_bounced_at
    into a from public.applications ap where ap.id = p_application_id;
  if not found then return 'no_application'; end if;
  v_email := lower(btrim(coalesce(a.email, '')));
  if v_email = '' or position('@' in v_email) = 0 then return 'no_email'; end if;
  v_phone10 := public.fn_reactivation_phone10(a.phone);
  if exists (select 1 from public.reactivation_bad_domains d where d.domain = split_part(v_email, '@', 2)) then
    return 'bad_domain';
  end if;
  if a.email_consent_given is not true then return 'no_email_consent'; end if;
  if a.do_not_contact_at is not null then return 'do_not_contact'; end if;
  -- WP-4: the person's own record moved on after enrolment (the cohort view only checked it once)
  if a.terminated_at is not null then return 'terminated'; end if;
  if a.contracted_at is not null then return 'contracted'; end if;
  if a.status not in ('new', 'reviewing', 'no_pickup') then return 'app_status:' || a.status; end if;
  if a.created_at >= v_cut then return 'owned_live_ladder'; end if;

  -- siblings: the same address, or one duplicate_of hop either way
  select array_agg(distinct x.id) into v_sib from (
    select a.id as id
    union select a2.id from public.applications a2 where lower(btrim(a2.email)) = v_email
    union select a2.id from public.applications a2 where a2.duplicate_of = a.id
    union select a.duplicate_of where a.duplicate_of is not null
  ) x;
  if exists (select 1 from public.applications a2 where a2.id = any(v_sib) and a2.created_at >= v_cut) then
    return 'owned_live_ladder';
  end if;
  -- WP-2: another application of this person was contracted or moved on (contracting, paid, rejected...).
  -- terminated_at ALONE on a sibling is not that: it is the dedupe closure stamped on the old twin the day the
  -- person re-applied (measured 2026-11-12: 21 'new' + 3 'reviewing' rows, each terminated the day its newer
  -- twin was created). Counting it blocked 5 people for having applied twice.
  select 'sibling_' || case when a2.contracted_at is not null then 'contracted' else a2.status::text end
    into v_reason
    from public.applications a2
   where a2.id = any(v_sib) and a2.id <> a.id
     and (a2.contracted_at is not null or a2.status::text not in ('new', 'reviewing', 'no_pickup'))
   limit 1;
  if v_reason is not null then return v_reason; end if;

  if a.email_bounced_at is not null then return 'bounced'; end if;
  if exists (select 1 from public.email_unsubscribes u where lower(u.email) = v_email) then return 'unsubscribed'; end if;
  if exists (select 1 from public.email_suppressions s where s.email = v_email
               and s.last_seen_at >= now() - interval '30 days') then return 'suppressed'; end if;

  -- WP-1/WP-3: anyone who is or was an agent or a producer, matched by address OR phone
  if exists (select 1 from public.agents g where g.source_application_id = any(v_sib)) then return 'is_agent'; end if;
  if exists (select 1 from public.profiles pr
              where (lower(btrim(pr.email)) = v_email
                     or (v_phone10 is not null and public.fn_reactivation_phone10(pr.phone) = v_phone10))
                and exists (select 1 from public.agents g where g.user_id = pr.user_id or g.profile_id = pr.id)) then
    return 'is_agent';
  end if;
  if exists (select 1 from public.agentlink_roster r
              where (r.approval_status = 'approved' or coalesce(r.total_contracts, 0) > 0 or r.producer_active is true)
                and (lower(btrim(r.email)) = v_email
                     or (v_phone10 is not null and public.fn_reactivation_phone10(r.phone) = v_phone10))) then
    return 'is_producer';
  end if;
  if exists (select 1 from public.ethos_roster r
              where lower(btrim(r.email)) = v_email
                 or (v_phone10 is not null and public.fn_reactivation_phone10(r.phone) = v_phone10)) then
    return 'is_producer_ethos';
  end if;
  if exists (select 1 from public.next_step_progress p where p.application_id = any(v_sib) and p.status = 'completed') then
    return 'completed_pipeline';
  end if;

  -- CONV-8/DS-5: a booking by any sibling or by the same invitee (address or phone)
  if exists (select 1 from public.interview_events ie
              where ie.canceled_at is null and ie.scheduled_at > now()
                and (ie.application_id = any(v_sib) or lower(btrim(ie.invitee_email)) = v_email
                     or (v_phone10 is not null and public.fn_reactivation_phone10(ie.invitee_phone) = v_phone10))) then
    return 'booked_upcoming';
  end if;
  select least(p_since, (select min(m.sent_at) from public.next_step_messages m
                          where m.application_id = any(v_sib) and m.sent_at is not null and m.fallback_of_id is null
                            and (m.stage_key like 'reactivation\_v2\_%' escape '\' or m.stage_key = 'reactivation_2026_11')))
    into v_anchor;
  if v_anchor is not null and exists (
       select 1 from public.interview_events ie
        where ie.canceled_at is null and ie.created_at >= v_anchor and ie.scheduled_at >= v_anchor - interval '1 day'
          and (ie.application_id = any(v_sib) or lower(btrim(ie.invitee_email)) = v_email
               or (v_phone10 is not null and public.fn_reactivation_phone10(ie.invitee_phone) = v_phone10))) then
    return 'booked';
  end if;

  -- DS-3: a human answer stops the sequence; an out-of-office does not
  if exists (select 1 from public.reactivation_replies r
              where (r.email_lower = v_email or r.application_id = any(v_sib)) and r.classification <> 'auto_reply') then
    return 'replied';
  end if;
  if to_regclass('public.v_onboarding_owned_people') is not null then
    execute 'select exists (select 1 from public.v_onboarding_owned_people o where o.email_lower = $1)'
      into v_owned using v_email;
    if v_owned then return 'owned_onboarding'; end if;
  end if;
  if to_regprocedure('public.fn_recruit_campaign_touch_ok(text,interval)') is not null then
    execute 'select public.fn_recruit_campaign_touch_ok($1, interval ''7 days'')' into v_ok using v_email;
    if v_ok is null then return 'hold:touch_gate_unknown'; end if;
    if v_ok is false then return 'hold:touch_gate'; end if;
  elsif exists (select 1 from public.email_delivery_log e where lower(e.recipient_email) = v_email
                  and e.sent_at >= now() - interval '7 days') then
    return 'hold:recent_other_email';
  end if;
  return null;
end $$;

-- 5. The cohort, ranked by warmth (CONV-5), with its track --------------------------------------------
create or replace view public.v_reactivation_cohort with (security_invoker = true) as
with eligible as (
  select t.application_id, t.first_name, t.last_name, t.email, t.phone, t.state, t.app_status, t.created_at,
         t.lead_score, t.ai_score_tier, t.last_touch_at, t.has_consent_artifact, t.consent_tier, t.channel, t.segment,
         t.current_stage_key, t.is_stalled, t.last_nudged_at, t.nudge_count, t.in_next_step_engine
    from public.v_reactivation_targets t
   where t.email is not null
     and exists (select 1 from public.applications a
                  where a.id = t.application_id and a.email_consent_given is true and a.do_not_contact_at is null
                    and a.created_at < '2026-11-08 19:00:00+00'::timestamptz)
     and not exists (select 1 from public.email_delivery_log e
                      where lower(e.recipient_email) = lower(t.email) and e.sent_at >= now() - interval '7 days')
     and not exists (select 1 from public.email_suppressions s
                      where s.email = lower(t.email) and s.last_event = 'suppressed'
                        and s.last_seen_at >= now() - interval '30 days')
     and not exists (select 1 from public.email_unsubscribes u where u.email = lower(t.email))
     and not exists (select 1 from public.agents g join public.profiles pr on pr.user_id = g.user_id
                      where lower(pr.email) = lower(t.email))
     and not exists (select 1 from public.next_step_progress p
                      where p.application_id = t.application_id and p.status = 'completed')
     and not exists (select 1 from public.next_step_messages m
                      where m.application_id = t.application_id and m.stage_key = 'reactivation_2026_11')
     -- ANCHOR's lane owns these (agents, Xcel students, suspended/banned logins, post-cutoff applications);
     -- fn_reactivation_gate also refuses them at every touch (20261112000170 made the view live)
     and not exists (select 1 from public.v_onboarding_owned_people o where o.email_lower = lower(btrim(t.email)))
), deduped as (
  select distinct on (lower(eligible.email)) eligible.*
    from eligible
   order by lower(eligible.email),
            case eligible.segment when 'in_review_stalled' then 1 when 'contacted_never_appointed' then 2 else 3 end,
            eligible.lead_score desc nulls last, eligible.created_at desc
), tracked as (
  select d.*, public.fn_reactivation_track_of(a.license_status::text, a.license_progress::text, a.exam_passed_at,
                                              a.course_started_at, a.course_purchased_at, d.current_stage_key) as track
    from deduped d
    join public.applications a on a.id = d.application_id
)
select application_id, first_name, last_name, email, phone, state, app_status, created_at, lead_score, ai_score_tier,
       last_touch_at, has_consent_artifact, consent_tier, channel, segment, current_stage_key, is_stalled,
       last_nudged_at, nudge_count, in_next_step_engine,
       row_number() over (order by public.fn_reactivation_track_warmth(track), created_at desc) as send_rank,
       track
  from tracked;

-- 6. Claim (SF-2 single flight, SF-4, SF-6, breaker) -----------------------------------------------------
create or replace function public.fn_reactivation_claim_next()
returns table(application_id uuid, touch smallint, track text, variant text, email text, first_name text,
              last_name text, reason text)
language plpgsql security definer set search_path = public as $$
declare
  v_cap int; v_sent_today int; v_n int; v_bounced int; v_complained int;
  v_cov_n int; v_cov_hit int; v_sent7 int; v_stop7 int; v_fail1h int;
  v_poll timestamptz; v_b record;
  r record; v_gate text; v_track text; v_variant text;
begin
  select coalesce(nullif(btrim(s.value), '')::int, 0) into v_cap from public.system_settings s where s.key = 'reactivation_daily_cap';
  v_cap := coalesce(v_cap, 0);
  if v_cap <= 0 then
    return query select null::uuid, null::smallint, null::text, null::text, null::text, null::text, null::text, 'paused_cap_0'::text;
    return;
  end if;
  select * into v_b from public.fn_reactivation_breaker_state();
  if v_b.is_open then
    return query select null::uuid, null::smallint, null::text, null::text, null::text, null::text, null::text,
                        ('paused_breaker: ' || coalesce(v_b.reason, '?'))::text;
    return;
  end if;
  -- SF-2: the previous email must be settled (receipt, or reconcile from its HTTP answer) before the next one
  if exists (select 1 from public.reactivation_sequence s where s.status = 'active' and s.claimed_at is not null) then
    return query select null::uuid, null::smallint, null::text, null::text, null::text, null::text, null::text, 'claim_outstanding'::text;
    return;
  end if;
  -- SF-4: nobody is reading the answers, so nobody gets a new email
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
    -- trip, so a human looks; the 14-day window alone would quietly resume later
    perform public.fn_reactivation_trip('spam complaint on a reactivation email', null);
    return query select null::uuid, null::smallint, null::text, null::text, null::text, null::text, null::text, 'paused_complaint'::text;
    return;
  end if;
  if v_n >= 25 and v_bounced::numeric / v_n >= 0.08 then
    perform public.fn_reactivation_trip('bounce rate ' || v_bounced || ' of ' || v_n || ' in 14 days', null);
    return query select null::uuid, null::smallint, null::text, null::text, null::text, null::text, null::text, 'paused_bounce_8pct'::text;
    return;
  end if;
  -- SF-6: the brakes above are blind unless provider events arrive
  select count(*), count(e.resend_id) into v_cov_n, v_cov_hit
    from public.next_step_messages m left join public.email_events e on e.resend_id = m.external_id
   where m.stage_key like 'reactivation\_v2\_%' escape '\' and m.fallback_of_id is null and m.sent_at is not null
     and m.sent_at >= now() - interval '7 days' and m.sent_at < now() - interval '2 hours';
  if v_cov_n >= 5 and v_cov_hit::numeric / v_cov_n < 0.5 then
    perform public.fn_reactivation_trip('events_blind: ' || v_cov_hit || ' of ' || v_cov_n || ' sends have a provider event', null);
    return query select null::uuid, null::smallint, null::text, null::text, null::text, null::text, null::text, 'paused_events_blind'::text;
    return;
  end if;
  -- SF-6: too many people asking to stop
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
  -- SF-1: repeated retryable failures mean something upstream is wrong, not the people
  select count(*) into v_fail1h from public.next_step_messages m
   where m.stage_key like 'reactivation\_v2\_%' escape '\' and m.failed_at >= now() - interval '1 hour'
     and coalesce((m.metadata->>'retryable')::boolean, false);
  if v_fail1h >= 3 then
    perform public.fn_reactivation_trip(v_fail1h || ' retryable send failures in 1 hour', interval '1 hour');
    return query select null::uuid, null::smallint, null::text, null::text, null::text, null::text, null::text, 'paused_failures'::text;
    return;
  end if;

  -- (a) sequences already in flight first: finish what was started before opening new ones
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

  -- (b) nothing due: enrol the warmest unenrolled cohort member (CONV-5)
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

-- 7. Settle claims from pg_net's own answer (SF-2) -------------------------------------------------------
-- The send function writes a receipt for every outcome it decides, and the receipt trigger releases the claim.
-- A row still claimed after pg_net has an answer means the function answered WITHOUT a receipt landing.
create or replace function public.fn_reactivation_reconcile()
returns text language plpgsql security definer set search_path = public as $$
declare r record; h record; v_code int; v_body text; v_out text; v_never boolean;
begin
  for r in
    select s.application_id, s.claim_request_id from public.reactivation_sequence s
     where s.status = 'active' and s.claimed_at is not null and s.claim_request_id is not null
       for update of s skip locked
  loop
    select hr.status_code, hr.timed_out, hr.error_msg, left(coalesce(hr.content, ''), 300) as body
      into h from net._http_response hr where hr.id = r.claim_request_id;
    if not found then
      continue;  -- no answer yet; hold_stale_claims settles it at 20 minutes
    end if;
    v_code := h.status_code;
    v_body := coalesce(h.body, '');
    -- answers the function gives BEFORE it ever calls the provider
    v_never := coalesce(h.timed_out, false) is false and h.error_msg is null and (
                 v_code in (400, 401, 403, 404, 405)
                 or (v_code = 503 and v_body ~* 'not_configured|unreadable')
                 or (v_code = 500 and v_body ~* 'template_invalid|stage unreadable|application unreadable'));
    if v_never then
      update public.reactivation_sequence
         set claimed_at = null, last_http_status = v_code, last_error = left('nothing sent: ' || v_body, 300),
             claim_reconciled_at = now(), updated_at = now()
       where reactivation_sequence.application_id = r.application_id;
      perform public.fn_reactivation_trip('send function answered ' || v_code || ' before sending: ' || left(v_body, 120), null);
      v_out := 'released_' || v_code;
    else
      update public.reactivation_sequence
         set status = 'held',
             stop_reason = case when v_code between 200 and 299 or v_body ~* 'sent_but_unrecorded' then 'sent_but_unrecorded'
                                when v_code = 409 then 'already_sent_unadvanced'
                                when h.timed_out then 'unverified_timeout'
                                when h.error_msg is not null then 'unverified_transport'
                                else 'unverified_' || coalesce(v_code::text, 'unknown') end,
             claimed_at = null, last_http_status = v_code,
             last_error = left(coalesce(h.error_msg, v_body), 300), claim_reconciled_at = now(), updated_at = now()
       where reactivation_sequence.application_id = r.application_id;
      perform public.fn_reactivation_trip(
        'unverified send (' || coalesce(v_code::text, case when h.timed_out then 'timeout' else 'transport' end) || ')',
        case when v_code between 200 and 299 or v_code = 409 or v_body ~* 'sent_but_unrecorded' then null
             else interval '1 hour' end);
      v_out := 'held_unverified';
    end if;
  end loop;
  return v_out;
end $$;

create or replace function public.fn_reactivation_hold_stale_claims()
returns integer language plpgsql security definer set search_path = public as $$
declare v_n int; v_recent int;
begin
  update public.reactivation_sequence
     set status = 'held', stop_reason = 'claim_stale_unverified', updated_at = now()
   where status = 'active' and claimed_at is not null and claimed_at < now() - interval '20 minutes';
  get diagnostics v_n = row_count;
  if v_n > 0 then
    select count(*) into v_recent from public.reactivation_sequence
     where status = 'held' and stop_reason = 'claim_stale_unverified' and updated_at >= now() - interval '1 hour';
    perform public.fn_reactivation_trip('stale claim: no answer from the send function (' || v_recent || ' in 1h)',
                                        case when v_recent >= 2 then null else interval '1 hour' end);
  end if;
  return v_n;
end $$;

-- 8. Dispatch: one tick, result always recorded (SF-3) -------------------------------------------------
create or replace function public.fn_reactivation_dispatch_inner()
returns text language plpgsql security definer set search_path = public as $$
declare c record; v_key text; v_stage text; v_req bigint; v_rec text;
begin
  v_rec := public.fn_reactivation_reconcile();
  perform public.fn_reactivation_hold_stale_claims();
  select * into c from public.fn_reactivation_claim_next() limit 1;
  if c.application_id is null then
    return coalesce(c.reason, 'nothing_due') || coalesce(' | reconcile: ' || v_rec, '');
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'reactivation_send_key';
  if v_key is null or btrim(v_key) = '' then
    update public.reactivation_sequence set claimed_at = null, last_error = 'no_send_key', updated_at = now()
     where reactivation_sequence.application_id = c.application_id;
    perform public.fn_reactivation_trip('no reactivation_send_key in vault', null);
    return 'no_send_key';
  end if;
  v_stage := 'reactivation_v2_' || lower(substr(c.track, 3)) || '_t' || c.touch || '_' || lower(c.variant);
  -- same transaction as the claim: a throw rolls both back (R-M7)
  v_req := net.http_post(
    url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/reactivation-send',
    body := jsonb_build_object('application_id', c.application_id, 'stage_key', v_stage),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-reactivation-key', v_key),
    timeout_milliseconds := 30000);
  update public.reactivation_sequence set claim_request_id = v_req, last_http_status = null, claim_reconciled_at = null
   where reactivation_sequence.application_id = c.application_id;
  return 'dispatched ' || v_stage || coalesce(' | reconcile: ' || v_rec, '');
end $$;

create or replace function public.fn_reactivation_dispatch()
returns text language plpgsql security definer set search_path = public as $$
declare v_result text; v_err boolean := false; v_prev text; v_streak int;
begin
  begin
    v_result := public.fn_reactivation_dispatch_inner();
  exception when others then
    v_result := 'error: ' || left(sqlerrm, 240);
    v_err := true;
  end;
  select btrim(s.value) into v_prev from public.system_settings s where s.key = 'reactivation_tick_error_streak';
  v_streak := case when not v_err then 0
                   when coalesce(v_prev, '') ~ '^[0-9]{1,6}$' then v_prev::int + 1
                   else 1 end;
  insert into public.system_settings (key, value, updated_at) values
    ('reactivation_last_tick', to_char(now() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') || ' ' || v_result, now()),
    ('reactivation_tick_error_streak', v_streak::text, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  return v_result;
end $$;

-- 9. Receipts (SF-1 scope) -----------------------------------------------------------------------------
create or replace function public.fn_reactivation_on_receipt()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_touch int; v_retry boolean; v_reason text; v_scope text;
begin
  begin
    v_touch := nullif(new.metadata->>'touch', '')::int;
    if v_touch is null then v_touch := substring(new.stage_key from '_t([123])_[ab]$')::int; end if;
    if new.sent_at is not null then
      update public.reactivation_sequence
         set current_touch = greatest(current_touch, v_touch), last_touch_at = new.sent_at,
             last_resend_id = new.external_id, last_message_id = new.id,
             attempts_failed = 0, last_error = null, claimed_at = null,
             next_due_at = case when v_touch < 3 then new.sent_at + interval '7 days 2 hours' else null end,
             status = case when v_touch >= 3 then 'completed' else 'active' end,
             stop_reason = case when v_touch >= 3 then 'sequence_complete' else null end,
             updated_at = now()
       where application_id = new.application_id;
    elsif new.failed_at is not null then
      v_retry := coalesce((new.metadata->>'retryable')::boolean, false);
      v_scope := coalesce(nullif(new.metadata->>'scope', ''), 'person');
      v_reason := regexp_replace(left(coalesce(new.error, 'send_refused'), 80), '^skipped:\s*', '');
      if v_scope = 'account' then
        -- the provider refused the ACCOUNT, not this person: release untouched and pause everyone
        update public.reactivation_sequence
           set claimed_at = null, last_error = left(new.error, 300), updated_at = now()
         where application_id = new.application_id;
        perform public.fn_reactivation_trip('provider refused the account: ' || left(coalesce(new.error, '?'), 150),
                                            case when v_retry then interval '1 hour' else null end);
      elsif v_scope = 'unknown' then
        -- the provider may have accepted it: never resend blind
        update public.reactivation_sequence
           set status = 'held', stop_reason = 'unverified_provider', claimed_at = null,
               last_error = left(new.error, 300), updated_at = now()
         where application_id = new.application_id;
        perform public.fn_reactivation_trip('unverified provider answer: ' || left(coalesce(new.error, '?'), 140), interval '1 hour');
      elsif v_retry then
        update public.reactivation_sequence
           set attempts_failed = attempts_failed + 1, last_error = left(new.error, 300), claimed_at = null,
               next_due_at = now() + make_interval(mins => 15 * (attempts_failed + 1)),
               status = case when attempts_failed + 1 >= 5 then 'held' else 'active' end,
               stop_reason = case when attempts_failed + 1 >= 5 then 'send_failed_5x' else stop_reason end,
               updated_at = now()
         where application_id = new.application_id;
      else
        update public.reactivation_sequence
           set status = 'stopped', stop_reason = v_reason, claimed_at = null, last_error = left(new.error, 300), updated_at = now()
         where application_id = new.application_id;
      end if;
    end if;
  exception when others then
    raise warning 'fn_reactivation_on_receipt: sequence update failed for %: %', new.application_id, sqlerrm;
  end;
  return null;
end $$;

-- 10. Data fixes (idempotent) ------------------------------------------------------------------------
-- DS-4: whoever got a REAL v1 email (a provider id) has had touch 1, whatever their track
update public.reactivation_sequence s
   set current_touch = 1,
       last_touch_at = coalesce(s.last_touch_at, v1.first_sent),
       next_due_at = greatest(coalesce(s.next_due_at, now()), v1.first_sent + interval '7 days 2 hours'),
       updated_at = now()
  from (select m.application_id, min(m.sent_at) as first_sent
          from public.next_step_messages m
         where m.stage_key = 'reactivation_2026_11' and m.channel = 'email' and m.sent_at is not null
           and m.external_id is not null and btrim(m.external_id) <> ''
         group by m.application_id) v1
 where v1.application_id = s.application_id and s.current_touch = 0 and s.status in ('active', 'held');

-- CONV-6: re-derive the track of everyone still in flight
update public.reactivation_sequence s
   set track = t.track, updated_at = now()
  from (select x.application_id, public.fn_reactivation_track(x.application_id) as track
          from public.reactivation_sequence x where x.status in ('active', 'held')) t
 where t.application_id = s.application_id and t.track is not null and s.track is distinct from t.track;

-- 11. Read models ------------------------------------------------------------------------------------
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
    where r.notified_at is null and r.push_title is not null and r.created_at < now() - interval '30 minutes') as unnotified_replies;

create or replace view public.v_reactivation_outcomes with (security_invoker = true) as
select s.track, s.variant,
       count(*) as enrolled,
       count(*) filter (where s.last_touch_at is not null) as emailed,
       count(*) filter (where s.stop_reason in ('replied', 'reply_stop', 'reply_stop_ambiguous')
                           or exists (select 1 from public.reactivation_replies r
                                       where (r.email_lower = s.email_lower or r.application_id = s.application_id)
                                         and r.classification <> 'auto_reply')) as replied,
       count(*) filter (where exists (
         select 1 from public.interview_events ie
          where ie.canceled_at is null
            and (ie.application_id = s.application_id or lower(btrim(ie.invitee_email)) = s.email_lower)
            and ie.created_at >= x.anchor and ie.scheduled_at >= x.anchor - interval '1 day')) as booked_after_send,
       count(*) filter (where s.stop_reason = 'unsubscribed'
                           or exists (select 1 from public.email_unsubscribes u where lower(u.email) = s.email_lower)) as unsubscribed,
       count(*) filter (where s.status = 'completed') as completed_3_touches,
       count(*) filter (where s.status = 'stopped') as stopped,
       count(*) filter (where s.status = 'active') as active
  from public.reactivation_sequence s
  left join lateral (
    select coalesce(min(m.sent_at), s.enrolled_at) as anchor
      from public.next_step_messages m
     where m.application_id = s.application_id and m.sent_at is not null and m.fallback_of_id is null
       and (m.stage_key like 'reactivation\_v2\_%' escape '\' or m.stage_key = 'reactivation_2026_11')
  ) x on true
 group by s.track, s.variant;

-- 12. Grants (R-M9, R-M10) -------------------------------------------------------------------------------
revoke all on function public.fn_reactivation_phone10(text) from public, anon, authenticated;
revoke all on function public.fn_reactivation_track_of(text, text, timestamptz, timestamptz, timestamptz, text) from public, anon, authenticated;
revoke all on function public.fn_reactivation_track_warmth(text) from public, anon, authenticated;
revoke all on function public.fn_reactivation_track(uuid) from public, anon, authenticated;
revoke all on function public.fn_reactivation_breaker_state() from public, anon, authenticated;
revoke all on function public.fn_reactivation_trip(text, interval) from public, anon, authenticated;
revoke all on function public.fn_reactivation_reply_last_ok() from public, anon, authenticated;
revoke all on function public.fn_reactivation_reply_reader_beat(boolean, text) from public, anon, authenticated;
revoke all on function public.fn_reactivation_gate(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.fn_reactivation_claim_next() from public, anon, authenticated;
revoke all on function public.fn_reactivation_reconcile() from public, anon, authenticated;
revoke all on function public.fn_reactivation_hold_stale_claims() from public, anon, authenticated;
revoke all on function public.fn_reactivation_dispatch_inner() from public, anon, authenticated;
revoke all on function public.fn_reactivation_dispatch() from public, anon, authenticated;
revoke all on function public.fn_reactivation_on_receipt() from public, anon, authenticated;
grant execute on function public.fn_reactivation_phone10(text),
                         public.fn_reactivation_track_of(text, text, timestamptz, timestamptz, timestamptz, text),
                         public.fn_reactivation_track_warmth(text),
                         public.fn_reactivation_track(uuid),
                         public.fn_reactivation_breaker_state(),
                         public.fn_reactivation_trip(text, interval),
                         public.fn_reactivation_reply_last_ok(),
                         public.fn_reactivation_reply_reader_beat(boolean, text),
                         public.fn_reactivation_gate(uuid, timestamptz),
                         public.fn_reactivation_claim_next(),
                         public.fn_reactivation_reconcile(),
                         public.fn_reactivation_hold_stale_claims(),
                         public.fn_reactivation_dispatch_inner(),
                         public.fn_reactivation_dispatch(),
                         public.fn_reactivation_on_receipt()
  to service_role;
revoke all on public.v_reactivation_cohort, public.v_reactivation_health, public.v_reactivation_outcomes
  from public, anon, authenticated;
grant select on public.v_reactivation_cohort, public.v_reactivation_health, public.v_reactivation_outcomes to service_role;

commit;
