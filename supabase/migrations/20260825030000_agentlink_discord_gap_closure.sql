-- Close the last production/Discord split.
--
-- v_production_unified correctly counts AgentLink's canonical book, but the
-- durable Discord path only listened to public.deals. Policies that exist in
-- agentlink_book but cannot be mirrored into deals (for example, an upstream
-- placeholder policy number) were visible on the dashboard and silent in
-- Discord. Queue the book itself, using a stable UUID derived from deal_key.

begin;

-- KJ's login is already banned and owns no live queues/roles. Restore the
-- agent-row offboarding invariant as well; production remains in the book and
-- Vantage rollups, but the departed producer cannot reappear as active.
update public.agents
set status = 'terminated',
    is_inactive = true,
    is_deactivated = true,
    is_manager = false,
    is_presenting = false,
    telegram_opt_out = true,
    updated_at = now()
where id = '431dff0d-7c82-4134-a85e-457e5226fc7f'::uuid;

create or replace function public.fn_agentlink_outbox_uuid(p_deal_key text)
returns uuid
language sql
immutable
strict
as $$
  select (
    substr(md5('agentlink:' || p_deal_key), 1, 8) || '-' ||
    substr(md5('agentlink:' || p_deal_key), 9, 4) || '-' ||
    substr(md5('agentlink:' || p_deal_key), 13, 4) || '-' ||
    substr(md5('agentlink:' || p_deal_key), 17, 4) || '-' ||
    substr(md5('agentlink:' || p_deal_key), 21, 12)
  )::uuid;
$$;

create or replace function public.trg_fn_agentlink_book_queue_discord()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_subagency text;
  v_aggregate_id uuid;
  v_payload jsonb;
  v_today date := (now() at time zone 'America/Phoenix')::date;
begin
  if new.deal_key is null
     or new.agent_id is null
     or new.annual_premium is null
     or new.is_dead is true
     or new.posted_date is null
     or new.posted_date < v_today - 3
     or new.agent_id = '431dff0d-7c82-4134-a85e-457e5226fc7f'::uuid
     or public.fn_agent_is_roster_excluded(new.agent_id) then
    return new;
  end if;

  v_aggregate_id := public.fn_agentlink_outbox_uuid(new.deal_key);
  v_payload := jsonb_build_object(
    'dealKey', new.deal_key,
    'agentId', new.agent_id,
    'agentName', new.agent_name,
    'carrier', new.carrier,
    'productCategory', new.product,
    'faceAmount', new.face_amount,
    'annualPremium', new.annual_premium,
    'postedDate', new.posted_date
  );

  insert into public.outbox_events(
    aggregate_type, aggregate_id, event_type, destination, payload,
    idempotency_key, correlation_id
  ) values (
    'agentlink_book_deal', v_aggregate_id, 'deal.posted', 'discord', v_payload,
    'agentlink.posted:' || new.deal_key || ':discord', gen_random_uuid()
  ) on conflict (idempotency_key) do nothing;

  v_subagency := public.fn_agent_subagency(new.agent_id);
  if v_subagency is not null then
    insert into public.outbox_events(
      aggregate_type, aggregate_id, event_type, destination, payload,
      idempotency_key, correlation_id
    ) values (
      'agentlink_book_deal', v_aggregate_id, 'deal.posted', 'discord_subagency',
      v_payload || jsonb_build_object('subagency', v_subagency),
      'agentlink.posted:' || new.deal_key || ':discord:' || v_subagency,
      gen_random_uuid()
    ) on conflict (idempotency_key) do nothing;
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

drop trigger if exists trg_agentlink_book_queue_discord_insert on public.agentlink_book;
create trigger trg_agentlink_book_queue_discord_insert
after insert on public.agentlink_book
for each row execute function public.trg_fn_agentlink_book_queue_discord();

drop trigger if exists trg_agentlink_book_queue_discord_reactivated on public.agentlink_book;
create trigger trg_agentlink_book_queue_discord_reactivated
after update of is_dead, posted_date on public.agentlink_book
for each row
when (
  new.is_dead is not true
  and (old.is_dead is true or old.posted_date is distinct from new.posted_date)
)
execute function public.trg_fn_agentlink_book_queue_discord();

-- Reconcile only genuinely recent APEX business plus this month's active
-- Vantage rows. Departed/excluded producers (including KJ) remain in production
-- history but never receive a fresh alert. Stable keys make this replay-safe.
with eligible as (
  select b.*
  from public.agentlink_book b
  where b.deal_key is not null
    and b.agent_id is not null
    and b.annual_premium is not null
    and b.is_dead is not true
    and b.posted_date is not null
    and b.agent_id <> '431dff0d-7c82-4134-a85e-457e5226fc7f'::uuid
    and not public.fn_agent_is_roster_excluded(b.agent_id)
    and (
      b.posted_date >= (now() at time zone 'America/Phoenix')::date - 3
      or (
        public.fn_agent_subagency(b.agent_id) = 'vantage'
        and b.posted_date >= date_trunc('month', now() at time zone 'America/Phoenix')::date
      )
    )
), prepared as (
  select
    e.*,
    public.fn_agentlink_outbox_uuid(e.deal_key) aggregate_id,
    public.fn_agent_subagency(e.agent_id) subagency,
    jsonb_build_object(
      'dealKey', e.deal_key, 'agentId', e.agent_id, 'agentName', e.agent_name,
      'carrier', e.carrier, 'productCategory', e.product,
      'faceAmount', e.face_amount, 'annualPremium', e.annual_premium,
      'postedDate', e.posted_date
    ) payload
  from eligible e
)
insert into public.outbox_events(
  aggregate_type, aggregate_id, event_type, destination, payload,
  idempotency_key, correlation_id
)
select
  'agentlink_book_deal', aggregate_id, 'deal.posted', 'discord', payload,
  'agentlink.posted:' || deal_key || ':discord', gen_random_uuid()
from prepared
on conflict (idempotency_key) do nothing;

with eligible as (
  select b.*, public.fn_agent_subagency(b.agent_id) subagency
  from public.agentlink_book b
  where b.deal_key is not null
    and b.agent_id is not null
    and b.annual_premium is not null
    and b.is_dead is not true
    and b.posted_date is not null
    and b.agent_id <> '431dff0d-7c82-4134-a85e-457e5226fc7f'::uuid
    and not public.fn_agent_is_roster_excluded(b.agent_id)
    and public.fn_agent_subagency(b.agent_id) = 'vantage'
    and b.posted_date >= date_trunc('month', now() at time zone 'America/Phoenix')::date
)
insert into public.outbox_events(
  aggregate_type, aggregate_id, event_type, destination, payload,
  idempotency_key, correlation_id
)
select
  'agentlink_book_deal', public.fn_agentlink_outbox_uuid(deal_key),
  'deal.posted', 'discord_subagency',
  jsonb_build_object(
    'dealKey', deal_key, 'agentId', agent_id, 'agentName', agent_name,
    'carrier', carrier, 'productCategory', product,
    'faceAmount', face_amount, 'annualPremium', annual_premium,
    'postedDate', posted_date, 'subagency', subagency
  ),
  'agentlink.posted:' || deal_key || ':discord:' || subagency,
  gen_random_uuid()
from eligible
on conflict (idempotency_key) do nothing;

commit;
