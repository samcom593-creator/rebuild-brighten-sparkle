-- WP6 (2026-11-10 onboarding audit): new-hire portal and first two weeks.
--
-- Applied live by WP6, then recorded in supabase_migrations.schema_migrations
-- (version 20261111100500). Idempotent: create or replace / if not exists /
-- on conflict do nothing throughout, so a re-run is harmless.
--
-- What this ships
--   1. my_activation_state(): one own-row read of the facts the first-login
--      guide needs (profile, training, licence, contracting, onboarding call,
--      first deal). Agents can't read agent_onboarding_queue or interview_events
--      under RLS, which is why the guide could never show the onboarding call.
--   2. Onboarding-call reminders d2/d5/d10. The first booking email was one-shot
--      by construction (2 of 20 licensed hires since 09-10 booked). Reminders are
--      FORWARD-ONLY: only hires created at or after system_settings
--      onboarding_wp6_cutoff_at (stamped once, at first apply) are eligible, so no
--      existing hire gets a backlog send. Max 3 per hire is a DB constraint, not a
--      code promise: one queue kind per step under UNIQUE(agent_id, email_kind).
--      (A single 'onboarding_call_reminder' kind with meta.step would need that
--      unique index changed, and it is the ON CONFLICT arbiter for 6+ writers.)
--      The sender re-checks booking, licence, cutoff and the 30-day window at
--      send time, so a booking stops the sequence immediately.
--   3. Tenure guards: fn_enqueue_onboarding_call_booking refuses agents whose
--      tenure anchor (greatest(created_at, licensed_at)) is older than 30 days, and
--      fn_enqueue_hired_licensed_onboarding skips a pure "moved to live" event for
--      the same veterans. 6 of the 10 current producers have no onboarding_call
--      row, so any automated stage move to 'live' would have emailed them an
--      onboarding invite (ACTIVATION-7 verifier).
--   4. claim_onboarding_queue_batch(int): FOR UPDATE SKIP LOCKED + a 10-minute
--      lease in meta.claimed_at, so two overlapping drains get disjoint rows.
--   5. Crons 53/54 (apex-agent-onboarding-emails-cdt/-cst) unscheduled: they POST
--      the same sender as hourly job 111, and fn_next_onboarding_window() returns
--      now(), so they added nothing but overlap. Job 111 stays.
--   6. fn_enqueue_unlicensed_activation stops queueing the legacy 'discord'-kind
--      Slack email. (The sender also skips that kind when the outbox Slack invite
--      already exists; see send-agent-onboarding-email.)
--   7. magic_login_tokens send receipts (send_status / send_message_id / sent_at),
--      v_newhire_needs_portal_login counting only real sends, a 45-day window for
--      hires after the cutoff (30 days for everyone else, unchanged), a cap of 6
--      sends, and a failure backoff. Legacy tokens (send_status null, written by
--      the 13 other minting paths too) count as sent, so this deploy cannot itself
--      trigger a re-send to anyone mailed in the last 72h.
--   8. Staged lists for a human (first names only, admin/manager gated):
--      v_newhire_never_signed_in_staged and v_scripts_packet_staged. Nothing here
--      sends; approving a scripts-packet row means calling
--      public.fn_enqueue_scripts_packet(agent_id) for it.
--   9. v_newhire_portal_health: one-row guard view for apex-doctor drop-in #47.
--
-- PREIMAGE (also in public.ops_preimage_snapshots id=7, taken 2026-11-10 21:07Z):
--
--   cron 53 apex-agent-onboarding-emails-cdt  schedule '0 15 * * *'  active
--   cron 54 apex-agent-onboarding-emails-cst  schedule '0 16 * * *'  active
--   both commands, verbatim:
--     SELECT net.http_post(
--       url := 'https://xrzweoneiieddzxogewk.supabase.co/functions/v1/send-agent-onboarding-email',
--       headers := jsonb_build_object(
--         'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='apex_bot_token' LIMIT 1),
--         'Content-Type', 'application/json'
--       ),
--       body := '{}'::jsonb,
--       timeout_milliseconds := 30000
--     );
--   To restore: select cron.schedule('apex-agent-onboarding-emails-cdt', '0 15 * * *', $$<command>$$);
--   (job 111 apex-agent-onboarding-emails-hourly '7 * * * *' is kept and unchanged)
--
--   agent_onboarding_queue_email_kind_check was:
--     CHECK ((email_kind = ANY (ARRAY['course','discord','hired_whatsapp','onboarding_call','get_licensed','scripts_packet'])))
--
--   fn_enqueue_unlicensed_activation was:
--     if new.status = 'active' and (old.status is distinct from 'active') and new.license_status <> 'licensed'
--        and coalesce(new.is_deactivated,false) = false and coalesce(new.is_inactive,false) = false then
--       insert into public.agent_onboarding_queue (agent_id, email_kind, target_send_at)
--       values (new.id, 'get_licensed', public.fn_next_onboarding_window()), (new.id, 'discord', public.fn_next_onboarding_window())
--       on conflict (agent_id, email_kind) do nothing;
--     end if;
--
--   fn_enqueue_onboarding_call_booking, fn_enqueue_hired_licensed_onboarding and
--   fn_sweep_onboarding_call_gaps were identical to the bodies below minus the
--   blocks marked "WP6"; full text is in ops_preimage_snapshots id=7.
--
--   v_newhire_needs_portal_login was the same select with
--     a.created_at > now() - '30 days' and
--     NOT EXISTS (magic_login_tokens t where t.agent_id = a.id and t.destination = 'portal'
--                 and t.created_at > now() - '72:00:00')
--   i.e. any minted token (sent or not) suppressed the next send for 72h.

-- ---------------------------------------------------------------------------
-- 0. Forward-only cutoff. Stamped once; a re-apply never moves it.
-- ---------------------------------------------------------------------------
insert into public.system_settings (key, value)
values ('onboarding_wp6_cutoff_at', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'))
on conflict (key) do nothing;

create or replace function public.fn_onboarding_wp6_cutoff()
returns timestamptz
language sql
stable
security definer
set search_path to 'public'
as $function$
  -- 'infinity' when unset: nothing is eligible rather than everything.
  select coalesce(
    (select nullif(btrim(value), '')::timestamptz from public.system_settings where key = 'onboarding_wp6_cutoff_at'),
    'infinity'::timestamptz);
$function$;

revoke all on function public.fn_onboarding_wp6_cutoff() from public, anon;
grant execute on function public.fn_onboarding_wp6_cutoff() to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 1. Queue kinds: one per reminder step, so UNIQUE(agent_id, email_kind) caps it at 3.
-- ---------------------------------------------------------------------------
alter table public.agent_onboarding_queue drop constraint if exists agent_onboarding_queue_email_kind_check;
alter table public.agent_onboarding_queue add constraint agent_onboarding_queue_email_kind_check
  check (email_kind = any (array[
    'course', 'discord', 'hired_whatsapp', 'onboarding_call', 'get_licensed', 'scripts_packet',
    'onboarding_call_reminder_d2', 'onboarding_call_reminder_d5', 'onboarding_call_reminder_d10'
  ]::text[]));

-- ---------------------------------------------------------------------------
-- 2. Magic-link send receipts.
-- ---------------------------------------------------------------------------
alter table public.magic_login_tokens add column if not exists send_status text;
alter table public.magic_login_tokens add column if not exists send_message_id text;
alter table public.magic_login_tokens add column if not exists sent_at timestamptz;
alter table public.magic_login_tokens drop constraint if exists magic_login_tokens_send_status_check;
alter table public.magic_login_tokens add constraint magic_login_tokens_send_status_check
  check (send_status is null or send_status in ('pending', 'sent', 'failed', 'refused'));
comment on column public.magic_login_tokens.send_status is
  'WP6: set by cron-newhire-portal-login only. pending = minted, send not yet resolved; sent = provider returned a message id (send_message_id); failed = provider error; refused = suppressed or non-routable recipient, never attempted. NULL = minted by another path that records no receipt.';

create index if not exists magic_login_tokens_agent_dest_created_idx
  on public.magic_login_tokens (agent_id, destination, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. Tenure guard on the onboarding-call enqueue (live definition + WP6 block).
-- ---------------------------------------------------------------------------
create or replace function public.fn_enqueue_onboarding_call_booking(p_agent_id uuid, p_source text default 'trigger'::text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
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
         coalesce(a.is_inactive, false) as is_inactive,
         greatest(a.created_at, coalesce(a.licensed_at, a.created_at)) as tenure_anchor
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

  -- WP6: veterans never get the new-hire invite. The anchor is the later of
  -- hire and licence, so a hire licensed today still qualifies while a stage
  -- move on a months-old producer does not.
  if v_agent.tenure_anchor is null or v_agent.tenure_anchor < now() - interval '30 days' then
    return jsonb_build_object('enqueued', false, 'reason', 'tenure_over_30d', 'agent_id', p_agent_id,
                              'tenure_anchor', v_agent.tenure_anchor);
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
end $function$;

-- ---------------------------------------------------------------------------
-- 4. Tenure guard on the 'live' branch of the hire trigger (live definition + WP6 block).
-- ---------------------------------------------------------------------------
create or replace function public.fn_enqueue_hired_licensed_onboarding()
returns trigger
language plpgsql
security definer
as $function$
declare
  should_fire boolean;
  v_licensed boolean;
  v_live_move boolean := false;
  v_other_reason boolean := false;
begin
  -- MP-353 employment gate: a hire event is "employed", never merely a status
  -- change. A licence backfill on an ex-agent is not an onboarding trigger.
  if coalesce(new.status::text, '') <> 'active'
     or coalesce(new.is_deactivated, false)
     or coalesce(new.is_inactive, false) then
    return new;
  end if;

  v_licensed := (new.license_status::text = 'licensed');

  if tg_op = 'INSERT' then
    should_fire := (new.onboarding_stage = 'live') or (new.status = 'active');
  else
    v_live_move := (old.onboarding_stage is distinct from new.onboarding_stage and new.onboarding_stage = 'live');
    v_other_reason := (
         (old.status is distinct from new.status and new.status = 'active' and coalesce(old.status::text, '') not in ('active', 'live'))
      or (old.license_status is distinct from new.license_status)
    );
    should_fire := v_live_move or v_other_reason;
  end if;

  if not should_fire then
    return new;
  end if;

  -- WP6: a move to 'live' on its own is a stage label, not a hire. For anyone
  -- whose hire/licence is older than 30 days it must not enqueue new-hire mail
  -- (protects any automated or bulk stage advance from emailing veterans).
  if tg_op = 'UPDATE' and v_live_move and not v_other_reason
     and greatest(new.created_at, coalesce(new.licensed_at, new.created_at)) < now() - interval '30 days' then
    return new;
  end if;

  if v_licensed then
    -- Licensed: sales course, community, and the onboarding call.
    if pg_trigger_depth() = 1 and coalesce(new.has_training_course, false) = false then
      update public.agents set has_training_course = true, updated_at = now()
       where id = new.id and coalesce(has_training_course, false) = false;
    end if;

    insert into public.agent_onboarding_queue (agent_id, email_kind, target_send_at)
    values (new.id, 'course', now()), (new.id, 'discord', now())
    on conflict (agent_id, email_kind) do nothing;

    begin
      perform public.fn_enqueue_onboarding_call_booking(new.id, 'trigger:' || tg_op);
    exception when others then
      raise warning 'fn_enqueue_onboarding_call_booking failed for agent %: %', new.id, sqlerrm;
    end;
  else
    -- MP-357 unlicensed: the licensing path and the team room. Explicitly NOT
    -- 'course' — the APEX sales course is not what gets someone licensed, and
    -- sending it is how a pre-licence hire ends up in the wrong material.
    insert into public.agent_onboarding_queue (agent_id, email_kind, target_send_at)
    values (new.id, 'get_licensed', now()), (new.id, 'discord', now())
    on conflict (agent_id, email_kind) do nothing;
  end if;

  return new;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. Unlicensed activation: no more legacy 'discord'-kind Slack email from here.
--    The outbox recruiting.slack_invite_requested path re-checks eligibility at
--    send time. (Other enqueuers still create the row for hires the outbox never
--    sees; the sender skips it when the outbox invite exists.)
-- ---------------------------------------------------------------------------
create or replace function public.fn_enqueue_unlicensed_activation()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
begin
  if new.status = 'active' and (old.status is distinct from 'active') and new.license_status <> 'licensed'
     and coalesce(new.is_deactivated,false) = false and coalesce(new.is_inactive,false) = false then
    insert into public.agent_onboarding_queue (agent_id, email_kind, target_send_at)
    values (new.id, 'get_licensed', public.fn_next_onboarding_window())
    on conflict (agent_id, email_kind) do nothing;
  end if;
  return new;
end $function$;

-- ---------------------------------------------------------------------------
-- 6. Gap sweep: unchanged first-email safety net + forward-only reminders.
-- ---------------------------------------------------------------------------
create or replace function public.fn_sweep_onboarding_call_gaps()
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_n int := 0;
  r record;
  v_cutoff timestamptz := public.fn_onboarding_wp6_cutoff();
  v_kind text;
  v_step text;
  v_qid uuid;
begin
  -- Safety net for "once hired -> onboarding meeting auto-scheduled": the
  -- on-hire trigger can miss agents inserted while agents triggers are
  -- suspended (bulk status corrections). Sweep RECENT (30d) licensed+active
  -- hires that have no onboarding call booked or queued and enqueue one.
  -- Idempotent (fn_enqueue_onboarding_call_booking guards on existing call);
  -- scoped to recent hires so established veterans never get a belated invite.
  for r in
    select a.id from public.agents a
    where a.license_status = 'licensed' and a.status = 'active'
      and coalesce(a.is_deactivated,false)=false and coalesce(a.is_inactive,false)=false
      and not public.fn_agent_is_roster_excluded(a.id)
      and a.created_at > now() - interval '30 days'
      and public.fn_agent_onboarding_call_booking(a.id) is null
      and not exists (select 1 from public.agent_onboarding_queue q where q.agent_id=a.id and q.email_kind='onboarding_call')
  loop
    if (public.fn_enqueue_onboarding_call_booking(r.id,'sweep')->>'enqueued')::boolean then v_n := v_n + 1; end if;
  end loop;

  -- WP6 reminders d2/d5/d10. Eligible only when ALL hold:
  --   hired at/after the WP6 cutoff (forward-only) and within 30 days;
  --   licensed, active, canonical row, not a manager account, not roster-excluded;
  --   the first onboarding_call email was actually sent (sent_at = provider id);
  --   no onboarding booking exists;
  --   nothing from the onboarding_call* family is still pending;
  --   the last onboarding_call* send was at least 48h ago.
  -- One row per step under UNIQUE(agent_id, email_kind), so at most 3 ever.
  for r in
    select a.id, a.created_at
      from public.agents a
     where a.license_status = 'licensed' and a.status = 'active'
       and coalesce(a.is_deactivated, false) = false and coalesce(a.is_inactive, false) = false
       and a.canonical_agent_id is null
       and coalesce(a.account_mode, '') <> 'manager'
       and a.created_at >= v_cutoff
       and a.created_at > now() - interval '30 days'
       and not public.fn_agent_is_roster_excluded(a.id)
       and exists (select 1 from public.agent_onboarding_queue q
                    where q.agent_id = a.id and q.email_kind = 'onboarding_call' and q.sent_at is not null)
       and not exists (select 1 from public.agent_onboarding_queue q
                        where q.agent_id = a.id
                          and q.email_kind in ('onboarding_call', 'onboarding_call_reminder_d2', 'onboarding_call_reminder_d5', 'onboarding_call_reminder_d10')
                          and q.sent_at is null and q.attempt_count < 5)
       and not exists (select 1 from public.agent_onboarding_queue q
                        where q.agent_id = a.id
                          and q.email_kind in ('onboarding_call', 'onboarding_call_reminder_d2', 'onboarding_call_reminder_d5', 'onboarding_call_reminder_d10')
                          and q.sent_at > now() - interval '48 hours')
       and public.fn_agent_onboarding_call_booking(a.id) is null
  loop
    v_kind := null;
    select s.kind, s.step into v_kind, v_step
      from (values (1, 'onboarding_call_reminder_d2', 'd2', 2),
                   (2, 'onboarding_call_reminder_d5', 'd5', 5),
                   (3, 'onboarding_call_reminder_d10', 'd10', 10)) as s(ord, kind, step, day_n)
     where r.created_at + make_interval(days => s.day_n) <= now()
       and not exists (select 1 from public.agent_onboarding_queue q where q.agent_id = r.id and q.email_kind = s.kind)
     order by s.ord
     limit 1;
    if v_kind is null then continue; end if;

    v_qid := null;
    insert into public.agent_onboarding_queue (agent_id, email_kind, target_send_at, meta)
    values (r.id, v_kind, now(), jsonb_build_object('step', v_step, 'source', 'sweep', 'enqueued_at', now(), 'cutoff', v_cutoff))
    on conflict (agent_id, email_kind) do nothing
    returning id into v_qid;
    if v_qid is not null then v_n := v_n + 1; end if;
  end loop;

  return v_n;
end $function$;

-- ---------------------------------------------------------------------------
-- 7. Atomic claim for the hourly drain.
-- ---------------------------------------------------------------------------
create or replace function public.claim_onboarding_queue_batch(p_limit integer default 50)
returns setof public.agent_onboarding_queue
language sql
volatile
security definer
set search_path to 'public'
as $function$
  -- Rows locked by a concurrent claimer are skipped (SKIP LOCKED); rows a
  -- caller claimed in the last 10 minutes are leased to it (meta.claimed_at),
  -- so an overlapping invocation after the first commits also gets disjoint rows.
  update public.agent_onboarding_queue q
     set meta = coalesce(q.meta, '{}'::jsonb) || jsonb_build_object('claimed_at', now())
   where q.id in (
     select c.id
       from public.agent_onboarding_queue c
      where c.sent_at is null
        and c.attempt_count < 5
        and c.target_send_at <= now()
        and coalesce((c.meta->>'claimed_at')::timestamptz, '-infinity'::timestamptz) < now() - interval '10 minutes'
      order by c.target_send_at
      limit greatest(1, least(coalesce(p_limit, 50), 200))
      for update skip locked)
  returning q.*;
$function$;

revoke all on function public.claim_onboarding_queue_batch(integer) from public, anon, authenticated;
grant execute on function public.claim_onboarding_queue_batch(integer) to service_role;

-- ---------------------------------------------------------------------------
-- 8. my_activation_state(): the caller's own agent row only.
-- ---------------------------------------------------------------------------
create or replace function public.my_activation_state(p_agent_id uuid default null)
returns table (
  agent_id uuid,
  first_name text,
  onboarding_stage text,
  license_status text,
  hired_at timestamptz,
  profile_complete boolean,
  has_phone boolean,
  training_started boolean,
  required_training_complete boolean,
  required_passed integer,
  required_total integer,
  contracting_done boolean,
  contracting_basis text,
  contracting_profile_submitted boolean,
  onboarding_call_booked boolean,
  onboarding_call_at timestamptz,
  onboarding_booking_url text,
  first_deal_at timestamptz,
  manual_overrides jsonb
)
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
#variable_conflict use_column
declare
  v_uid uuid := auth.uid();
  v_id uuid;
  v_n int;
  a record;
  v_profile_complete boolean := false;
  v_has_phone boolean := false;
  v_full_name text;
  v_contract_profile boolean := false;
  v_training_started boolean := false;
  v_req_complete boolean := false;
  v_req_passed int := 0;
  v_req_total int := 0;
  v_marks int := 0;
  v_basis text;
  v_booking uuid;
  v_booking_at timestamptz;
  v_single text;
  v_had_cancel boolean := false;
  v_url text;
  v_over jsonb := '{}'::jsonb;
begin
  -- No session, no rows. Agents read only their own row: an explicit id must
  -- belong to the caller; no id resolves the caller's single live row and
  -- returns nothing when two live rows share the login (never pick one).
  if v_uid is null then return; end if;
  if p_agent_id is not null then
    select ag.id into v_id from public.agents ag where ag.id = p_agent_id and ag.user_id = v_uid;
  else
    select count(*) into v_n from public.agents ag where ag.user_id = v_uid and ag.canonical_agent_id is null;
    if v_n = 1 then
      select ag.id into v_id from public.agents ag where ag.user_id = v_uid and ag.canonical_agent_id is null;
    end if;
  end if;
  if v_id is null then return; end if;

  select ag.* into a from public.agents ag where ag.id = v_id;

  select coalesce(bool_or(nullif(btrim(p.full_name), '') is not null and nullif(btrim(p.phone), '') is not null), false),
         coalesce(bool_or(nullif(btrim(p.phone), '') is not null), false),
         max(nullif(btrim(p.full_name), ''))
    into v_profile_complete, v_has_phone, v_full_name
    from public.profiles p
   where (a.user_id is not null and p.user_id = a.user_id) or (a.profile_id is not null and p.id = a.profile_id);

  v_contract_profile := exists (select 1 from public.agent_contract_profile cp where cp.agent_id = v_id);
  v_training_started := exists (select 1 from public.onboarding_progress op where op.agent_id = v_id);
  select coalesce(t.required_complete, false), coalesce(t.required_passed, 0), coalesce(t.required_total, 0)
    into v_req_complete, v_req_passed, v_req_total
    from public.v_training_required_completion t where t.agent_id = v_id;

  -- Contracting. Until Sam names the required carriers (audit N7) any staff
  -- confirmation counts; the agent's own checkboxes are returned separately
  -- as manual overrides, never as fact.
  select count(*) into v_marks from public.contract_review_marks m where m.agent_id = v_id;
  v_basis := case
    when v_marks > 0 then 'contract_review_marks'
    when a.contracted_at is not null then 'agents.contracted_at'
    when a.first_deal_at is not null then 'first_deal'
    else null end;

  v_booking := public.fn_agent_onboarding_call_booking(v_id);
  if v_booking is not null then
    select ie.scheduled_at into v_booking_at from public.interview_events ie where ie.id = v_booking;
  end if;

  -- The single-use link from the latest delivered onboarding email, unless a
  -- booking was cancelled (that link is spent); else the public scheduling URL.
  select q.meta->>'booking_url' into v_single
    from public.agent_onboarding_queue q
   where q.agent_id = v_id
     and q.email_kind in ('onboarding_call', 'onboarding_call_reminder_d2', 'onboarding_call_reminder_d5', 'onboarding_call_reminder_d10')
     and q.sent_at is not null
     and coalesce(q.meta->>'booking_url', '') like 'https://%'
   order by q.sent_at desc
   limit 1;
  v_had_cancel := exists (
    select 1 from public.interview_events ie
     where ie.call_track = 'onboarding' and ie.canceled_at is not null
       and (ie.agent_id = v_id or (a.source_application_id is not null and ie.application_id = a.source_application_id)));
  v_url := case when v_single is not null and not v_had_cancel then v_single
                else (select nullif(btrim(s.value), '') from public.system_settings s where s.key = 'onboarding_call_scheduling_url') end;

  select coalesce(jsonb_build_object(
           'completed_profile', g.completed_profile,
           'added_phone_number', g.added_phone_number,
           'completed_first_training', g.completed_first_training,
           'received_license', g.received_license,
           'closed_first_deal', g.closed_first_deal,
           'contracted_with_carriers', g.contracted_with_carriers,
           'contracted_ahl_sent', g.contracted_ahl_sent,
           'contracted_ethos_sent', g.contracted_ethos_sent,
           'contracted_chubb_sent', g.contracted_chubb_sent), '{}'::jsonb)
    into v_over
    from public.getting_started_progress g where g.agent_id = v_id
   limit 1;

  return query select
    v_id,
    coalesce(nullif(split_part(coalesce(v_full_name, a.display_name, ''), ' ', 1), ''), 'there'),
    a.onboarding_stage::text,
    a.license_status::text,
    a.created_at,
    v_profile_complete,
    v_has_phone,
    v_training_started,
    v_req_complete,
    v_req_passed,
    v_req_total,
    (v_basis is not null),
    v_basis,
    v_contract_profile,
    (v_booking is not null),
    v_booking_at,
    v_url,
    a.first_deal_at,
    coalesce(v_over, '{}'::jsonb);
end;
$function$;

revoke all on function public.my_activation_state(uuid) from public, anon;
grant execute on function public.my_activation_state(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 9. Portal-login recipients: receipts, 45-day window (post-cutoff hires), cap 6.
--    Columns 1-7 unchanged (create or replace keeps them); one column appended.
-- ---------------------------------------------------------------------------
create or replace view public.v_newhire_needs_portal_login as
select a.id as agent_id,
       a.created_at as hired_at,
       p.email,
       coalesce(p.full_name, a.display_name, 'Agent'::text) as full_name,
       lower(coalesce(a.license_status::text, ''::text)) as license_status,
       a.invited_by_manager_id as manager_id,
       mp.email as manager_email,
       tk.portal_sends as portal_sends_so_far
  from public.agents a
  join auth.users u on u.id = a.user_id
  join public.profiles p on p.user_id = a.user_id
  left join public.agents ma on ma.id = a.invited_by_manager_id
  left join public.profiles mp on mp.user_id = ma.user_id
  cross join lateral (
    select
      -- legacy tokens (send_status null) count as sent: they were treated as
      -- delivered before receipts existed, and other paths still mint them.
      count(*) filter (where coalesce(t.send_status, 'sent') = 'sent') as portal_sends,
      bool_or(t.created_at > now() - interval '72 hours' and coalesce(t.send_status, 'sent') in ('sent', 'pending')) as recent_send,
      bool_or(t.created_at > now() - interval '24 hours' and t.send_status = 'failed') as recent_failure,
      bool_or(t.created_at > now() - interval '30 days' and t.send_status = 'refused') as recent_refusal
      from public.magic_login_tokens t
     where t.agent_id = a.id and t.destination = 'portal'
  ) tk
 where a.created_at > now() - case when a.created_at >= public.fn_onboarding_wp6_cutoff()
                                   then interval '45 days' else interval '30 days' end
   and a.user_id is not null
   and coalesce(a.is_deactivated, false) = false
   and coalesce(a.status::text, ''::text) <> 'terminated'::text
   and u.last_sign_in_at is null
   and p.email is not null
   and p.email <> ''::text
   and position(('placeholder'::text) in (lower(p.email))) = 0
   and not coalesce(tk.recent_send, false)
   and not coalesce(tk.recent_failure, false)
   and not coalesce(tk.recent_refusal, false)
   and coalesce(tk.portal_sends, 0) < 6;

revoke all on public.v_newhire_needs_portal_login from anon, authenticated;
grant select on public.v_newhire_needs_portal_login to service_role;

-- ---------------------------------------------------------------------------
-- 10. Staged call list: hires past day 7 who have not signed in since hire.
--     First names only. No auto-text: a person calls from this list.
-- ---------------------------------------------------------------------------
create or replace view public.v_newhire_never_signed_in_staged
with (security_barrier = true) as
select a.id as agent_id,
       coalesce(nullif(split_part(btrim(coalesce(pr.full_name, a.display_name, '')), ' ', 1), ''), 'Unknown') as first_name,
       lower(coalesce(a.license_status::text, '')) as license_status,
       a.created_at as hired_at,
       floor(extract(epoch from (now() - a.created_at)) / 86400)::int as days_since_hire,
       case when a.created_at <= now() - interval '14 days' then 'day14' else 'day7' end as checkpoint,
       (u.id is null) as no_login_account,
       coalesce(tk.links_sent, 0) as portal_links_sent,
       coalesce(tk.links_used, 0) as portal_links_used,
       tk.last_link_at,
       tk.last_link_status,
       nullif(split_part(btrim(coalesce(ma.display_name, '')), ' ', 1), '') as manager_first_name
  from public.agents a
  left join auth.users u on u.id = a.user_id
  left join lateral (
    select p.full_name from public.profiles p
     where (a.user_id is not null and p.user_id = a.user_id) or (a.profile_id is not null and p.id = a.profile_id)
     order by (nullif(btrim(p.full_name), '') is not null) desc
     limit 1) pr on true
  left join public.agents ma on ma.id = coalesce(a.invited_by_manager_id, a.manager_id)
  left join lateral (
    select count(*) filter (where coalesce(t.send_status, 'sent') = 'sent') as links_sent,
           count(*) filter (where t.used_at is not null) as links_used,
           max(t.created_at) as last_link_at,
           (array_agg(coalesce(t.send_status, 'unrecorded') order by t.created_at desc))[1] as last_link_status
      from public.magic_login_tokens t
     where t.agent_id = a.id and t.destination = 'portal') tk on true
 where a.status = 'active'
   and coalesce(a.is_deactivated, false) = false
   and coalesce(a.is_inactive, false) = false
   and a.canonical_agent_id is null
   and coalesce(a.account_mode, '') <> 'manager'
   and not public.fn_agent_is_roster_excluded(a.id)
   and not public.fn_agent_is_placeholder(a.id)
   and a.created_at <= now() - interval '7 days'
   and a.created_at > now() - interval '120 days'
   and (u.id is null or u.last_sign_in_at is null or u.last_sign_in_at < a.created_at)
   and ((current_user <> all (array['anon'::name, 'authenticated'::name]))
        or public.api_is_admin_role()
        or public.has_role(auth.uid(), 'manager'::app_role));

revoke all on public.v_newhire_never_signed_in_staged from anon, public;
grant select on public.v_newhire_never_signed_in_staged to authenticated, service_role;
comment on view public.v_newhire_never_signed_in_staged is
  'WP6 staged call list (Sam/Aisha): active hires 7-120 days old who have not signed in since hire. First names only; contact details stay in the admin UI. Nothing sends from this view.';

-- ---------------------------------------------------------------------------
-- 11. Staged scripts-packet backfill: trained, licensed, active, never got it.
--     Same eligibility as fn_enqueue_scripts_packet. On Sam's yes, call
--     public.fn_enqueue_scripts_packet(agent_id) per row (idempotent).
-- ---------------------------------------------------------------------------
create or replace view public.v_scripts_packet_staged
with (security_barrier = true) as
select a.id as agent_id,
       coalesce(nullif(split_part(btrim(coalesce(pr.full_name, a.display_name, '')), ' ', 1), ''), 'Unknown') as first_name,
       a.created_at as hired_at,
       (select max(op.completed_at) from public.onboarding_progress op where op.agent_id = a.id and op.passed) as required_training_completed_at
  from public.agents a
  join public.v_training_required_completion c on c.agent_id = a.id and c.required_complete
  left join public.profiles pr on pr.id = a.profile_id
 where a.status::text = 'active'
   and coalesce(a.is_deactivated, false) = false
   and a.canonical_agent_id is null
   and not public.fn_agent_is_placeholder(a.id)
   and a.license_status::text = 'licensed'
   and nullif(btrim(pr.email), '') is not null
   and not exists (select 1 from public.email_unsubscribes u where lower(u.email) = lower(pr.email))
   and not exists (select 1 from public.agent_onboarding_queue q where q.agent_id = a.id and q.email_kind = 'scripts_packet')
   and ((current_user <> all (array['anon'::name, 'authenticated'::name]))
        or public.api_is_admin_role()
        or public.has_role(auth.uid(), 'manager'::app_role));

revoke all on public.v_scripts_packet_staged from anon, public;
grant select on public.v_scripts_packet_staged to authenticated, service_role;
comment on view public.v_scripts_packet_staged is
  'WP6 staged list: trained licensed agents who never got the scripts packet (completions predate the trigger). Approval = select public.fn_enqueue_scripts_packet(agent_id). Nothing sends from this view.';

-- ---------------------------------------------------------------------------
-- 12. Guard view for apex-doctor drop-in #47. One row in every state: scalar
--     subqueries only, no WHERE on the outer select beyond the role gate.
-- ---------------------------------------------------------------------------
create or replace view public.v_newhire_portal_health
with (security_barrier = true) as
select q.*
  from (
    select
      public.fn_onboarding_wp6_cutoff() as cutoff_at,
      -- Reminder lane (forward-only population)
      (select count(*) from public.agents a
        where a.license_status = 'licensed' and a.status = 'active'
          and coalesce(a.is_deactivated, false) = false and coalesce(a.is_inactive, false) = false
          and a.canonical_agent_id is null and coalesce(a.account_mode, '') <> 'manager'
          and not public.fn_agent_is_roster_excluded(a.id)
          and a.created_at >= public.fn_onboarding_wp6_cutoff()) as licensed_hires_post_cutoff,
      (select count(*) from public.agents a
        where a.license_status = 'licensed' and a.status = 'active'
          and coalesce(a.is_deactivated, false) = false and coalesce(a.is_inactive, false) = false
          and a.canonical_agent_id is null and coalesce(a.account_mode, '') <> 'manager'
          and not public.fn_agent_is_roster_excluded(a.id)
          and a.created_at >= public.fn_onboarding_wp6_cutoff()
          and public.fn_agent_onboarding_call_booking(a.id) is not null) as booked_post_cutoff,
      (select count(*) from public.agents a
        where a.license_status = 'licensed' and a.status = 'active'
          and coalesce(a.is_deactivated, false) = false and coalesce(a.is_inactive, false) = false
          and a.canonical_agent_id is null and coalesce(a.account_mode, '') <> 'manager'
          and not public.fn_agent_is_roster_excluded(a.id)
          and a.created_at >= public.fn_onboarding_wp6_cutoff()
          and a.created_at <= now() - interval '3 days'
          and a.created_at > now() - interval '30 days'
          and public.fn_agent_onboarding_call_booking(a.id) is null
          and not exists (select 1 from public.agent_onboarding_queue q
                           where q.agent_id = a.id
                             and q.email_kind in ('onboarding_call_reminder_d2', 'onboarding_call_reminder_d5', 'onboarding_call_reminder_d10'))) as unbooked_past_d3_no_reminder,
      (select count(*) from public.agent_onboarding_queue q
        where q.email_kind in ('onboarding_call_reminder_d2', 'onboarding_call_reminder_d5', 'onboarding_call_reminder_d10')) as reminder_rows_total,
      (select count(*) from public.agent_onboarding_queue q
        where q.email_kind in ('onboarding_call_reminder_d2', 'onboarding_call_reminder_d5', 'onboarding_call_reminder_d10')
          and q.sent_at is not null) as reminders_sent_total,
      (select count(*) from (
         select q.agent_id from public.agent_onboarding_queue q
          where q.email_kind in ('onboarding_call_reminder_d2', 'onboarding_call_reminder_d5', 'onboarding_call_reminder_d10')
          group by q.agent_id having count(*) > 3) x) as agents_over_reminder_cap,
      (select count(*) from public.agent_onboarding_queue q
         join public.agents a on a.id = q.agent_id
        where q.email_kind in ('onboarding_call_reminder_d2', 'onboarding_call_reminder_d5', 'onboarding_call_reminder_d10')
          and q.sent_at is not null
          and a.created_at < public.fn_onboarding_wp6_cutoff()) as reminders_sent_pre_cutoff,
      (select count(*) from public.agent_onboarding_queue q
         join public.interview_events ie on ie.id = public.fn_agent_onboarding_call_booking(q.agent_id)
        where q.email_kind in ('onboarding_call_reminder_d2', 'onboarding_call_reminder_d5', 'onboarding_call_reminder_d10')
          and q.sent_at is not null
          and q.sent_at > ie.created_at) as reminders_sent_after_booking,
      -- Magic-link lane
      (select count(*) from public.magic_login_tokens t
        where t.send_status = 'pending' and t.created_at < now() - interval '1 hour') as portal_tokens_pending_over_1h,
      (select count(*) from public.magic_login_tokens t
        where t.destination = 'portal' and t.send_status = 'sent' and t.created_at > now() - interval '7 days') as portal_sends_7d,
      (select count(*) from public.magic_login_tokens t
        where t.destination = 'portal' and t.send_status = 'failed' and t.created_at > now() - interval '7 days') as portal_failures_7d,
      (select count(*) from public.magic_login_tokens t
        where t.destination = 'portal' and t.send_status = 'refused' and t.created_at > now() - interval '7 days') as portal_refusals_7d,
      -- Independent count of the staged population, compared to the view itself
      (select count(*) from public.agents a
         left join auth.users u on u.id = a.user_id
        where a.status = 'active' and coalesce(a.is_deactivated, false) = false and coalesce(a.is_inactive, false) = false
          and a.canonical_agent_id is null and coalesce(a.account_mode, '') <> 'manager'
          and not public.fn_agent_is_roster_excluded(a.id) and not public.fn_agent_is_placeholder(a.id)
          and a.created_at <= now() - interval '7 days' and a.created_at > now() - interval '120 days'
          and (u.id is null or u.last_sign_in_at is null or u.last_sign_in_at < a.created_at)) as never_signed_in_past_d7,
      (select count(*) from public.v_newhire_never_signed_in_staged) as staged_never_signed_in,
      (select count(*) from public.v_scripts_packet_staged) as staged_scripts_packet,
      -- Queue hygiene
      (select count(*) from cron.job j where j.jobname like 'apex-agent-onboarding-emails-c%') as legacy_window_crons,
      (select count(*) from cron.job j where j.jobname = 'apex-agent-onboarding-emails-hourly' and j.active) as hourly_drain_active,
      (select count(*) from cron.job j where j.jobname = 'apex-onboarding-call-gap-sweep' and j.active) as gap_sweep_active,
      now() as measured_at
  ) q
 where (current_user <> all (array['anon'::name, 'authenticated'::name])) or public.api_is_admin_role();

revoke all on public.v_newhire_portal_health from anon, public;
grant select on public.v_newhire_portal_health to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 13. Unschedule the redundant timezone-window crons (53/54). Keep job 111.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from cron.job where jobname = 'apex-agent-onboarding-emails-cdt') then
    perform cron.unschedule('apex-agent-onboarding-emails-cdt');
  end if;
  if exists (select 1 from cron.job where jobname = 'apex-agent-onboarding-emails-cst') then
    perform cron.unschedule('apex-agent-onboarding-emails-cst');
  end if;
end $$;
