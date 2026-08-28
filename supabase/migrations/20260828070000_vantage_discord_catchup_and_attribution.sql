-- Catch up verified Vantage #daily-sales messages and preserve the actual
-- writing agent on leaderboards. Canonical IDs remain reconciliation keys only;
-- they must not replace the seller identity shown to operators.

begin;

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
    btrim(p_source), btrim(p_external_ref), btrim(p_agency_name), p_agent_id,
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

create or replace view public.v_production_canonical
with (security_invoker = on) as
with external_ranked as (
  select
    e.*,
    coalesce(m.canonical_agent_id, e.agent_id) as canonical_agent_id,
    row_number() over (
      partition by coalesce(m.canonical_agent_id, e.agent_id), e.posted_date,
        e.annual_premium, coalesce(e.face_amount, 0),
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
  e.agent_id,
  e.agent_name,
  null::text,
  e.carrier,
  e.product,
  e.policy_number,
  e.annual_premium,
  e.posted_date,
  null::date,
  e.status,
  e.updated_at
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

-- Verified Discord message-level facts. external_ref is the immutable Discord
-- message ID, making this seed safe to replay.
select public.ingest_external_production_deal('discord_vantage_agentcloud','1542217782123560961','Vantage Financial','021f1686-2560-4b05-9281-c3a66d23c1f2','Marquay Vaughns','Ethos','Whole Life',240,2882,20000,'2026-08-26T17:02:52.279Z','2026-08-26',jsonb_build_object('discord_message_id','1542217782123560961'));
select public.ingest_external_production_deal('discord_vantage_agentcloud','1542269363564978257','Vantage Financial','021f1686-2560-4b05-9281-c3a66d23c1f2','Marquay Vaughns','Newbridge Life','Whole Life',145,1740,12000,'2026-08-26T20:27:50.253Z','2026-08-26',jsonb_build_object('discord_message_id','1542269363564978257'));
select public.ingest_external_production_deal('discord_vantage_agentcloud','1542270229143617607','Vantage Financial','d607c992-7625-4e41-81de-b06c0a5c8161','David Ladd','Combined Life',null,100,1200,7525,'2026-08-26T20:31:16.623Z','2026-08-26',jsonb_build_object('discord_message_id','1542270229143617607'));
select public.ingest_external_production_deal('discord_vantage_agentcloud','1542272979411664968','Vantage Financial','58c7b19b-5fd9-4e44-94a3-2c8ed6235685','Kaeden Vaughns','Ethos','Whole Life',167,2007,21000,'2026-08-26T20:42:12.338Z','2026-08-26',jsonb_build_object('discord_message_id','1542272979411664968'));

select public.ingest_external_production_deal('discord_vantage_agentcloud','1542539218750935112','Vantage Financial','021f1686-2560-4b05-9281-c3a66d23c1f2','Marquay Vaughns','Ethos','Whole Life',152,1824,15000,'2026-08-27T14:20:08.743Z','2026-08-27',jsonb_build_object('discord_message_id','1542539218750935112'));
select public.ingest_external_production_deal('discord_vantage_agentcloud','1542552365130059917','Vantage Financial','021f1686-2560-4b05-9281-c3a66d23c1f2','Marquay Vaughns','Newbridge Life','Whole Life',188,2253,9000,'2026-08-27T15:12:23.084Z','2026-08-27',jsonb_build_object('discord_message_id','1542552365130059917'));
select public.ingest_external_production_deal('discord_vantage_agentcloud','1542561773989928961','Vantage Financial','20344eff-2a14-4b9f-bae2-fabc87f55c07','Pranav Kodali','Ethos','Whole Life',149,1788,20000,'2026-08-27T15:49:46.331Z','2026-08-27',jsonb_build_object('discord_message_id','1542561773989928961'));
select public.ingest_external_production_deal('discord_vantage_agentcloud','1542564474433835190','Vantage Financial','d607c992-7625-4e41-81de-b06c0a5c8161','David Ladd','Ethos','Whole Life',216,2591,17000,'2026-08-27T16:00:30.167Z','2026-08-27',jsonb_build_object('discord_message_id','1542564474433835190'));
select public.ingest_external_production_deal('discord_vantage_agentcloud','1542591653448126466','Vantage Financial','20344eff-2a14-4b9f-bae2-fabc87f55c07','Pranav Kodali','Ethos','Whole Life',166,1992,25000,'2026-08-27T17:48:30.149Z','2026-08-27',jsonb_build_object('discord_message_id','1542591653448126466'));

-- Two 8/26 messages belong to an Alonzo who is not safely matchable to an
-- APEX agent. Preserve their aggregate without falsely assigning another user.
insert into public.production_external_daily_snapshots (
  agency_name, business_date, reported_policies, reported_alp,
  source, external_ref, metadata
) values (
  'Vantage Financial','2026-08-26',9,16888,
  'discord_vantage_message_reconciliation','channel-1537486131329896506-2026-08-26',
  jsonb_build_object('verified_named_rows',7,'unattributed_rows',2,'unattributed_alp',1908)
)
on conflict (agency_name, business_date, source) do update set
  reported_policies = excluded.reported_policies,
  reported_alp = excluded.reported_alp,
  external_ref = excluded.external_ref,
  metadata = excluded.metadata,
  reported_at = now(),
  updated_at = now();

comment on function public.ingest_external_production_deal(text,text,text,uuid,text,text,text,numeric,numeric,numeric,timestamptz,date,jsonb) is
  'Idempotent external production ingestion that preserves the actual writing agent while canonical IDs are used only for duplicate reconciliation.';

commit;
