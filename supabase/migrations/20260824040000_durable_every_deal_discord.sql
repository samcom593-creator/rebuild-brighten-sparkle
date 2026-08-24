-- Every fresh IMO/native deal gets one durable Discord delivery.
--
-- The previous trigger called pg_net directly and wrote a success log as soon
-- as the request was queued, before Discord answered. It also could not see
-- native APEX deals because those are inserted with an intentionally stale
-- posted_at and promoted after validation. Route both paths through the retrying
-- outbox with a unique per-deal key instead.
create or replace function public.trg_fn_deal_celebration()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
begin
  if new.agent_id is null or coalesce(new.status, 'draft') = 'draft' then
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
  -- An alert must never roll back the deal. Unlike the removed fire-and-forget
  -- path, this failure remains visible for Monday operations.
  begin
    insert into public.automation_run_log(job_name, status, error, created_at)
    values ('deal_celebration_queue', 'error', format('deal %s: %s', new.id, sqlerrm), now());
  exception when others then null;
  end;
  return new;
end;
$fn$;

-- Imported IMO deals keep the existing freshness guard so a historical sync
-- can never blast Discord. The function now only queues; no network runs in the
-- transaction that writes the deal.
drop trigger if exists trg_deal_celebration on public.deals;
create trigger trg_deal_celebration
after insert on public.deals
for each row
when (public.is_fresh_deal_close(new.effective_date, new.posted_at, new.created_at))
execute function public.trg_fn_deal_celebration();

-- Native posts become real only when submit_apex_deal promotes source from its
-- inert insert value to apex_native. Queue at that exact transition.
drop trigger if exists trg_deal_native_discord on public.deals;
create trigger trg_deal_native_discord
after update of source on public.deals
for each row
when (new.source = 'apex_native' and old.source is distinct from new.source)
execute function public.trg_fn_deal_celebration();

-- Reconcile only the current Phoenix business day. This picks up the verified
-- missed sale without replaying historical imports or duplicating any event
-- already represented in the durable outbox.
insert into public.outbox_events(
  aggregate_type, aggregate_id, event_type, destination, payload,
  idempotency_key, correlation_id
)
select
  'deal', d.id, 'deal.posted', 'discord',
  jsonb_build_object(
    'dealId', d.id,
    'agentId', d.agent_id,
    'carrierId', d.carrier_id,
    'productCategory', d.product_sold,
    'annualPremium', coalesce(d.annualized_commissionable_premium, d.annual_premium)
  ),
  'deal.posted:' || d.id::text || ':discord',
  coalesce(d.correlation_id, gen_random_uuid())
from public.deals d
where d.agent_id is not null
  and coalesce(d.status, 'draft') <> 'draft'
  and d.created_at >= (date_trunc('day', now() at time zone 'America/Phoenix') at time zone 'America/Phoenix')
  and (d.source = 'apex_native' or public.is_fresh_deal_close(d.effective_date, d.posted_at, d.created_at))
on conflict (idempotency_key) do nothing;
