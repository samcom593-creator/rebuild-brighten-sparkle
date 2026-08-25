-- P0 · canonical deal-ledger idempotency.
--
-- The implementation packet called the ledger `policies`; this repository's
-- canonical writable policy ledger is public.deals. Identity is therefore the
-- requested (carrier_id, normalized policy_number, writing_npn) tuple.
-- Existing repeated AgentLink mirror rows are retained and reversibly linked
-- to one canonical row. Nothing is deleted.

begin;

alter table public.deals
  add column if not exists writing_npn text,
  add column if not exists duplicate_of_deal_id uuid references public.deals(id) on delete restrict;

comment on column public.deals.writing_npn is
  'NPN captured from the writing agent when the ledger row is created; part of the canonical policy identity.';
comment on column public.deals.duplicate_of_deal_id is
  'Reversible link for a pre-constraint duplicate. NULL means this is the canonical ledger row.';

-- Freeze the writing identity on existing rows before any uniqueness decision.
update public.deals d
set writing_npn = nullif(regexp_replace(coalesce(a.nipr_number, ''), '[^0-9]', '', 'g'), '')
from public.agents a
where a.id = d.agent_id
  and d.writing_npn is null;

-- The live audit found legacy AgentLink repeats. Prefer the row representing
-- the strongest current carrier state, then the freshest record. The others
-- remain available for audit but can no longer become the canonical policy.
with ranked as (
  select
    d.id,
    first_value(d.id) over (
      partition by d.carrier_id, lower(btrim(d.policy_number)), d.writing_npn
      order by
        case lower(coalesce(d.status, ''))
          when 'active' then 0
          when 'in_force' then 0
          when 'issued' then 1
          when 'approved' then 1
          when 'submitted' then 2
          when 'needs_review' then 3
          else 4
        end,
        coalesce(d.status_updated_at, d.updated_at, d.posted_at, d.created_at) desc,
        d.id
    ) as canonical_id,
    row_number() over (
      partition by d.carrier_id, lower(btrim(d.policy_number)), d.writing_npn
      order by
        case lower(coalesce(d.status, ''))
          when 'active' then 0
          when 'in_force' then 0
          when 'issued' then 1
          when 'approved' then 1
          when 'submitted' then 2
          when 'needs_review' then 3
          else 4
        end,
        coalesce(d.status_updated_at, d.updated_at, d.posted_at, d.created_at) desc,
        d.id
    ) as position
  from public.deals d
  where d.carrier_id is not null
    and nullif(btrim(d.policy_number), '') is not null
    and d.writing_npn is not null
)
update public.deals d
set duplicate_of_deal_id = ranked.canonical_id
from ranked
where d.id = ranked.id
  and ranked.position > 1
  and d.duplicate_of_deal_id is distinct from ranked.canonical_id;

create unique index if not exists deals_policy_identity_unique
  on public.deals(carrier_id, lower(btrim(policy_number)), writing_npn)
  where carrier_id is not null
    and nullif(btrim(policy_number), '') is not null
    and writing_npn is not null
    and duplicate_of_deal_id is null;

create index if not exists deals_duplicate_of_idx
  on public.deals(duplicate_of_deal_id)
  where duplicate_of_deal_id is not null;

create or replace function public.fn_deal_capture_writing_npn()
returns trigger
language plpgsql
set search_path = public
as $function$
begin
  if new.writing_npn is null or btrim(new.writing_npn) = '' then
    select nullif(regexp_replace(coalesce(a.nipr_number, ''), '[^0-9]', '', 'g'), '')
      into new.writing_npn
    from public.agents a
    where a.id = new.agent_id;
  else
    new.writing_npn := nullif(regexp_replace(new.writing_npn, '[^0-9]', '', 'g'), '');
  end if;
  return new;
end;
$function$;

drop trigger if exists trg_deal_capture_writing_npn on public.deals;
create trigger trg_deal_capture_writing_npn
before insert or update of agent_id, writing_npn on public.deals
for each row execute function public.fn_deal_capture_writing_npn();

-- Preserve the latest full submit implementation behind one wrapper. The
-- wrapper serializes on the business identity and returns an ordinary JSON
-- receipt for a replay, so PostgREST answers HTTP 200 instead of a 23505 error.
do $block$
begin
  if to_regprocedure('public.submit_apex_deal_ledger_impl(uuid,jsonb,uuid)') is null then
    alter function public.submit_apex_deal(uuid, jsonb, uuid)
      rename to submit_apex_deal_ledger_impl;
  end if;
end;
$block$;

revoke all on function public.submit_apex_deal_ledger_impl(uuid, jsonb, uuid)
  from public, anon, authenticated;

create or replace function public.submit_apex_deal(
  p_idempotency_key uuid,
  p_payload jsonb,
  p_agent_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as $function$
declare
  v_user_id uuid := auth.uid();
  v_own_agent_id uuid;
  v_agent_id uuid;
  v_carrier_id uuid;
  v_policy_number text := btrim(coalesce(p_payload->>'policyNumber', ''));
  v_writing_npn text;
  v_existing public.deals;
begin
  -- Keep authorization equivalent to the underlying submit function before
  -- disclosing that another agent's policy already exists.
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select a.id into v_own_agent_id
  from public.agents a
  where a.user_id = v_user_id
  order by a.created_at
  limit 1;

  v_agent_id := coalesce(p_agent_id, v_own_agent_id);
  if v_agent_id is distinct from v_own_agent_id then
    if not public.apex_is_admin()
       and not (
         public.apex_has_any_role(array['manager'])
         and public.apex_can_read_agent(v_agent_id)
       ) then
      raise exception 'Writing-agent override is not permitted' using errcode = '42501';
    end if;
  end if;

  begin
    v_carrier_id := nullif(p_payload->>'carrierId', '')::uuid;
  exception when others then
    v_carrier_id := null;
  end;

  select nullif(regexp_replace(coalesce(a.nipr_number, ''), '[^0-9]', '', 'g'), '')
    into v_writing_npn
  from public.agents a
  where a.id = v_agent_id;

  if v_carrier_id is not null and v_policy_number <> '' and v_writing_npn is not null then
    perform pg_advisory_xact_lock(
      hashtextextended(v_carrier_id::text || ':' || lower(v_policy_number) || ':' || v_writing_npn, 0)
    );

    select d.* into v_existing
    from public.deals d
    where d.carrier_id = v_carrier_id
      and lower(btrim(d.policy_number)) = lower(v_policy_number)
      and d.writing_npn = v_writing_npn
      and d.duplicate_of_deal_id is null
    order by d.created_at
    limit 1;

    if found then
      return jsonb_build_object(
        'ok', true,
        'status', 'already_recorded',
        'dealStatus', v_existing.status,
        'replayed', true,
        'dealId', v_existing.id,
        'correlationId', v_existing.correlation_id,
        'downstreamState', 'not_repeated'
      );
    end if;
  end if;

  return public.submit_apex_deal_ledger_impl(p_idempotency_key, p_payload, p_agent_id);
end;
$function$;

revoke all on function public.submit_apex_deal(uuid, jsonb, uuid) from public, anon;
grant execute on function public.submit_apex_deal(uuid, jsonb, uuid) to authenticated;

commit;
