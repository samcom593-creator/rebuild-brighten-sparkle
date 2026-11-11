-- MP-ONBOARD-ANCHOR-PKG1 (2026-11-12) 3/9: dispatcher truth (send gate, claim, retry drain).
--
-- WHAT
--   * fn_next_step_send_gate(message_id, email, reserve default false) -> jsonb verdict
--     {action send|skip|defer, reason, not_before, zone, copy, license_status, call_track,
--     cap}. Order:
--       everyone   open agent_access_suspensions or a live login ban (by address or the
--                  agent's login), email_unsubscribes, Resend suppression (30-day window,
--                  as suppression.ts)
--       applicant  applications.email_bounced_at, do_not_contact_at, is_duplicate,
--                  terminated/closed; and for applicant-LADDER stages (the stages an applicant
--                  derives into), already has an agent row (C8: applicant mail to hires).
--                  Another package's template stage (PKG3's exam push to course finishers,
--                  hired or not) is not refused for having an agent row.
--       cadence    a SWEEP step (metadata.cadence: only fn_next_step_nudge_sweep writes it)
--                  whose stage has moved on, or whose progress row is closed. Rows other
--                  senders queue through the dispatcher (PKG3's exam push and hired-unlicensed
--                  nudges, the reactivation runner) use template stage keys nobody sits in and
--                  carry no metadata.cadence, so they are never judged "stage_changed".
--       daily cap  at most ONE automated next-step email per recipient per local day
--                  (the day-0 welcome counts): DEFER to 08:00 next local day, never drop.
--                  With reserve => true (the live send path) the check runs under a
--                  per-recipient advisory lock and stamps metadata.cap on the row, so two rows
--                  for one address dispatched at the same moment cannot both pass. A
--                  reservation counts while the row is sent, or unfailed and under 30 minutes
--                  old. reserve => false (dry runs) is read-only.
--   * fn_next_step_claim(message_id) -> the row as jsonb when this caller may process it
--     (unsent, unfailed, parent row, inside its age limit, not before its not_before, not
--     claimed in the last 5 minutes), else null. Atomic, so the trigger and the drain can
--     never both send one row.
--   * fn_next_step_retry_drain(p_dry_run default TRUE, p_limit default 5): posts rows that
--     next-step-dispatch left retryable (transient 429/5xx/network, metadata.retry) or
--     deferred (daily cap) back to the dispatcher once metadata.not_before has passed.
--     Holds outside 08:00-21:00 recipient time by moving not_before to the next allowed
--     hour. A retryable or deferred row that passes its 72-hour age limit unsent can no
--     longer be claimed: the drain CLOSES it (failed_at, error 'expired: ...',
--     metadata.skip_reason 'expired') instead of leaving it unsent and unfailed forever.
--     Only rows created after fn_anchor_pkg1_cutoff(): forward-only.
--   * pg_cron 'next_step_retry_drain' every 5 minutes (p_dry_run => false).
--   * index on (lower(recipient), sent_at) for the daily-cap lookup, and one on the
--     reservation address.
-- WHY
--   message_map_and_copy.md 4c F1-F3 and F12, 4b C8; DECISIONS.md "Fake successes in the
--   dispatcher", "Banned people", "One drip" (one automated email per person per day).
--   4 rows died on Resend's 10/s rate limit on 2026-11-11 and could never be retried.
-- SECURITY
--   All three functions: SECURITY DEFINER, search_path pinned, EXECUTE revoked from
--   public/anon/authenticated, granted to service_role only (next-step-dispatch calls the
--   gate and the claim with the service key; pg_cron runs the drain as its owner).
-- ROLLBACK
--   select cron.unschedule('next_step_retry_drain');
--   drop function public.fn_next_step_retry_drain(boolean, integer);
--   drop function public.fn_next_step_claim(uuid);
--   drop function public.fn_next_step_send_gate(uuid, text, boolean);
--   drop index if exists public.nsm_email_recipient_sent_idx;
--   drop index if exists public.nsm_cap_reservation_idx;
--   (redeploy the previous next-step-dispatch first: the new one calls the gate and claim)

create index if not exists nsm_email_recipient_sent_idx
  on public.next_step_messages (lower(recipient), sent_at desc)
  where channel = 'email' and sent_at is not null;

create index if not exists nsm_cap_reservation_idx
  on public.next_step_messages ((metadata->'cap'->>'email'), (metadata->'cap'->>'day'))
  where fallback_of_id is null and failed_at is null and metadata ? 'cap';

-- an earlier draft of this package had a 2-argument gate; never two overloads
drop function if exists public.fn_next_step_send_gate(uuid, text);

create or replace function public.fn_next_step_send_gate(
  p_message_id uuid,
  p_email text default null,
  p_reserve boolean default false)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
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
$$;

comment on function public.fn_next_step_send_gate(uuid, text, boolean) is
  'MP-ONBOARD-ANCHOR-PKG1: one verdict per queued next_step_messages row before next-step-dispatch sends anything. skip = suspended (open suspension or login ban)/unsubscribed/suppressed/bounced/do_not_contact/duplicate/closed/has_agent_row (applicant-ladder stages only)/stage_changed (sweep rows only); defer = daily_cap (one automated email per recipient per local day). p_reserve => true (live sends only) takes a per-recipient advisory lock and stamps metadata.cap; false is read-only. Service role only.';

revoke all on function public.fn_next_step_send_gate(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.fn_next_step_send_gate(uuid, text, boolean) to service_role;

create or replace function public.fn_next_step_claim(p_message_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_row jsonb;
begin
  update public.next_step_messages m
     set metadata = coalesce(m.metadata, '{}'::jsonb) || jsonb_build_object('claimed_at', now())
   where m.id = p_message_id
     and m.sent_at is null
     and m.failed_at is null
     and m.fallback_of_id is null
     and (m.metadata->>'claimed_at' is null
          or (m.metadata->>'claimed_at')::timestamptz < now() - interval '5 minutes')
     and (m.created_at >= now() - interval '24 hours'
          or (m.metadata ? 'not_before' and m.created_at >= now() - interval '72 hours'))
     and (not (m.metadata ? 'not_before')
          or (m.metadata->>'not_before')::timestamptz <= now() + interval '1 minute')
  returning to_jsonb(m.*) into v_row;
  return v_row; -- null: not ours (sent, failed, claimed, not due yet, or too old)
end
$$;

comment on function public.fn_next_step_claim(uuid) is
  'MP-ONBOARD-ANCHOR-PKG1: atomic claim of one queued parent row for next-step-dispatch. Returns the row (jsonb) or null. A row with not_before older than 72h is never claimable; fn_next_step_retry_drain closes it as expired. Service role only.';

revoke all on function public.fn_next_step_claim(uuid) from public, anon, authenticated;
grant execute on function public.fn_next_step_claim(uuid) to service_role;

create or replace function public.fn_next_step_retry_drain(p_dry_run boolean default true, p_limit integer default 5)
returns table (message_id uuid, first_name text, stage_key text, due_reason text, action text)
language plpgsql
volatile
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  r        record;
  v_url    text;
  v_anon   text;
  v_cutoff timestamptz := public.fn_anchor_pkg1_cutoff();
  v_t      timestamptz;
  i        integer;
begin
  select s.value into v_url from public.system_settings s where s.key = 'supabase_url' limit 1;
  select s.value into v_anon from public.system_settings s where s.key = 'supabase_anon_key' limit 1;

  -- 1. close what can no longer be sent. fn_next_step_claim refuses a deferred or retryable
  --    row once it is 72 hours old, so without this it would stay unsent and unfailed for
  --    good and read as "due" forever. A late reminder is worse than none; the reason is
  --    recorded on the row, never a fake "sent".
  for r in
    select m.id, m.stage_key as stage, m.metadata as meta,
           coalesce(nullif(btrim(ap.first_name), ''), nullif(split_part(coalesce(g.display_name, ''), ' ', 1), '')) as fname
      from public.next_step_messages m
      left join public.applications ap on ap.id = m.application_id
      left join public.agents g on g.id = m.agent_id
     where m.fallback_of_id is null
       and m.sent_at is null
       and m.failed_at is null
       and m.metadata ? 'not_before'
       and m.created_at >= v_cutoff
       and m.created_at < now() - interval '72 hours'
       and (m.metadata->>'claimed_at' is null
            or (m.metadata->>'claimed_at')::timestamptz < now() - interval '5 minutes')
     order by m.created_at
     limit 50
  loop
    message_id := r.id;
    first_name := r.fname;
    stage_key  := r.stage;
    due_reason := coalesce(r.meta->'deferred'->>'reason', case when r.meta ? 'retry' then 'retry' end, 'due');
    if coalesce(p_dry_run, true) then
      action := 'would_expire';
    else
      update public.next_step_messages n
         set failed_at = now(),
             error = 'expired: not sent within 72 hours (' || due_reason || ')',
             metadata = coalesce(n.metadata, '{}'::jsonb) - 'claimed_at'
                        || jsonb_build_object('skip_reason', 'expired', 'expired_at', now())
       where n.id = r.id and n.sent_at is null and n.failed_at is null;
      action := 'expired';
    end if;
    return next;
  end loop;

  -- 2. re-post what is due
  for r in
    select m.id, m.stage_key as stage, m.metadata as meta,
           coalesce(nullif(btrim(ap.first_name), ''), nullif(split_part(coalesce(g.display_name, ''), ' ', 1), '')) as fname,
           public.fn_next_step_send_zones(m.application_id, m.agent_id) as zones
      from public.next_step_messages m
      left join public.applications ap on ap.id = m.application_id
      left join public.agents g on g.id = m.agent_id
     where m.fallback_of_id is null
       and m.sent_at is null
       and m.failed_at is null
       and m.metadata ? 'not_before'
       and m.created_at >= greatest(v_cutoff, now() - interval '72 hours')
       and (m.metadata->>'not_before')::timestamptz <= now()
       and (m.metadata->>'claimed_at' is null
            or (m.metadata->>'claimed_at')::timestamptz < now() - interval '5 minutes')
     order by (m.metadata->>'not_before')::timestamptz, m.created_at
     limit greatest(1, least(coalesce(p_limit, 5), 25))
  loop
    message_id := r.id;
    first_name := r.fname;
    stage_key  := r.stage;
    due_reason := coalesce(r.meta->'deferred'->>'reason', case when r.meta ? 'retry' then 'retry' end, 'due');
    if not public.fn_next_step_send_ok(r.zones, now()) then
      -- quiet hours (08:00-21:00 recipient time): move not_before to the next allowed hour
      v_t := date_trunc('hour', now()) + interval '1 hour';
      i := 0;
      while i < 36 and not public.fn_next_step_send_ok(r.zones, v_t) loop
        v_t := v_t + interval '1 hour';
        i := i + 1;
      end loop;
      if not coalesce(p_dry_run, true) then
        update public.next_step_messages n
           set metadata = coalesce(n.metadata, '{}'::jsonb) || jsonb_build_object('not_before', v_t)
         where n.id = r.id;
      end if;
      action := 'held_quiet_hours';
      return next;
      continue;
    end if;
    if coalesce(p_dry_run, true) then
      action := 'would_dispatch';
      return next;
      continue;
    end if;
    if v_url is null or v_anon is null then
      action := 'no_endpoint';
      return next;
      continue;
    end if;
    perform net.http_post(
      url := rtrim(v_url, '/') || '/functions/v1/next-step-dispatch',
      headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_anon),
      body := jsonb_build_object('message_id', r.id::text),
      timeout_milliseconds := 10000);
    action := 'dispatched';
    return next;
  end loop;
end
$$;

comment on function public.fn_next_step_retry_drain(boolean, integer) is
  'MP-ONBOARD-ANCHOR-PKG1: re-posts retryable/deferred next_step_messages (metadata.not_before passed) to next-step-dispatch, and closes those past the 72h age limit as expired (failed_at + skip_reason). Dry run by default; pg_cron next_step_retry_drain passes p_dry_run => false. Forward-only: rows created after fn_anchor_pkg1_cutoff().';

revoke all on function public.fn_next_step_retry_drain(boolean, integer) from public, anon, authenticated;
grant execute on function public.fn_next_step_retry_drain(boolean, integer) to service_role;

-- every 5 minutes; cron.schedule upserts by job name (pg_cron 1.6), so re-running is safe.
-- Wrapped in DO so the migration returns no result set (bot-sql applies multi-statement text).
do $mig$
begin
  perform cron.schedule(
    'next_step_retry_drain',
    '*/5 * * * *',
    $cron$ select public.fn_next_step_retry_drain(p_dry_run => false, p_limit => 5); $cron$
  );
end
$mig$;
