-- Slack: interview no-show alerts, licensing fan-out to licensing-academy-support,
-- an atomic per-destination delivery lease, carrier name on sales wins, and the
-- introspection RPCs slack-integration-health uses to prove route coverage.
--
-- Live event-type names are kept on purpose. The dispatcher templates, the
-- five live route rules and every trigger are keyed by them and nothing about
-- them is broken; renaming would re-bind routes for zero operator benefit.
--
-- Applied to prod statement-by-statement through bot-sql on 2026-08-25 and
-- recorded in supabase_migrations.schema_migrations; `db push` skips it.

begin;

-- ── 1. Lease interval, single-sourced ───────────────────────────────────────
-- claim_messaging_delivery_receipt() decides when a 'claimed' receipt is stale
-- enough to re-lease; slack_delivery_receipt_stats() reports how many claims
-- are stale. One function feeds both so they can never disagree (the
-- curl --max-time vs fn_agentlink_reap_stuck lesson: two copies of one number
-- drifted into 36 false pages a day).
create or replace function public.messaging_receipt_lease_interval()
returns interval
language sql
immutable
as $fn$ select interval '10 minutes' $fn$;

revoke all on function public.messaging_receipt_lease_interval() from public, anon;
grant execute on function public.messaging_receipt_lease_interval() to authenticated, service_role;

-- ── 2. Atomic per-destination delivery lease ────────────────────────────────
-- The parent outbox event is already claimed FOR UPDATE SKIP LOCKED. This RPC
-- adds a per-(event, destination) lease so an accidental second invocation, or
-- a stale-'processing' re-claim after a worker death, still cannot race
-- chat.postMessage for the same event/channel.
--   returns the row -> caller holds the lease (status 'claimed'), OR the row is
--                      already 'delivered' and the caller must skip the post
--   returns no row  -> another worker holds a fresh lease; skip this destination
create or replace function public.claim_messaging_delivery_receipt(
  p_outbox_event_id uuid,
  p_installation_id uuid,
  p_destination_id uuid,
  p_idempotency_key text,
  p_template_version integer,
  p_correlation_id uuid
)
returns setof public.messaging_delivery_receipts
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_row public.messaging_delivery_receipts%rowtype;
begin
  if auth.role() <> 'service_role' then
    raise exception 'service role required' using errcode = '42501';
  end if;

  insert into public.messaging_delivery_receipts(
    outbox_event_id, installation_id, destination_id, idempotency_key,
    status, template_version, correlation_id
  ) values (
    p_outbox_event_id, p_installation_id, p_destination_id, p_idempotency_key,
    'pending', p_template_version, coalesce(p_correlation_id, gen_random_uuid())
  ) on conflict (outbox_event_id, destination_id) do nothing;

  select * into v_row
  from public.messaging_delivery_receipts
  where outbox_event_id = p_outbox_event_id
    and destination_id = p_destination_id
  for update;

  if v_row.status = 'delivered' then
    return next v_row;
    return;
  end if;

  if v_row.status = 'claimed'
     and v_row.claimed_at >= now() - public.messaging_receipt_lease_interval() then
    return;
  end if;

  update public.messaging_delivery_receipts
  set status = 'claimed',
      attempt_count = attempt_count + 1,
      claimed_at = now(),
      next_attempt_at = null,
      updated_at = now()
  where id = v_row.id
  returning * into v_row;

  return next v_row;
end;
$fn$;

revoke all on function public.claim_messaging_delivery_receipt(uuid, uuid, uuid, text, integer, uuid)
  from public, anon, authenticated;
grant execute on function public.claim_messaging_delivery_receipt(uuid, uuid, uuid, text, integer, uuid)
  to service_role;

comment on function public.claim_messaging_delivery_receipt(uuid, uuid, uuid, text, integer, uuid) is
  'Atomic per-(outbox event, destination) Slack delivery lease. Returns the receipt when the caller may post (claimed) or must skip (delivered); returns nothing while another worker holds a fresh lease.';

-- ── 3. Interview no-show -> Slack ───────────────────────────────────────────
-- Fires once per interview_events row: the idempotency key is the row id, so
-- flipping outcome away from no_show and back does not re-alert. The payload
-- carries the candidate's name and the recovery URL only; invitee_email and
-- invitee_phone are deliberately never read.
create or replace function public.fn_queue_interview_noshow_slack()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.outcome is distinct from 'no_show'
     or (tg_op = 'UPDATE' and old.outcome is not distinct from 'no_show') then
    return new;
  end if;

  insert into public.outbox_events(
    aggregate_type, aggregate_id, event_type, destination, payload,
    idempotency_key, correlation_id
  ) values (
    'interview_event', new.id, 'candidate.interview_noshow', 'slack',
    jsonb_strip_nulls(jsonb_build_object(
      'interviewId', new.id,
      'applicationId', new.application_id,
      'candidateName', nullif(btrim(new.invitee_name), ''),
      'urgentFollowup', true,
      'openUrl', 'https://apex-financial.org/dashboard/recruiting/follow-ups'
    )),
    'candidate.interview_noshow:' || new.id::text || ':slack',
    gen_random_uuid()
  ) on conflict (idempotency_key) do nothing;
  return new;
exception when others then
  -- A Slack alert must never roll back a VA's disposition.
  return new;
end;
$fn$;

drop trigger if exists trg_queue_interview_noshow_slack on public.interview_events;
create trigger trg_queue_interview_noshow_slack
  after insert or update of outcome on public.interview_events
  for each row execute function public.fn_queue_interview_noshow_slack();

revoke all on function public.fn_queue_interview_noshow_slack()
  from public, anon, authenticated;

comment on function public.fn_queue_interview_noshow_slack() is
  'Queues one PII-minimized urgent Slack alert the first time an interview is dispositioned no_show.';

-- ── 4. deal.posted names the producer, premium, carrier and product ─────────
-- Same gates as the live definition; only carrierName is added. The
-- policyholder is never read: no client_* column appears in this payload.
create or replace function public.fn_queue_deal_slack()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_agent_name text;
  v_carrier_name text;
begin
  if new.agent_id is null or coalesce(new.status, 'draft') = 'draft' then
    return new;
  end if;

  if tg_op = 'INSERT'
     and not public.is_fresh_deal_close(new.effective_date, new.posted_at, new.created_at) then
    return new;
  end if;

  if tg_op = 'UPDATE'
     and not (new.source = 'apex_native' and old.source is distinct from new.source) then
    return new;
  end if;

  select coalesce(nullif(btrim(p.full_name), ''), nullif(btrim(a.display_name), ''), 'APEX producer')
    into v_agent_name
  from public.agents a
  left join public.profiles p on p.id = a.profile_id or p.user_id = a.user_id
  where a.id = new.agent_id
  order by (p.id = a.profile_id) desc nulls last
  limit 1;

  select nullif(btrim(c.name), '')
    into v_carrier_name
  from public.carriers c
  where c.id = new.carrier_id;

  insert into public.outbox_events(
    aggregate_type,
    aggregate_id,
    event_type,
    destination,
    payload,
    idempotency_key,
    correlation_id
  ) values (
    'deal',
    new.id,
    'deal.posted',
    'slack',
    jsonb_strip_nulls(jsonb_build_object(
      'dealId', new.id,
      'agentId', new.agent_id,
      'agentName', coalesce(v_agent_name, 'APEX producer'),
      'carrierId', new.carrier_id,
      'carrierName', v_carrier_name,
      'productCategory', new.product_sold,
      'annualPremium', coalesce(new.annualized_commissionable_premium, new.annual_premium, 0),
      'openUrl', 'https://apex-financial.org/dashboard'
    )),
    'deal.posted:' || new.id::text || ':slack',
    coalesce(new.correlation_id, gen_random_uuid())
  ) on conflict (idempotency_key) do nothing;
  return new;
exception when others then
  -- A Slack notification must never roll back a canonical deal.
  return new;
end;
$fn$;

-- ── 5. Routes: no-show -> recruiting_growth (p0); licensing milestones also
--       fan out to licensing_support (p2) beside recruiting_growth ──────────
do $block$
declare
  v_installation_id uuid;
  v_destination_id uuid;
  v_route record;
begin
  select id into v_installation_id
  from public.messaging_workspace_installations
  where provider = 'slack' and environment = 'production' and status = 'active'
  order by installed_at desc nulls last, created_at desc
  limit 1;

  if v_installation_id is null then
    raise exception 'No active production Slack installation; routes not bound';
  end if;

  for v_route in
    select * from (values
      ('candidate.interview_noshow',    'recruiting_growth', 0::smallint),
      ('candidate.licensing_milestone', 'licensing_support', 2::smallint)
    ) as r(event_type, purpose, priority)
  loop
    select id into v_destination_id
    from public.messaging_destinations
    where installation_id = v_installation_id
      and purpose = v_route.purpose
      and scope_type = 'organization'
      and scope_key is null
      and is_enabled;

    if v_destination_id is null then
      raise exception 'Verified Slack destination missing for purpose %', v_route.purpose;
    end if;

    insert into public.messaging_route_rules(
      installation_id, event_type, destination_id, audience_scope,
      priority, batch_policy, is_enabled
    ) values (
      v_installation_id, v_route.event_type, v_destination_id, 'organization',
      v_route.priority, 'instant', true
    ) on conflict (installation_id, event_type, destination_id, audience_scope)
      do update set priority = excluded.priority,
        batch_policy = excluded.batch_policy,
        is_enabled = true;
  end loop;
end;
$block$;

-- ── 6. Introspection for slack-integration-health ───────────────────────────
-- Every public function that inserts an outbox_events row with destination
-- 'slack', with the event_type literal it queues and the trigger (if any) that
-- fires it. Read from pg_proc, never from a hand-kept list, so a trigger added
-- without a route shows up as a gap the week it lands.
create or replace function public.slack_outbox_emitters()
returns table(
  function_name text,
  trigger_name text,
  table_name text,
  trigger_enabled boolean,
  event_type text
)
language plpgsql
stable
security definer
set search_path = public, pg_catalog
as $fn$
begin
  if coalesce(auth.role(), '') <> 'service_role' and not coalesce(public.apex_is_admin(), false) then
    raise exception 'admin or service role required' using errcode = '42501';
  end if;

  return query
  with emitters as (
    select p.oid as fn_oid, p.proname, m[1] as queued_event_type
    from pg_proc p
    cross join lateral regexp_matches(
      p.prosrc,
      '''([a-z_]+\.[a-z_]+)''\s*,\s*''slack''',
      'g'
    ) as m
    where p.pronamespace = 'public'::regnamespace
      and p.prosrc like '%outbox_events%'
  )
  select
    e.proname::text,
    t.tgname::text,
    c.relname::text,
    case when t.oid is null then null else (t.tgenabled <> 'D') end,
    e.queued_event_type::text
  from emitters e
  left join pg_trigger t on t.tgfoid = e.fn_oid and not t.tgisinternal
  left join pg_class c on c.oid = t.tgrelid
  order by 1, 2;
end;
$fn$;

-- One JSON object in every state, including an empty receipts table. Scalar
-- subqueries only: a view that filters then groups returns zero rows when
-- nothing has happened, and zero rows reads as green on every surface.
create or replace function public.slack_delivery_receipt_stats(
  p_window interval default interval '24 hours'
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_lease interval := public.messaging_receipt_lease_interval();
  v_since timestamptz := now() - coalesce(p_window, interval '24 hours');
begin
  if coalesce(auth.role(), '') <> 'service_role' and not coalesce(public.apex_is_admin(), false) then
    raise exception 'admin or service role required' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'window_hours', round((extract(epoch from coalesce(p_window, interval '24 hours')) / 3600.0)::numeric, 2),
    'lease_stale_after_seconds', extract(epoch from v_lease)::integer,
    'receipts', jsonb_build_object(
      'delivered',      (select count(*) from public.messaging_delivery_receipts where status = 'delivered' and delivered_at >= v_since),
      'retrying',       (select count(*) from public.messaging_delivery_receipts where status = 'retrying' and updated_at >= v_since),
      'dead_letter',    (select count(*) from public.messaging_delivery_receipts where status = 'dead_letter' and updated_at >= v_since),
      'suppressed',     (select count(*) from public.messaging_delivery_receipts where status = 'suppressed' and updated_at >= v_since),
      'pending',        (select count(*) from public.messaging_delivery_receipts where status = 'pending'),
      'claimed_active', (select count(*) from public.messaging_delivery_receipts where status = 'claimed' and claimed_at >= now() - v_lease),
      'claimed_stale',  (select count(*) from public.messaging_delivery_receipts where status = 'claimed' and (claimed_at is null or claimed_at < now() - v_lease)),
      'total_all_time', (select count(*) from public.messaging_delivery_receipts),
      'last_delivered_at', (select max(delivered_at) from public.messaging_delivery_receipts where status = 'delivered'),
      'last_error_redacted', (
        select r.last_error_redacted from public.messaging_delivery_receipts r
        where r.last_error_redacted is not null order by r.updated_at desc limit 1
      ),
      'last_error_at', (
        select r.updated_at from public.messaging_delivery_receipts r
        where r.last_error_redacted is not null order by r.updated_at desc limit 1
      )
    ),
    'outbox_slack', jsonb_build_object(
      'pending',                (select count(*) from public.outbox_events where destination = 'slack' and status = 'pending'),
      'processing',             (select count(*) from public.outbox_events where destination = 'slack' and status = 'processing'),
      'failed',                 (select count(*) from public.outbox_events where destination = 'slack' and status = 'failed'),
      'manual_action_required', (select count(*) from public.outbox_events where destination = 'slack' and status = 'manual_action_required'),
      'dead_letter',            (select count(*) from public.outbox_events where destination = 'slack' and status = 'dead_letter'),
      'delivered_in_window',    (select count(*) from public.outbox_events where destination = 'slack' and status = 'delivered' and processed_at >= v_since),
      'queued_in_window',       (select count(*) from public.outbox_events where destination = 'slack' and created_at >= v_since),
      'oldest_undelivered_age_seconds', (
        select extract(epoch from now() - min(created_at))::integer
        from public.outbox_events
        where destination = 'slack' and status in ('pending', 'failed', 'processing')
      ),
      'last_manual_reason', (
        select o.last_error_redacted from public.outbox_events o
        where o.destination = 'slack' and o.status = 'manual_action_required'
        order by o.updated_at desc limit 1
      )
    )
  );
end;
$fn$;

revoke all on function public.slack_outbox_emitters() from public, anon;
grant execute on function public.slack_outbox_emitters() to authenticated, service_role;
revoke all on function public.slack_delivery_receipt_stats(interval) from public, anon;
grant execute on function public.slack_delivery_receipt_stats(interval) to authenticated, service_role;

comment on function public.slack_outbox_emitters() is
  'Every public function that queues a destination=slack outbox event, the event_type literal it queues, and its trigger. Feeds slack-integration-health route coverage.';
comment on function public.slack_delivery_receipt_stats(interval) is
  'Scalar-subquery Slack delivery stats (receipts + slack outbox backlog) for slack-integration-health. Never returns zero rows.';

commit;
