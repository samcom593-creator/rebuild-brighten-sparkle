-- 20261112152741_reactivation_v2_prearm_hardening.sql
-- MP-BOB-CONVERSION v2: fixes from the pre-arm adversarial review (workflow bob-prearm-verify, 106 agents, every
-- finding double-checked by two skeptics). The campaign stays PAUSED (cap 0). Hand-applied with bot-sql and recorded,
-- pushed to main in the same step. Every statement is safe to run twice (R-M3).
--
--   one person = one sequence   siblings by address, duplicate_of, phone, or first+last name+state: an earlier-enrolled
--                               sibling owns the campaign; an opt-out, suppression, reply or booking on ANY sibling address
--                               refuses the rest (a STOP from address 1 no longer leaves address 2 mailing)
--   claim binding               dispatch stores a claim_token and sends it; reactivation-send asks fn_reactivation_claim_check
--                               (active, claimed with this token, < 15 min, breaker closed, cap > 0, in window, full gate)
--                               before anything else. A request that waited in pg_net past its claim cannot mail anyone.
--                               hold_stale also deletes the still-queued request.
--   reconcile                   never-sent answers release (claim_not_live: no breaker; transient read errors: 1h, manual
--                               at 3 in 24h; config/BOOT_ERROR: manual). Maybe-sent answers hold; a second unverified hold
--                               inside 24h latches the breaker manual instead of holding one more person every hour.
--   receipts                    a late receipt never resurrects a STOP; failure branches touch active rows only
--   incidents                   judged at send time: no clock-less consent or roster arms (a later do-not-contact or a
--                               conversion is not a gate miss); consent is read from the receipt's own snapshot
--   brakes + ack                complaint, bounce-rate and STOP-rate windows start at reactivation_incident_ack
--   ramp                        evaluates the last COMPLETE Phoenix day on that day's own sends, whatever the ack; a
--                               pause or an incident restarts the count
--   cap                         parsed strictly (fn_reactivation_cap): an unreadable value pauses, loudly, never raises
--   dependencies                a missing v_onboarding_owned_people or fn_recruit_campaign_touch_ok HOLDS (fail closed)
--   email shape                 one bare mailbox or 'invalid_email'; applications.email_bad_at refuses
--   replies                     one row per inbound MESSAGE (message_key), so a STOP after an out-of-office in the same
--                               thread is recorded too; a writer that sends no key gets 'thread:<thread_id>' (the
--                               pre-key shape) instead of a 23502, so the reply reader cannot be broken by this file

begin;

-- 1. Schema -----------------------------------------------------------------------------------------------
alter table public.reactivation_replies add column if not exists message_key text;
update public.reactivation_replies set message_key = 'thread:' || thread_id where message_key is null;
alter table public.reactivation_replies alter column message_key set not null;
do $$
begin
  if exists (select 1 from pg_constraint c
              where c.conrelid = 'public.reactivation_replies'::regclass and c.conname = 'reactivation_replies_pkey'
                and pg_get_constraintdef(c.oid) = 'PRIMARY KEY (thread_id)') then
    alter table public.reactivation_replies drop constraint reactivation_replies_pkey;
  end if;
  if not exists (select 1 from pg_constraint c where c.conrelid = 'public.reactivation_replies'::regclass and c.contype = 'p') then
    alter table public.reactivation_replies add constraint reactivation_replies_pkey primary key (message_key);
  end if;
end $$;
create index if not exists reactivation_replies_thread_idx on public.reactivation_replies (thread_id);
create index if not exists reactivation_replies_email_idx on public.reactivation_replies (email_lower);
create index if not exists reactivation_replies_app_idx on public.reactivation_replies (application_id);

-- A writer that predates message_key (the reply poller's first version wrote one row per thread and sent no key)
-- must not start failing with 23502 the moment this lands: default the key to the thread, so that insert lands
-- exactly as it did before. A per-message writer supplies its own key and the default never fires.
create or replace function public.fn_reactivation_replies_default_key()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.message_key is null or btrim(new.message_key) = '' then
    new.message_key := 'thread:' || new.thread_id;
  end if;
  return new;
end $$;
drop trigger if exists trg_reactivation_replies_default_key on public.reactivation_replies;
create trigger trg_reactivation_replies_default_key
  before insert on public.reactivation_replies
  for each row execute function public.fn_reactivation_replies_default_key();

alter table public.reactivation_sequence add column if not exists claim_token uuid;

-- 2. Small readers ---------------------------------------------------------------------------------------
create or replace function public.fn_reactivation_cap()
returns integer language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  select btrim(s.value, E' \t\r\n') into v from public.system_settings s where s.key = 'reactivation_daily_cap';
  if v is null or v = '' then
    return 0;
  end if;
  if v ~ '^[0-9]{1,5}$' then
    return v::int;
  end if;
  return -1;   -- unreadable: callers pause and say so; never an exception that rolls the tick back
end $$;

create or replace function public.fn_reactivation_ack()
returns timestamptz language plpgsql stable security definer set search_path = public as $$
declare v text;
begin
  select btrim(s.value) into v from public.system_settings s where s.key = 'reactivation_incident_ack';
  if v is null or v = '' then
    return null;
  end if;
  return v::timestamptz;
exception when others then
  return null;   -- an unreadable ack acknowledges nothing
end $$;

create or replace function public.fn_reactivation_unverified_24h()
returns integer language sql stable security definer set search_path = public as $$
  select count(*)::int from public.reactivation_sequence q
   where q.status = 'held' and q.updated_at >= now() - interval '24 hours'
     and (q.stop_reason like 'unverified%' or q.stop_reason in ('claim_stale_unverified', 'sent_but_unrecorded', 'already_sent_unadvanced'))
$$;

-- One person, however many applications: same address, a duplicate_of hop either way, the same phone, or the same
-- first + last name in the same state (over-matching only ever means fewer emails, never more).
create or replace function public.fn_reactivation_person_siblings(p_application_id uuid)
returns table(application_id uuid, email_lower text)
language sql stable security definer set search_path = public as $$
  with me as (
    select a.id, lower(btrim(coalesce(a.email, ''))) as email, public.fn_reactivation_phone10(a.phone) as phone10,
           a.duplicate_of,
           nullif(lower(btrim(coalesce(a.first_name, ''))), '') as fname,
           nullif(lower(btrim(coalesce(a.last_name, ''))), '') as lname,
           nullif(upper(btrim(coalesce(a.state, ''))), '') as st
      from public.applications a where a.id = p_application_id
  )
  select distinct a2.id, lower(btrim(coalesce(a2.email, '')))
    from me
    join public.applications a2
      on a2.id = me.id
      or (me.email <> '' and lower(btrim(a2.email)) = me.email)
      or a2.duplicate_of = me.id
      or a2.id = me.duplicate_of
      or (me.phone10 is not null and public.fn_reactivation_phone10(a2.phone) = me.phone10)
      or (me.fname is not null and me.lname is not null and me.st is not null
          and length(me.fname) >= 2 and length(me.lname) >= 2
          and lower(btrim(a2.first_name)) = me.fname and lower(btrim(a2.last_name)) = me.lname
          and upper(btrim(a2.state)) = me.st)
$$;

-- 3. The gate --------------------------------------------------------------------------------------------
create or replace function public.fn_reactivation_gate(p_application_id uuid, p_since timestamptz default null)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  a record; v_email text; v_phone10 text; v_cut timestamptz := public.fn_lane_ladder_cutoff();
  v_ok boolean; v_owned boolean; v_sib uuid[]; v_sib_emails text[]; v_anchor timestamptz; v_reason text;
  v_my_enrolled timestamptz;
begin
  select ap.id, ap.email, ap.phone, ap.status::text as status, ap.terminated_at, ap.contracted_at, ap.duplicate_of,
         ap.email_consent_given, ap.do_not_contact_at, ap.created_at, ap.email_bounced_at, ap.email_bad_at
    into a from public.applications ap where ap.id = p_application_id;
  if not found then return 'no_application'; end if;
  v_email := lower(btrim(coalesce(a.email, '')));
  if v_email = '' or position('@' in v_email) = 0 then return 'no_email'; end if;
  if v_email !~ '^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$' then return 'invalid_email'; end if;
  v_phone10 := public.fn_reactivation_phone10(a.phone);
  if exists (select 1 from public.reactivation_bad_domains d where d.domain = split_part(v_email, '@', 2)) then
    return 'bad_domain';
  end if;
  if a.email_consent_given is not true then return 'no_email_consent'; end if;
  if a.do_not_contact_at is not null then return 'do_not_contact'; end if;
  if a.email_bad_at is not null then return 'email_bad'; end if;
  if a.terminated_at is not null then return 'terminated'; end if;
  if a.contracted_at is not null then return 'contracted'; end if;
  if a.status not in ('new', 'reviewing', 'no_pickup') then return 'app_status:' || a.status; end if;
  if a.created_at >= v_cut then return 'owned_live_ladder'; end if;

  select array_agg(s.application_id), array_agg(distinct s.email_lower) filter (where s.email_lower <> '')
    into v_sib, v_sib_emails
    from public.fn_reactivation_person_siblings(a.id) s;
  v_sib := coalesce(v_sib, array[a.id]);
  v_sib_emails := coalesce(v_sib_emails, array[v_email]);
  if exists (select 1 from public.applications a2 where a2.id = any(v_sib) and a2.created_at >= v_cut) then
    return 'owned_live_ladder';
  end if;
  -- another application of this person was contracted or moved on. terminated_at ALONE is the dedupe closure stamped
  -- on the old twin when someone re-applies (21 'new' + 3 'reviewing' rows), so it does not count.
  select 'sibling_' || case when a2.contracted_at is not null then 'contracted' else a2.status::text end
    into v_reason
    from public.applications a2
   where a2.id = any(v_sib) and a2.id <> a.id
     and (a2.contracted_at is not null or a2.status::text not in ('new', 'reviewing', 'no_pickup'))
   limit 1;
  if v_reason is not null then return v_reason; end if;
  -- one person, one sequence: an earlier-enrolled sibling owns the campaign for this person
  select s.enrolled_at into v_my_enrolled from public.reactivation_sequence s where s.application_id = a.id;
  if exists (select 1 from public.reactivation_sequence s2
              where s2.application_id = any(v_sib) and s2.application_id <> a.id
                and (v_my_enrolled is null or s2.enrolled_at < v_my_enrolled
                     or (s2.enrolled_at = v_my_enrolled and s2.application_id < a.id))) then
    return 'sibling_in_campaign';
  end if;

  if a.email_bounced_at is not null then return 'bounced'; end if;
  if exists (select 1 from public.email_unsubscribes u where lower(u.email) = any(v_sib_emails)) then return 'unsubscribed'; end if;
  if exists (select 1 from public.email_suppressions s where s.email = any(v_sib_emails)
               and s.last_seen_at >= now() - interval '30 days') then return 'suppressed'; end if;

  -- anyone who is or was an agent or a producer, matched by any of the person's addresses or their phone
  if exists (select 1 from public.agents g where g.source_application_id = any(v_sib)) then return 'is_agent'; end if;
  if exists (select 1 from public.profiles pr
              where (lower(btrim(pr.email)) = any(v_sib_emails)
                     or (v_phone10 is not null and public.fn_reactivation_phone10(pr.phone) = v_phone10))
                and exists (select 1 from public.agents g where g.user_id = pr.user_id or g.profile_id = pr.id)) then
    return 'is_agent';
  end if;
  if exists (select 1 from public.agentlink_roster r
              where (r.approval_status = 'approved' or coalesce(r.total_contracts, 0) > 0 or r.producer_active is true)
                and (lower(btrim(r.email)) = any(v_sib_emails)
                     or (v_phone10 is not null and public.fn_reactivation_phone10(r.phone) = v_phone10))) then
    return 'is_producer';
  end if;
  if exists (select 1 from public.ethos_roster r
              where lower(btrim(r.email)) = any(v_sib_emails)
                 or (v_phone10 is not null and public.fn_reactivation_phone10(r.phone) = v_phone10)) then
    return 'is_producer_ethos';
  end if;
  if exists (select 1 from public.next_step_progress p where p.application_id = any(v_sib) and p.status = 'completed') then
    return 'completed_pipeline';
  end if;

  if exists (select 1 from public.interview_events ie
              where ie.canceled_at is null and ie.scheduled_at > now()
                and (ie.application_id = any(v_sib) or lower(btrim(ie.invitee_email)) = any(v_sib_emails)
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
          and (ie.application_id = any(v_sib) or lower(btrim(ie.invitee_email)) = any(v_sib_emails)
               or (v_phone10 is not null and public.fn_reactivation_phone10(ie.invitee_phone) = v_phone10))) then
    return 'booked';
  end if;

  if exists (select 1 from public.reactivation_replies r
              where (r.email_lower = any(v_sib_emails) or r.application_id = any(v_sib)) and r.classification <> 'auto_reply') then
    return 'replied';
  end if;
  -- the onboarding lane's ownership and the peer touch gate: a missing dependency HOLDS, it never waves people through
  if to_regclass('public.v_onboarding_owned_people') is null then
    return 'hold:dependency_missing';
  end if;
  execute 'select exists (select 1 from public.v_onboarding_owned_people o where o.email_lower = any($1))'
    into v_owned using v_sib_emails;
  if v_owned then return 'owned_onboarding'; end if;
  if to_regprocedure('public.fn_recruit_campaign_touch_ok(text,interval)') is null then
    return 'hold:dependency_missing';
  end if;
  execute 'select public.fn_recruit_campaign_touch_ok($1, interval ''7 days'')' into v_ok using v_email;
  if v_ok is null then return 'hold:touch_gate_unknown'; end if;
  if v_ok is false then return 'hold:touch_gate'; end if;
  return null;
end $$;

-- 4. Claim binding -----------------------------------------------------------------------------------------
create or replace function public.fn_reactivation_claim_check(p_application_id uuid, p_claim_token uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare q record; v_b record; v_cap int; v_state text; v_gate text;
begin
  select s.status, s.claimed_at, s.claim_token, s.enrolled_at into q
    from public.reactivation_sequence s where s.application_id = p_application_id;
  if not found then return 'no_sequence'; end if;
  if q.status <> 'active' then return 'status:' || q.status; end if;
  if q.claimed_at is null then return 'not_claimed'; end if;
  if q.claim_token is distinct from p_claim_token then return 'token_mismatch'; end if;
  if q.claimed_at < now() - interval '15 minutes' then return 'claim_expired'; end if;
  select * into v_b from public.fn_reactivation_breaker_state();
  if v_b.is_open then return 'breaker_open'; end if;
  v_cap := public.fn_reactivation_cap();
  if v_cap <= 0 then return 'paused'; end if;
  select a.state into v_state from public.applications a where a.id = p_application_id;
  if not public.fn_reactivation_in_window(v_state) then return 'outside_window'; end if;
  v_gate := public.fn_reactivation_gate(p_application_id, q.enrolled_at);
  if v_gate is not null then return 'gate:' || v_gate; end if;
  return null;
end $$;

-- 5. Incidents, judged at send time -----------------------------------------------------------------------
create or replace function public.fn_reactivation_incidents_between(p_from timestamptz, p_to timestamptz)
returns table(sends integer, bounced integer, complained integer, gate_misses integer)
language sql stable security definer set search_path = public as $$
  with s as materialized (
    select m.application_id, lower(btrim(m.recipient)) as email, m.sent_at, m.external_id,
           public.fn_reactivation_phone10(a.phone) as phone10
      from public.next_step_messages m
      join public.applications a on a.id = m.application_id
     where m.stage_key like 'reactivation\_v2\_%' escape '\' and m.fallback_of_id is null and m.sent_at is not null
       and m.sent_at >= p_from and m.sent_at < p_to
  ), ev as materialized (
    select e.last_event from s join public.email_events e on e.resend_id = s.external_id
  ), agent_people as materialized (
    select lower(btrim(pr.email)) as email, public.fn_reactivation_phone10(pr.phone) as phone10, g.created_at
      from public.agents g join public.profiles pr on pr.user_id = g.user_id or pr.id = g.profile_id
  )
  select
    (select count(*)::int from s),
    (select count(*)::int from ev where ev.last_event = 'bounced'),
    (select count(*)::int from ev where ev.last_event = 'complained'),
    (select count(*)::int from s
      where exists (select 1 from public.email_unsubscribes u where lower(u.email) = s.email and u.unsubscribed_at < s.sent_at)
         or exists (select 1 from public.agents g where g.source_application_id = s.application_id and g.created_at < s.sent_at)
         or exists (select 1 from agent_people ap
                     where (ap.email = s.email or (s.phone10 is not null and ap.phone10 = s.phone10)) and ap.created_at < s.sent_at)
         or exists (select 1 from public.applications a2
                     where lower(btrim(a2.email)) = s.email and a2.created_at >= public.fn_lane_ladder_cutoff()
                       and a2.created_at < s.sent_at))
$$;

create or replace function public.fn_reactivation_incidents()
returns table(bounced integer, complained integer, gate_misses integer, since timestamptz)
language sql stable security definer set search_path = public as $$
  select i.bounced, i.complained, i.gate_misses, public.fn_reactivation_ack()
    from public.fn_reactivation_incidents_between(coalesce(public.fn_reactivation_ack(), '-infinity'::timestamptz),
                                                  'infinity'::timestamptz) i
$$;

create or replace function public.fn_reactivation_canary_guard(p_cap integer)
returns text language plpgsql security definer set search_path = public as $$
declare v record; v_today text := ((now() at time zone 'America/Phoenix')::date)::text;
begin
  if p_cap > 25 then
    return null;
  end if;
  select * into v from public.fn_reactivation_incidents();
  if v.bounced = 0 and v.complained = 0 and v.gate_misses = 0 then
    return null;
  end if;
  update public.system_settings set value = '0', updated_at = now() where key = 'reactivation_daily_cap';
  -- an incident restarts the canary: no qualifying day from before it may count toward a ramp
  insert into public.system_settings (key, value, updated_at) values ('reactivation_ramp_state', '0|0|' || v_today, now())
  on conflict (key) do update set value = excluded.value, updated_at = now();
  perform public.fn_reactivation_trip(
    'canary: ' || v.bounced || ' bounced, ' || v.complained || ' complained, ' || v.gate_misses
      || ' gate miss; cap 0. Resume after the fix: set reactivation_incident_ack, clear reactivation_breaker, set cap 5',
    null);
  return 'paused_incident';
end $$;

-- 6. Ramp: the last COMPLETE Phoenix day, on that day's own sends ---------------------------------------
create or replace function public.fn_reactivation_ramp_evaluate(p_now timestamptz default now())
returns text language plpgsql security definer set search_path = public as $$
declare
  v_cap int := public.fn_reactivation_cap();
  v_day date := ((p_now at time zone 'America/Phoenix')::date) - 1;
  v_from timestamptz := (v_day::timestamp at time zone 'America/Phoenix');
  v_to timestamptz := ((v_day + 1)::timestamp at time zone 'America/Phoenix');
  v_state text; v_step int; v_days int := 0; v_last date;
  v_noid int; v_unsettled int; v_day_inc record; v_open record; v_b record; v_poll timestamptz;
  v_need int; v_next int; v_ok boolean; v_why text := ''; v_out text;
begin
  if v_cap not in (5, 15) then
    if v_cap <= 0 then
      -- paused (by hand, by an incident, or unreadable): the canary count starts afresh when it is re-armed
      insert into public.system_settings (key, value, updated_at) values ('reactivation_ramp_state', '0|0|' || v_day, now())
      on conflict (key) do update set value = excluded.value, updated_at = now();
    end if;
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
      v_days := 0;
    end if;
    if v_last = v_day and v_step = v_cap then
      return 'already evaluated ' || v_day;
    end if;
    select * into v_day_inc from public.fn_reactivation_incidents_between(v_from, v_to);
    select count(*) into v_noid from public.next_step_messages m
     where m.stage_key like 'reactivation\_v2\_%' escape '\' and m.sent_at >= v_from and m.sent_at < v_to
       and (m.external_id is null or btrim(m.external_id) = '');
    select count(*) into v_unsettled from public.reactivation_sequence q
     where (q.status = 'active' and q.claimed_at is not null and q.claimed_at < p_now - interval '15 minutes')
        or (q.status = 'held' and (q.stop_reason like 'unverified%'
                                   or q.stop_reason in ('sent_but_unrecorded', 'already_sent_unadvanced', 'claim_stale_unverified')));
    select * into v_open from public.fn_reactivation_incidents();
    select * into v_b from public.fn_reactivation_breaker_state();
    v_poll := public.fn_reactivation_reply_last_ok();
    if v_day_inc.sends < 3 then v_why := v_why || ' only ' || v_day_inc.sends || ' sent;'; end if;
    if v_noid > 0 then v_why := v_why || ' ' || v_noid || ' without a provider id;'; end if;
    if v_unsettled > 0 then v_why := v_why || ' ' || v_unsettled || ' unsettled claim(s);'; end if;
    if v_day_inc.bounced + v_day_inc.complained + v_day_inc.gate_misses > 0 then v_why := v_why || ' that day had incidents;'; end if;
    if v_open.bounced + v_open.complained + v_open.gate_misses > 0 then v_why := v_why || ' incidents open;'; end if;
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
      v_out := 'ramped ' || v_cap || ' -> ' || v_next || ' after ' || v_days || ' qualifying day(s), last ' || v_day;
      v_step := v_next; v_days := 0;
    elsif v_ok then
      v_out := 'qualifying day ' || v_days || '/' || v_need || ' at cap ' || v_cap || ' (' || v_day || ': ' || v_day_inc.sends || ' sent)';
      v_step := v_cap;
    else
      v_out := v_day || ' did not qualify at cap ' || v_cap || ':' || v_why;
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

-- 7. Claim ----------------------------------------------------------------------------------------------
create or replace function public.fn_reactivation_claim_next()
returns table(application_id uuid, touch smallint, track text, variant text, email text, first_name text,
              last_name text, reason text)
language plpgsql security definer set search_path = public as $$
declare
  v_cap int; v_sent_today int; v_n int; v_bounced int; v_complained int;
  v_cov_n int; v_cov_hit int; v_sent7 int; v_stop7 int; v_fail1h int;
  v_poll timestamptz; v_b record; v_guard text; v_ack timestamptz; v_from14 timestamptz; v_from7 timestamptz;
  cand record; v_gate text; v_track text; v_variant text;
begin
  v_cap := public.fn_reactivation_cap();
  if v_cap < 0 then
    return query select null::uuid, null::smallint, null::text, null::text, null::text, null::text, null::text, 'paused_cap_unreadable'::text;
    return;
  end if;
  if v_cap = 0 then
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
  -- the brakes' windows start at the incident ack, so the documented resume actually resumes
  v_ack := public.fn_reactivation_ack();
  v_from14 := greatest(now() - interval '14 days', coalesce(v_ack, '-infinity'::timestamptz));
  v_from7 := greatest(now() - interval '7 days', coalesce(v_ack, '-infinity'::timestamptz));
  select count(*), count(*) filter (where e.last_event = 'bounced'), count(*) filter (where e.last_event = 'complained')
    into v_n, v_bounced, v_complained
    from public.next_step_messages m join public.email_events e on e.resend_id = m.external_id
   where m.stage_key like 'reactivation\_v2\_%' escape '\' and m.sent_at >= v_from14;
  if v_complained > 0 then
    perform public.fn_reactivation_trip('spam complaint on a reactivation email; after the fix set reactivation_incident_ack, clear the breaker', null);
    return query select null::uuid, null::smallint, null::text, null::text, null::text, null::text, null::text, 'paused_complaint'::text;
    return;
  end if;
  if v_n >= 25 and v_bounced::numeric / v_n >= 0.08 then
    perform public.fn_reactivation_trip('bounce rate ' || v_bounced || ' of ' || v_n || ' since ack or 14 days', null);
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
   where m.stage_key like 'reactivation\_v2\_%' escape '\' and m.fallback_of_id is null and m.sent_at >= v_from7;
  select count(distinct coalesce(rp.application_id::text, rp.email_lower)) into v_stop7 from public.reactivation_replies rp
   where rp.classification = 'stop' and rp.created_at >= v_from7
     and exists (select 1 from public.next_step_messages m
                  where m.stage_key like 'reactivation\_v2\_%' escape '\' and m.sent_at is not null
                    and (m.application_id = rp.application_id or lower(btrim(m.recipient)) = rp.email_lower));
  if v_sent7 >= 20 and v_stop7::numeric / v_sent7 >= 0.05 then
    perform public.fn_reactivation_trip('stop_rate: ' || v_stop7 || ' people said STOP on ' || v_sent7 || ' sends since ack or 7 days', null);
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

  for cand in
    select s.application_id, s.current_touch, s.track, s.variant, s.enrolled_at, a.email, a.first_name, a.last_name, a.state
      from public.reactivation_sequence s join public.applications a on a.id = s.application_id
     where s.status = 'active' and s.next_due_at <= now() and s.claimed_at is null
     order by s.current_touch desc, s.next_due_at
     limit 40
       for update of s skip locked
  loop
    if not public.fn_reactivation_in_window(cand.state) then continue; end if;
    v_gate := public.fn_reactivation_gate(cand.application_id, cand.enrolled_at);
    if v_gate is null then
      update public.reactivation_sequence set claimed_at = now(), claim_request_id = null, claim_token = null, updated_at = now()
       where reactivation_sequence.application_id = cand.application_id;
      return query select cand.application_id, (cand.current_touch + 1)::smallint, cand.track, cand.variant, cand.email::text,
                          cand.first_name::text, cand.last_name::text, 'claimed'::text;
      return;
    elsif v_gate like 'hold:%' then
      update public.reactivation_sequence set next_due_at = now() + interval '6 hours', last_error = v_gate, updated_at = now()
       where reactivation_sequence.application_id = cand.application_id;
    else
      update public.reactivation_sequence set status = 'stopped', stop_reason = v_gate, claimed_at = null, updated_at = now()
       where reactivation_sequence.application_id = cand.application_id;
    end if;
  end loop;

  for cand in
    select c.application_id, c.email, c.first_name, c.last_name, c.state, c.track
      from public.v_reactivation_cohort c
     where not exists (select 1 from public.reactivation_sequence s
                        where s.application_id = c.application_id or s.email_lower = lower(btrim(c.email)))
     order by c.send_rank
     limit 40
  loop
    if not public.fn_reactivation_in_window(cand.state) then continue; end if;
    v_gate := public.fn_reactivation_gate(cand.application_id, null);
    v_track := coalesce(cand.track, public.fn_reactivation_track(cand.application_id));
    v_variant := public.fn_reactivation_variant(cand.application_id);
    insert into public.reactivation_sequence (application_id, email_lower, track, variant, current_touch, next_due_at,
                                              status, stop_reason, enrolled_from, claimed_at)
    values (cand.application_id, lower(btrim(cand.email)), v_track, v_variant, 0,
            case when v_gate like 'hold:%' then now() + interval '6 hours' else now() end,
            case when v_gate is null or v_gate like 'hold:%' then 'active' else 'stopped' end,
            case when v_gate is null or v_gate like 'hold:%' then null else v_gate end,
            'cohort', case when v_gate is null then now() else null end)
    on conflict do nothing;
    if v_gate is null and found then
      return query select cand.application_id, 1::smallint, v_track, v_variant, cand.email::text,
                          cand.first_name::text, cand.last_name::text, 'claimed_new'::text;
      return;
    end if;
  end loop;
  return query select null::uuid, null::smallint, null::text, null::text, null::text, null::text, null::text, 'nothing_due'::text;
end $$;

-- 8. Settle claims -------------------------------------------------------------------------------------
create or replace function public.fn_reactivation_reconcile()
returns text language plpgsql security definer set search_path = public as $$
declare r record; h record; v_code int; v_body text; v_out text; v_kind text; v_recent int;
begin
  for r in
    select s.application_id, s.claim_request_id from public.reactivation_sequence s
     where s.claim_request_id is not null and s.claim_reconciled_at is null
       and ((s.status = 'active' and s.claimed_at is not null)
            or (s.status = 'held' and s.stop_reason = 'claim_stale_unverified'))
       for update of s skip locked
  loop
    select hr.status_code, hr.timed_out, hr.error_msg, left(coalesce(hr.content, ''), 300) as body
      into h from net._http_response hr where hr.id = r.claim_request_id;
    if not found then
      continue;   -- no answer yet; hold_stale_claims settles it at 20 minutes
    end if;
    v_code := h.status_code;
    v_body := coalesce(h.body, '');
    v_kind := case
      when coalesce(h.timed_out, false) or h.error_msg is not null or v_code is null then 'maybe'
      when v_code = 409 and v_body ~* 'claim_not_live' then 'not_live'
      when v_code = 503 and v_body ~* 'BOOT_ERROR' then 'config'          -- the handler never ran
      when v_code in (400, 401, 403, 404, 405) then 'config'
      when v_code = 503 and v_body ~* 'not_configured' then 'config'
      when v_code = 500 and v_body ~* 'template_invalid' then 'config'
      when v_code = 503 and v_body ~* 'unreadable|unwritable|nothing sent' then 'transient'
      when v_code = 500 and v_body ~* 'stage unreadable|application unreadable' then 'transient'
      else 'maybe' end;
    if v_kind in ('not_live', 'config', 'transient') then
      -- nothing was sent: release untouched (a precautionary stale hold is released too)
      update public.reactivation_sequence
         set status = 'active', stop_reason = null, claimed_at = null, claim_token = null,
             last_http_status = v_code, last_error = left('nothing sent: ' || v_body, 300),
             claim_reconciled_at = now(), updated_at = now()
       where reactivation_sequence.application_id = r.application_id;
      if v_kind = 'config' then
        perform public.fn_reactivation_trip('send function answered ' || v_code || ' before sending: ' || left(v_body, 120), null);
      elsif v_kind = 'transient' then
        select count(*) into v_recent from public.reactivation_sequence q
         where q.claim_reconciled_at >= now() - interval '24 hours' and q.last_error like 'nothing sent:%'
           and q.last_http_status in (500, 503);
        perform public.fn_reactivation_trip('transient read error in the send function (' || v_recent || ' in 24h): ' || left(v_body, 100),
                                            case when v_recent >= 3 then null else interval '1 hour' end);
      end if;
      v_out := v_kind || '_' || v_code;
    else
      update public.reactivation_sequence
         set status = 'held',
             stop_reason = case when v_code between 200 and 299 or v_body ~* 'sent_but_unrecorded' then 'sent_but_unrecorded'
                                when v_code = 409 then 'already_sent_unadvanced'
                                when h.timed_out then 'unverified_timeout'
                                when h.error_msg is not null then 'unverified_transport'
                                else 'unverified_' || coalesce(v_code::text, 'unknown') end,
             claimed_at = null, claim_token = null, last_http_status = v_code,
             last_error = left(coalesce(h.error_msg, v_body), 300), claim_reconciled_at = now(), updated_at = now()
       where reactivation_sequence.application_id = r.application_id;
      perform public.fn_reactivation_trip(
        'unverified send (' || coalesce(v_code::text, case when h.timed_out then 'timeout' else 'transport' end) || ')',
        case when v_code between 200 and 299 or v_code = 409 or v_body ~* 'sent_but_unrecorded'
                  or public.fn_reactivation_unverified_24h() >= 2 then null
             else interval '1 hour' end);
      v_out := 'held_unverified';
    end if;
  end loop;
  return v_out;
end $$;

create or replace function public.fn_reactivation_hold_stale_claims()
returns integer language plpgsql security definer set search_path = public as $$
declare v_n int := 0; v_ids bigint[];
begin
  with held as (
    update public.reactivation_sequence
       set status = 'held', stop_reason = 'claim_stale_unverified', updated_at = now()
     where status = 'active' and claimed_at is not null and claimed_at < now() - interval '20 minutes'
    returning claim_request_id
  )
  select count(*), array_agg(claim_request_id) filter (where claim_request_id is not null) into v_n, v_ids from held;
  if v_n > 0 then
    -- a request still waiting in pg_net's queue would fire late; cancel it (the send function's claim check is the
    -- second line: a late request is answered claim_not_live)
    delete from net.http_request_queue q where q.id = any(coalesce(v_ids, '{}'::bigint[]));
    perform public.fn_reactivation_trip('stale claim: no answer from the send function',
                                        case when public.fn_reactivation_unverified_24h() >= 2 then null else interval '1 hour' end);
  end if;
  return v_n;
end $$;

-- 9. Dispatch -------------------------------------------------------------------------------------------
create or replace function public.fn_reactivation_dispatch_inner()
returns text language plpgsql security definer set search_path = public as $$
declare c record; v_key text; v_stage text; v_req bigint; v_rec text; v_token uuid;
begin
  v_rec := public.fn_reactivation_reconcile();
  perform public.fn_reactivation_hold_stale_claims();
  select * into c from public.fn_reactivation_claim_next() limit 1;
  if c.application_id is null then
    return coalesce(c.reason, 'nothing_due') || coalesce(' | reconcile: ' || v_rec, '');
  end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'reactivation_send_key';
  if v_key is null or btrim(v_key) = '' then
    update public.reactivation_sequence set claimed_at = null, claim_token = null, last_error = 'no_send_key', updated_at = now()
     where reactivation_sequence.application_id = c.application_id;
    perform public.fn_reactivation_trip('no reactivation_send_key in vault', null);
    return 'no_send_key';
  end if;
  v_stage := 'reactivation_v2_' || lower(substr(c.track, 3)) || '_t' || c.touch || '_' || lower(c.variant);
  v_token := gen_random_uuid();
  v_req := net.http_post(
    url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/reactivation-send',
    body := jsonb_build_object('application_id', c.application_id, 'stage_key', v_stage, 'claim_token', v_token),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-reactivation-key', v_key),
    timeout_milliseconds := 30000);
  update public.reactivation_sequence
     set claim_request_id = v_req, claim_token = v_token, last_http_status = null, claim_reconciled_at = null
   where reactivation_sequence.application_id = c.application_id;
  return 'dispatched ' || v_stage || coalesce(' | reconcile: ' || v_rec, '');
end $$;

-- 10. Receipts ------------------------------------------------------------------------------------------
create or replace function public.fn_reactivation_on_receipt()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_touch int; v_retry boolean; v_reason text; v_scope text;
begin
  begin
    v_touch := nullif(new.metadata->>'touch', '')::int;
    if v_touch is null then v_touch := substring(new.stage_key from '_t([123])_[ab]$')::int; end if;
    if new.sent_at is not null then
      -- the email is out, so the record always moves forward; but a STOP that landed mid-flight is never undone
      update public.reactivation_sequence
         set current_touch = greatest(current_touch, v_touch), last_touch_at = new.sent_at,
             last_resend_id = new.external_id, last_message_id = new.id,
             attempts_failed = 0, last_error = null, claimed_at = null, claim_token = null,
             next_due_at = case when status = 'stopped' then next_due_at
                                when v_touch < 3 then new.sent_at + interval '7 days 2 hours' else null end,
             status = case when status = 'stopped' then status when v_touch >= 3 then 'completed' else 'active' end,
             stop_reason = case when status = 'stopped' then stop_reason when v_touch >= 3 then 'sequence_complete' else null end,
             updated_at = now()
       where application_id = new.application_id;
    elsif new.failed_at is not null then
      v_retry := coalesce((new.metadata->>'retryable')::boolean, false);
      v_scope := coalesce(nullif(new.metadata->>'scope', ''), 'person');
      v_reason := regexp_replace(left(coalesce(new.error, 'send_refused'), 80), '^skipped:\s*', '');
      if v_scope = 'account' then
        update public.reactivation_sequence
           set claimed_at = null, claim_token = null, last_error = left(new.error, 300), updated_at = now()
         where application_id = new.application_id and status = 'active';
        perform public.fn_reactivation_trip('provider refused the account: ' || left(coalesce(new.error, '?'), 150),
                                            case when v_retry then interval '1 hour' else null end);
      elsif v_scope = 'unknown' then
        update public.reactivation_sequence
           set status = 'held', stop_reason = 'unverified_provider', claimed_at = null, claim_token = null,
               last_error = left(new.error, 300), updated_at = now()
         where application_id = new.application_id and status = 'active';
        perform public.fn_reactivation_trip('unverified provider answer: ' || left(coalesce(new.error, '?'), 140),
                                            case when public.fn_reactivation_unverified_24h() >= 2 then null else interval '1 hour' end);
      elsif v_retry then
        update public.reactivation_sequence
           set attempts_failed = attempts_failed + 1, last_error = left(new.error, 300), claimed_at = null, claim_token = null,
               next_due_at = now() + make_interval(mins => 15 * (attempts_failed + 1)),
               status = case when attempts_failed + 1 >= 5 then 'held' else 'active' end,
               stop_reason = case when attempts_failed + 1 >= 5 then 'send_failed_5x' else stop_reason end,
               updated_at = now()
         where application_id = new.application_id and status = 'active';
      else
        update public.reactivation_sequence
           set status = 'stopped', stop_reason = v_reason, claimed_at = null, claim_token = null,
               last_error = left(new.error, 300), updated_at = now()
         where application_id = new.application_id and status = 'active';
      end if;
    end if;
  exception when others then
    raise warning 'fn_reactivation_on_receipt: sequence update failed for %: %', new.application_id, sqlerrm;
  end;
  return null;
end $$;

-- 11. Health ---------------------------------------------------------------------------------------------
create or replace view public.v_reactivation_health with (security_invoker = true) as
select
  public.fn_reactivation_cap() as daily_cap,
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
  -- consent as the send function SAW it at send time (its receipt snapshot), never as it reads today
  (select count(*) from public.next_step_messages m
    where m.stage_key like 'reactivation\_v2\_%' escape '\' and m.sent_at is not null
      and coalesce(m.metadata->>'consent', 'false') <> 'true') as sent_without_email_consent,
  (select count(*) from public.next_step_stages st where st.stage_key like 'reactivation\_v2\_%' escape '\') as stage_rows_loaded,
  (select count(*) from cron.job where jobname = 'reactivation-send-tick' and active) as cron_tick_active,
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
  i.bounced as incident_bounced,
  i.complained as incident_complained,
  i.gate_misses as gate_misses,
  i.since as incident_since,
  (select s.value from public.system_settings s where s.key = 'reactivation_ramp_state') as ramp_state,
  (select s.value from public.system_settings s where s.key = 'reactivation_ramp_log') as ramp_log,
  -- appended 2026-11-12 (pre-arm hardening)
  (select case when split_part(s.value, ' ', 1) ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$'
               then extract(epoch from now() - split_part(s.value, ' ', 1)::timestamptz)::int end
     from public.system_settings s where s.key = 'reactivation_last_tick') as last_tick_age_s,
  (to_regclass('public.v_onboarding_owned_people') is not null
   and to_regprocedure('public.fn_recruit_campaign_touch_ok(text,interval)') is not null) as dependencies_present,
  public.fn_reactivation_unverified_24h() as unverified_24h
from public.fn_reactivation_incidents() i;

-- 12. Grants ---------------------------------------------------------------------------------------------
revoke all on function public.fn_reactivation_cap() from public, anon, authenticated;
revoke all on function public.fn_reactivation_ack() from public, anon, authenticated;
revoke all on function public.fn_reactivation_unverified_24h() from public, anon, authenticated;
revoke all on function public.fn_reactivation_person_siblings(uuid) from public, anon, authenticated;
revoke all on function public.fn_reactivation_gate(uuid, timestamptz) from public, anon, authenticated;
revoke all on function public.fn_reactivation_claim_check(uuid, uuid) from public, anon, authenticated;
revoke all on function public.fn_reactivation_incidents_between(timestamptz, timestamptz) from public, anon, authenticated;
revoke all on function public.fn_reactivation_incidents() from public, anon, authenticated;
revoke all on function public.fn_reactivation_canary_guard(integer) from public, anon, authenticated;
revoke all on function public.fn_reactivation_ramp_evaluate(timestamptz) from public, anon, authenticated;
revoke all on function public.fn_reactivation_claim_next() from public, anon, authenticated;
revoke all on function public.fn_reactivation_reconcile() from public, anon, authenticated;
revoke all on function public.fn_reactivation_hold_stale_claims() from public, anon, authenticated;
revoke all on function public.fn_reactivation_dispatch_inner() from public, anon, authenticated;
revoke all on function public.fn_reactivation_on_receipt() from public, anon, authenticated;
revoke all on function public.fn_reactivation_replies_default_key() from public, anon, authenticated;
grant execute on function public.fn_reactivation_replies_default_key() to service_role;
grant execute on function public.fn_reactivation_cap(), public.fn_reactivation_ack(), public.fn_reactivation_unverified_24h(),
                         public.fn_reactivation_person_siblings(uuid), public.fn_reactivation_gate(uuid, timestamptz),
                         public.fn_reactivation_claim_check(uuid, uuid),
                         public.fn_reactivation_incidents_between(timestamptz, timestamptz), public.fn_reactivation_incidents(),
                         public.fn_reactivation_canary_guard(integer), public.fn_reactivation_ramp_evaluate(timestamptz),
                         public.fn_reactivation_claim_next(), public.fn_reactivation_reconcile(),
                         public.fn_reactivation_hold_stale_claims(), public.fn_reactivation_dispatch_inner(),
                         public.fn_reactivation_on_receipt()
  to service_role;
revoke all on public.v_reactivation_health from public, anon, authenticated;
grant select on public.v_reactivation_health to service_role;

commit;
