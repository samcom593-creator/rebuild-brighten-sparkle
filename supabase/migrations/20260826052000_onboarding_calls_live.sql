-- 20260826052000_onboarding_calls_live.sql
-- Lane 3 (2026-08-26): Onboarding calls — accurate + live, auto-booked for every
-- newly licensed hire, Milver on every onboarding meeting.
--
-- MEASURED BEFORE WRITING (bot-sql, 2026-08-26 UTC — never coded to the brief):
--   * interview_events.call_track CHECK allowed licensed/leader/seminar/exam/other.
--     No onboarding track existed anywhere; no Calendly event type contained
--     "onboarding"; count(*) where event_type_name ilike '%onboard%' = 0.
--   * apex_scheduled_calls holds 2 rows, both 2026-06-10, both 'licensed_prospect'.
--     Its only writer (gcal-sync) has no cron. The launchd calendly-alerter polls
--     THAT table and has fired 0 alerts in its life (0 "ALERTED" log lines,
--     lastid = 2) while 252 Calendly bookings landed in interview_events. The
--     alerter is repointed at interview_events in this wave (business-ops side).
--   * 87 of 88 interview_events rows in the last 30d were created at the :17/:18
--     backfill tick — the Calendly webhook is not delivering; capture lags up to
--     6h. A 15-minute future-window reconcile is scheduled below.
--   * Calendly org has ONE member (Sam, owner). Milver cannot be a co-host on the
--     event type without an org seat (paid) — not purchased (hard limit). The
--     durable path is a real .ics invite per booking (onboarding_call_invites).
--   * Event type created via Calendly API 2026-08-26T03:10:02Z:
--       https://api.calendly.com/event_types/9e76c9f9-263b-4c39-9689-3b3941f6b15f
--       https://calendly.com/apexfinancialempire/apex-onboarding-call (30 min, outbound_call)
--
-- Statements are separated by `-- @@stmt` markers so the bot-sql applier can send
-- them one at a time (a function body cannot cross a bot-sql call). The file is
-- still a valid single migration for `supabase db push`.

-- ---------------------------------------------------------------------------
-- 1. 'onboarding' becomes a first-class call track
-- ---------------------------------------------------------------------------
-- @@stmt
alter table public.interview_events drop constraint if exists interview_events_call_track_check;
-- @@stmt
alter table public.interview_events
  add constraint interview_events_call_track_check
  check (call_track = any (array['licensed'::text, 'leader'::text, 'seminar'::text, 'exam'::text, 'other'::text, 'onboarding'::text]));

-- Both ingest paths (calendly-webhook, calendly-backfill) classify with a substring
-- ladder that has no "onboarding" rung and files "APEX Onboarding Call" under
-- 'other'. Normalising in a BEFORE trigger covers both writers plus manual rows
-- without touching either edge function, and resolves the hire's agent row.
-- @@stmt
create or replace function public.fn_interview_events_classify_onboarding()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
begin
  if coalesce(new.event_type_name, '') ilike '%onboarding%' then
    new.call_track := 'onboarding';
  end if;

  if new.call_track = 'onboarding' and new.agent_id is null then
    -- 1. application -> agent (agents.source_application_id)
    if new.application_id is not null then
      select array_agg(a.id) into v_ids
        from public.agents a
       where a.source_application_id = new.application_id
         and coalesce(a.is_deactivated, false) = false;
      if coalesce(cardinality(v_ids), 0) = 1 then
        new.agent_id := v_ids[1];
      end if;
    end if;
    -- 2. invitee email -> profile -> agent. Exactly one match or nothing: two rows
    --    that agree is still ambiguity, not identity (MP-275).
    if new.agent_id is null and coalesce(new.invitee_email, '') <> '' then
      select array_agg(distinct a.id) into v_ids
        from public.agents a
        join public.profiles p on p.user_id = a.user_id
       where lower(p.email) = lower(new.invitee_email)
         and coalesce(a.is_deactivated, false) = false;
      if coalesce(cardinality(v_ids), 0) = 1 then
        new.agent_id := v_ids[1];
      end if;
    end if;
  end if;
  return new;
end $$;
-- @@stmt
drop trigger if exists trg_interview_events_classify_onboarding on public.interview_events;
-- @@stmt
create trigger trg_interview_events_classify_onboarding
  before insert or update of event_type_name, call_track, invitee_email, application_id
  on public.interview_events
  for each row execute function public.fn_interview_events_classify_onboarding();

-- Backfill any booking already stored under the new event type name (0 rows at
-- apply time — measured — but the statement is what makes a later re-run honest).
-- @@stmt
update public.interview_events
   set call_track = 'onboarding'
 where event_type_name ilike '%onboarding%'
   and call_track is distinct from 'onboarding';

-- ---------------------------------------------------------------------------
-- 2. onboarding_call_invites — one row per (booking, recipient, kind); the
--    Resend message id is the receipt. Drained by edge fn onboarding-call-invites.
-- ---------------------------------------------------------------------------
-- @@stmt
create table if not exists public.onboarding_call_invites (
  id                uuid primary key default gen_random_uuid(),
  booking_id        uuid not null references public.interview_events(id) on delete cascade,
  recipient         text not null,
  kind              text not null default 'request' check (kind in ('request', 'cancel')),
  ics_uid           text not null,
  sequence          integer not null default 0,
  status            text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped')),
  attempt_count     integer not null default 0,
  last_error        text,
  resend_message_id text,
  sent_at           timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (booking_id, recipient, kind)
);
-- @@stmt
comment on table public.onboarding_call_invites is
  'Lane 3 2026-08-26: calendar invites (.ics METHOD:REQUEST / CANCEL) sent by Resend to the onboarding team for every onboarding-call booking. resend_message_id is the delivery receipt; a row without one was never delivered.';
-- @@stmt
create index if not exists onboarding_call_invites_pending_idx
  on public.onboarding_call_invites (created_at) where status = 'queued';
-- @@stmt
alter table public.onboarding_call_invites enable row level security;
-- @@stmt
drop policy if exists onboarding_call_invites_service on public.onboarding_call_invites;
-- @@stmt
create policy onboarding_call_invites_service on public.onboarding_call_invites
  for all to service_role using (true) with check (true);
-- @@stmt
drop policy if exists onboarding_call_invites_staff_read on public.onboarding_call_invites;
-- @@stmt
create policy onboarding_call_invites_staff_read on public.onboarding_call_invites
  for select to authenticated
  using (exists (select 1 from public.user_roles ur
                  where ur.user_id = auth.uid()
                    and ur.role::text in ('admin', 'manager', 'va_manager', 'va')));

-- Recipients + Calendly identifiers live in system_settings so Sam can change
-- them without a deploy. Sam named Milver (milver.taca@gmail.com) 2026-08-26.
-- @@stmt
insert into public.system_settings (key, value) values
  ('onboarding_call_invite_recipients', 'milver.taca@gmail.com'),
  ('onboarding_call_event_type_uri',    'https://api.calendly.com/event_types/9e76c9f9-263b-4c39-9689-3b3941f6b15f'),
  ('onboarding_call_scheduling_url',    'https://calendly.com/apexfinancialempire/apex-onboarding-call')
on conflict (key) do nothing;

-- @@stmt
create or replace function public.fn_queue_onboarding_call_invites()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_recipients text[];
  v_r text;
  v_uid text;
begin
  if new.call_track is distinct from 'onboarding' then
    return new;
  end if;

  begin
    select array_remove(array_agg(distinct lower(trim(x))), '')
      into v_recipients
      from unnest(string_to_array(
             coalesce((select value from public.system_settings where key = 'onboarding_call_invite_recipients'), ''),
             ',')) as x;
    if v_recipients is null or cardinality(v_recipients) = 0 then
      return new;
    end if;

    v_uid := 'apex-onboarding-' || new.id::text || '@apex-financial.org';

    if new.canceled_at is null and new.scheduled_at > now() then
      -- (re)booked: one REQUEST per recipient. A request that already reached a
      -- calendar and whose time moved is re-opened with a higher SEQUENCE.
      foreach v_r in array v_recipients loop
        insert into public.onboarding_call_invites (booking_id, recipient, kind, ics_uid)
        values (new.id, v_r, 'request', v_uid)
        on conflict (booking_id, recipient, kind) do nothing;
      end loop;
      if tg_op = 'UPDATE' and old.scheduled_at is distinct from new.scheduled_at then
        update public.onboarding_call_invites
           set status = 'queued', attempt_count = 0, last_error = null,
               sequence = sequence + 1, updated_at = now()
         where booking_id = new.id and kind = 'request' and status = 'sent';
      end if;
    elsif new.canceled_at is not null and (tg_op = 'INSERT' or old.canceled_at is null) then
      -- canceled: a REQUEST that was delivered needs a CANCEL; one still queued
      -- is withdrawn — there is nothing to un-send.
      update public.onboarding_call_invites
         set status = 'skipped', last_error = 'booking canceled before invite was sent', updated_at = now()
       where booking_id = new.id and kind = 'request' and status = 'queued';
      insert into public.onboarding_call_invites (booking_id, recipient, kind, ics_uid, sequence)
      select i.booking_id, i.recipient, 'cancel', i.ics_uid, i.sequence + 1
        from public.onboarding_call_invites i
       where i.booking_id = new.id and i.kind = 'request' and i.status = 'sent'
      on conflict (booking_id, recipient, kind) do nothing;
    end if;
  exception when others then
    -- An invite-queue failure must never lose the booking store (same posture as
    -- fn_auto_license_from_licensed_booking). v_onboarding_call_truth shows gaps.
    raise warning 'fn_queue_onboarding_call_invites failed for interview_event %: %', new.id, sqlerrm;
  end;
  return new;
end $$;
-- @@stmt
drop trigger if exists trg_queue_onboarding_call_invites on public.interview_events;
-- @@stmt
create trigger trg_queue_onboarding_call_invites
  after insert or update of call_track, event_type_name, canceled_at, scheduled_at, invitee_email, invitee_name
  on public.interview_events
  for each row execute function public.fn_queue_onboarding_call_invites();

-- Queue invites for onboarding bookings that already exist and are still ahead
-- (0 rows at apply time — measured).
-- @@stmt
insert into public.onboarding_call_invites (booking_id, recipient, kind, ics_uid)
select ie.id, r.recipient, 'request', 'apex-onboarding-' || ie.id::text || '@apex-financial.org'
  from public.interview_events ie
  cross join (select array_remove(array_agg(distinct lower(trim(x))), '') as recipients
                from unnest(string_to_array(coalesce((select value from public.system_settings where key = 'onboarding_call_invite_recipients'), ''), ',')) as x) rs
  cross join lateral unnest(rs.recipients) as r(recipient)
 where ie.call_track = 'onboarding'
   and ie.canceled_at is null
   and ie.scheduled_at > now()
on conflict (booking_id, recipient, kind) do nothing;

-- ---------------------------------------------------------------------------
-- 3. Auto-book on license: ONE idempotent 'onboarding_call' message through the
--    existing agent_onboarding_queue -> send-agent-onboarding-email path.
-- ---------------------------------------------------------------------------
-- @@stmt
alter table public.agent_onboarding_queue drop constraint if exists agent_onboarding_queue_email_kind_check;
-- @@stmt
alter table public.agent_onboarding_queue
  add constraint agent_onboarding_queue_email_kind_check
  check (email_kind = any (array['course'::text, 'discord'::text, 'hired_whatsapp'::text, 'onboarding_call'::text]));
-- @@stmt
alter table public.agent_onboarding_queue add column if not exists meta jsonb;

-- The onboarding-call booking an agent already has (future or past, not canceled),
-- resolved through every identity the booking might carry: agent_id, the agent's
-- source application, or the profile email. NULL means none on the calendar.
-- @@stmt
create or replace function public.fn_agent_onboarding_call_booking(p_agent_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select ie.id
    from public.interview_events ie
    left join public.agents a on a.id = p_agent_id
    left join lateral (
      select p.email from public.profiles p
       where p.user_id = a.user_id and coalesce(p.email, '') <> ''
       limit 1
    ) pe on true
   where ie.call_track = 'onboarding'
     and ie.canceled_at is null
     and (
          ie.agent_id = p_agent_id
       or (a.source_application_id is not null and ie.application_id = a.source_application_id)
       or (pe.email is not null and lower(ie.invitee_email) = lower(pe.email))
     )
   order by ie.scheduled_at desc
   limit 1
$$;

-- @@stmt
create or replace function public.fn_enqueue_onboarding_call_booking(p_agent_id uuid, p_source text default 'trigger')
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent record;
  v_booking uuid;
  v_queue_id uuid;
  v_existing record;
begin
  select a.id,
         a.license_status::text as license_status,
         a.status::text as status,
         coalesce(a.is_deactivated, false) as is_deactivated,
         coalesce(a.is_inactive, false) as is_inactive
    into v_agent
    from public.agents a
   where a.id = p_agent_id;
  if not found then
    return jsonb_build_object('enqueued', false, 'reason', 'agent_not_found', 'agent_id', p_agent_id);
  end if;
  if v_agent.license_status is distinct from 'licensed' then
    return jsonb_build_object('enqueued', false, 'reason', 'not_licensed', 'agent_id', p_agent_id, 'license_status', v_agent.license_status);
  end if;
  if v_agent.is_deactivated or v_agent.is_inactive or v_agent.status is distinct from 'active' then
    return jsonb_build_object('enqueued', false, 'reason', 'agent_not_active', 'agent_id', p_agent_id, 'status', v_agent.status);
  end if;

  v_booking := public.fn_agent_onboarding_call_booking(p_agent_id);
  if v_booking is not null then
    return jsonb_build_object('enqueued', false, 'reason', 'booking_exists', 'agent_id', p_agent_id, 'booking_id', v_booking);
  end if;

  select q.id, q.sent_at into v_existing
    from public.agent_onboarding_queue q
   where q.agent_id = p_agent_id and q.email_kind = 'onboarding_call';
  if found then
    return jsonb_build_object('enqueued', false,
      'reason', case when v_existing.sent_at is not null then 'already_sent' else 'already_queued' end,
      'agent_id', p_agent_id, 'queue_id', v_existing.id, 'sent_at', v_existing.sent_at);
  end if;

  insert into public.agent_onboarding_queue (agent_id, email_kind, target_send_at, meta)
  values (p_agent_id, 'onboarding_call', now(), jsonb_build_object('source', p_source, 'enqueued_at', now()))
  on conflict (agent_id, email_kind) do nothing
  returning id into v_queue_id;

  return jsonb_build_object('enqueued', v_queue_id is not null,
    'reason', case when v_queue_id is null then 'already_queued' else 'queued' end,
    'agent_id', p_agent_id, 'queue_id', v_queue_id);
end $$;

-- Same gate as the course/discord/whatsapp chain (trg_agents_hired_licensed_enqueue
-- on agents INSERT/UPDATE OF onboarding_stage, status, license_status). Body is the
-- live prod definition read back via pg_get_functiondef 2026-08-26, plus one call.
-- @@stmt
CREATE OR REPLACE FUNCTION public.fn_enqueue_hired_licensed_onboarding()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
  should_fire boolean;
BEGIN
  -- Only hired+licensed agents get the hired chain.
  IF NEW.license_status IS DISTINCT FROM 'licensed' THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    -- Enqueue when the row lands in the terminal hired state directly.
    should_fire := (NEW.onboarding_stage = 'live')
                   OR (NEW.status = 'active');
  ELSE
    -- UPDATE path: any transition into a terminal state (stage / status /
    -- license_status) trips the enqueue, matching the pre-fix behavior.
    should_fire := (
         (OLD.onboarding_stage IS DISTINCT FROM NEW.onboarding_stage AND NEW.onboarding_stage = 'live')
      OR (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'active' AND COALESCE(OLD.status::text, '') NOT IN ('active', 'live'))
      OR (OLD.license_status IS DISTINCT FROM NEW.license_status AND NEW.license_status = 'licensed')
    );
  END IF;

  IF NOT should_fire THEN
    RETURN NEW;
  END IF;

  -- Flip has_training_course = true so ProducerProfile + CourseProgressPanel
  -- + DashboardCRM treat this agent as enrolled without waiting for their
  -- first /course-catalog visit. Guarded by pg_trigger_depth to prevent
  -- self-recursion when the flip re-fires the UPDATE trigger.
  IF pg_trigger_depth() = 1
     AND COALESCE(NEW.has_training_course, false) = false THEN
    UPDATE public.agents
    SET has_training_course = true,
        updated_at = now()
    WHERE id = NEW.id
      AND COALESCE(has_training_course, false) = false;
  END IF;

  -- Enqueue the hired chain. We do NOT gate on profile-email presence at
  -- enqueue time — the drainer skips no-email rows and the guardrail view
  -- surfaces them. This preserves the routing receipt (row exists) even
  -- when the profile is not yet linked.
  INSERT INTO public.agent_onboarding_queue (agent_id, email_kind, target_send_at)
  VALUES
    (NEW.id, 'course',         now()),
    (NEW.id, 'discord',        now()),
    (NEW.id, 'hired_whatsapp', now())
  ON CONFLICT (agent_id, email_kind) DO NOTHING;

  -- Lane 3 (2026-08-26): every newly licensed hire also gets ONE onboarding-call
  -- booking email, unless an onboarding call is already on the calendar.
  -- Idempotent on (agent_id, 'onboarding_call'); never blocks the hire write.
  BEGIN
    PERFORM public.fn_enqueue_onboarding_call_booking(NEW.id, 'trigger:' || TG_OP);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'fn_enqueue_onboarding_call_booking failed for agent %: %', NEW.id, SQLERRM;
  END;

  RETURN NEW;
END;
$function$;

-- One-call admin RPC for the backfill decision: currently licensed agents with no
-- onboarding call are COUNTED (v_onboarding_call_truth / v_onboarding_call_gaps),
-- never mass-sent. An admin enqueues a named person.
-- @@stmt
create or replace function public.admin_enqueue_onboarding_call(p_agent_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null
     or not (public.has_role(auth.uid(), 'admin'::public.app_role)
          or public.has_role(auth.uid(), 'manager'::public.app_role)
          or public.has_role(auth.uid(), 'va_manager'::public.app_role)) then
    raise exception 'admin_enqueue_onboarding_call: admin, manager or va_manager role required'
      using errcode = '42501';
  end if;
  return public.fn_enqueue_onboarding_call_booking(p_agent_id, 'manual:' || auth.uid()::text);
end $$;
-- @@stmt
revoke all on function public.fn_enqueue_onboarding_call_booking(uuid, text) from public;
-- @@stmt
grant execute on function public.fn_enqueue_onboarding_call_booking(uuid, text) to service_role;
-- @@stmt
revoke all on function public.fn_agent_onboarding_call_booking(uuid) from public;
-- @@stmt
grant execute on function public.fn_agent_onboarding_call_booking(uuid) to service_role, authenticated;
-- @@stmt
grant execute on function public.admin_enqueue_onboarding_call(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Truth views. All scalar subqueries — one row in every state, never blank.
-- ---------------------------------------------------------------------------
-- @@stmt
create or replace view public.v_onboarding_call_truth as
select
  (select count(*) from public.agents a
    where a.license_status = 'licensed' and a.status = 'active'
      and coalesce(a.is_deactivated, false) = false and coalesce(a.is_inactive, false) = false)
    as licensed_active_agents,
  (select count(*) from public.agents a
    where a.license_status = 'licensed' and a.status = 'active'
      and coalesce(a.is_deactivated, false) = false and coalesce(a.is_inactive, false) = false
      and public.fn_agent_onboarding_call_booking(a.id) is null)
    as licensed_active_without_onboarding_call,
  (select count(*) from public.interview_events ie where ie.call_track = 'onboarding')
    as onboarding_calls_total,
  (select count(*) from public.interview_events ie
    where ie.call_track = 'onboarding' and ie.canceled_at is null and ie.scheduled_at > now())
    as onboarding_calls_future_open,
  (select count(*) from public.interview_events ie
    where ie.call_track = 'onboarding' and ie.canceled_at is null and ie.scheduled_at < now() and ie.outcome is null)
    as onboarding_calls_past_undispositioned,
  (select max(ie.created_at) from public.interview_events ie where ie.call_track = 'onboarding')
    as last_onboarding_capture_at,
  (select count(*) from public.agent_onboarding_queue q
    where q.email_kind = 'onboarding_call' and q.sent_at is null and q.attempt_count < 5)
    as booking_emails_queued,
  (select count(*) from public.agent_onboarding_queue q
    where q.email_kind = 'onboarding_call' and q.sent_at is not null)
    as booking_emails_sent,
  (select count(*) from public.agent_onboarding_queue q
    where q.email_kind = 'onboarding_call' and q.sent_at is null and q.attempt_count >= 5)
    as booking_emails_dead,
  (select count(*) from public.onboarding_call_invites i where i.status = 'queued') as invites_queued,
  (select count(*) from public.onboarding_call_invites i where i.status = 'sent')   as invites_sent,
  (select count(*) from public.onboarding_call_invites i where i.status = 'failed') as invites_failed,
  (select max(i.sent_at) from public.onboarding_call_invites i where i.status = 'sent') as last_invite_sent_at,
  (select value from public.system_settings where key = 'onboarding_call_invite_recipients') as invite_recipients,
  (select value from public.system_settings where key = 'onboarding_call_scheduling_url')    as scheduling_url;
-- @@stmt
comment on view public.v_onboarding_call_truth is
  'Lane 3 2026-08-26: onboarding-call system health. Scalar subqueries only — one row in every state. licensed_active_without_onboarding_call is the backfill COUNT (never auto-sent; use admin_enqueue_onboarding_call per person).';

-- Rows for the Interviews page "Onboarding" tab. security_invoker so the staff RLS
-- on interview_events / onboarding_call_invites decides who sees invitee contact data.
-- @@stmt
create or replace view public.v_onboarding_calls with (security_invoker = true) as
select
  ie.id, ie.source, ie.event_type_name,
  ie.invitee_name, ie.invitee_email, ie.invitee_phone,
  ie.scheduled_at, ie.ended_at, ie.canceled_at, ie.cancel_reason,
  ie.outcome, ie.outcome_at, ie.notes,
  ie.reschedule_url, ie.cancel_url, ie.was_rescheduled,
  ie.application_id, ie.agent_id, ie.created_at, ie.updated_at,
  a.display_name as agent_display_name,
  a.license_status::text as agent_license_status,
  case
    when ie.canceled_at is not null then 'canceled'
    when ie.outcome is not null    then 'completed'
    when ie.scheduled_at > now()   then 'upcoming'
    else 'overdue'
  end as bucket,
  coalesce((
    select jsonb_agg(jsonb_build_object(
             'recipient', i.recipient, 'kind', i.kind, 'status', i.status,
             'sent_at', i.sent_at, 'resend_message_id', i.resend_message_id,
             'last_error', i.last_error, 'attempt_count', i.attempt_count)
           order by i.created_at)
      from public.onboarding_call_invites i
     where i.booking_id = ie.id), '[]'::jsonb) as invites
from public.interview_events ie
left join public.agents a on a.id = ie.agent_id
where ie.call_track = 'onboarding';

-- Licensed, active agents with no onboarding call on the calendar, with the state
-- of their booking email. This is the backfill list — surfaced, not sent.
-- @@stmt
create or replace view public.v_onboarding_call_gaps as
select
  a.id as agent_id,
  a.display_name,
  a.licensed_at,
  a.created_at as agent_created_at,
  q.id as queue_id,
  q.sent_at as booking_email_sent_at,
  q.attempt_count as booking_email_attempts,
  q.last_error as booking_email_last_error,
  q.meta as booking_email_meta
from public.agents a
left join public.agent_onboarding_queue q on q.agent_id = a.id and q.email_kind = 'onboarding_call'
where a.license_status = 'licensed'
  and a.status = 'active'
  and coalesce(a.is_deactivated, false) = false
  and coalesce(a.is_inactive, false) = false
  and public.fn_agent_onboarding_call_booking(a.id) is null;
-- @@stmt
grant select on public.v_onboarding_call_truth to authenticated, service_role;
-- @@stmt
grant select on public.v_onboarding_calls to authenticated, service_role;
-- @@stmt
revoke all on public.v_onboarding_call_gaps from public, anon, authenticated;
-- @@stmt
grant select on public.v_onboarding_call_gaps to service_role;

-- ---------------------------------------------------------------------------
-- 5. Crons. Bearer pattern copied from jobs 53/76 (vault apex_bot_token) —
--    app.settings.service_role_key is NULL on this database (measured), so the
--    job-68 pattern sends an empty bearer and only works because that fn has no
--    auth check.
-- ---------------------------------------------------------------------------
-- @@stmt
select cron.unschedule('apex-onboarding-call-invites-5min')
 where exists (select 1 from cron.job where jobname = 'apex-onboarding-call-invites-5min');
-- @@stmt
select cron.schedule(
  'apex-onboarding-call-invites-5min',
  '*/5 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/onboarding-call-invites',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='apex_bot_token' LIMIT 1),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $cron$
);

-- The Calendly webhook is not delivering (87/88 rows in 30d arrived on the 6h
-- backfill tick). Until it is re-subscribed, reconcile the FUTURE window every 15
-- minutes: since = now-3h, calendly-backfill's own until = now+60d, idempotent
-- upsert on calendly_event_uri. ~20-40 Calendly calls per tick.
-- @@stmt
select cron.unschedule('apex-calendly-reconcile-15min')
 where exists (select 1 from cron.job where jobname = 'apex-calendly-reconcile-15min');
-- @@stmt
select cron.schedule(
  'apex-calendly-reconcile-15min',
  '3-59/15 * * * *',
  $cron$
  SELECT net.http_post(
    url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/calendly-backfill?since='
           || to_char((now() - interval '3 hours') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='apex_bot_token' LIMIT 1),
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 120000
  );
  $cron$
);

-- @@stmt
insert into supabase_migrations.schema_migrations (version, name)
values ('20260826052000', 'onboarding_calls_live')
on conflict (version) do nothing;
