-- AgentLink refreshes can contain multiple raw rows for one real policy and can
-- replace the table repeatedly. Discord idempotency therefore belongs to the
-- canonical policy fingerprint, not to the upstream row/deal key.

begin;

drop trigger if exists trg_agentlink_book_queue_discord_insert on public.agentlink_book;
drop trigger if exists trg_agentlink_book_queue_discord_reactivated on public.agentlink_book;

-- Resolve duplicate identities before classifying agency ownership. This keeps
-- KJ/Kaeden's historical production in Vantage without reactivating either row.
create or replace function public.fn_agent_subagency(p_agent_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select coalesce(public.fn_canonical_agent_id(p_agent_id), p_agent_id) as canonical_id
  )
  select case
    when p_agent_id is null then null
    when target.canonical_id = '431dff0d-7c82-4134-a85e-457e5226fc7f'::uuid then 'vantage'
    when exists (
      select 1
      from public.agents a
      left join public.v_agent_canonical_map manager_map on manager_map.agent_id = a.manager_id
      where a.id in (p_agent_id, target.canonical_id)
        and coalesce(manager_map.canonical_agent_id, a.manager_id) =
          '431dff0d-7c82-4134-a85e-457e5226fc7f'::uuid
    ) then 'vantage'
    else null
  end
  from target;
$$;

revoke all on function public.fn_agent_subagency(uuid) from public, anon;
grant execute on function public.fn_agent_subagency(uuid) to authenticated, service_role;

create or replace function public.fn_agentlink_policy_fingerprint(
  p_agent_name text,
  p_client_name text,
  p_annual_premium numeric,
  p_effective_date date,
  p_carrier text
)
returns text
language sql
immutable
as $$
  select md5(
    coalesce(p_agent_name, '') || '|' ||
    lower(btrim(coalesce(p_client_name, ''))) || '|' ||
    coalesce(p_annual_premium::text, '') || '|' ||
    coalesce(p_effective_date::text, '') || '|' ||
    coalesce(p_carrier, '')
  );
$$;

create or replace function public.fn_agentlink_policy_outbox_uuid(p_fingerprint text)
returns uuid
language sql
immutable
strict
as $$
  select (
    substr(md5('agentlink-policy:' || p_fingerprint), 1, 8) || '-' ||
    substr(md5('agentlink-policy:' || p_fingerprint), 9, 4) || '-' ||
    substr(md5('agentlink-policy:' || p_fingerprint), 13, 4) || '-' ||
    substr(md5('agentlink-policy:' || p_fingerprint), 17, 4) || '-' ||
    substr(md5('agentlink-policy:' || p_fingerprint), 21, 12)
  )::uuid;
$$;

create table if not exists public.agentlink_discord_policy_ledger (
  policy_fingerprint text not null,
  destination text not null check (destination in ('discord', 'discord_subagency')),
  first_deal_key text,
  outbox_event_id uuid references public.outbox_events(id) on delete set null,
  first_seen_at timestamptz not null default now(),
  primary key (policy_fingerprint, destination)
);

alter table public.agentlink_discord_policy_ledger enable row level security;
revoke all on public.agentlink_discord_policy_ledger from public, anon, authenticated;
grant select, insert, update on public.agentlink_discord_policy_ledger to service_role;

-- Seed every alert already queued so the next full AgentLink rebuild cannot
-- announce it again under the new fingerprint key.
insert into public.agentlink_discord_policy_ledger(
  policy_fingerprint, destination, first_deal_key, outbox_event_id, first_seen_at
)
select distinct on (fingerprint, o.destination)
  fingerprint, o.destination, b.deal_key, o.id, o.created_at
from public.outbox_events o
join public.agentlink_book b on b.deal_key = o.payload ->> 'dealKey'
cross join lateral (
  select public.fn_agentlink_policy_fingerprint(
    b.agent_name, b.client_name, b.annual_premium, b.effective_date, b.carrier
  ) as fingerprint
) f
where o.aggregate_type = 'agentlink_book_deal'
  and o.destination in ('discord', 'discord_subagency')
order by fingerprint, o.destination, o.created_at, o.id
on conflict (policy_fingerprint, destination) do nothing;

create or replace function public.trg_fn_agentlink_book_queue_discord()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_subagency text;
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
    'dealKey', new.deal_key,
    'agentId', new.agent_id,
    'agentName', new.agent_name,
    'carrier', new.carrier,
    'productCategory', new.product,
    'faceAmount', new.face_amount,
    'annualPremium', new.annual_premium,
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

  v_subagency := public.fn_agent_subagency(new.agent_id);
  if v_subagency is not null then
    insert into public.agentlink_discord_policy_ledger(
      policy_fingerprint, destination, first_deal_key
    ) values (v_fingerprint, 'discord_subagency', new.deal_key)
    on conflict (policy_fingerprint, destination) do nothing;

    if found then
      insert into public.outbox_events(
        aggregate_type, aggregate_id, event_type, destination, payload,
        idempotency_key, correlation_id
      ) values (
        'agentlink_book_deal', v_aggregate_id, 'deal.posted', 'discord_subagency',
        v_payload || jsonb_build_object('subagency', v_subagency),
        'agentlink.policy:' || v_fingerprint || ':discord:' || v_subagency,
        gen_random_uuid()
      )
      on conflict (idempotency_key) do update set idempotency_key = excluded.idempotency_key
      returning id into v_event_id;

      update public.agentlink_discord_policy_ledger
      set outbox_event_id = v_event_id
      where policy_fingerprint = v_fingerprint and destination = 'discord_subagency';
    end if;
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

create trigger trg_agentlink_book_queue_discord_insert
after insert on public.agentlink_book
for each row execute function public.trg_fn_agentlink_book_queue_discord();

create trigger trg_agentlink_book_queue_discord_reactivated
after update of is_dead, posted_date on public.agentlink_book
for each row
when (
  new.is_dead is not true
  and (old.is_dead is true or old.posted_date is distinct from new.posted_date)
)
execute function public.trg_fn_agentlink_book_queue_discord();

create table if not exists public.discord_message_retractions (
  outbox_event_id uuid primary key references public.outbox_events(id) on delete restrict,
  provider_message_id text not null,
  reason text not null,
  http_status integer not null,
  retracted_at timestamptz not null default now()
);

alter table public.discord_message_retractions enable row level security;
revoke all on public.discord_message_retractions from public, anon, authenticated;
grant select, insert on public.discord_message_retractions to service_role;

commit;
