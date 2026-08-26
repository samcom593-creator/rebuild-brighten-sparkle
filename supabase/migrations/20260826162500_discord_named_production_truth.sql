-- Discord/Agent Cloud can surface a sub-agency sale before the APEX AgentLink
-- cookie sync can see it. Preserve those message-level facts as named-agent
-- production, then reconcile them away one-for-one if AgentLink catches up.
-- This keeps the Phoenix-day dashboard live without manufacturing policy or
-- client identity and without double counting a later canonical row.

begin;

create table if not exists public.production_external_deals (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  external_ref text not null,
  agency_name text not null,
  agent_id uuid not null references public.agents(id),
  agent_name text not null,
  carrier text,
  product text,
  policy_number text,
  monthly_premium numeric(14,2),
  annual_premium numeric(14,2) not null check (annual_premium > 0),
  face_amount numeric(14,2),
  occurred_at timestamptz not null,
  posted_date date not null,
  status text not null default 'reported_external',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source, external_ref)
);

create index if not exists production_external_deals_date_agent_idx
  on public.production_external_deals(posted_date, agent_id);

alter table public.production_external_deals enable row level security;
drop policy if exists production_external_deals_scope_read
  on public.production_external_deals;
create policy production_external_deals_scope_read
  on public.production_external_deals
  for select to authenticated
  using (
    public.apex_can_read_agent(agent_id)
    or public.crm_can_read_agent_scope(agent_id)
  );

revoke all on public.production_external_deals from public, anon, authenticated;
grant select on public.production_external_deals to authenticated;
grant select, insert, update on public.production_external_deals to service_role;

create or replace function public.ingest_external_production_deal(
  p_source text,
  p_external_ref text,
  p_agency_name text,
  p_agent_id uuid,
  p_agent_name text,
  p_carrier text,
  p_product text,
  p_monthly_premium numeric,
  p_annual_premium numeric,
  p_face_amount numeric,
  p_occurred_at timestamptz,
  p_posted_date date,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_inserted boolean;
begin
  if nullif(btrim(p_source), '') is null
     or nullif(btrim(p_external_ref), '') is null
     or p_agent_id is null
     or p_annual_premium is null
     or p_annual_premium <= 0
     or p_occurred_at is null
     or p_posted_date is null then
    raise exception 'missing or invalid external production identity';
  end if;

  insert into public.production_external_deals (
    source, external_ref, agency_name, agent_id, agent_name,
    carrier, product, monthly_premium, annual_premium, face_amount,
    occurred_at, posted_date, metadata
  ) values (
    btrim(p_source), btrim(p_external_ref), btrim(p_agency_name),
    coalesce(public.fn_canonical_agent_id(p_agent_id), p_agent_id),
    btrim(p_agent_name), nullif(btrim(p_carrier), ''),
    nullif(btrim(p_product), ''), p_monthly_premium, p_annual_premium,
    p_face_amount, p_occurred_at, p_posted_date, coalesce(p_metadata, '{}'::jsonb)
  )
  on conflict (source, external_ref) do update set
    metadata = public.production_external_deals.metadata || excluded.metadata,
    updated_at = now()
  returning id, (xmax = 0) into v_id, v_inserted;

  return jsonb_build_object(
    'id', v_id,
    'status', case when v_inserted then 'recorded' else 'already_recorded' end,
    'is_new_insert', v_inserted
  );
end;
$$;

revoke all on function public.ingest_external_production_deal(
  text, text, text, uuid, text, text, text, numeric, numeric, numeric,
  timestamptz, date, jsonb
) from public, anon, authenticated;
grant execute on function public.ingest_external_production_deal(
  text, text, text, uuid, text, text, text, numeric, numeric, numeric,
  timestamptz, date, jsonb
) to service_role;

-- Match external rows to later AgentLink rows as a multiset. The row_number /
-- count pairing is important: two same-value policies written by one agent on
-- one day remain two policies, while each later AgentLink arrival replaces only
-- one external row. Face amount and carrier narrow the fallback fingerprint.
create or replace view public.v_production_canonical
with (security_invoker = on) as
with external_ranked as (
  select
    e.*,
    coalesce(m.canonical_agent_id, e.agent_id) as canonical_agent_id,
    row_number() over (
      partition by
        coalesce(m.canonical_agent_id, e.agent_id),
        e.posted_date,
        e.annual_premium,
        coalesce(e.face_amount, 0),
        lower(btrim(coalesce(e.carrier, '')))
      order by e.occurred_at, e.external_ref
    )::integer as match_rank
  from public.production_external_deals e
  left join public.v_agent_canonical_map m on m.agent_id = e.agent_id
  where lower(coalesce(e.status, '')) not in (
    'lapsed', 'cancelled', 'charged_back', 'withdrawn', 'not_taken', 'declined'
  )
    and not public.fn_agent_is_roster_excluded(e.agent_id)
), agentlink_match_counts as (
  select
    coalesce(m.canonical_agent_id, b.agent_id) as canonical_agent_id,
    b.posted_date,
    b.annual_premium,
    coalesce(b.face_amount, 0) as face_amount,
    lower(btrim(coalesce(b.carrier, ''))) as carrier_key,
    count(*)::integer as matched_rows
  from public.v_agentlink_book_scoped b
  left join public.v_agent_canonical_map m on m.agent_id = b.agent_id
  where b.is_dead is not true
  group by 1, 2, 3, 4, 5
)
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
  btrim(coalesce(d.client_first_name, '') || ' ' || coalesce(d.client_last_name, '')),
  c.name, d.product_sold, d.policy_number, d.annual_premium,
  coalesce(d.posted_at::date, d.created_at::date), d.effective_date, d.status,
  d.created_at
from public.deals d
left join public.agents ag on ag.id = d.agent_id
left join public.carriers c on c.id = d.carrier_id
where d.agent_id is not null
  and d.annual_premium is not null
  and d.source = 'apex_native'
  and lower(coalesce(d.status, '')) not in (
    'lapsed', 'cancelled', 'charged_back', 'withdrawn', 'not_taken', 'declined'
  )
  and not public.fn_agent_is_roster_excluded(d.agent_id)
  and not exists (
    select 1 from public.v_agentlink_book_scoped b
    where nullif(btrim(coalesce(b.policy_number, '')), '') is not null
      and lower(btrim(b.policy_number)) = lower(btrim(coalesce(d.policy_number, '')))
  )
  and not exists (
    select 1 from public.v_agentlink_book_scoped b2
    where b2.agent_id = d.agent_id
      and b2.annual_premium = d.annual_premium
      and b2.effective_date = d.effective_date
      and lower(btrim(coalesce(b2.client_name, ''))) =
          lower(btrim(coalesce(d.client_first_name, '') || ' ' || coalesce(d.client_last_name, '')))
  )

union all

select
  'external-deal:' || e.source || ':' || e.external_ref,
  'discord_external'::text,
  e.canonical_agent_id,
  e.agent_name,
  null::text as client_name,
  e.carrier,
  e.product,
  e.policy_number,
  e.annual_premium,
  e.posted_date,
  null::date as effective_date,
  e.status,
  e.updated_at as synced_at
from external_ranked e
left join agentlink_match_counts c
  on c.canonical_agent_id = e.canonical_agent_id
 and c.posted_date = e.posted_date
 and c.annual_premium = e.annual_premium
 and c.face_amount = coalesce(e.face_amount, 0)
 and c.carrier_key = lower(btrim(coalesce(e.carrier, '')))
where e.match_rank > coalesce(c.matched_rows, 0)
  and not exists (
    select 1 from public.v_agentlink_book_scoped b
    where nullif(btrim(coalesce(e.policy_number, '')), '') is not null
      and lower(btrim(b.policy_number)) = lower(btrim(e.policy_number))
  );

grant select on public.v_production_canonical to authenticated, service_role;

do $$
begin
  alter publication supabase_realtime add table public.production_external_deals;
exception when duplicate_object then null;
end $$;

-- Live, message-level evidence observed in Vantage Financial #daily-sales on
-- 2026-08-26. No client or policy identity is copied from Discord.
select public.ingest_external_production_deal(
  'discord_vantage_agentcloud',
  'guild-1537486129224224830-channel-1537486131329896506-20260826-0545-marquay-2037',
  'Vantage Financial', '021f1686-2560-4b05-9281-c3a66d23c1f2'::uuid,
  'Marquay Vaughns', 'Ethos', 'Whole Life', 170, 2037, 31000,
  timestamptz '2026-08-26 05:45:00 America/Phoenix', date '2026-08-26',
  jsonb_build_object('provenance', 'Vantage Discord #daily-sales', 'observed_at', now())
);

select public.ingest_external_production_deal(
  'discord_vantage_agentcloud',
  'guild-1537486129224224830-channel-1537486131329896506-20260826-0712-marquay-1094',
  'Vantage Financial', '021f1686-2560-4b05-9281-c3a66d23c1f2'::uuid,
  'Marquay Vaughns', 'Ethos', 'Whole Life', 91, 1094, 8000,
  timestamptz '2026-08-26 07:12:00 America/Phoenix', date '2026-08-26',
  jsonb_build_object('provenance', 'Vantage Discord #daily-sales', 'observed_at', now())
);

select public.ingest_external_production_deal(
  'discord_vantage_agentcloud',
  'guild-1537486129224224830-channel-1537486131329896506-20260826-0749-pranav-4020',
  'Vantage Financial', '20344eff-2a14-4b9f-bae2-fabc87f55c07'::uuid,
  'Pranav Kodali', 'Ethos', 'Whole Life', 335, 4020, 25000,
  timestamptz '2026-08-26 07:49:00 America/Phoenix', date '2026-08-26',
  jsonb_build_object('provenance', 'Vantage Discord #daily-sales', 'observed_at', now())
);

comment on table public.production_external_deals is
  'Named-agent, message-level external production facts. Reconciled one-for-one against later AgentLink rows by v_production_canonical.';
comment on function public.ingest_external_production_deal(
  text, text, text, uuid, text, text, text, numeric, numeric, numeric,
  timestamptz, date, jsonb
) is 'Service-role idempotent ingestion for verified external production messages; returns recorded or already_recorded.';

commit;
