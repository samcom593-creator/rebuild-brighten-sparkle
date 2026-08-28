-- MP-335 — two Slack routes that were wired but structurally dead.
--
-- 1. CONTRACTING → #apex-contracting-support. fn_queue_contracting_slack enqueues
--    (aggregate_type='contracting_intake', event_type='contracting.intake_submitted',
--    destination='slack') on every intake, the messaging_route_rules row exists and is
--    enabled, the Slack template exists — and ZERO rows ever reached Slack (0 of 23
--    intakes in 14d) because trg_fn_contracting_outbox_route_guard (BEFORE INSERT on
--    outbox_events) returns NULL for any contracting_intake row whose destination is
--    not ethos_sheet / contracting_discord. A route enabled at every layer but one is
--    a route that does not exist. The guard now admits 'slack'; the dispatcher routes
--    destination='slack' to deliverSlack ahead of the contracting handler (which has no
--    slack case) in the same wave.
--
-- 2. AGENTLINK BOOK DEALS → #apex-sales-wins. deal.posted has a live Slack route, but
--    only NATIVE deals (fn_queue_deal_slack on public.deals) enqueue a slack row. Book
--    deals (trg_fn_agentlink_book_queue_discord) enqueue Discord only — 43 of 79
--    deal.posted rows in 14d never reached Slack. Same trigger now also enqueues a
--    slack row with the payload shape the deal.posted Slack template reads
--    (agentName, annualPremium, carrierName, productCategory, openUrl — never the
--    policyholder), deduped per policy fingerprint via the existing ledger under
--    destination='slack'. Vantage head / roster-excluded / stale / dead rows keep the
--    same exclusions as the Discord leg. No backfill: historical book rows stay silent
--    (a storm of 43 stale sale posts is not a fix).

create or replace function public.trg_fn_contracting_outbox_route_guard()
returns trigger
language plpgsql
set search_path to 'public'
as $function$
begin
  if new.aggregate_type = 'contracting_intake'
     and new.destination not in ('ethos_sheet', 'contracting_discord', 'slack') then
    return null;
  end if;
  return new;
end;
$function$;

create or replace function public.trg_fn_agentlink_book_queue_discord()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_canonical_agent_id uuid;
  v_fingerprint text;
  v_aggregate_id uuid;
  v_event_id uuid;
  v_payload jsonb;
  v_slack_payload jsonb;
  v_today date := (now() at time zone 'America/Phoenix')::date;
begin
  v_canonical_agent_id := coalesce(public.fn_canonical_agent_id(new.agent_id), new.agent_id);
  if new.deal_key is null
     or new.agent_id is null
     or new.annual_premium is null
     or new.is_dead is true
     or new.posted_date is null
     or new.posted_date < v_today - 3
     or v_canonical_agent_id = '431dff0d-7c82-4134-a85e-457e5226fc7f'::uuid
     or public.fn_agent_is_roster_excluded(new.agent_id)
     or public.fn_agent_is_roster_excluded(v_canonical_agent_id) then
    return new;
  end if;

  v_fingerprint := public.fn_agentlink_policy_fingerprint(
    new.agent_name, new.client_name, new.annual_premium, new.effective_date, new.carrier
  );
  v_aggregate_id := public.fn_agentlink_policy_outbox_uuid(v_fingerprint);
  v_payload := jsonb_build_object(
    'dealKey', new.deal_key, 'agentId', new.agent_id, 'agentName', new.agent_name,
    'carrier', new.carrier, 'productCategory', new.product,
    'faceAmount', new.face_amount, 'annualPremium', new.annual_premium,
    'postedDate', new.posted_date
  );

  -- Discord leg (unchanged).
  insert into public.agentlink_discord_policy_ledger(
    policy_fingerprint, destination, first_deal_key
  ) values (v_fingerprint, 'discord', new.deal_key)
  on conflict (policy_fingerprint, destination) do nothing;

  if found then
    insert into public.outbox_events(
      aggregate_type, aggregate_id, event_type, destination, payload,
      idempotency_key, correlation_id
    ) values (
      'agentlink_book_deal', v_aggregate_id, 'deal.posted', 'discord', v_payload,
      'agentlink.policy:' || v_fingerprint || ':discord', gen_random_uuid()
    )
    on conflict (idempotency_key) do update set idempotency_key = excluded.idempotency_key
    returning id into v_event_id;

    update public.agentlink_discord_policy_ledger
    set outbox_event_id = v_event_id
    where policy_fingerprint = v_fingerprint and destination = 'discord';
  end if;

  -- Slack leg (MP-335): same policy, same dedupe ledger, template-shaped payload.
  v_slack_payload := jsonb_strip_nulls(jsonb_build_object(
    'dealKey', new.deal_key,
    'agentId', new.agent_id,
    'agentName', coalesce(nullif(btrim(new.agent_name), ''), 'APEX producer'),
    'carrierName', nullif(btrim(new.carrier), ''),
    'productCategory', nullif(btrim(new.product), ''),
    'annualPremium', new.annual_premium,
    'openUrl', 'https://apex-financial.org/dashboard'
  ));

  insert into public.agentlink_discord_policy_ledger(
    policy_fingerprint, destination, first_deal_key
  ) values (v_fingerprint, 'slack', new.deal_key)
  on conflict (policy_fingerprint, destination) do nothing;

  if found then
    insert into public.outbox_events(
      aggregate_type, aggregate_id, event_type, destination, payload,
      idempotency_key, correlation_id
    ) values (
      'agentlink_book_deal', v_aggregate_id, 'deal.posted', 'slack', v_slack_payload,
      'agentlink.policy:' || v_fingerprint || ':slack', gen_random_uuid()
    )
    on conflict (idempotency_key) do update set idempotency_key = excluded.idempotency_key
    returning id into v_event_id;

    update public.agentlink_discord_policy_ledger
    set outbox_event_id = v_event_id
    where policy_fingerprint = v_fingerprint and destination = 'slack';
  end if;

  return new;
exception when others then
  begin
    insert into public.automation_run_log(job_name, status, error, created_at)
    values (
      'agentlink_book_discord_queue', 'error',
      format('deal_key %s: %s', new.deal_key, sqlerrm), now()
    );
  exception when others then null;
  end;
  return new;
end;
$function$;

-- The dedupe ledger's CHECK only admitted discord/discord_subagency. Without this
-- the slack ledger insert above raises inside the trigger and the outer handler
-- rolls back the WHOLE block — which would have silently killed the Discord leg
-- too. Caught by reading the constraint before trusting the apply.
alter table public.agentlink_discord_policy_ledger drop constraint agentlink_discord_policy_ledger_destination_check;
alter table public.agentlink_discord_policy_ledger
  add constraint agentlink_discord_policy_ledger_destination_check check (destination = any (array['discord'::text, 'discord_subagency'::text, 'slack'::text]));
