-- One deal, one durable main-channel event. Vantage/KJ deal-channel fan-out is
-- disabled by owner direction; the Vantage classification remains available
-- for production totals and team scoping only.

begin;

create or replace function public.trg_fn_deal_celebration()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_canonical_agent_id uuid;
begin
  v_canonical_agent_id := coalesce(public.fn_canonical_agent_id(new.agent_id), new.agent_id);
  if new.agent_id is null
     or coalesce(new.status, 'draft') = 'draft'
     or v_canonical_agent_id = '431dff0d-7c82-4134-a85e-457e5226fc7f'::uuid
     or public.fn_agent_is_roster_excluded(new.agent_id)
     or public.fn_agent_is_roster_excluded(v_canonical_agent_id) then
    return new;
  end if;

  insert into public.outbox_events(
    aggregate_type, aggregate_id, event_type, destination, payload,
    idempotency_key, correlation_id
  ) values (
    'deal', new.id, 'deal.posted', 'discord',
    jsonb_build_object(
      'dealId', new.id,
      'agentId', new.agent_id,
      'carrierId', new.carrier_id,
      'productCategory', new.product_sold,
      'annualPremium', coalesce(new.annualized_commissionable_premium, new.annual_premium)
    ),
    'deal.posted:' || new.id::text || ':discord',
    coalesce(new.correlation_id, gen_random_uuid())
  ) on conflict (idempotency_key) do nothing;

  return new;
exception when others then
  begin
    insert into public.automation_run_log(job_name, status, error, created_at)
    values ('deal_celebration_queue', 'error', format('deal %s: %s', new.id, sqlerrm), now());
  exception when others then null;
  end;
  return new;
end;
$fn$;

-- Keep the policy ledger, but queue only the primary feed.
create or replace function public.trg_fn_agentlink_book_queue_discord()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_canonical_agent_id uuid;
  v_fingerprint text;
  v_aggregate_id uuid;
  v_event_id uuid;
  v_payload jsonb;
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
$fn$;

update public.outbox_events
set status = 'manual_action_required',
    processed_at = now(),
    last_error_redacted = 'Vantage deal-channel delivery disabled by agency owner',
    updated_at = now()
where destination = 'discord_subagency'
  and status in ('pending', 'failed');

commit;
