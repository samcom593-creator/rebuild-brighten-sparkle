-- 20261112104317_reactivation_v2.sql
-- MP-BOB-CONVERSION v2: reactivation engine for STALE pre-cutoff applicants (BoB chat, session 3c262e62).
-- Migration range 202611121xxxxx is BoB's (ANCHOR keeps 202611120xxxxx). Hand-applied with bot-sql and
-- recorded in supabase_migrations.schema_migrations; every statement is safe to run twice (R-M3).
--
-- SHAPE
--   pg_cron 'reactivation-send-tick' (*/5) -> fn_reactivation_dispatch(): holds stale claims, claims ONE due
--   person (cap, window, bounce, complaint and per-person gates), and net.http_posts {application_id, stage_key}
--   to the reactivation-send edge function in the SAME transaction as the claim (R-M7).
--   reactivation-send renders the copy stored in next_step_stages, sends via gateResend, and writes a
--   next_step_messages receipt for EVERY outcome (sent_at or failed_at set, so the dispatcher's own trigger
--   never fires on it). trg_reactivation_on_receipt advances or stops the sequence from that receipt, so a
--   person is never left claimed; it is exception-guarded so it can never roll back a receipt.
--
-- WHY NOT next-step-dispatch: its ladder is chosen from the PERSON (a linked Telegram chat ends the ladder and
--   skips email; a carrier-gateway SMS counts as sent even when the email fails). v1 sent 101 parents and 9
--   people got no email while all 9 read as touched. This engine is email-only by construction.
-- WHY 7-DAY SPACING: 6e's fn_recruit_campaign_touch_ok forbids two campaign emails to one address inside 7 days.
-- WHY NO AUTO RE-CLAIM: resend@2.0.0 cannot send an idempotency key; a claim left set after a crash between the
--   provider and the receipt is HELD for review, never re-sent (a re-claim could mail someone twice).
-- SHIPS PAUSED: system_settings.reactivation_daily_cap = '0'. Raising it is cleared with ANCHOR first.

begin;

-- 1. Sequence state -------------------------------------------------------------------------------------
create table if not exists public.reactivation_sequence (
  application_id   uuid primary key references public.applications(id) on delete cascade,
  email_lower      text not null,
  track            text not null check (track in ('T_COLD','T_IN_COURSE','T_COURSE_DONE','T_PENDING','T_LICENSED')),
  variant          text not null check (variant in ('A','B')),
  current_touch    smallint not null default 0 check (current_touch between 0 and 3),
  next_due_at      timestamptz,
  status           text not null default 'active' check (status in ('active','stopped','completed','held')),
  stop_reason      text,
  enrolled_from    text not null check (enrolled_from in ('cohort','v1_carryover')),
  enrolled_at      timestamptz not null default now(),
  claimed_at       timestamptz,
  claim_request_id bigint,
  last_touch_at    timestamptz,
  last_resend_id   text,
  last_message_id  uuid,
  attempts_failed  smallint not null default 0,
  last_error       text,
  updated_at       timestamptz not null default now()
);
-- R-M5: a SQL body may not SET a *_sent_at column without dispatching. The first apply named it last_sent_at.
do $rename$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'public'
               and table_name = 'reactivation_sequence' and column_name = 'last_sent_at') then
    alter table public.reactivation_sequence rename column last_sent_at to last_touch_at;
  end if;
end $rename$;
alter table public.reactivation_sequence add column if not exists claim_request_id bigint;
create unique index if not exists reactivation_sequence_email_uniq on public.reactivation_sequence (email_lower);
create index if not exists reactivation_sequence_due_idx on public.reactivation_sequence (next_due_at) where status = 'active';
alter table public.reactivation_sequence enable row level security;
revoke all on public.reactivation_sequence from public, anon, authenticated;
grant all on public.reactivation_sequence to service_role;

-- 2. Reply ledger (the local Neo reply poller writes it; one row per inbound thread) --------------------
create table if not exists public.reactivation_replies (
  thread_id       text primary key,
  email_lower     text not null,
  application_id  uuid references public.applications(id) on delete set null,
  received_at     timestamptz,
  classification  text not null check (classification in ('stop','not_interested','interested','question','auto_reply','unknown')),
  subject         text,
  notified_at     timestamptz,
  created_at      timestamptz not null default now()
);
create index if not exists reactivation_replies_email_idx on public.reactivation_replies (email_lower);
alter table public.reactivation_replies enable row level security;
revoke all on public.reactivation_replies from public, anon, authenticated;
grant all on public.reactivation_replies to service_role;

-- 3. Typo / dead domains: an applicant who typed gmail.con cannot be reached and must not be mailed ---
create table if not exists public.reactivation_bad_domains (
  domain     text primary key,
  reason     text not null,
  created_at timestamptz not null default now()
);
alter table public.reactivation_bad_domains enable row level security;
revoke all on public.reactivation_bad_domains from public, anon, authenticated;
grant all on public.reactivation_bad_domains to service_role;
insert into public.reactivation_bad_domains (domain, reason) values
  ('agmail.com', 'typo of gmail.com; null MX (placement audit 2026-11-11)'),
  ('gmail.clm', 'typo of gmail.com; no MX or A record'),
  ('gmail.con', 'typo of gmail.com; no MX or A record'),
  ('gnail.con', 'typo of gmail.com; no MX or A record'),
  ('gamil.com', 'typo of gmail.com'),
  ('lenskartomni.com', 'no mail host found'),
  ('gmial.com', 'typo of gmail.com'),
  ('gmaill.com', 'typo of gmail.com'),
  ('gmai.com', 'typo of gmail.com'),
  ('gmal.com', 'typo of gmail.com'),
  ('gmail.co', 'typo of gmail.com'),
  ('gmail.cm', 'typo of gmail.com'),
  ('hotmial.com', 'typo of hotmail.com'),
  ('yahooo.com', 'typo of yahoo.com'),
  ('yaho.com', 'typo of yahoo.com'),
  ('iclould.com', 'typo of icloud.com')
on conflict (domain) do nothing;

-- 4. The first apply recorded sends in SQL (fn_reactivation_record); receipts now come from the edge
--    function and the trigger below, so the SQL recorder is gone.
drop function if exists public.fn_reactivation_record(uuid, smallint, boolean, text, text, boolean, text, text);

-- 5. Track / variant / window ---------------------------------------------------------------------------
create or replace function public.fn_reactivation_track(p_application_id uuid)
returns text language sql stable security definer set search_path = public as $$
  select case
    when a.license_status::text = 'licensed' then 'T_LICENSED'
    when a.license_status::text = 'pending'  then 'T_PENDING'
    when a.exam_passed_at is not null
      or p.current_stage_key in ('finished_prelicense','exam_scheduled','passed_exam') then 'T_COURSE_DONE'
    when a.course_started_at is not null or a.course_purchased_at is not null
      or p.current_stage_key = 'started_prelicense' then 'T_IN_COURSE'
    else 'T_COLD' end
  from public.applications a
  left join public.next_step_progress p on p.application_id = a.id
  where a.id = p_application_id
$$;

create or replace function public.fn_reactivation_variant(p_application_id uuid)
returns text language sql immutable as $$
  select case when get_byte(decode(md5(p_application_id::text), 'hex'), 0) % 2 = 0 then 'A' else 'B' end
$$;

-- 09:00-16:59 local in EVERY zone the recipient's state spans (FL, ID span two); unknown state -> Central
create or replace function public.fn_reactivation_in_window(p_state text, p_now timestamptz default now())
returns boolean language sql stable set search_path = public as $$
  select coalesce(bool_and(extract(hour from (p_now at time zone z))::int between 9 and 16), false)
  from unnest(coalesce(nullif(public.fn_us_state_send_zones(p_state), '{}'::text[]),
                       array['America/Chicago'])) as z
$$;

-- 6. Gate: NULL = may send now; 'hold:<why>' = retry later; '<why>' = stop permanently ------------------
create or replace function public.fn_reactivation_gate(p_application_id uuid, p_since timestamptz default null)
returns text language plpgsql stable security definer set search_path = public as $$
declare
  a record; v_email text; v_cut timestamptz := public.fn_lane_ladder_cutoff(); v_ok boolean; v_owned boolean;
begin
  select id, email, email_consent_given, do_not_contact_at, created_at, email_bounced_at
    into a from public.applications where id = p_application_id;
  if not found then return 'no_application'; end if;
  v_email := lower(btrim(coalesce(a.email, '')));
  if v_email = '' or position('@' in v_email) = 0 then return 'no_email'; end if;
  if exists (select 1 from public.reactivation_bad_domains d where d.domain = split_part(v_email, '@', 2)) then
    return 'bad_domain';
  end if;
  if a.email_consent_given is not true then return 'no_email_consent'; end if;
  if a.do_not_contact_at is not null then return 'do_not_contact'; end if;
  if a.created_at >= v_cut then return 'owned_live_ladder'; end if;
  if exists (select 1 from public.applications a2 where lower(btrim(a2.email)) = v_email and a2.created_at >= v_cut) then
    return 'owned_live_ladder';
  end if;
  if a.email_bounced_at is not null then return 'bounced'; end if;
  if exists (select 1 from public.email_unsubscribes u where lower(u.email) = v_email) then return 'unsubscribed'; end if;
  if exists (select 1 from public.email_suppressions s where s.email = v_email
               and s.last_seen_at >= now() - interval '30 days') then return 'suppressed'; end if;
  if exists (select 1 from public.agents g join public.profiles pr on pr.user_id = g.user_id
               where lower(pr.email) = v_email) then return 'is_agent'; end if;
  if exists (select 1 from public.next_step_progress p where p.application_id = a.id and p.status = 'completed') then
    return 'completed_pipeline';
  end if;
  if exists (select 1 from public.interview_events ie where ie.application_id = a.id
               and ie.canceled_at is null and ie.scheduled_at > now()) then return 'booked_upcoming'; end if;
  if p_since is not null and exists (select 1 from public.interview_events ie where ie.application_id = a.id
               and ie.canceled_at is null and ie.created_at >= p_since) then return 'booked'; end if;
  if exists (select 1 from public.reactivation_replies r where r.email_lower = v_email) then return 'replied'; end if;
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

-- 7. Claim ONE send (cap, bounce and complaint guards; never re-claims a set claim) -------------------
create or replace function public.fn_reactivation_claim_next()
returns table (application_id uuid, touch smallint, track text, variant text, email text,
               first_name text, last_name text, reason text)
language plpgsql volatile security definer set search_path = public as $$
declare
  v_cap int; v_sent_today int; v_n int; v_bounced int; v_complained int;
  r record; v_gate text; v_track text; v_variant text;
begin
  select coalesce(nullif(btrim(value), '')::int, 0) into v_cap from public.system_settings where key = 'reactivation_daily_cap';
  v_cap := coalesce(v_cap, 0);
  if v_cap <= 0 then
    return query select null::uuid, null::smallint, null::text, null::text, null::text, null::text, null::text, 'paused_cap_0'::text; return;
  end if;
  select count(*) into v_sent_today from public.next_step_messages m
   where m.stage_key like 'reactivation\_v2\_%' escape '\' and m.fallback_of_id is null and m.sent_at is not null
     and (m.sent_at at time zone 'America/Phoenix')::date = (now() at time zone 'America/Phoenix')::date;
  if v_sent_today >= v_cap then
    return query select null::uuid, null::smallint, null::text, null::text, null::text, null::text, null::text, 'daily_cap_reached'::text; return;
  end if;
  select count(*), count(*) filter (where e.last_event = 'bounced'), count(*) filter (where e.last_event = 'complained')
    into v_n, v_bounced, v_complained
    from public.next_step_messages m join public.email_events e on e.resend_id = m.external_id
   where m.stage_key like 'reactivation\_v2\_%' escape '\' and m.sent_at >= now() - interval '14 days';
  if v_complained > 0 then
    return query select null::uuid, null::smallint, null::text, null::text, null::text, null::text, null::text, 'paused_complaint'::text; return;
  end if;
  if v_n >= 25 and v_bounced::numeric / v_n >= 0.08 then
    return query select null::uuid, null::smallint, null::text, null::text, null::text, null::text, null::text, 'paused_bounce_8pct'::text; return;
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
      update public.reactivation_sequence set claimed_at = now(), updated_at = now()
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

  -- (b) nothing due: enrol the warmest unenrolled cohort member
  for r in
    select c.application_id, c.email, c.first_name, c.last_name, c.state
      from public.v_reactivation_cohort c
     where not exists (select 1 from public.reactivation_sequence s
                        where s.application_id = c.application_id or s.email_lower = lower(btrim(c.email)))
     order by c.send_rank
     limit 40
  loop
    if not public.fn_reactivation_in_window(r.state) then continue; end if;
    v_gate := public.fn_reactivation_gate(r.application_id, null);
    v_track := public.fn_reactivation_track(r.application_id);
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

-- 8. A claim with no receipt after 20 minutes is ambiguous (did the provider send before the crash?): HOLD it.
create or replace function public.fn_reactivation_hold_stale_claims()
returns int language plpgsql volatile security definer set search_path = public as $$
declare v_n int;
begin
  update public.reactivation_sequence
     set status = 'held', stop_reason = 'claim_stale_unverified', updated_at = now()
   where status = 'active' and claimed_at is not null and claimed_at < now() - interval '20 minutes';
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- 9. The cron driver: one claim, one POST, same transaction; launches nothing when nothing is due (R-M15) --
create or replace function public.fn_reactivation_dispatch()
returns text language plpgsql volatile security definer set search_path = public as $$
declare c record; v_key text; v_stage text; v_req bigint;
begin
  perform public.fn_reactivation_hold_stale_claims();
  select * into c from public.fn_reactivation_claim_next() limit 1;
  if c.application_id is null then return coalesce(c.reason, 'nothing_due'); end if;
  select decrypted_secret into v_key from vault.decrypted_secrets where name = 'reactivation_send_key';
  if v_key is null or btrim(v_key) = '' then
    update public.reactivation_sequence set claimed_at = null, last_error = 'no_send_key', updated_at = now()
     where reactivation_sequence.application_id = c.application_id;
    return 'no_send_key';
  end if;
  v_stage := 'reactivation_v2_' || lower(substr(c.track, 3)) || '_t' || c.touch || '_' || lower(c.variant);
  v_req := net.http_post(
    url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/reactivation-send',
    body := jsonb_build_object('application_id', c.application_id, 'stage_key', v_stage),
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-reactivation-key', v_key),
    timeout_milliseconds := 30000);
  update public.reactivation_sequence set claim_request_id = v_req where reactivation_sequence.application_id = c.application_id;
  return 'dispatched ' || v_stage;
end $$;

-- 10. Receipt -> sequence. Exception-guarded: a sequence error must never roll back the receipt ---------
create or replace function public.fn_reactivation_on_receipt()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_touch int; v_retry boolean; v_reason text;
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
      v_reason := regexp_replace(left(coalesce(new.error, 'send_refused'), 80), '^skipped:\s*', '');
      if v_retry then
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

drop trigger if exists trg_reactivation_on_receipt on public.next_step_messages;
create trigger trg_reactivation_on_receipt
  after insert on public.next_step_messages
  for each row when (new.stage_key like 'reactivation\_v2\_%' and (new.sent_at is not null or new.failed_at is not null))
  execute function public.fn_reactivation_on_receipt();

-- 11. Stop on reply (the reply poller); a STOP reply also unsubscribes from ALL mail --------------------
create or replace function public.fn_reactivation_stop(p_email text, p_reason text, p_unsubscribe boolean default false)
returns int language plpgsql volatile security definer set search_path = public as $$
declare v_n int := 0; v_email text := lower(btrim(coalesce(p_email, '')));
begin
  if v_email = '' then return 0; end if;
  update public.reactivation_sequence set status = 'stopped', stop_reason = p_reason, claimed_at = null, updated_at = now()
   where email_lower = v_email and status in ('active','held');
  get diagnostics v_n = row_count;
  if p_unsubscribe then
    insert into public.email_unsubscribes (email, reason, source, unsubscribed_at)
    values (v_email, 'reply_stop', 'reply-stop', now())
    on conflict (email) do nothing;
  end if;
  return v_n;
end $$;

-- 12. One-time carryover of the 101 v1 parents (no-op once rows exist) ----------------------------------
insert into public.reactivation_sequence (application_id, email_lower, track, variant, current_touch, next_due_at,
                                          status, stop_reason, enrolled_from, last_touch_at)
select distinct on (lower(btrim(a.email)))
       m.application_id, lower(btrim(a.email)),
       public.fn_reactivation_track(m.application_id), public.fn_reactivation_variant(m.application_id),
       case when m.metadata->>'email_rung' = 'sent'
             and public.fn_reactivation_track(m.application_id) not in ('T_LICENSED','T_PENDING') then 1 else 0 end,
       case when m.metadata->>'email_rung' = 'sent' then m.sent_at + interval '7 days 2 hours' else now() end,
       case when g.gate is null or g.gate like 'hold:%' then 'active' else 'stopped' end,
       case when g.gate is null or g.gate like 'hold:%' then null else g.gate end,
       'v1_carryover',
       case when m.metadata->>'email_rung' = 'sent' then m.sent_at end
  from public.next_step_messages m
  join public.applications a on a.id = m.application_id
  cross join lateral (select public.fn_reactivation_gate(m.application_id, null) as gate) g
 where m.stage_key = 'reactivation_2026_11' and m.fallback_of_id is null
   and a.email is not null and btrim(a.email) <> ''
 order by lower(btrim(a.email)), (m.metadata->>'email_rung' = 'sent') desc, m.created_at
on conflict do nothing;

-- 13. Views (invoker, service_role only) ---------------------------------------------------------------
create or replace view public.v_reactivation_health with (security_invoker = true) as
select
  (select coalesce(nullif(btrim(value),'')::int, 0) from public.system_settings where key = 'reactivation_daily_cap') as daily_cap,
  (select count(*) from public.reactivation_sequence) as enrolled,
  (select count(*) from public.reactivation_sequence where status = 'active') as active,
  (select count(*) from public.reactivation_sequence where status = 'active' and next_due_at <= now()) as due_now,
  (select count(*) from public.reactivation_sequence where status = 'stopped') as stopped,
  (select count(*) from public.reactivation_sequence where status = 'completed') as completed,
  (select count(*) from public.reactivation_sequence where status = 'held') as held,
  (select count(*) from public.v_reactivation_cohort c where not exists (select 1 from public.reactivation_sequence s
      where s.application_id = c.application_id or s.email_lower = lower(btrim(c.email)))) as not_yet_enrolled,
  (select count(*) from public.next_step_messages where stage_key like 'reactivation\_v2\_%' escape '\' and fallback_of_id is null
      and sent_at is not null and (sent_at at time zone 'America/Phoenix')::date = (now() at time zone 'America/Phoenix')::date) as sent_today,
  (select max(sent_at) from public.next_step_messages where stage_key like 'reactivation\_v2\_%' escape '\') as last_send_at,
  (select count(*) from public.next_step_messages m join public.email_events e on e.resend_id = m.external_id
      where m.stage_key like 'reactivation\_v2\_%' escape '\' and m.sent_at >= now() - interval '14 days') as events_14d,
  (select count(*) from public.next_step_messages m join public.email_events e on e.resend_id = m.external_id
      where m.stage_key like 'reactivation\_v2\_%' escape '\' and m.sent_at >= now() - interval '14 days' and e.last_event = 'bounced') as bounced_14d,
  (select count(*) from public.next_step_messages m join public.email_events e on e.resend_id = m.external_id
      where m.stage_key like 'reactivation\_v2\_%' escape '\' and m.sent_at >= now() - interval '14 days' and e.last_event = 'complained') as complained_14d,
  (select count(*) from public.reactivation_sequence where status = 'active' and claimed_at < now() - interval '15 minutes') as stale_claims,
  (select count(*) from public.reactivation_sequence where status = 'active' and last_error is not null) as retrying,
  (select count(*) from public.reactivation_replies) as replies_total,
  (select max(created_at) from public.reactivation_replies) as last_reply_at,
  (select count(*) from public.next_step_messages m where m.stage_key like 'reactivation\_v2\_%' escape '\'
      and m.sent_at is not null and (m.external_id is null or btrim(m.external_id) = '')) as sent_without_provider_id,
  (select count(*) from public.next_step_messages m join public.email_unsubscribes u on lower(u.email) = lower(btrim(m.recipient))
      where m.stage_key like 'reactivation\_v2\_%' escape '\' and m.sent_at is not null and u.unsubscribed_at < m.sent_at) as sent_after_unsubscribe,
  (select count(*) from public.next_step_messages m join public.applications a on a.id = m.application_id
      where m.stage_key like 'reactivation\_v2\_%' escape '\' and m.sent_at is not null and a.email_consent_given is not true) as sent_without_email_consent,
  (select count(*) from public.next_step_stages st where st.stage_key like 'reactivation\_v2\_%' escape '\') as stage_rows_loaded,
  (select count(*) from cron.job where jobname = 'reactivation-send-tick' and active) as cron_tick_active;

create or replace view public.v_reactivation_funnel with (security_invoker = true) as
with sends as (
  select m.application_id, (m.metadata->>'track') as track, (m.metadata->>'touch')::int as touch,
         (m.metadata->>'variant') as variant, m.sent_at, e.last_event
    from public.next_step_messages m
    left join public.email_events e on e.resend_id = m.external_id
   where m.stage_key like 'reactivation\_v2\_%' escape '\' and m.fallback_of_id is null and m.sent_at is not null
)
select track, touch, variant,
       count(*)                                                               as sent,
       count(*) filter (where last_event in ('delivered','opened','clicked'))  as delivered,
       count(*) filter (where last_event = 'clicked')                         as clicked,
       count(*) filter (where last_event = 'bounced')                         as bounced,
       count(*) filter (where last_event = 'complained')                      as complained,
       count(*) filter (where last_event is null)                             as no_provider_event_yet
  from sends group by 1, 2, 3;

create or replace view public.v_reactivation_outcomes with (security_invoker = true) as
select s.track, s.variant,
       count(*)                                                         as enrolled,
       count(*) filter (where s.last_touch_at is not null)              as emailed,
       count(*) filter (where s.stop_reason = 'replied' or exists (select 1 from public.reactivation_replies r where r.email_lower = s.email_lower)) as replied,
       count(*) filter (where exists (select 1 from public.interview_events ie
                          where ie.application_id = s.application_id and ie.canceled_at is null
                            and ie.created_at >= coalesce((select min(m.sent_at) from public.next_step_messages m
                                                            where m.application_id = s.application_id
                                                              and (m.stage_key like 'reactivation\_v2\_%' escape '\' or m.stage_key = 'reactivation_2026_11')
                                                              and m.sent_at is not null), s.enrolled_at))) as booked_after_send,
       count(*) filter (where s.stop_reason = 'unsubscribed' or exists (select 1 from public.email_unsubscribes u where lower(u.email) = s.email_lower)) as unsubscribed,
       count(*) filter (where s.status = 'completed')                   as completed_3_touches,
       count(*) filter (where s.status = 'stopped')                     as stopped,
       count(*) filter (where s.status = 'active')                      as active
  from public.reactivation_sequence s
 group by 1, 2;

-- 14. Settings: ships PAUSED (raw text, never JSON-quoted: R-M12) ---------------------------------------
insert into public.system_settings (key, value) values ('reactivation_daily_cap', '0') on conflict (key) do nothing;

-- 15. Copy: 30 rows = 5 tracks x 3 touches x 2 subject variants (verified deck, single-quoted per R-M4) --
insert into public.next_step_stages (stage_key, order_index, display_name, audience, owner_role,
  next_action_label, next_action_url, reminder_cadence, stall_action, dashboard_section, color_hex, icon_name,
  candidate_message_template, manager_alert_template, telegram_template, sms_template,
  email_subject_template, email_body_template, is_terminal, success_event, failure_label, notes, retired_at)
values ('reactivation_v2_cold_t1_a', 100, 'Reactivation v2: cold touch 1 (A)', 'applicant', 'system',
  'Reply or book a call', null, 'manual', 'flag', 'campaign', '#eab308', 'arrow-path',
  'Hey {{first_name}},

It''s Sam James from Galaxy Financial (formerly Apex Financial). You applied with us, and your application is still open.

Do you still want to get your life insurance license? Just reply yes or no.

If you''re not sure what it takes, grab 10 minutes on the phone before you decide. Ask anything about the course, the exam, or how long it takes. Pick a time here: {{booking_url}}
We call the number you put in.

Sam

You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? Unsubscribe: {{unsubscribe_url}}
Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801', '', '', '',
  '{{first_name}}, still want to get licensed?', '<p>Hey {{first_name}},</p>
<p>It''s Sam James from Galaxy Financial (formerly Apex Financial). You applied with us, and your application is still open.</p>
<p>Do you still want to get your life insurance license? Just reply yes or no.</p>
<p>If you''re not sure what it takes, grab 10 minutes on the phone before you decide. Ask anything about the course, the exam, or how long it takes. <a href="{{booking_url}}">Pick a time here</a>. We call the number you put in.</p>
<p>Sam</p>
<p style="font-size:12px;color:#888888">You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? <a href="{{unsubscribe_url}}">Unsubscribe here</a>.<br>Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801</p>', false, '', '',
  'BoB reactivation v2 copy (MP-BOB-CONVERSION). Sent ONLY by reactivation-send; candidate_message_template holds the plain-text body. reminder_cadence=manual and no next_step_progress row ever points here, so no sweep can fire it. retired_at hides it from the recruiting worklist; reactivation-send reads it by stage_key regardless.',
  now())
on conflict (stage_key) do update set
  email_subject_template = excluded.email_subject_template,
  email_body_template = excluded.email_body_template,
  candidate_message_template = excluded.candidate_message_template,
  display_name = excluded.display_name,
  notes = excluded.notes,
  retired_at = coalesce(public.next_step_stages.retired_at, excluded.retired_at);

insert into public.next_step_stages (stage_key, order_index, display_name, audience, owner_role,
  next_action_label, next_action_url, reminder_cadence, stall_action, dashboard_section, color_hex, icon_name,
  candidate_message_template, manager_alert_template, telegram_template, sms_template,
  email_subject_template, email_body_template, is_terminal, success_event, failure_label, notes, retired_at)
values ('reactivation_v2_cold_t1_b', 101, 'Reactivation v2: cold touch 1 (B)', 'applicant', 'system',
  'Reply or book a call', null, 'manual', 'flag', 'campaign', '#eab308', 'arrow-path',
  'Hey {{first_name}},

It''s Sam James from Galaxy Financial (formerly Apex Financial). You applied with us, and your application is still open.

Do you still want to get your life insurance license? Just reply yes or no.

If you''re not sure what it takes, grab 10 minutes on the phone before you decide. Ask anything about the course, the exam, or how long it takes. Pick a time here: {{booking_url}}
We call the number you put in.

Sam

You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? Unsubscribe: {{unsubscribe_url}}
Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801', '', '', '',
  'Questions about getting licensed?', '<p>Hey {{first_name}},</p>
<p>It''s Sam James from Galaxy Financial (formerly Apex Financial). You applied with us, and your application is still open.</p>
<p>Do you still want to get your life insurance license? Just reply yes or no.</p>
<p>If you''re not sure what it takes, grab 10 minutes on the phone before you decide. Ask anything about the course, the exam, or how long it takes. <a href="{{booking_url}}">Pick a time here</a>. We call the number you put in.</p>
<p>Sam</p>
<p style="font-size:12px;color:#888888">You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? <a href="{{unsubscribe_url}}">Unsubscribe here</a>.<br>Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801</p>', false, '', '',
  'BoB reactivation v2 copy (MP-BOB-CONVERSION). Sent ONLY by reactivation-send; candidate_message_template holds the plain-text body. reminder_cadence=manual and no next_step_progress row ever points here, so no sweep can fire it. retired_at hides it from the recruiting worklist; reactivation-send reads it by stage_key regardless.',
  now())
on conflict (stage_key) do update set
  email_subject_template = excluded.email_subject_template,
  email_body_template = excluded.email_body_template,
  candidate_message_template = excluded.candidate_message_template,
  display_name = excluded.display_name,
  notes = excluded.notes,
  retired_at = coalesce(public.next_step_stages.retired_at, excluded.retired_at);

insert into public.next_step_stages (stage_key, order_index, display_name, audience, owner_role,
  next_action_label, next_action_url, reminder_cadence, stall_action, dashboard_section, color_hex, icon_name,
  candidate_message_template, manager_alert_template, telegram_template, sms_template,
  email_subject_template, email_body_template, is_terminal, success_event, failure_label, notes, retired_at)
values ('reactivation_v2_cold_t2_a', 102, 'Reactivation v2: cold touch 2 (A)', 'applicant', 'system',
  'Reply or book a call', null, 'manual', 'flag', 'campaign', '#eab308', 'arrow-path',
  'Hey {{first_name}},

It''s Sam again from Galaxy Financial (formerly Apex Financial). What got in the way, the cost or the time? Just reply with one word.

If it''s the cost, ask about it before you spend anything. That''s what the 10 minute call is for, and we call you. Book it here: {{booking_url}}

Sam

You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? Unsubscribe: {{unsubscribe_url}}
Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801', '', '', '',
  '{{first_name}}, what got in the way?', '<p>Hey {{first_name}},</p>
<p>It''s Sam again from Galaxy Financial (formerly Apex Financial). What got in the way, the cost or the time? Just reply with one word.</p>
<p>If it''s the cost, ask about it before you spend anything. That''s what the 10 minute call is for, and we call you. <a href="{{booking_url}}">Book it here</a>.</p>
<p>Sam</p>
<p style="font-size:12px;color:#888888">You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? <a href="{{unsubscribe_url}}">Unsubscribe here</a>.<br>Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801</p>', false, '', '',
  'BoB reactivation v2 copy (MP-BOB-CONVERSION). Sent ONLY by reactivation-send; candidate_message_template holds the plain-text body. reminder_cadence=manual and no next_step_progress row ever points here, so no sweep can fire it. retired_at hides it from the recruiting worklist; reactivation-send reads it by stage_key regardless.',
  now())
on conflict (stage_key) do update set
  email_subject_template = excluded.email_subject_template,
  email_body_template = excluded.email_body_template,
  candidate_message_template = excluded.candidate_message_template,
  display_name = excluded.display_name,
  notes = excluded.notes,
  retired_at = coalesce(public.next_step_stages.retired_at, excluded.retired_at);

insert into public.next_step_stages (stage_key, order_index, display_name, audience, owner_role,
  next_action_label, next_action_url, reminder_cadence, stall_action, dashboard_section, color_hex, icon_name,
  candidate_message_template, manager_alert_template, telegram_template, sms_template,
  email_subject_template, email_body_template, is_terminal, success_event, failure_label, notes, retired_at)
values ('reactivation_v2_cold_t2_b', 103, 'Reactivation v2: cold touch 2 (B)', 'applicant', 'system',
  'Reply or book a call', null, 'manual', 'flag', 'campaign', '#eab308', 'arrow-path',
  'Hey {{first_name}},

It''s Sam again from Galaxy Financial (formerly Apex Financial). What got in the way, the cost or the time? Just reply with one word.

If it''s the cost, ask about it before you spend anything. That''s what the 10 minute call is for, and we call you. Book it here: {{booking_url}}

Sam

You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? Unsubscribe: {{unsubscribe_url}}
Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801', '', '', '',
  'Was it the cost or the time?', '<p>Hey {{first_name}},</p>
<p>It''s Sam again from Galaxy Financial (formerly Apex Financial). What got in the way, the cost or the time? Just reply with one word.</p>
<p>If it''s the cost, ask about it before you spend anything. That''s what the 10 minute call is for, and we call you. <a href="{{booking_url}}">Book it here</a>.</p>
<p>Sam</p>
<p style="font-size:12px;color:#888888">You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? <a href="{{unsubscribe_url}}">Unsubscribe here</a>.<br>Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801</p>', false, '', '',
  'BoB reactivation v2 copy (MP-BOB-CONVERSION). Sent ONLY by reactivation-send; candidate_message_template holds the plain-text body. reminder_cadence=manual and no next_step_progress row ever points here, so no sweep can fire it. retired_at hides it from the recruiting worklist; reactivation-send reads it by stage_key regardless.',
  now())
on conflict (stage_key) do update set
  email_subject_template = excluded.email_subject_template,
  email_body_template = excluded.email_body_template,
  candidate_message_template = excluded.candidate_message_template,
  display_name = excluded.display_name,
  notes = excluded.notes,
  retired_at = coalesce(public.next_step_stages.retired_at, excluded.retired_at);

insert into public.next_step_stages (stage_key, order_index, display_name, audience, owner_role,
  next_action_label, next_action_url, reminder_cadence, stall_action, dashboard_section, color_hex, icon_name,
  candidate_message_template, manager_alert_template, telegram_template, sms_template,
  email_subject_template, email_body_template, is_terminal, success_event, failure_label, notes, retired_at)
values ('reactivation_v2_cold_t3_a', 104, 'Reactivation v2: cold touch 3 (A)', 'applicant', 'system',
  'Reply or book a call', null, 'manual', 'flag', 'campaign', '#eab308', 'arrow-path',
  'Hey {{first_name}},

This is my last email about your application with Galaxy Financial (formerly Apex Financial).

If you still want to get licensed, now or down the road, just reply "yes". Or grab 10 minutes here and ask your questions first. {{booking_url}}

Sam

You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? Unsubscribe: {{unsubscribe_url}}
Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801', '', '', '',
  '{{first_name}}, last note from me', '<p>Hey {{first_name}},</p>
<p>This is my last email about your application with Galaxy Financial (formerly Apex Financial).</p>
<p>If you still want to get licensed, now or down the road, just reply "yes". Or <a href="{{booking_url}}">grab 10 minutes here</a> and ask your questions first.</p>
<p>Sam</p>
<p style="font-size:12px;color:#888888">You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? <a href="{{unsubscribe_url}}">Unsubscribe here</a>.<br>Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801</p>', false, '', '',
  'BoB reactivation v2 copy (MP-BOB-CONVERSION). Sent ONLY by reactivation-send; candidate_message_template holds the plain-text body. reminder_cadence=manual and no next_step_progress row ever points here, so no sweep can fire it. retired_at hides it from the recruiting worklist; reactivation-send reads it by stage_key regardless.',
  now())
on conflict (stage_key) do update set
  email_subject_template = excluded.email_subject_template,
  email_body_template = excluded.email_body_template,
  candidate_message_template = excluded.candidate_message_template,
  display_name = excluded.display_name,
  notes = excluded.notes,
  retired_at = coalesce(public.next_step_stages.retired_at, excluded.retired_at);

insert into public.next_step_stages (stage_key, order_index, display_name, audience, owner_role,
  next_action_label, next_action_url, reminder_cadence, stall_action, dashboard_section, color_hex, icon_name,
  candidate_message_template, manager_alert_template, telegram_template, sms_template,
  email_subject_template, email_body_template, is_terminal, success_event, failure_label, notes, retired_at)
values ('reactivation_v2_cold_t3_b', 105, 'Reactivation v2: cold touch 3 (B)', 'applicant', 'system',
  'Reply or book a call', null, 'manual', 'flag', 'campaign', '#eab308', 'arrow-path',
  'Hey {{first_name}},

This is my last email about your application with Galaxy Financial (formerly Apex Financial).

If you still want to get licensed, now or down the road, just reply "yes". Or grab 10 minutes here and ask your questions first. {{booking_url}}

Sam

You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? Unsubscribe: {{unsubscribe_url}}
Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801', '', '', '',
  'Closing the loop on your application', '<p>Hey {{first_name}},</p>
<p>This is my last email about your application with Galaxy Financial (formerly Apex Financial).</p>
<p>If you still want to get licensed, now or down the road, just reply "yes". Or <a href="{{booking_url}}">grab 10 minutes here</a> and ask your questions first.</p>
<p>Sam</p>
<p style="font-size:12px;color:#888888">You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? <a href="{{unsubscribe_url}}">Unsubscribe here</a>.<br>Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801</p>', false, '', '',
  'BoB reactivation v2 copy (MP-BOB-CONVERSION). Sent ONLY by reactivation-send; candidate_message_template holds the plain-text body. reminder_cadence=manual and no next_step_progress row ever points here, so no sweep can fire it. retired_at hides it from the recruiting worklist; reactivation-send reads it by stage_key regardless.',
  now())
on conflict (stage_key) do update set
  email_subject_template = excluded.email_subject_template,
  email_body_template = excluded.email_body_template,
  candidate_message_template = excluded.candidate_message_template,
  display_name = excluded.display_name,
  notes = excluded.notes,
  retired_at = coalesce(public.next_step_stages.retired_at, excluded.retired_at);

insert into public.next_step_stages (stage_key, order_index, display_name, audience, owner_role,
  next_action_label, next_action_url, reminder_cadence, stall_action, dashboard_section, color_hex, icon_name,
  candidate_message_template, manager_alert_template, telegram_template, sms_template,
  email_subject_template, email_body_template, is_terminal, success_event, failure_label, notes, retired_at)
values ('reactivation_v2_in_course_t1_a', 106, 'Reactivation v2: in_course touch 1 (A)', 'applicant', 'system',
  'Reply or book a call', null, 'manual', 'flag', 'campaign', '#eab308', 'arrow-path',
  'Hey {{first_name}},

It''s Sam James from Galaxy Financial (formerly Apex Financial). I have you down as started on the pre-licensing course, and I don''t have it marked finished.

Do you still want to finish it? Hit reply with a yes or no.

If something got in the way, a 15 minute call can sort out what''s left and when you''ll sit the exam. Here''s my calendar: {{booking_url}}
I call the number you put in, so have your course login handy.

Sam

You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? Unsubscribe: {{unsubscribe_url}}
Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801', '', '', '',
  '{{first_name}}, still working on the course?', '<p>Hey {{first_name}},</p>
<p>It''s Sam James from Galaxy Financial (formerly Apex Financial). I have you down as started on the pre-licensing course, and I don''t have it marked finished.</p>
<p>Do you still want to finish it? Hit reply with a yes or no.</p>
<p>If something got in the way, a 15 minute call can sort out what''s left and when you''ll sit the exam. <a href="{{booking_url}}">Here''s my calendar</a>. I call the number you put in, so have your course login handy.</p>
<p>Sam</p>
<p style="font-size:12px;color:#888888">You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? <a href="{{unsubscribe_url}}">Unsubscribe here</a>.<br>Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801</p>', false, '', '',
  'BoB reactivation v2 copy (MP-BOB-CONVERSION). Sent ONLY by reactivation-send; candidate_message_template holds the plain-text body. reminder_cadence=manual and no next_step_progress row ever points here, so no sweep can fire it. retired_at hides it from the recruiting worklist; reactivation-send reads it by stage_key regardless.',
  now())
on conflict (stage_key) do update set
  email_subject_template = excluded.email_subject_template,
  email_body_template = excluded.email_body_template,
  candidate_message_template = excluded.candidate_message_template,
  display_name = excluded.display_name,
  notes = excluded.notes,
  retired_at = coalesce(public.next_step_stages.retired_at, excluded.retired_at);

insert into public.next_step_stages (stage_key, order_index, display_name, audience, owner_role,
  next_action_label, next_action_url, reminder_cadence, stall_action, dashboard_section, color_hex, icon_name,
  candidate_message_template, manager_alert_template, telegram_template, sms_template,
  email_subject_template, email_body_template, is_terminal, success_event, failure_label, notes, retired_at)
values ('reactivation_v2_in_course_t1_b', 107, 'Reactivation v2: in_course touch 1 (B)', 'applicant', 'system',
  'Reply or book a call', null, 'manual', 'flag', 'campaign', '#eab308', 'arrow-path',
  'Hey {{first_name}},

It''s Sam James from Galaxy Financial (formerly Apex Financial). I have you down as started on the pre-licensing course, and I don''t have it marked finished.

Do you still want to finish it? Hit reply with a yes or no.

If something got in the way, a 15 minute call can sort out what''s left and when you''ll sit the exam. Here''s my calendar: {{booking_url}}
I call the number you put in, so have your course login handy.

Sam

You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? Unsubscribe: {{unsubscribe_url}}
Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801', '', '', '',
  'How''s the pre-licensing course going?', '<p>Hey {{first_name}},</p>
<p>It''s Sam James from Galaxy Financial (formerly Apex Financial). I have you down as started on the pre-licensing course, and I don''t have it marked finished.</p>
<p>Do you still want to finish it? Hit reply with a yes or no.</p>
<p>If something got in the way, a 15 minute call can sort out what''s left and when you''ll sit the exam. <a href="{{booking_url}}">Here''s my calendar</a>. I call the number you put in, so have your course login handy.</p>
<p>Sam</p>
<p style="font-size:12px;color:#888888">You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? <a href="{{unsubscribe_url}}">Unsubscribe here</a>.<br>Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801</p>', false, '', '',
  'BoB reactivation v2 copy (MP-BOB-CONVERSION). Sent ONLY by reactivation-send; candidate_message_template holds the plain-text body. reminder_cadence=manual and no next_step_progress row ever points here, so no sweep can fire it. retired_at hides it from the recruiting worklist; reactivation-send reads it by stage_key regardless.',
  now())
on conflict (stage_key) do update set
  email_subject_template = excluded.email_subject_template,
  email_body_template = excluded.email_body_template,
  candidate_message_template = excluded.candidate_message_template,
  display_name = excluded.display_name,
  notes = excluded.notes,
  retired_at = coalesce(public.next_step_stages.retired_at, excluded.retired_at);

insert into public.next_step_stages (stage_key, order_index, display_name, audience, owner_role,
  next_action_label, next_action_url, reminder_cadence, stall_action, dashboard_section, color_hex, icon_name,
  candidate_message_template, manager_alert_template, telegram_template, sms_template,
  email_subject_template, email_body_template, is_terminal, success_event, failure_label, notes, retired_at)
values ('reactivation_v2_in_course_t2_a', 108, 'Reactivation v2: in_course touch 2 (A)', 'applicant', 'system',
  'Reply or book a call', null, 'manual', 'flag', 'campaign', '#eab308', 'arrow-path',
  'Hey {{first_name}},

It''s Sam again from Galaxy Financial (formerly Apex Financial). You already have the course, so I''d hate to see it sit. What stalled it, time or a tough section? Just reply with one word.

Or grab 15 minutes with me and we''ll plan the rest. {{booking_url}}

Sam

You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? Unsubscribe: {{unsubscribe_url}}
Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801', '', '', '',
  '{{first_name}}, what stalled the course?', '<p>Hey {{first_name}},</p>
<p>It''s Sam again from Galaxy Financial (formerly Apex Financial). You already have the course, so I''d hate to see it sit. What stalled it, time or a tough section? Just reply with one word.</p>
<p>Or <a href="{{booking_url}}">grab 15 minutes with me</a> and we''ll plan the rest.</p>
<p>Sam</p>
<p style="font-size:12px;color:#888888">You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? <a href="{{unsubscribe_url}}">Unsubscribe here</a>.<br>Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801</p>', false, '', '',
  'BoB reactivation v2 copy (MP-BOB-CONVERSION). Sent ONLY by reactivation-send; candidate_message_template holds the plain-text body. reminder_cadence=manual and no next_step_progress row ever points here, so no sweep can fire it. retired_at hides it from the recruiting worklist; reactivation-send reads it by stage_key regardless.',
  now())
on conflict (stage_key) do update set
  email_subject_template = excluded.email_subject_template,
  email_body_template = excluded.email_body_template,
  candidate_message_template = excluded.candidate_message_template,
  display_name = excluded.display_name,
  notes = excluded.notes,
  retired_at = coalesce(public.next_step_stages.retired_at, excluded.retired_at);

insert into public.next_step_stages (stage_key, order_index, display_name, audience, owner_role,
  next_action_label, next_action_url, reminder_cadence, stall_action, dashboard_section, color_hex, icon_name,
  candidate_message_template, manager_alert_template, telegram_template, sms_template,
  email_subject_template, email_body_template, is_terminal, success_event, failure_label, notes, retired_at)
values ('reactivation_v2_in_course_t2_b', 109, 'Reactivation v2: in_course touch 2 (B)', 'applicant', 'system',
  'Reply or book a call', null, 'manual', 'flag', 'campaign', '#eab308', 'arrow-path',
  'Hey {{first_name}},

It''s Sam again from Galaxy Financial (formerly Apex Financial). You already have the course, so I''d hate to see it sit. What stalled it, time or a tough section? Just reply with one word.

Or grab 15 minutes with me and we''ll plan the rest. {{booking_url}}

Sam

You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? Unsubscribe: {{unsubscribe_url}}
Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801', '', '', '',
  'Stuck on the course?', '<p>Hey {{first_name}},</p>
<p>It''s Sam again from Galaxy Financial (formerly Apex Financial). You already have the course, so I''d hate to see it sit. What stalled it, time or a tough section? Just reply with one word.</p>
<p>Or <a href="{{booking_url}}">grab 15 minutes with me</a> and we''ll plan the rest.</p>
<p>Sam</p>
<p style="font-size:12px;color:#888888">You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? <a href="{{unsubscribe_url}}">Unsubscribe here</a>.<br>Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801</p>', false, '', '',
  'BoB reactivation v2 copy (MP-BOB-CONVERSION). Sent ONLY by reactivation-send; candidate_message_template holds the plain-text body. reminder_cadence=manual and no next_step_progress row ever points here, so no sweep can fire it. retired_at hides it from the recruiting worklist; reactivation-send reads it by stage_key regardless.',
  now())
on conflict (stage_key) do update set
  email_subject_template = excluded.email_subject_template,
  email_body_template = excluded.email_body_template,
  candidate_message_template = excluded.candidate_message_template,
  display_name = excluded.display_name,
  notes = excluded.notes,
  retired_at = coalesce(public.next_step_stages.retired_at, excluded.retired_at);

insert into public.next_step_stages (stage_key, order_index, display_name, audience, owner_role,
  next_action_label, next_action_url, reminder_cadence, stall_action, dashboard_section, color_hex, icon_name,
  candidate_message_template, manager_alert_template, telegram_template, sms_template,
  email_subject_template, email_body_template, is_terminal, success_event, failure_label, notes, retired_at)
values ('reactivation_v2_in_course_t3_a', 110, 'Reactivation v2: in_course touch 3 (A)', 'applicant', 'system',
  'Reply or book a call', null, 'manual', 'flag', 'campaign', '#eab308', 'arrow-path',
  'Hey {{first_name}},

This is my last email about the course and your application with Galaxy Financial (formerly Apex Financial).

If you pick it back up and want a plan for the rest, reply "yes", or pick a time with me here: {{booking_url}}

Sam

You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? Unsubscribe: {{unsubscribe_url}}
Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801', '', '', '',
  '{{first_name}}, last note about the course', '<p>Hey {{first_name}},</p>
<p>This is my last email about the course and your application with Galaxy Financial (formerly Apex Financial).</p>
<p>If you pick it back up and want a plan for the rest, reply "yes", or <a href="{{booking_url}}">pick a time with me here</a>.</p>
<p>Sam</p>
<p style="font-size:12px;color:#888888">You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? <a href="{{unsubscribe_url}}">Unsubscribe here</a>.<br>Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801</p>', false, '', '',
  'BoB reactivation v2 copy (MP-BOB-CONVERSION). Sent ONLY by reactivation-send; candidate_message_template holds the plain-text body. reminder_cadence=manual and no next_step_progress row ever points here, so no sweep can fire it. retired_at hides it from the recruiting worklist; reactivation-send reads it by stage_key regardless.',
  now())
on conflict (stage_key) do update set
  email_subject_template = excluded.email_subject_template,
  email_body_template = excluded.email_body_template,
  candidate_message_template = excluded.candidate_message_template,
  display_name = excluded.display_name,
  notes = excluded.notes,
  retired_at = coalesce(public.next_step_stages.retired_at, excluded.retired_at);

insert into public.next_step_stages (stage_key, order_index, display_name, audience, owner_role,
  next_action_label, next_action_url, reminder_cadence, stall_action, dashboard_section, color_hex, icon_name,
  candidate_message_template, manager_alert_template, telegram_template, sms_template,
  email_subject_template, email_body_template, is_terminal, success_event, failure_label, notes, retired_at)
values ('reactivation_v2_in_course_t3_b', 111, 'Reactivation v2: in_course touch 3 (B)', 'applicant', 'system',
  'Reply or book a call', null, 'manual', 'flag', 'campaign', '#eab308', 'arrow-path',
  'Hey {{first_name}},

This is my last email about the course and your application with Galaxy Financial (formerly Apex Financial).

If you pick it back up and want a plan for the rest, reply "yes", or pick a time with me here: {{booking_url}}

Sam

You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? Unsubscribe: {{unsubscribe_url}}
Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801', '', '', '',
  'Closing the loop on your course', '<p>Hey {{first_name}},</p>
<p>This is my last email about the course and your application with Galaxy Financial (formerly Apex Financial).</p>
<p>If you pick it back up and want a plan for the rest, reply "yes", or <a href="{{booking_url}}">pick a time with me here</a>.</p>
<p>Sam</p>
<p style="font-size:12px;color:#888888">You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? <a href="{{unsubscribe_url}}">Unsubscribe here</a>.<br>Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801</p>', false, '', '',
  'BoB reactivation v2 copy (MP-BOB-CONVERSION). Sent ONLY by reactivation-send; candidate_message_template holds the plain-text body. reminder_cadence=manual and no next_step_progress row ever points here, so no sweep can fire it. retired_at hides it from the recruiting worklist; reactivation-send reads it by stage_key regardless.',
  now())
on conflict (stage_key) do update set
  email_subject_template = excluded.email_subject_template,
  email_body_template = excluded.email_body_template,
  candidate_message_template = excluded.candidate_message_template,
  display_name = excluded.display_name,
  notes = excluded.notes,
  retired_at = coalesce(public.next_step_stages.retired_at, excluded.retired_at);

insert into public.next_step_stages (stage_key, order_index, display_name, audience, owner_role,
  next_action_label, next_action_url, reminder_cadence, stall_action, dashboard_section, color_hex, icon_name,
  candidate_message_template, manager_alert_template, telegram_template, sms_template,
  email_subject_template, email_body_template, is_terminal, success_event, failure_label, notes, retired_at)
values ('reactivation_v2_course_done_t1_a', 112, 'Reactivation v2: course_done touch 1 (A)', 'applicant', 'system',
  'Reply or book a call', null, 'manual', 'flag', 'campaign', '#eab308', 'arrow-path',
  'Hey {{first_name}},

It''s Sam James from Galaxy Financial (formerly Apex Financial). I have you down as done with the pre-licensing course, but I don''t have an exam result for you.

Have you taken the state exam yet? Hit reply with a yes or no.

If the exam is where things stalled, let''s map out your exam, fingerprints and license on a 15 minute call. Here''s my calendar: {{booking_url}}
I call the number you put in, so have your course login handy.

Sam

You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? Unsubscribe: {{unsubscribe_url}}
Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801', '', '', '',
  '{{first_name}}, have you taken the exam yet?', '<p>Hey {{first_name}},</p>
<p>It''s Sam James from Galaxy Financial (formerly Apex Financial). I have you down as done with the pre-licensing course, but I don''t have an exam result for you.</p>
<p>Have you taken the state exam yet? Hit reply with a yes or no.</p>
<p>If the exam is where things stalled, let''s map out your exam, fingerprints and license on a 15 minute call. <a href="{{booking_url}}">Here''s my calendar</a>. I call the number you put in, so have your course login handy.</p>
<p>Sam</p>
<p style="font-size:12px;color:#888888">You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? <a href="{{unsubscribe_url}}">Unsubscribe here</a>.<br>Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801</p>', false, '', '',
  'BoB reactivation v2 copy (MP-BOB-CONVERSION). Sent ONLY by reactivation-send; candidate_message_template holds the plain-text body. reminder_cadence=manual and no next_step_progress row ever points here, so no sweep can fire it. retired_at hides it from the recruiting worklist; reactivation-send reads it by stage_key regardless.',
  now())
on conflict (stage_key) do update set
  email_subject_template = excluded.email_subject_template,
  email_body_template = excluded.email_body_template,
  candidate_message_template = excluded.candidate_message_template,
  display_name = excluded.display_name,
  notes = excluded.notes,
  retired_at = coalesce(public.next_step_stages.retired_at, excluded.retired_at);

insert into public.next_step_stages (stage_key, order_index, display_name, audience, owner_role,
  next_action_label, next_action_url, reminder_cadence, stall_action, dashboard_section, color_hex, icon_name,
  candidate_message_template, manager_alert_template, telegram_template, sms_template,
  email_subject_template, email_body_template, is_terminal, success_event, failure_label, notes, retired_at)
values ('reactivation_v2_course_done_t1_b', 113, 'Reactivation v2: course_done touch 1 (B)', 'applicant', 'system',
  'Reply or book a call', null, 'manual', 'flag', 'campaign', '#eab308', 'arrow-path',
  'Hey {{first_name}},

It''s Sam James from Galaxy Financial (formerly Apex Financial). I have you down as done with the pre-licensing course, but I don''t have an exam result for you.

Have you taken the state exam yet? Hit reply with a yes or no.

If the exam is where things stalled, let''s map out your exam, fingerprints and license on a 15 minute call. Here''s my calendar: {{booking_url}}
I call the number you put in, so have your course login handy.

Sam

You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? Unsubscribe: {{unsubscribe_url}}
Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801', '', '', '',
  'Your next step after the course', '<p>Hey {{first_name}},</p>
<p>It''s Sam James from Galaxy Financial (formerly Apex Financial). I have you down as done with the pre-licensing course, but I don''t have an exam result for you.</p>
<p>Have you taken the state exam yet? Hit reply with a yes or no.</p>
<p>If the exam is where things stalled, let''s map out your exam, fingerprints and license on a 15 minute call. <a href="{{booking_url}}">Here''s my calendar</a>. I call the number you put in, so have your course login handy.</p>
<p>Sam</p>
<p style="font-size:12px;color:#888888">You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? <a href="{{unsubscribe_url}}">Unsubscribe here</a>.<br>Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801</p>', false, '', '',
  'BoB reactivation v2 copy (MP-BOB-CONVERSION). Sent ONLY by reactivation-send; candidate_message_template holds the plain-text body. reminder_cadence=manual and no next_step_progress row ever points here, so no sweep can fire it. retired_at hides it from the recruiting worklist; reactivation-send reads it by stage_key regardless.',
  now())
on conflict (stage_key) do update set
  email_subject_template = excluded.email_subject_template,
  email_body_template = excluded.email_body_template,
  candidate_message_template = excluded.candidate_message_template,
  display_name = excluded.display_name,
  notes = excluded.notes,
  retired_at = coalesce(public.next_step_stages.retired_at, excluded.retired_at);

insert into public.next_step_stages (stage_key, order_index, display_name, audience, owner_role,
  next_action_label, next_action_url, reminder_cadence, stall_action, dashboard_section, color_hex, icon_name,
  candidate_message_template, manager_alert_template, telegram_template, sms_template,
  email_subject_template, email_body_template, is_terminal, success_event, failure_label, notes, retired_at)
values ('reactivation_v2_course_done_t2_a', 114, 'Reactivation v2: course_done touch 2 (A)', 'applicant', 'system',
  'Reply or book a call', null, 'manual', 'flag', 'campaign', '#eab308', 'arrow-path',
  'Hey {{first_name}},

It''s Sam again from Galaxy Financial (formerly Apex Financial). Did you already pass the exam? If so, reply "passed" so I stop asking about it.

If you haven''t booked it, the 15 minute call is where we plan the date and line up fingerprints and the state application. Pick a time here: {{booking_url}}

Sam

You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? Unsubscribe: {{unsubscribe_url}}
Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801', '', '', '',
  '{{first_name}}, exam booked yet?', '<p>Hey {{first_name}},</p>
<p>It''s Sam again from Galaxy Financial (formerly Apex Financial). Did you already pass the exam? If so, reply "passed" so I stop asking about it.</p>
<p>If you haven''t booked it, the 15 minute call is where we plan the date and line up fingerprints and the state application. <a href="{{booking_url}}">Pick a time here</a>.</p>
<p>Sam</p>
<p style="font-size:12px;color:#888888">You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? <a href="{{unsubscribe_url}}">Unsubscribe here</a>.<br>Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801</p>', false, '', '',
  'BoB reactivation v2 copy (MP-BOB-CONVERSION). Sent ONLY by reactivation-send; candidate_message_template holds the plain-text body. reminder_cadence=manual and no next_step_progress row ever points here, so no sweep can fire it. retired_at hides it from the recruiting worklist; reactivation-send reads it by stage_key regardless.',
  now())
on conflict (stage_key) do update set
  email_subject_template = excluded.email_subject_template,
  email_body_template = excluded.email_body_template,
  candidate_message_template = excluded.candidate_message_template,
  display_name = excluded.display_name,
  notes = excluded.notes,
  retired_at = coalesce(public.next_step_stages.retired_at, excluded.retired_at);

insert into public.next_step_stages (stage_key, order_index, display_name, audience, owner_role,
  next_action_label, next_action_url, reminder_cadence, stall_action, dashboard_section, color_hex, icon_name,
  candidate_message_template, manager_alert_template, telegram_template, sms_template,
  email_subject_template, email_body_template, is_terminal, success_event, failure_label, notes, retired_at)
values ('reactivation_v2_course_done_t2_b', 115, 'Reactivation v2: course_done touch 2 (B)', 'applicant', 'system',
  'Reply or book a call', null, 'manual', 'flag', 'campaign', '#eab308', 'arrow-path',
  'Hey {{first_name}},

It''s Sam again from Galaxy Financial (formerly Apex Financial). Did you already pass the exam? If so, reply "passed" so I stop asking about it.

If you haven''t booked it, the 15 minute call is where we plan the date and line up fingerprints and the state application. Pick a time here: {{booking_url}}

Sam

You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? Unsubscribe: {{unsubscribe_url}}
Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801', '', '', '',
  'One question about your exam', '<p>Hey {{first_name}},</p>
<p>It''s Sam again from Galaxy Financial (formerly Apex Financial). Did you already pass the exam? If so, reply "passed" so I stop asking about it.</p>
<p>If you haven''t booked it, the 15 minute call is where we plan the date and line up fingerprints and the state application. <a href="{{booking_url}}">Pick a time here</a>.</p>
<p>Sam</p>
<p style="font-size:12px;color:#888888">You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? <a href="{{unsubscribe_url}}">Unsubscribe here</a>.<br>Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801</p>', false, '', '',
  'BoB reactivation v2 copy (MP-BOB-CONVERSION). Sent ONLY by reactivation-send; candidate_message_template holds the plain-text body. reminder_cadence=manual and no next_step_progress row ever points here, so no sweep can fire it. retired_at hides it from the recruiting worklist; reactivation-send reads it by stage_key regardless.',
  now())
on conflict (stage_key) do update set
  email_subject_template = excluded.email_subject_template,
  email_body_template = excluded.email_body_template,
  candidate_message_template = excluded.candidate_message_template,
  display_name = excluded.display_name,
  notes = excluded.notes,
  retired_at = coalesce(public.next_step_stages.retired_at, excluded.retired_at);

insert into public.next_step_stages (stage_key, order_index, display_name, audience, owner_role,
  next_action_label, next_action_url, reminder_cadence, stall_action, dashboard_section, color_hex, icon_name,
  candidate_message_template, manager_alert_template, telegram_template, sms_template,
  email_subject_template, email_body_template, is_terminal, success_event, failure_label, notes, retired_at)
values ('reactivation_v2_course_done_t3_a', 116, 'Reactivation v2: course_done touch 3 (A)', 'applicant', 'system',
  'Reply or book a call', null, 'manual', 'flag', 'campaign', '#eab308', 'arrow-path',
  'Hey {{first_name}},

This is my last email about your exam and your application with Galaxy Financial (formerly Apex Financial).

You already finished the course. If you still want the license, reply "yes", or grab 15 minutes with me here: {{booking_url}}

Sam

You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? Unsubscribe: {{unsubscribe_url}}
Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801', '', '', '',
  '{{first_name}}, last note about your exam', '<p>Hey {{first_name}},</p>
<p>This is my last email about your exam and your application with Galaxy Financial (formerly Apex Financial).</p>
<p>You already finished the course. If you still want the license, reply "yes", or <a href="{{booking_url}}">grab 15 minutes with me here</a>.</p>
<p>Sam</p>
<p style="font-size:12px;color:#888888">You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? <a href="{{unsubscribe_url}}">Unsubscribe here</a>.<br>Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801</p>', false, '', '',
  'BoB reactivation v2 copy (MP-BOB-CONVERSION). Sent ONLY by reactivation-send; candidate_message_template holds the plain-text body. reminder_cadence=manual and no next_step_progress row ever points here, so no sweep can fire it. retired_at hides it from the recruiting worklist; reactivation-send reads it by stage_key regardless.',
  now())
on conflict (stage_key) do update set
  email_subject_template = excluded.email_subject_template,
  email_body_template = excluded.email_body_template,
  candidate_message_template = excluded.candidate_message_template,
  display_name = excluded.display_name,
  notes = excluded.notes,
  retired_at = coalesce(public.next_step_stages.retired_at, excluded.retired_at);

insert into public.next_step_stages (stage_key, order_index, display_name, audience, owner_role,
  next_action_label, next_action_url, reminder_cadence, stall_action, dashboard_section, color_hex, icon_name,
  candidate_message_template, manager_alert_template, telegram_template, sms_template,
  email_subject_template, email_body_template, is_terminal, success_event, failure_label, notes, retired_at)
values ('reactivation_v2_course_done_t3_b', 117, 'Reactivation v2: course_done touch 3 (B)', 'applicant', 'system',
  'Reply or book a call', null, 'manual', 'flag', 'campaign', '#eab308', 'arrow-path',
  'Hey {{first_name}},

This is my last email about your exam and your application with Galaxy Financial (formerly Apex Financial).

You already finished the course. If you still want the license, reply "yes", or grab 15 minutes with me here: {{booking_url}}

Sam

You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? Unsubscribe: {{unsubscribe_url}}
Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801', '', '', '',
  'Closing the loop on your exam', '<p>Hey {{first_name}},</p>
<p>This is my last email about your exam and your application with Galaxy Financial (formerly Apex Financial).</p>
<p>You already finished the course. If you still want the license, reply "yes", or <a href="{{booking_url}}">grab 15 minutes with me here</a>.</p>
<p>Sam</p>
<p style="font-size:12px;color:#888888">You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? <a href="{{unsubscribe_url}}">Unsubscribe here</a>.<br>Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801</p>', false, '', '',
  'BoB reactivation v2 copy (MP-BOB-CONVERSION). Sent ONLY by reactivation-send; candidate_message_template holds the plain-text body. reminder_cadence=manual and no next_step_progress row ever points here, so no sweep can fire it. retired_at hides it from the recruiting worklist; reactivation-send reads it by stage_key regardless.',
  now())
on conflict (stage_key) do update set
  email_subject_template = excluded.email_subject_template,
  email_body_template = excluded.email_body_template,
  candidate_message_template = excluded.candidate_message_template,
  display_name = excluded.display_name,
  notes = excluded.notes,
  retired_at = coalesce(public.next_step_stages.retired_at, excluded.retired_at);

insert into public.next_step_stages (stage_key, order_index, display_name, audience, owner_role,
  next_action_label, next_action_url, reminder_cadence, stall_action, dashboard_section, color_hex, icon_name,
  candidate_message_template, manager_alert_template, telegram_template, sms_template,
  email_subject_template, email_body_template, is_terminal, success_event, failure_label, notes, retired_at)
values ('reactivation_v2_pending_t1_a', 118, 'Reactivation v2: pending touch 1 (A)', 'applicant', 'system',
  'Reply or book a call', null, 'manual', 'flag', 'campaign', '#eab308', 'arrow-path',
  'Hey {{first_name}},

It''s Sam James from Galaxy Financial (formerly Apex Financial). Your application with us is still open, and I have your license down as pending.

Did it come through? Just reply "yes" or "not yet".

If it''s a yes, the next step is a 15 minute call with me. Here''s my calendar: {{booking_url}}
I call the number you put in, so have your NPN and licensed states handy.

Sam

You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? Unsubscribe: {{unsubscribe_url}}
Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801', '', '', '',
  '{{first_name}}, did your license come in?', '<p>Hey {{first_name}},</p>
<p>It''s Sam James from Galaxy Financial (formerly Apex Financial). Your application with us is still open, and I have your license down as pending.</p>
<p>Did it come through? Just reply "yes" or "not yet".</p>
<p>If it''s a yes, the next step is a 15 minute call with me. <a href="{{booking_url}}">Here''s my calendar</a>. I call the number you put in, so have your NPN and licensed states handy.</p>
<p>Sam</p>
<p style="font-size:12px;color:#888888">You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? <a href="{{unsubscribe_url}}">Unsubscribe here</a>.<br>Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801</p>', false, '', '',
  'BoB reactivation v2 copy (MP-BOB-CONVERSION). Sent ONLY by reactivation-send; candidate_message_template holds the plain-text body. reminder_cadence=manual and no next_step_progress row ever points here, so no sweep can fire it. retired_at hides it from the recruiting worklist; reactivation-send reads it by stage_key regardless.',
  now())
on conflict (stage_key) do update set
  email_subject_template = excluded.email_subject_template,
  email_body_template = excluded.email_body_template,
  candidate_message_template = excluded.candidate_message_template,
  display_name = excluded.display_name,
  notes = excluded.notes,
  retired_at = coalesce(public.next_step_stages.retired_at, excluded.retired_at);

insert into public.next_step_stages (stage_key, order_index, display_name, audience, owner_role,
  next_action_label, next_action_url, reminder_cadence, stall_action, dashboard_section, color_hex, icon_name,
  candidate_message_template, manager_alert_template, telegram_template, sms_template,
  email_subject_template, email_body_template, is_terminal, success_event, failure_label, notes, retired_at)
values ('reactivation_v2_pending_t1_b', 119, 'Reactivation v2: pending touch 1 (B)', 'applicant', 'system',
  'Reply or book a call', null, 'manual', 'flag', 'campaign', '#eab308', 'arrow-path',
  'Hey {{first_name}},

It''s Sam James from Galaxy Financial (formerly Apex Financial). Your application with us is still open, and I have your license down as pending.

Did it come through? Just reply "yes" or "not yet".

If it''s a yes, the next step is a 15 minute call with me. Here''s my calendar: {{booking_url}}
I call the number you put in, so have your NPN and licensed states handy.

Sam

You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? Unsubscribe: {{unsubscribe_url}}
Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801', '', '', '',
  'Checking on your license', '<p>Hey {{first_name}},</p>
<p>It''s Sam James from Galaxy Financial (formerly Apex Financial). Your application with us is still open, and I have your license down as pending.</p>
<p>Did it come through? Just reply "yes" or "not yet".</p>
<p>If it''s a yes, the next step is a 15 minute call with me. <a href="{{booking_url}}">Here''s my calendar</a>. I call the number you put in, so have your NPN and licensed states handy.</p>
<p>Sam</p>
<p style="font-size:12px;color:#888888">You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? <a href="{{unsubscribe_url}}">Unsubscribe here</a>.<br>Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801</p>', false, '', '',
  'BoB reactivation v2 copy (MP-BOB-CONVERSION). Sent ONLY by reactivation-send; candidate_message_template holds the plain-text body. reminder_cadence=manual and no next_step_progress row ever points here, so no sweep can fire it. retired_at hides it from the recruiting worklist; reactivation-send reads it by stage_key regardless.',
  now())
on conflict (stage_key) do update set
  email_subject_template = excluded.email_subject_template,
  email_body_template = excluded.email_body_template,
  candidate_message_template = excluded.candidate_message_template,
  display_name = excluded.display_name,
  notes = excluded.notes,
  retired_at = coalesce(public.next_step_stages.retired_at, excluded.retired_at);

insert into public.next_step_stages (stage_key, order_index, display_name, audience, owner_role,
  next_action_label, next_action_url, reminder_cadence, stall_action, dashboard_section, color_hex, icon_name,
  candidate_message_template, manager_alert_template, telegram_template, sms_template,
  email_subject_template, email_body_template, is_terminal, success_event, failure_label, notes, retired_at)
values ('reactivation_v2_pending_t2_a', 120, 'Reactivation v2: pending touch 2 (A)', 'applicant', 'system',
  'Reply or book a call', null, 'manual', 'flag', 'campaign', '#eab308', 'arrow-path',
  'Hey {{first_name}},

It''s Sam again from Galaxy Financial (formerly Apex Financial). If your license is still pending, what''s holding it up: the exam, fingerprints, or the state application? Hit reply with whichever one it is.

If it already came through, grab 15 minutes with me here: {{booking_url}}

Sam

You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? Unsubscribe: {{unsubscribe_url}}
Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801', '', '', '',
  '{{first_name}}, any word from the state?', '<p>Hey {{first_name}},</p>
<p>It''s Sam again from Galaxy Financial (formerly Apex Financial). If your license is still pending, what''s holding it up: the exam, fingerprints, or the state application? Hit reply with whichever one it is.</p>
<p>If it already came through, <a href="{{booking_url}}">grab 15 minutes with me here</a>.</p>
<p>Sam</p>
<p style="font-size:12px;color:#888888">You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? <a href="{{unsubscribe_url}}">Unsubscribe here</a>.<br>Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801</p>', false, '', '',
  'BoB reactivation v2 copy (MP-BOB-CONVERSION). Sent ONLY by reactivation-send; candidate_message_template holds the plain-text body. reminder_cadence=manual and no next_step_progress row ever points here, so no sweep can fire it. retired_at hides it from the recruiting worklist; reactivation-send reads it by stage_key regardless.',
  now())
on conflict (stage_key) do update set
  email_subject_template = excluded.email_subject_template,
  email_body_template = excluded.email_body_template,
  candidate_message_template = excluded.candidate_message_template,
  display_name = excluded.display_name,
  notes = excluded.notes,
  retired_at = coalesce(public.next_step_stages.retired_at, excluded.retired_at);

insert into public.next_step_stages (stage_key, order_index, display_name, audience, owner_role,
  next_action_label, next_action_url, reminder_cadence, stall_action, dashboard_section, color_hex, icon_name,
  candidate_message_template, manager_alert_template, telegram_template, sms_template,
  email_subject_template, email_body_template, is_terminal, success_event, failure_label, notes, retired_at)
values ('reactivation_v2_pending_t2_b', 121, 'Reactivation v2: pending touch 2 (B)', 'applicant', 'system',
  'Reply or book a call', null, 'manual', 'flag', 'campaign', '#eab308', 'arrow-path',
  'Hey {{first_name}},

It''s Sam again from Galaxy Financial (formerly Apex Financial). If your license is still pending, what''s holding it up: the exam, fingerprints, or the state application? Hit reply with whichever one it is.

If it already came through, grab 15 minutes with me here: {{booking_url}}

Sam

You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? Unsubscribe: {{unsubscribe_url}}
Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801', '', '', '',
  'Still waiting on the state?', '<p>Hey {{first_name}},</p>
<p>It''s Sam again from Galaxy Financial (formerly Apex Financial). If your license is still pending, what''s holding it up: the exam, fingerprints, or the state application? Hit reply with whichever one it is.</p>
<p>If it already came through, <a href="{{booking_url}}">grab 15 minutes with me here</a>.</p>
<p>Sam</p>
<p style="font-size:12px;color:#888888">You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? <a href="{{unsubscribe_url}}">Unsubscribe here</a>.<br>Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801</p>', false, '', '',
  'BoB reactivation v2 copy (MP-BOB-CONVERSION). Sent ONLY by reactivation-send; candidate_message_template holds the plain-text body. reminder_cadence=manual and no next_step_progress row ever points here, so no sweep can fire it. retired_at hides it from the recruiting worklist; reactivation-send reads it by stage_key regardless.',
  now())
on conflict (stage_key) do update set
  email_subject_template = excluded.email_subject_template,
  email_body_template = excluded.email_body_template,
  candidate_message_template = excluded.candidate_message_template,
  display_name = excluded.display_name,
  notes = excluded.notes,
  retired_at = coalesce(public.next_step_stages.retired_at, excluded.retired_at);

insert into public.next_step_stages (stage_key, order_index, display_name, audience, owner_role,
  next_action_label, next_action_url, reminder_cadence, stall_action, dashboard_section, color_hex, icon_name,
  candidate_message_template, manager_alert_template, telegram_template, sms_template,
  email_subject_template, email_body_template, is_terminal, success_event, failure_label, notes, retired_at)
values ('reactivation_v2_pending_t3_a', 122, 'Reactivation v2: pending touch 3 (A)', 'applicant', 'system',
  'Reply or book a call', null, 'manual', 'flag', 'campaign', '#eab308', 'arrow-path',
  'Hey {{first_name}},

This is my last email about your license and your application with Galaxy Financial (formerly Apex Financial).

When it comes through and you still want in, reply "licensed" or pick a time with me here: {{booking_url}}

Sam

You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? Unsubscribe: {{unsubscribe_url}}
Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801', '', '', '',
  '{{first_name}}, last note on your license', '<p>Hey {{first_name}},</p>
<p>This is my last email about your license and your application with Galaxy Financial (formerly Apex Financial).</p>
<p>When it comes through and you still want in, reply "licensed" or <a href="{{booking_url}}">pick a time with me here</a>.</p>
<p>Sam</p>
<p style="font-size:12px;color:#888888">You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? <a href="{{unsubscribe_url}}">Unsubscribe here</a>.<br>Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801</p>', false, '', '',
  'BoB reactivation v2 copy (MP-BOB-CONVERSION). Sent ONLY by reactivation-send; candidate_message_template holds the plain-text body. reminder_cadence=manual and no next_step_progress row ever points here, so no sweep can fire it. retired_at hides it from the recruiting worklist; reactivation-send reads it by stage_key regardless.',
  now())
on conflict (stage_key) do update set
  email_subject_template = excluded.email_subject_template,
  email_body_template = excluded.email_body_template,
  candidate_message_template = excluded.candidate_message_template,
  display_name = excluded.display_name,
  notes = excluded.notes,
  retired_at = coalesce(public.next_step_stages.retired_at, excluded.retired_at);

insert into public.next_step_stages (stage_key, order_index, display_name, audience, owner_role,
  next_action_label, next_action_url, reminder_cadence, stall_action, dashboard_section, color_hex, icon_name,
  candidate_message_template, manager_alert_template, telegram_template, sms_template,
  email_subject_template, email_body_template, is_terminal, success_event, failure_label, notes, retired_at)
values ('reactivation_v2_pending_t3_b', 123, 'Reactivation v2: pending touch 3 (B)', 'applicant', 'system',
  'Reply or book a call', null, 'manual', 'flag', 'campaign', '#eab308', 'arrow-path',
  'Hey {{first_name}},

This is my last email about your license and your application with Galaxy Financial (formerly Apex Financial).

When it comes through and you still want in, reply "licensed" or pick a time with me here: {{booking_url}}

Sam

You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? Unsubscribe: {{unsubscribe_url}}
Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801', '', '', '',
  'Closing the loop on your license', '<p>Hey {{first_name}},</p>
<p>This is my last email about your license and your application with Galaxy Financial (formerly Apex Financial).</p>
<p>When it comes through and you still want in, reply "licensed" or <a href="{{booking_url}}">pick a time with me here</a>.</p>
<p>Sam</p>
<p style="font-size:12px;color:#888888">You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? <a href="{{unsubscribe_url}}">Unsubscribe here</a>.<br>Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801</p>', false, '', '',
  'BoB reactivation v2 copy (MP-BOB-CONVERSION). Sent ONLY by reactivation-send; candidate_message_template holds the plain-text body. reminder_cadence=manual and no next_step_progress row ever points here, so no sweep can fire it. retired_at hides it from the recruiting worklist; reactivation-send reads it by stage_key regardless.',
  now())
on conflict (stage_key) do update set
  email_subject_template = excluded.email_subject_template,
  email_body_template = excluded.email_body_template,
  candidate_message_template = excluded.candidate_message_template,
  display_name = excluded.display_name,
  notes = excluded.notes,
  retired_at = coalesce(public.next_step_stages.retired_at, excluded.retired_at);

insert into public.next_step_stages (stage_key, order_index, display_name, audience, owner_role,
  next_action_label, next_action_url, reminder_cadence, stall_action, dashboard_section, color_hex, icon_name,
  candidate_message_template, manager_alert_template, telegram_template, sms_template,
  email_subject_template, email_body_template, is_terminal, success_event, failure_label, notes, retired_at)
values ('reactivation_v2_licensed_t1_a', 124, 'Reactivation v2: licensed touch 1 (A)', 'applicant', 'system',
  'Reply or book a call', null, 'manual', 'flag', 'campaign', '#eab308', 'arrow-path',
  'Hey {{first_name}},

It''s Sam James from Galaxy Financial (formerly Apex Financial). I have you down as a licensed agent, and your application with us is still open.

One question: are you still looking for an agency to write with? Just hit reply with a yes or a no.

If it''s a yes, here''s my calendar: {{booking_url}}
It''s 15 minutes and I call the number you put in. Have your NPN and licensed states handy.

Sam

You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? Unsubscribe: {{unsubscribe_url}}
Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801', '', '', '',
  '{{first_name}}, still looking for an agency?', '<p>Hey {{first_name}},</p>
<p>It''s Sam James from Galaxy Financial (formerly Apex Financial). I have you down as a licensed agent, and your application with us is still open.</p>
<p>One question: are you still looking for an agency to write with? Just hit reply with a yes or a no.</p>
<p>If it''s a yes, <a href="{{booking_url}}">here''s my calendar</a>. It''s 15 minutes and I call the number you put in. Have your NPN and licensed states handy.</p>
<p>Sam</p>
<p style="font-size:12px;color:#888888">You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? <a href="{{unsubscribe_url}}">Unsubscribe here</a>.<br>Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801</p>', false, '', '',
  'BoB reactivation v2 copy (MP-BOB-CONVERSION). Sent ONLY by reactivation-send; candidate_message_template holds the plain-text body. reminder_cadence=manual and no next_step_progress row ever points here, so no sweep can fire it. retired_at hides it from the recruiting worklist; reactivation-send reads it by stage_key regardless.',
  now())
on conflict (stage_key) do update set
  email_subject_template = excluded.email_subject_template,
  email_body_template = excluded.email_body_template,
  candidate_message_template = excluded.candidate_message_template,
  display_name = excluded.display_name,
  notes = excluded.notes,
  retired_at = coalesce(public.next_step_stages.retired_at, excluded.retired_at);

insert into public.next_step_stages (stage_key, order_index, display_name, audience, owner_role,
  next_action_label, next_action_url, reminder_cadence, stall_action, dashboard_section, color_hex, icon_name,
  candidate_message_template, manager_alert_template, telegram_template, sms_template,
  email_subject_template, email_body_template, is_terminal, success_event, failure_label, notes, retired_at)
values ('reactivation_v2_licensed_t1_b', 125, 'Reactivation v2: licensed touch 1 (B)', 'applicant', 'system',
  'Reply or book a call', null, 'manual', 'flag', 'campaign', '#eab308', 'arrow-path',
  'Hey {{first_name}},

It''s Sam James from Galaxy Financial (formerly Apex Financial). I have you down as a licensed agent, and your application with us is still open.

One question: are you still looking for an agency to write with? Just hit reply with a yes or a no.

If it''s a yes, here''s my calendar: {{booking_url}}
It''s 15 minutes and I call the number you put in. Have your NPN and licensed states handy.

Sam

You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? Unsubscribe: {{unsubscribe_url}}
Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801', '', '', '',
  'Licensed and still looking?', '<p>Hey {{first_name}},</p>
<p>It''s Sam James from Galaxy Financial (formerly Apex Financial). I have you down as a licensed agent, and your application with us is still open.</p>
<p>One question: are you still looking for an agency to write with? Just hit reply with a yes or a no.</p>
<p>If it''s a yes, <a href="{{booking_url}}">here''s my calendar</a>. It''s 15 minutes and I call the number you put in. Have your NPN and licensed states handy.</p>
<p>Sam</p>
<p style="font-size:12px;color:#888888">You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? <a href="{{unsubscribe_url}}">Unsubscribe here</a>.<br>Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801</p>', false, '', '',
  'BoB reactivation v2 copy (MP-BOB-CONVERSION). Sent ONLY by reactivation-send; candidate_message_template holds the plain-text body. reminder_cadence=manual and no next_step_progress row ever points here, so no sweep can fire it. retired_at hides it from the recruiting worklist; reactivation-send reads it by stage_key regardless.',
  now())
on conflict (stage_key) do update set
  email_subject_template = excluded.email_subject_template,
  email_body_template = excluded.email_body_template,
  candidate_message_template = excluded.candidate_message_template,
  display_name = excluded.display_name,
  notes = excluded.notes,
  retired_at = coalesce(public.next_step_stages.retired_at, excluded.retired_at);

insert into public.next_step_stages (stage_key, order_index, display_name, audience, owner_role,
  next_action_label, next_action_url, reminder_cadence, stall_action, dashboard_section, color_hex, icon_name,
  candidate_message_template, manager_alert_template, telegram_template, sms_template,
  email_subject_template, email_body_template, is_terminal, success_event, failure_label, notes, retired_at)
values ('reactivation_v2_licensed_t2_a', 126, 'Reactivation v2: licensed touch 2 (A)', 'applicant', 'system',
  'Reply or book a call', null, 'manual', 'flag', 'campaign', '#eab308', 'arrow-path',
  'Hey {{first_name}},

It''s Sam again from Galaxy Financial (formerly Apex Financial). Did you end up finding an agency, or are you still looking? Just hit reply, one word is plenty.

If time was the problem, the call is only 15 minutes and I keep slots open most days, weekends included. Pick one here: {{booking_url}}

Sam

You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? Unsubscribe: {{unsubscribe_url}}
Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801', '', '', '',
  '{{first_name}}, did you find an agency yet?', '<p>Hey {{first_name}},</p>
<p>It''s Sam again from Galaxy Financial (formerly Apex Financial). Did you end up finding an agency, or are you still looking? Just hit reply, one word is plenty.</p>
<p>If time was the problem, the call is only 15 minutes and I keep slots open most days, weekends included. <a href="{{booking_url}}">Pick one here</a>.</p>
<p>Sam</p>
<p style="font-size:12px;color:#888888">You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? <a href="{{unsubscribe_url}}">Unsubscribe here</a>.<br>Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801</p>', false, '', '',
  'BoB reactivation v2 copy (MP-BOB-CONVERSION). Sent ONLY by reactivation-send; candidate_message_template holds the plain-text body. reminder_cadence=manual and no next_step_progress row ever points here, so no sweep can fire it. retired_at hides it from the recruiting worklist; reactivation-send reads it by stage_key regardless.',
  now())
on conflict (stage_key) do update set
  email_subject_template = excluded.email_subject_template,
  email_body_template = excluded.email_body_template,
  candidate_message_template = excluded.candidate_message_template,
  display_name = excluded.display_name,
  notes = excluded.notes,
  retired_at = coalesce(public.next_step_stages.retired_at, excluded.retired_at);

insert into public.next_step_stages (stage_key, order_index, display_name, audience, owner_role,
  next_action_label, next_action_url, reminder_cadence, stall_action, dashboard_section, color_hex, icon_name,
  candidate_message_template, manager_alert_template, telegram_template, sms_template,
  email_subject_template, email_body_template, is_terminal, success_event, failure_label, notes, retired_at)
values ('reactivation_v2_licensed_t2_b', 127, 'Reactivation v2: licensed touch 2 (B)', 'applicant', 'system',
  'Reply or book a call', null, 'manual', 'flag', 'campaign', '#eab308', 'arrow-path',
  'Hey {{first_name}},

It''s Sam again from Galaxy Financial (formerly Apex Financial). Did you end up finding an agency, or are you still looking? Just hit reply, one word is plenty.

If time was the problem, the call is only 15 minutes and I keep slots open most days, weekends included. Pick one here: {{booking_url}}

Sam

You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? Unsubscribe: {{unsubscribe_url}}
Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801', '', '', '',
  'Still looking, or all set?', '<p>Hey {{first_name}},</p>
<p>It''s Sam again from Galaxy Financial (formerly Apex Financial). Did you end up finding an agency, or are you still looking? Just hit reply, one word is plenty.</p>
<p>If time was the problem, the call is only 15 minutes and I keep slots open most days, weekends included. <a href="{{booking_url}}">Pick one here</a>.</p>
<p>Sam</p>
<p style="font-size:12px;color:#888888">You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? <a href="{{unsubscribe_url}}">Unsubscribe here</a>.<br>Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801</p>', false, '', '',
  'BoB reactivation v2 copy (MP-BOB-CONVERSION). Sent ONLY by reactivation-send; candidate_message_template holds the plain-text body. reminder_cadence=manual and no next_step_progress row ever points here, so no sweep can fire it. retired_at hides it from the recruiting worklist; reactivation-send reads it by stage_key regardless.',
  now())
on conflict (stage_key) do update set
  email_subject_template = excluded.email_subject_template,
  email_body_template = excluded.email_body_template,
  candidate_message_template = excluded.candidate_message_template,
  display_name = excluded.display_name,
  notes = excluded.notes,
  retired_at = coalesce(public.next_step_stages.retired_at, excluded.retired_at);

insert into public.next_step_stages (stage_key, order_index, display_name, audience, owner_role,
  next_action_label, next_action_url, reminder_cadence, stall_action, dashboard_section, color_hex, icon_name,
  candidate_message_template, manager_alert_template, telegram_template, sms_template,
  email_subject_template, email_body_template, is_terminal, success_event, failure_label, notes, retired_at)
values ('reactivation_v2_licensed_t3_a', 128, 'Reactivation v2: licensed touch 3 (A)', 'applicant', 'system',
  'Reply or book a call', null, 'manual', 'flag', 'campaign', '#eab308', 'arrow-path',
  'Hey {{first_name}},

I haven''t heard back, so this is my last email about your application with Galaxy Financial (formerly Apex Financial).

If you still want to talk, just reply "yes". Or grab 15 minutes with me here: {{booking_url}}
Either way, thanks for applying.

Sam

You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? Unsubscribe: {{unsubscribe_url}}
Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801', '', '', '',
  '{{first_name}}, last note from me', '<p>Hey {{first_name}},</p>
<p>I haven''t heard back, so this is my last email about your application with Galaxy Financial (formerly Apex Financial).</p>
<p>If you still want to talk, just reply "yes". Or <a href="{{booking_url}}">grab 15 minutes with me here</a>. Either way, thanks for applying.</p>
<p>Sam</p>
<p style="font-size:12px;color:#888888">You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? <a href="{{unsubscribe_url}}">Unsubscribe here</a>.<br>Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801</p>', false, '', '',
  'BoB reactivation v2 copy (MP-BOB-CONVERSION). Sent ONLY by reactivation-send; candidate_message_template holds the plain-text body. reminder_cadence=manual and no next_step_progress row ever points here, so no sweep can fire it. retired_at hides it from the recruiting worklist; reactivation-send reads it by stage_key regardless.',
  now())
on conflict (stage_key) do update set
  email_subject_template = excluded.email_subject_template,
  email_body_template = excluded.email_body_template,
  candidate_message_template = excluded.candidate_message_template,
  display_name = excluded.display_name,
  notes = excluded.notes,
  retired_at = coalesce(public.next_step_stages.retired_at, excluded.retired_at);

insert into public.next_step_stages (stage_key, order_index, display_name, audience, owner_role,
  next_action_label, next_action_url, reminder_cadence, stall_action, dashboard_section, color_hex, icon_name,
  candidate_message_template, manager_alert_template, telegram_template, sms_template,
  email_subject_template, email_body_template, is_terminal, success_event, failure_label, notes, retired_at)
values ('reactivation_v2_licensed_t3_b', 129, 'Reactivation v2: licensed touch 3 (B)', 'applicant', 'system',
  'Reply or book a call', null, 'manual', 'flag', 'campaign', '#eab308', 'arrow-path',
  'Hey {{first_name}},

I haven''t heard back, so this is my last email about your application with Galaxy Financial (formerly Apex Financial).

If you still want to talk, just reply "yes". Or grab 15 minutes with me here: {{booking_url}}
Either way, thanks for applying.

Sam

You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? Unsubscribe: {{unsubscribe_url}}
Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801', '', '', '',
  'Closing the loop on your application', '<p>Hey {{first_name}},</p>
<p>I haven''t heard back, so this is my last email about your application with Galaxy Financial (formerly Apex Financial).</p>
<p>If you still want to talk, just reply "yes". Or <a href="{{booking_url}}">grab 15 minutes with me here</a>. Either way, thanks for applying.</p>
<p>Sam</p>
<p style="font-size:12px;color:#888888">You''re getting this because you applied with Galaxy Financial (formerly Apex Financial). Not interested anymore? <a href="{{unsubscribe_url}}">Unsubscribe here</a>.<br>Galaxy Financial, a brand of Apex Financial Empire LLC, 30 North Gould Street, Sheridan, WY 82801</p>', false, '', '',
  'BoB reactivation v2 copy (MP-BOB-CONVERSION). Sent ONLY by reactivation-send; candidate_message_template holds the plain-text body. reminder_cadence=manual and no next_step_progress row ever points here, so no sweep can fire it. retired_at hides it from the recruiting worklist; reactivation-send reads it by stage_key regardless.',
  now())
on conflict (stage_key) do update set
  email_subject_template = excluded.email_subject_template,
  email_body_template = excluded.email_body_template,
  candidate_message_template = excluded.candidate_message_template,
  display_name = excluded.display_name,
  notes = excluded.notes,
  retired_at = coalesce(public.next_step_stages.retired_at, excluded.retired_at);

-- 16. The driver. Every 5 minutes; returns at once when paused or nothing is due (no HTTP) ---------------
select cron.schedule('reactivation-send-tick', '*/5 * * * *', $cron$select public.fn_reactivation_dispatch()$cron$);

-- 17. Lock it down (R-M9: PUBLIC holds a default EXECUTE grant; revoke from it, not just anon) -----------
revoke all on function public.fn_reactivation_track(uuid)                  from public, anon, authenticated;
revoke all on function public.fn_reactivation_variant(uuid)                from public, anon, authenticated;
revoke all on function public.fn_reactivation_in_window(text, timestamptz) from public, anon, authenticated;
revoke all on function public.fn_reactivation_gate(uuid, timestamptz)      from public, anon, authenticated;
revoke all on function public.fn_reactivation_claim_next()                 from public, anon, authenticated;
revoke all on function public.fn_reactivation_hold_stale_claims()          from public, anon, authenticated;
revoke all on function public.fn_reactivation_dispatch()                   from public, anon, authenticated;
revoke all on function public.fn_reactivation_on_receipt()                 from public, anon, authenticated;
revoke all on function public.fn_reactivation_stop(text, text, boolean)    from public, anon, authenticated;
grant execute on function public.fn_reactivation_track(uuid), public.fn_reactivation_variant(uuid),
  public.fn_reactivation_in_window(text, timestamptz), public.fn_reactivation_gate(uuid, timestamptz),
  public.fn_reactivation_claim_next(), public.fn_reactivation_hold_stale_claims(), public.fn_reactivation_dispatch(),
  public.fn_reactivation_stop(text, text, boolean) to service_role;
revoke all on public.v_reactivation_health, public.v_reactivation_funnel, public.v_reactivation_outcomes from public, anon, authenticated;
grant select on public.v_reactivation_health, public.v_reactivation_funnel, public.v_reactivation_outcomes to service_role;

commit;
