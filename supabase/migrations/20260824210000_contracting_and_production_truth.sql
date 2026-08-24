-- APEX 2026-08-24: one contracting path and one production truth.
-- Contracting is spreadsheet + the private contracting Discord. There is no
-- AgentLink continuation, support-email fanout, or laptop-workbook delivery.
-- Vantage deal posts use two independent outbox events so failure in its own
-- channel can never be hidden behind a successful APEX-channel post.

begin;

-- The original intake RPC is already deployed with four destinations. These
-- guards narrow it at the storage boundary without risking a large in-place
-- rewrite of its validation/dedupe transaction. Fresh installs use the
-- corrected two-item array in the original migration; upgraded installs use
-- these guards. Returning NULL from a BEFORE INSERT trigger is intentional.
create or replace function public.trg_fn_contracting_delivery_route_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.destination not in ('ethos_sheet', 'contracting_discord') then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_contracting_delivery_route_guard on public.contracting_intake_deliveries;
create trigger trg_contracting_delivery_route_guard
before insert on public.contracting_intake_deliveries
for each row execute function public.trg_fn_contracting_delivery_route_guard();

create or replace function public.trg_fn_contracting_outbox_route_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.aggregate_type = 'contracting_intake'
     and new.destination not in ('ethos_sheet', 'contracting_discord') then
    return null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_contracting_outbox_route_guard on public.outbox_events;
create trigger trg_contracting_outbox_route_guard
before insert on public.outbox_events
for each row execute function public.trg_fn_contracting_outbox_route_guard();

-- Imported book rows previously posted through pg_net and were recorded as
-- successful before Discord answered. The deals mirror already provides the
-- fresh-row trigger, so remove the direct, non-durable duplicate path.
drop trigger if exists trg_agentlink_book_announce on public.agentlink_book;

create or replace function public.trg_fn_deal_celebration()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_subagency text;
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

  v_subagency := public.fn_agent_subagency(new.agent_id);
  if v_subagency is not null then
    insert into public.outbox_events(
      aggregate_type, aggregate_id, event_type, destination, payload,
      idempotency_key, correlation_id
    ) values (
      'deal', new.id, 'deal.posted', 'discord_subagency',
      jsonb_build_object(
        'dealId', new.id,
        'agentId', new.agent_id,
        'subagency', v_subagency,
        'carrierId', new.carrier_id,
        'productCategory', new.product_sold,
        'annualPremium', coalesce(new.annualized_commissionable_premium, new.annual_premium)
      ),
      'deal.posted:' || new.id::text || ':discord:' || v_subagency,
      coalesce(new.correlation_id, gen_random_uuid())
    ) on conflict (idempotency_key) do nothing;
  end if;

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

-- Reconcile only the current Phoenix business day. This catches a deployment
-- race without replaying historical Vantage business into Discord.
insert into public.outbox_events(
  aggregate_type, aggregate_id, event_type, destination, payload,
  idempotency_key, correlation_id
)
select
  'deal', d.id, 'deal.posted', 'discord_subagency',
  jsonb_build_object(
    'dealId', d.id, 'agentId', d.agent_id,
    'subagency', public.fn_agent_subagency(d.agent_id),
    'carrierId', d.carrier_id, 'productCategory', d.product_sold,
    'annualPremium', coalesce(d.annualized_commissionable_premium, d.annual_premium)
  ),
  'deal.posted:' || d.id::text || ':discord:' || public.fn_agent_subagency(d.agent_id),
  coalesce(d.correlation_id, gen_random_uuid())
from public.deals d
where public.fn_agent_subagency(d.agent_id) is not null
  and coalesce(d.status, 'draft') <> 'draft'
  and d.created_at >= (date_trunc('day', now() at time zone 'America/Phoenix') at time zone 'America/Phoenix')
  and (d.source = 'apex_native' or public.is_fresh_deal_close(d.effective_date, d.posted_at, d.created_at))
on conflict (idempotency_key) do nothing;

-- Add a freshness timestamp to the shared production rows, then make all
-- headline, status, and agency totals aggregate this same deduped dataset.
create or replace view public.v_production_unified
with (security_invoker = on) as
select
  b.deal_key::text as row_key, 'agentlink'::text as origin,
  b.agent_id, b.agent_name, b.client_name, b.carrier, b.product,
  b.policy_number, b.annual_premium, b.posted_date, b.effective_date, b.status,
  b.imported_at as synced_at
from public.v_agentlink_book_scoped b
where b.is_dead is not true
union all
select
  d.id::text, 'apex_native'::text, d.agent_id,
  coalesce(ag.display_name, 'Agent'),
  btrim(coalesce(d.client_first_name,'') || ' ' || coalesce(d.client_last_name,'')),
  c.name, d.product_sold, d.policy_number, d.annual_premium,
  coalesce(d.posted_at::date, d.created_at::date), d.effective_date, d.status,
  d.created_at
from public.deals d
left join public.agents ag on ag.id = d.agent_id
left join public.carriers c on c.id = d.carrier_id
where d.agent_id is not null
  and d.annual_premium is not null
  and d.source = 'apex_native'
  and lower(coalesce(d.status,'')) not in ('lapsed','cancelled','charged_back','withdrawn','not_taken','declined')
  and not public.fn_agent_is_roster_excluded(d.agent_id)
  and not exists (
    select 1 from public.v_agentlink_book_scoped b
    where nullif(btrim(coalesce(b.policy_number,'')),'') is not null
      and lower(btrim(b.policy_number)) = lower(btrim(coalesce(d.policy_number,'')))
  )
  and not exists (
    select 1 from public.v_agentlink_book_scoped b2
    where b2.agent_id = d.agent_id
      and b2.annual_premium = d.annual_premium
      and b2.effective_date = d.effective_date
      and lower(btrim(coalesce(b2.client_name,''))) =
          lower(btrim(coalesce(d.client_first_name,'') || ' ' || coalesce(d.client_last_name,'')))
  );

create or replace view public.v_agentlink_book_truth
with (security_invoker = on) as
with p as (select (now() at time zone 'America/Phoenix')::date as d)
select
  count(*)::integer as total_deals,
  sum(b.annual_premium) as total_annual_premium,
  count(*) filter (where b.posted_date = p.d)::integer as deals_today,
  coalesce(sum(b.annual_premium) filter (where b.posted_date = p.d), 0::numeric) as premium_today,
  count(*) filter (where b.posted_date >= date_trunc('week', p.d::timestamp)::date and b.posted_date <= p.d)::integer as deals_this_week,
  coalesce(sum(b.annual_premium) filter (where b.posted_date >= date_trunc('week', p.d::timestamp)::date and b.posted_date <= p.d), 0::numeric) as premium_this_week,
  count(*) filter (where b.posted_date >= date_trunc('month', p.d::timestamp)::date and b.posted_date <= p.d)::integer as deals_this_month,
  coalesce(sum(b.annual_premium) filter (where b.posted_date >= date_trunc('month', p.d::timestamp)::date and b.posted_date <= p.d), 0::numeric) as premium_this_month,
  max(b.synced_at) as last_synced_at,
  count(*) filter (where b.posted_date >= date_trunc('week', p.d::timestamp)::date - 7 and b.posted_date <= p.d - 7)::integer as deals_prior_week,
  coalesce(sum(b.annual_premium) filter (where b.posted_date >= date_trunc('week', p.d::timestamp)::date - 7 and b.posted_date <= p.d - 7), 0::numeric) as premium_prior_week,
  count(*) filter (where b.posted_date >= p.d - 30 and b.posted_date <= p.d)::integer as deals_30d,
  coalesce(sum(b.annual_premium) filter (where b.posted_date >= p.d - 30 and b.posted_date <= p.d), 0::numeric) as premium_30d,
  count(*) filter (where b.posted_date >= p.d - 60 and b.posted_date < p.d - 30)::integer as deals_prior_30d,
  coalesce(sum(b.annual_premium) filter (where b.posted_date >= p.d - 60 and b.posted_date < p.d - 30), 0::numeric) as premium_prior_30d
from public.v_production_unified b cross join p;

create or replace view public.v_book_status_tiles
with (security_invoker = on) as
select
  case
    when lower(status) = 'active' then 'active'
    when lower(status) in ('issued','approved') then 'issued_not_paid'
    when lower(status) in ('in review','pending','submitted') then 'in_review'
    when lower(status) = 'lapse pending' then 'lapse_pending'
    when lower(status) = 'lapsed' then 'lapsed'
    when lower(status) = 'cancelled' then 'cancelled'
    when lower(status) = 'withdrawn' then 'withdrawn'
    when lower(status) in ('not taken','declined') then 'not_taken'
    when lower(status) = 'postponed' then 'postponed'
    else 'carrier_na'
  end as bucket,
  count(*)::int as n,
  round(sum(annual_premium)::numeric, 0) as alp
from public.v_production_unified
group by 1;

create or replace view public.v_imo_by_agency
with (security_invoker = on) as
with scoped as (
  select annual_premium, posted_date,
         coalesce(public.fn_agent_subagency(agent_id) = 'vantage', false) as is_vantage
  from public.v_production_unified
)
select
  case when is_vantage then 'Vantage Financial'::text else 'APEX Financial'::text end as agency,
  not is_vantage as is_primary,
  count(*)::integer as policies,
  round(sum(annual_premium), 0) as alp,
  round(coalesce(sum(annual_premium) filter (
    where posted_date >= date_trunc('month', ((now() at time zone 'America/Phoenix')::date)::timestamptz)
  ), 0::numeric), 0) as alp_mtd
from scoped
group by 1, 2
order by round(sum(annual_premium), 0) desc;

grant select on public.v_production_unified, public.v_agentlink_book_truth,
  public.v_book_status_tiles, public.v_imo_by_agency to authenticated;
grant select on public.v_agentlink_book_truth, public.v_book_status_tiles to anon;

commit;
