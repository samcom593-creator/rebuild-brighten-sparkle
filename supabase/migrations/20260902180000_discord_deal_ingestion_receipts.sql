-- MP-389: durable inbound Discord deal ingestion for the APEX and Vantage
-- sales channels. Discord message IDs are transport receipts; canonical policy
-- rows remain production_external_deals -> v_production_canonical -> every live
-- dashboard. Unparseable/ambiguous posts are durable exceptions, never silent.

begin;

create table if not exists public.discord_deal_sources (
  source text primary key,
  agency_name text not null,
  guild_id text not null,
  channel_id text not null unique,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (source ~ '^discord_[a-z0-9_]+$'),
  check (guild_id ~ '^[0-9]{15,22}$'),
  check (channel_id ~ '^[0-9]{15,22}$')
);

insert into public.discord_deal_sources(source, agency_name, guild_id, channel_id)
values
  ('discord_apex_money_printer', 'APEX Financial', '792544196874469427', '1425987061013287022'),
  ('discord_vantage_agentcloud', 'Vantage Financial', '1537486129224224830', '1537486131329896506')
on conflict (source) do update set
  agency_name = excluded.agency_name,
  guild_id = excluded.guild_id,
  channel_id = excluded.channel_id,
  enabled = true,
  updated_at = now();

create table if not exists public.discord_deal_ingestion_receipts (
  id uuid primary key default gen_random_uuid(),
  source text not null references public.discord_deal_sources(source),
  guild_id text not null,
  channel_id text not null,
  message_id text not null,
  deal_ordinal integer not null default 0 check (deal_ordinal >= 0 and deal_ordinal < 50),
  status text not null check (status in ('ingested', 'duplicate', 'unresolved')),
  production_external_deal_id uuid references public.production_external_deals(id) on delete restrict,
  issue_code text,
  issue_detail text,
  content_sha256 text not null check (content_sha256 ~ '^[0-9a-f]{64}$'),
  parsed_payload jsonb not null default '{}'::jsonb,
  message_created_at timestamptz not null,
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  resolved_at timestamptz,
  unique (message_id, deal_ordinal),
  check (
    (status in ('ingested', 'duplicate') and production_external_deal_id is not null and issue_code is null)
    or (status = 'unresolved' and production_external_deal_id is null and issue_code is not null)
  )
);

create index if not exists discord_deal_ingestion_receipts_status_seen_idx
  on public.discord_deal_ingestion_receipts(status, last_seen_at desc);
create index if not exists discord_deal_ingestion_receipts_source_created_idx
  on public.discord_deal_ingestion_receipts(source, message_created_at desc);

create table if not exists public.discord_deal_ingestion_health (
  source text primary key references public.discord_deal_sources(source),
  status text not null check (status in ('healthy', 'credential_blocked', 'channel_unavailable', 'error')),
  last_heartbeat_at timestamptz not null default now(),
  last_message_at timestamptz,
  last_ingested_at timestamptz,
  detail text,
  updated_at timestamptz not null default now()
);

alter table public.discord_deal_sources enable row level security;
alter table public.discord_deal_ingestion_receipts enable row level security;
alter table public.discord_deal_ingestion_health enable row level security;
revoke all on public.discord_deal_sources from public, anon, authenticated;
revoke all on public.discord_deal_ingestion_receipts from public, anon, authenticated;
revoke all on public.discord_deal_ingestion_health from public, anon, authenticated;
grant select on public.discord_deal_sources to service_role;
grant select, insert, update on public.discord_deal_ingestion_receipts to service_role;
grant select, insert, update on public.discord_deal_ingestion_health to service_role;

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

  select coalesce(public.fn_canonical_agent_id(a.id), a.id)
  into v_canonical_agent_id
  from public.agents a
  where a.id = p_agent_id
    and coalesce(a.agent_code, '') not like 'GHOST_%';
  if v_canonical_agent_id is null then
    raise exception 'Discord producer does not resolve to a real APEX agent';
  end if;

  v_external_ref := p_message_id || case when p_deal_ordinal = 0 then '' else ':' || p_deal_ordinal::text end;
  v_metadata := coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
    'discord_message_id', p_message_id,
    'discord_channel_id', p_channel_id,
    'discord_guild_id', p_guild_id,
    'discord_deal_ordinal', p_deal_ordinal,
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
    p_source, v_external_ref, v_agency_name, v_canonical_agent_id, btrim(p_agent_name),
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

create or replace function public.record_discord_deal_ingestion_exception(
  p_source text,
  p_guild_id text,
  p_channel_id text,
  p_message_id text,
  p_deal_ordinal integer,
  p_message_created_at timestamptz,
  p_issue_code text,
  p_issue_detail text,
  p_content_sha256 text,
  p_parsed_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_receipt_id uuid;
begin
  if not exists (
    select 1 from public.discord_deal_sources s
    where s.source = p_source and s.guild_id = p_guild_id
      and s.channel_id = p_channel_id and s.enabled
  ) then
    raise exception 'Discord deal source/channel is not enabled';
  end if;
  if p_message_id !~ '^[0-9]{15,22}$'
     or p_deal_ordinal < 0 or p_deal_ordinal >= 50
     or p_message_created_at is null
     or nullif(btrim(p_issue_code), '') is null
     or p_content_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception 'Missing or invalid Discord exception identity';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_message_id || ':' || p_deal_ordinal::text, 0)
  );
  insert into public.discord_deal_ingestion_receipts(
    source, guild_id, channel_id, message_id, deal_ordinal, status,
    issue_code, issue_detail, content_sha256, parsed_payload, message_created_at
  ) values (
    p_source, p_guild_id, p_channel_id, p_message_id, p_deal_ordinal, 'unresolved',
    btrim(p_issue_code), left(nullif(btrim(p_issue_detail), ''), 700),
    p_content_sha256, coalesce(p_parsed_payload, '{}'::jsonb), p_message_created_at
  )
  on conflict (message_id, deal_ordinal) do update set
    source = case when discord_deal_ingestion_receipts.status = 'unresolved' then excluded.source else discord_deal_ingestion_receipts.source end,
    guild_id = case when discord_deal_ingestion_receipts.status = 'unresolved' then excluded.guild_id else discord_deal_ingestion_receipts.guild_id end,
    channel_id = case when discord_deal_ingestion_receipts.status = 'unresolved' then excluded.channel_id else discord_deal_ingestion_receipts.channel_id end,
    issue_code = case when discord_deal_ingestion_receipts.status = 'unresolved' then excluded.issue_code else null end,
    issue_detail = case when discord_deal_ingestion_receipts.status = 'unresolved' then excluded.issue_detail else null end,
    content_sha256 = excluded.content_sha256,
    parsed_payload = case when discord_deal_ingestion_receipts.status = 'unresolved' then excluded.parsed_payload else discord_deal_ingestion_receipts.parsed_payload end,
    message_created_at = excluded.message_created_at,
    last_seen_at = now()
  returning id into v_receipt_id;
  return jsonb_build_object('status', 'unresolved', 'receipt_id', v_receipt_id);
end;
$function$;

create or replace function public.record_discord_deal_ingestion_heartbeat(
  p_source text,
  p_status text,
  p_last_message_at timestamptz default null,
  p_last_ingested_at timestamptz default null,
  p_detail text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $function$
begin
  if p_status not in ('healthy', 'credential_blocked', 'channel_unavailable', 'error') then
    raise exception 'Invalid Discord ingestion heartbeat state';
  end if;
  if not exists (select 1 from public.discord_deal_sources where source = p_source and enabled) then
    raise exception 'Discord deal source is not enabled';
  end if;
  insert into public.discord_deal_ingestion_health(
    source, status, last_heartbeat_at, last_message_at, last_ingested_at, detail, updated_at
  ) values (
    p_source, p_status, now(), p_last_message_at, p_last_ingested_at,
    left(nullif(btrim(p_detail), ''), 700), now()
  )
  on conflict (source) do update set
    status = excluded.status,
    last_heartbeat_at = excluded.last_heartbeat_at,
    last_message_at = greatest(public.discord_deal_ingestion_health.last_message_at, excluded.last_message_at),
    last_ingested_at = greatest(public.discord_deal_ingestion_health.last_ingested_at, excluded.last_ingested_at),
    detail = excluded.detail,
    updated_at = now();
end;
$function$;

create or replace view public.v_discord_deal_ingestion_health
with (security_invoker = on) as
select
  s.source,
  s.agency_name,
  s.guild_id,
  s.channel_id,
  coalesce(h.status, 'never_seen') as status,
  h.last_heartbeat_at,
  h.last_message_at,
  h.last_ingested_at,
  h.detail,
  coalesce(r.unresolved_total, 0)::integer as unresolved_total,
  coalesce(r.unresolved_24h, 0)::integer as unresolved_24h,
  r.latest_receipt_at,
  now() as measured_at
from public.discord_deal_sources s
left join public.discord_deal_ingestion_health h on h.source = s.source
left join lateral (
  select
    count(*) filter (where x.status = 'unresolved') as unresolved_total,
    count(*) filter (where x.status = 'unresolved' and x.last_seen_at >= now() - interval '24 hours') as unresolved_24h,
    max(x.last_seen_at) as latest_receipt_at
  from public.discord_deal_ingestion_receipts x
  where x.source = s.source
) r on true
where s.enabled;

revoke all on function public.ingest_discord_production_deal(
  text, text, text, text, integer, uuid, text, text, text, text,
  numeric, numeric, numeric, timestamptz, date, text, jsonb
) from public, anon, authenticated;
revoke all on function public.record_discord_deal_ingestion_exception(
  text, text, text, text, integer, timestamptz, text, text, text, jsonb
) from public, anon, authenticated;
revoke all on function public.record_discord_deal_ingestion_heartbeat(
  text, text, timestamptz, timestamptz, text
) from public, anon, authenticated;
grant execute on function public.ingest_discord_production_deal(
  text, text, text, text, integer, uuid, text, text, text, text,
  numeric, numeric, numeric, timestamptz, date, text, jsonb
) to service_role;
grant execute on function public.record_discord_deal_ingestion_exception(
  text, text, text, text, integer, timestamptz, text, text, text, jsonb
) to service_role;
grant execute on function public.record_discord_deal_ingestion_heartbeat(
  text, text, timestamptz, timestamptz, text
) to service_role;
grant select on public.v_discord_deal_ingestion_health to service_role;
revoke all on public.v_discord_deal_ingestion_health from anon, authenticated;

comment on table public.discord_deal_ingestion_receipts is
  'PII-minimized receipt/exception ledger for inbound APEX and Vantage Discord sales messages.';
comment on function public.ingest_discord_production_deal(
  text, text, text, text, integer, uuid, text, text, text, text,
  numeric, numeric, numeric, timestamptz, date, text, jsonb
) is 'Idempotent Discord-message settlement into production_external_deals. Message ID stops retries; policy/canonical refs stop safe cross-channel duplicates; ambiguous value-only matches remain separate.';

commit;
