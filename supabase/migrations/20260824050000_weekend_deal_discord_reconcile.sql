-- The first durable-alert backfill used the current Phoenix calendar day.
-- A sale submitted Saturday evening was therefore outside Sunday's window.
-- Reconcile the last 72 hours; the freshness predicate excludes late imports
-- and the unique idempotency key makes this safe after manual recovery.
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
  and d.created_at >= now() - interval '72 hours'
  and (
    d.source = 'apex_native'
    or public.is_fresh_deal_close(d.effective_date, d.posted_at, d.created_at)
  )
on conflict (idempotency_key) do nothing;
