-- MP-424: a Discord message is one durable production fact, and its named
-- writer remains the producer attached to that fact.
--
-- The gateway daemon numbers the first parsed deal as ordinal zero. A manual
-- message-link helper briefly numbered it as one, so the nine August catch-up
-- messages acquired both `<message_id>` and `<message_id>:1` rows. Preserve the
-- rows for audit, mark only the retry copies duplicate, and point their durable
-- receipts back to the original message rows.
--
-- The receipt RPC also canonicalized the supplied agent before storage. That
-- is correct for reconciliation, hierarchy scope, and comp, but wrong for the
-- source fact: Kaeden Vaughns' named deal was stored on departed KJ Vaughn's
-- agent id. Store the resolved writing-agent row and use canonical identity
-- only for safe duplicate comparison. v_production_comp_truth continues to
-- canonicalize downstream scope/comp while preserving the Discord writer name.

begin;

with retry_pairs as (
  select retry.id as retry_id, original.id as original_id
  from public.production_external_deals retry
  join public.production_external_deals original
    on original.source = retry.source
   and retry.external_ref = original.external_ref || ':1'
   and original.external_ref = retry.metadata ->> 'discord_message_id'
   and original.metadata ->> 'discord_message_id' = retry.metadata ->> 'discord_message_id'
  where retry.metadata ->> 'discord_deal_ordinal' = '1'
)
update public.discord_deal_ingestion_receipts receipt
set status = 'ingested',
    deal_ordinal = 0,
    production_external_deal_id = pair.original_id,
    issue_code = null,
    issue_detail = null,
    resolved_at = coalesce(receipt.resolved_at, now()),
    last_seen_at = now()
from retry_pairs pair
where receipt.production_external_deal_id = pair.retry_id;

with retry_pairs as (
  select retry.id as retry_id, original.id as original_id
  from public.production_external_deals retry
  join public.production_external_deals original
    on original.source = retry.source
   and retry.external_ref = original.external_ref || ':1'
   and original.external_ref = retry.metadata ->> 'discord_message_id'
   and original.metadata ->> 'discord_message_id' = retry.metadata ->> 'discord_message_id'
  where retry.metadata ->> 'discord_deal_ordinal' = '1'
)
update public.production_external_deals retry
set status = 'duplicate',
    metadata = retry.metadata || jsonb_build_object(
      'duplicate_of_external_deal_id', pair.original_id,
      'duplicate_reason', 'first deal ordinal mismatch repaired by MP-424'
    ),
    updated_at = now()
from retry_pairs pair
where retry.id = pair.retry_id;

create or replace function public.ingest_discord_production_deal(
  p_source text,
  p_guild_id text,
  p_channel_id text,
  p_message_id text,
  p_deal_ordinal integer,
  p_agent_id uuid,
  p_agent_name text,
  p_carrier text,
  p_product text,
  p_policy_number text,
  p_monthly_premium numeric,
  p_annual_premium numeric,
  p_face_amount numeric,
  p_occurred_at timestamptz,
  p_posted_date date,
  p_content_sha256 text,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_agency_name text;
  v_writer_agent_id uuid;
  v_canonical_agent_id uuid;
  v_external_ref text;
  v_existing_receipt public.discord_deal_ingestion_receipts%rowtype;
  v_deal_id uuid;
  v_duplicate_id uuid;
  v_inserted boolean;
  v_policy_number text := nullif(btrim(p_policy_number), '');
  v_carrier text := nullif(btrim(p_carrier), '');
  v_metadata jsonb;
  v_canonical_ref text := nullif(btrim(coalesce(p_metadata ->> 'canonical_deal_ref', '')), '');
begin
  select s.agency_name into v_agency_name
  from public.discord_deal_sources s
  where s.source = p_source
    and s.guild_id = p_guild_id
    and s.channel_id = p_channel_id
    and s.enabled;
  if v_agency_name is null then
    raise exception 'Discord deal source/channel is not enabled';
  end if;

  if p_message_id !~ '^[0-9]{15,22}$'
     or p_deal_ordinal < 0 or p_deal_ordinal >= 50
     or p_agent_id is null
     or nullif(btrim(p_agent_name), '') is null
     or p_annual_premium is null or p_annual_premium <= 0
     or p_occurred_at is null or p_posted_date is null
     or p_content_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Missing or invalid Discord production identity';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_message_id || ':' || p_deal_ordinal::text, 0)
  );

  select * into v_existing_receipt
  from public.discord_deal_ingestion_receipts r
  where r.message_id = p_message_id and r.deal_ordinal = p_deal_ordinal
  for update;
  if found
     and v_existing_receipt.status in ('ingested', 'duplicate')
     and v_existing_receipt.content_sha256 = p_content_sha256 then
    update public.discord_deal_ingestion_receipts
    set last_seen_at = now(), content_sha256 = p_content_sha256
    where id = v_existing_receipt.id;
    return jsonb_build_object(
      'status', 'already_recorded',
      'receipt_id', v_existing_receipt.id,
      'production_external_deal_id', v_existing_receipt.production_external_deal_id
    );
  end if;

  -- The writer row is the source fact. Canonical identity is a comparison key,
  -- not permission to replace the named producer attached to the deal.
  select a.id, coalesce(public.fn_canonical_agent_id(a.id), a.id)
  into v_writer_agent_id, v_canonical_agent_id
  from public.agents a
  where a.id = p_agent_id
    and coalesce(a.agent_code, '') not like 'GHOST_%'
    and not coalesce(a.is_deactivated, false)
    and not coalesce(a.is_inactive, false)
    and lower(coalesce(a.status, 'active')) not in ('inactive', 'deactivated', 'terminated')
    and a.id <> '431dff0d-7c82-4134-a85e-457e5226fc7f'::uuid;
  if v_writer_agent_id is null or v_canonical_agent_id is null then
    raise exception 'Discord producer does not resolve to an eligible APEX agent';
  end if;

  v_external_ref := p_message_id || case when p_deal_ordinal = 0 then '' else ':' || p_deal_ordinal::text end;
  v_metadata := coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
    'discord_message_id', p_message_id,
    'discord_channel_id', p_channel_id,
    'discord_guild_id', p_guild_id,
    'discord_deal_ordinal', p_deal_ordinal,
    'source_writer_agent_id', v_writer_agent_id,
    'canonical_agent_id', v_canonical_agent_id,
    'content_sha256', p_content_sha256
  );

  -- Discord message IDs stop retries. A policy/canonical reference stops the
  -- same real deal copied into both sales channels. Value-only fingerprints are
  -- deliberately NOT collapsed: one producer can write two equal-value policies
  -- on one day, and deleting the second would be a commission-affecting guess.
  if v_policy_number is not null then
    select e.id into v_duplicate_id
    from public.production_external_deals e
    where coalesce(public.fn_canonical_agent_id(e.agent_id), e.agent_id) = v_canonical_agent_id
      and lower(btrim(coalesce(e.policy_number, ''))) = lower(v_policy_number)
      and lower(btrim(coalesce(e.carrier, ''))) = lower(btrim(coalesce(v_carrier, '')))
      and not (e.source = p_source and e.external_ref = v_external_ref)
    order by e.created_at, e.id
    limit 1;
  end if;

  if v_duplicate_id is null and v_canonical_ref is not null then
    select e.id into v_duplicate_id
    from public.production_external_deals e
    where nullif(btrim(coalesce(e.metadata ->> 'canonical_deal_ref', '')), '') = v_canonical_ref
    order by e.created_at, e.id
    limit 1;
  end if;

  if v_duplicate_id is not null then
    insert into public.discord_deal_ingestion_receipts(
      source, guild_id, channel_id, message_id, deal_ordinal, status,
      production_external_deal_id, content_sha256, parsed_payload,
      message_created_at, resolved_at
    ) values (
      p_source, p_guild_id, p_channel_id, p_message_id, p_deal_ordinal, 'duplicate',
      v_duplicate_id, p_content_sha256, v_metadata, p_occurred_at, now()
    )
    on conflict (message_id, deal_ordinal) do update set
      source = excluded.source,
      guild_id = excluded.guild_id,
      channel_id = excluded.channel_id,
      status = 'duplicate',
      production_external_deal_id = excluded.production_external_deal_id,
      issue_code = null,
      issue_detail = null,
      content_sha256 = excluded.content_sha256,
      parsed_payload = excluded.parsed_payload,
      message_created_at = excluded.message_created_at,
      last_seen_at = now(),
      resolved_at = now();
    return jsonb_build_object(
      'status', 'duplicate',
      'production_external_deal_id', v_duplicate_id
    );
  end if;

  insert into public.production_external_deals(
    source, external_ref, agency_name, agent_id, agent_name,
    carrier, product, policy_number, monthly_premium, annual_premium,
    face_amount, occurred_at, posted_date, metadata
  ) values (
    p_source, v_external_ref, v_agency_name, v_writer_agent_id, btrim(p_agent_name),
    v_carrier, nullif(btrim(p_product), ''), v_policy_number, p_monthly_premium,
    p_annual_premium, p_face_amount, p_occurred_at, p_posted_date, v_metadata
  )
  on conflict (source, external_ref) do update set
    agency_name = excluded.agency_name,
    agent_id = excluded.agent_id,
    agent_name = excluded.agent_name,
    carrier = excluded.carrier,
    product = excluded.product,
    policy_number = excluded.policy_number,
    monthly_premium = excluded.monthly_premium,
    annual_premium = excluded.annual_premium,
    face_amount = excluded.face_amount,
    occurred_at = excluded.occurred_at,
    posted_date = excluded.posted_date,
    metadata = public.production_external_deals.metadata || excluded.metadata,
    updated_at = now()
  returning id, (xmax = 0) into v_deal_id, v_inserted;

  insert into public.discord_deal_ingestion_receipts(
    source, guild_id, channel_id, message_id, deal_ordinal, status,
    production_external_deal_id, content_sha256, parsed_payload,
    message_created_at, resolved_at
  ) values (
    p_source, p_guild_id, p_channel_id, p_message_id, p_deal_ordinal, 'ingested',
    v_deal_id, p_content_sha256, v_metadata, p_occurred_at, now()
  )
  on conflict (message_id, deal_ordinal) do update set
    source = excluded.source,
    guild_id = excluded.guild_id,
    channel_id = excluded.channel_id,
    status = 'ingested',
    production_external_deal_id = excluded.production_external_deal_id,
    issue_code = null,
    issue_detail = null,
    content_sha256 = excluded.content_sha256,
    parsed_payload = excluded.parsed_payload,
    message_created_at = excluded.message_created_at,
    last_seen_at = now(),
    resolved_at = now();

  return jsonb_build_object(
    'status', case when v_inserted then 'recorded' else 'updated' end,
    'production_external_deal_id', v_deal_id
  );
end;
$function$;

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
    'duplicate', 'lapsed', 'cancelled', 'charged_back', 'withdrawn', 'not_taken', 'declined'
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

comment on function public.ingest_discord_production_deal(
  text, text, text, text, integer, uuid, text, text, text, text,
  numeric, numeric, numeric, timestamptz, date, text, jsonb
) is 'Idempotent Discord-message settlement. Stores the source-resolved writer; canonical identity is used only for duplicate comparison and downstream scope/comp.';

comment on view public.v_production_canonical is
  'Canonical live production. Discord retry copies marked duplicate remain auditable in production_external_deals but never enter dashboard totals.';

commit;
