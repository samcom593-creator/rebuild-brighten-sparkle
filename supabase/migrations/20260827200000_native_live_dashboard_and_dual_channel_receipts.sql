-- APEX native operations: instant dashboard truth, durable Slack + Discord
-- receipts for every new hire and every named external/Vantage deal, and no
-- forward dependency on retired AgentLink/InsuraCloud write paths.

begin;

-- ── 1. Retire forward writes to the legacy cloud ────────────────────────────
drop trigger if exists trg_deals_autopush_insuracloud on public.deals;

create or replace function public.fn_block_retired_cloud_outbox()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
begin
  if new.destination = 'insuracloud' then
    -- Returning NULL skips only this destination row. Native APEX, Slack,
    -- Discord, review, and file-scan rows in the same statement still insert.
    return null;
  end if;
  return new;
end;
$fn$;

drop trigger if exists trg_block_retired_cloud_outbox on public.outbox_events;
create trigger trg_block_retired_cloud_outbox
  before insert on public.outbox_events
  for each row execute function public.fn_block_retired_cloud_outbox();

insert into public.system_settings(key, value, updated_at)
values ('legacy_cloud_forward_writes_enabled', 'false', now())
on conflict (key) do update
set value = excluded.value, updated_at = excluded.updated_at;

do $block$
declare v_job record;
begin
  if to_regclass('cron.job') is null then return; end if;
  for v_job in
    select jobid from cron.job
    where jobname ilike '%insuracloud%' or command ilike '%insuracloud%'
  loop
    perform cron.unschedule(v_job.jobid);
  end loop;
end;
$block$;

update public.outbox_events
set status = 'manual_action_required',
    processed_at = now(),
    locked_at = null,
    last_error_redacted = 'Legacy cloud forwarding retired; APEX is the system of record.'
where destination = 'insuracloud'
  and status in ('pending', 'failed', 'processing');

-- ── 2. One durable Slack + Discord receipt for every real new hire ──────────
create or replace function public.fn_notify_agent_hired()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_manager text;
  v_payload jsonb;
begin
  if coalesce(new.status::text, '') <> 'active' then return new; end if;
  if coalesce(new.is_deactivated, false) or coalesce(new.is_inactive, false) then return new; end if;
  if coalesce(new.agent_code, '') like 'GHOST_%' then return new; end if;

  select display_name into v_manager from public.agents where id = new.manager_id;
  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'agentName', new.display_name,
    'agentCode', new.agent_code,
    'managerName', v_manager,
    'licenseStatus', new.license_status::text,
    'contractingUrl', 'https://apex-financial.org/start-contracting',
    'openUrl', 'https://apex-financial.org/dashboard/profile?agentId=' || new.id::text
  ));

  insert into public.outbox_events(
    aggregate_type, aggregate_id, event_type, destination, payload,
    idempotency_key, correlation_id
  ) values
    ('agent', new.id, 'agent.hired', 'slack', v_payload,
     'agent.hired:' || new.id::text || ':slack', gen_random_uuid()),
    ('agent', new.id, 'agent.hired', 'discord', v_payload,
     'agent.hired:' || new.id::text || ':discord', gen_random_uuid())
  on conflict (idempotency_key) do nothing;

  return new;
exception when others then
  raise warning 'fn_notify_agent_hired failed for agent % (%): %', new.id, new.display_name, sqlerrm;
  return new;
end;
$fn$;

-- ── 3. Named external/Vantage deals use the same durable fan-out ───────────
create or replace function public.fn_queue_external_deal_channels()
returns trigger
language plpgsql
security definer
set search_path = public
as $fn$
declare v_payload jsonb;
begin
  if lower(coalesce(new.status, '')) in
     ('lapsed', 'cancelled', 'charged_back', 'withdrawn', 'not_taken', 'declined') then
    return new;
  end if;

  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'dealId', new.id,
    'agentId', new.agent_id,
    'agentName', new.agent_name,
    'agencyName', new.agency_name,
    'carrierName', new.carrier,
    'productCategory', new.product,
    'annualPremium', new.annual_premium,
    'openUrl', 'https://apex-financial.org/dashboard/production'
  ));

  insert into public.outbox_events(
    aggregate_type, aggregate_id, event_type, destination, payload,
    idempotency_key, correlation_id
  ) values
    ('external_production_deal', new.id, 'deal.posted', 'slack', v_payload,
     'external.deal.posted:' || new.id::text || ':slack', gen_random_uuid()),
    ('external_production_deal', new.id, 'deal.posted', 'discord', v_payload,
     'external.deal.posted:' || new.id::text || ':discord', gen_random_uuid())
  on conflict (idempotency_key) do nothing;
  return new;
exception when others then
  raise warning 'external deal channel queue failed for %: %', new.id, sqlerrm;
  return new;
end;
$fn$;

drop trigger if exists trg_queue_external_deal_channels on public.production_external_deals;
create trigger trg_queue_external_deal_channels
  after insert on public.production_external_deals
  for each row execute function public.fn_queue_external_deal_channels();

-- Realtime is the cross-device delivery path. Duplicate-object means the table
-- was already enabled and is healthy.
do $block$
begin
  if to_regclass('public.policies') is not null then
    execute 'alter publication supabase_realtime add table public.policies';
  end if;
exception when duplicate_object then null;
end;
$block$;

commit;
