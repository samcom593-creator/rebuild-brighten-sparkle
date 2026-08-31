-- MP-341: call out the first deal on the board each day, in Slack.
--
-- Sam: "make sure everyone sees the first deal hit the board."
--
-- Slack deal notifications were already working and proven — 18 of 18 posts to
-- #apex-sales-wins carry a real Slack message_ts receipt, the workspace is
-- active, the deal.posted route is enabled. What was missing is that every sale
-- reads identically, so the first one of the day — the one that sets the tone
-- in a sales room — looks like the fifth.
--
-- The flag is computed at ENQUEUE time, not render time. A template is
-- stateless and the dispatcher may run minutes later or retry, so asking "is
-- this the first?" during rendering would answer about the wrong moment and
-- could mark two different deals first on a retry. Deciding once, when the row
-- lands, is the only reading that stays true.
--
-- Both deal paths call the same helper so #apex-sales-wins cannot disagree with
-- itself: fn_queue_deal_slack (native deals on public.deals) and
-- trg_fn_agentlink_book_queue_discord (the AgentLink book, which is where
-- essentially all real production lands).

begin;

create or replace function public.fn_is_first_slack_deal_today()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  -- Phoenix, matching every other "today" in this schema. Counts queued Slack
  -- deal events rather than deal rows, because that is exactly the population
  -- the channel has already been told about — an imported backfill that never
  -- announced must not consume the day's first-deal slot.
  select not exists (
    select 1
    from public.outbox_events o
    where o.event_type = 'deal.posted'
      and o.destination = 'slack'
      and (o.created_at at time zone 'America/Phoenix')::date
          = (now() at time zone 'America/Phoenix')::date
  );
$function$;

comment on function public.fn_is_first_slack_deal_today() is
  'MP-341: true when no deal.posted Slack event has been queued yet today '
  '(Phoenix). Evaluated at enqueue time so a dispatcher retry cannot crown a '
  'second deal first.';

-- ---------------------------------------------------------------------------
-- Native deals on public.deals
-- ---------------------------------------------------------------------------
create or replace function public.fn_queue_deal_slack()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_agent_name text;
  v_carrier_name text;
  v_first boolean;
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

  v_first := public.fn_is_first_slack_deal_today();

  insert into public.outbox_events(
    aggregate_type, aggregate_id, event_type, destination, payload,
    idempotency_key, correlation_id
  ) values (
    'deal', new.id, 'deal.posted', 'slack',
    jsonb_strip_nulls(jsonb_build_object(
      'dealId', new.id,
      'agentId', new.agent_id,
      'agentName', coalesce(v_agent_name, 'APEX producer'),
      'carrierId', new.carrier_id,
      'carrierName', v_carrier_name,
      'productCategory', new.product_sold,
      'annualPremium', coalesce(new.annualized_commissionable_premium, new.annual_premium, 0),
      'firstOfDay', case when v_first then true else null end,
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
$function$;

-- ---------------------------------------------------------------------------
-- AgentLink book — the same flag on the path real production travels
-- ---------------------------------------------------------------------------
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
  v_first boolean;
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

  -- Slack leg. Evaluate first-of-day BEFORE the insert, or this row would see
  -- itself and never be first.
  v_first := public.fn_is_first_slack_deal_today();

  v_slack_payload := jsonb_strip_nulls(jsonb_build_object(
    'dealKey', new.deal_key,
    'agentId', new.agent_id,
    'agentName', coalesce(nullif(btrim(new.agent_name), ''), 'APEX producer'),
    'carrierName', nullif(btrim(new.carrier), ''),
    'productCategory', nullif(btrim(new.product), ''),
    'annualPremium', new.annual_premium,
    'firstOfDay', case when v_first then true else null end,
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

commit;
