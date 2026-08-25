-- Per-agent carrier contracting checklist shown inside AgentProfileDrawer.
--
-- agent_carrier_comp is intentionally the shared row: the contract workflow
-- ships now, and Sam's replacement comp grid can populate the same records
-- later without creating a second carrier-by-agent source of truth.

alter table public.agent_carrier_comp
  add column if not exists contract_status text not null default 'not_started',
  add column if not exists contract_sent_at timestamptz,
  add column if not exists contract_sent_by uuid references auth.users(id) on delete set null,
  add column if not exists contract_completed_at timestamptz,
  add column if not exists contract_status_note text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.agent_carrier_comp'::regclass
      and conname = 'agent_carrier_comp_contract_status_check'
  ) then
    alter table public.agent_carrier_comp
      add constraint agent_carrier_comp_contract_status_check
      check (contract_status in (
        'not_started', 'ready_to_send', 'sent', 'agent_action_required',
        'submitted', 'active', 'issue', 'declined', 'not_needed'
      ));
  end if;
end $$;

create index if not exists agent_carrier_comp_workflow_idx
  on public.agent_carrier_comp(agent_id, contract_status, updated_at desc);

create table if not exists public.agent_contract_status_history (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  carrier_id uuid references public.carriers(id) on delete set null,
  carrier_name text not null,
  from_status text,
  to_status text not null,
  note text,
  changed_by uuid references auth.users(id) on delete set null,
  changed_at timestamptz not null default now()
);

create index if not exists agent_contract_status_history_agent_idx
  on public.agent_contract_status_history(agent_id, changed_at desc);

alter table public.agent_contract_status_history enable row level security;

drop policy if exists agent_contract_history_scoped_read on public.agent_contract_status_history;
create policy agent_contract_history_scoped_read
  on public.agent_contract_status_history for select to authenticated
  using (public.apex_can_read_agent(agent_id));

-- One safe read surface. It combines every active APEX carrier, Sam's manual
-- workflow state, saved compensation, and the latest AgentLink appointment.
create or replace function public.apex_agent_contract_checklist(p_agent_id uuid)
returns table (
  carrier_id uuid,
  carrier_name text,
  workflow_status text,
  sent_at timestamptz,
  sent_by_name text,
  completed_at timestamptz,
  status_note text,
  contract_pct numeric,
  effective_pct numeric,
  override_pct numeric,
  live_status text,
  writing_number text,
  contract_number text,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
begin
  if auth.uid() is null or not public.apex_can_read_agent(p_agent_id) then
    raise exception 'Not permitted to view this agent' using errcode = '42501';
  end if;

  return query
  select
    c.id,
    c.name,
    coalesce(acc.contract_status, 'not_started'),
    acc.contract_sent_at,
    coalesce(nullif(trim(actor.full_name), ''), nullif(trim(actor.display_name), '')),
    acc.contract_completed_at,
    acc.contract_status_note,
    acc.contract_pct,
    acc.effective_pct,
    acc.override_pct,
    live.status,
    live.writing_number,
    live.contract_number,
    acc.updated_at
  from public.carriers c
  left join public.agent_carrier_comp acc
    on acc.agent_id = p_agent_id
   and lower(trim(acc.carrier_name)) = lower(trim(c.name))
  left join lateral (
    select
      (select pr.full_name from public.profiles pr
        where pr.user_id = acc.contract_sent_by
        order by pr.updated_at desc nulls last, pr.id
        limit 1) as full_name,
      (select ax.display_name from public.agents ax
        where ax.user_id = acc.contract_sent_by
        order by ax.updated_at desc nulls last, ax.id
        limit 1) as display_name
  ) actor on true
  left join lateral (
    select alc.status, alc.writing_number, alc.contract_number
    from public.agentlink_contracts alc
    where alc.agent_id = p_agent_id
      and (
        alc.carrier_id = c.id
        or lower(trim(coalesce(alc.raw_payload -> 'carrier' ->> 'name', ''))) = lower(trim(c.name))
      )
    order by
      case lower(coalesce(alc.status, ''))
        when 'active' then 0 when 'submitted' then 1 else 2
      end,
      alc.updated_at desc nulls last,
      alc.id
    limit 1
  ) live on true
  where coalesce(c.is_active, true)
  order by c.name;
end;
$$;

comment on function public.apex_agent_contract_checklist(uuid) is
  'Per-agent onboarding contract checklist: active carriers plus manual workflow, saved comp and latest AgentLink appointment. Scoped through apex_can_read_agent.';

-- Sam/admin is the only writer. The RPC makes timestamp semantics and history
-- atomic, so the UI cannot say "sent" without a sent timestamp and receipt.
create or replace function public.apex_set_agent_contract_status(
  p_agent_id uuid,
  p_carrier_id uuid,
  p_status text,
  p_note text default null
)
returns public.agent_carrier_comp
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_carrier public.carriers%rowtype;
  v_previous text;
  v_row public.agent_carrier_comp%rowtype;
  v_status text := lower(trim(coalesce(p_status, '')));
begin
  if auth.uid() is null or not public.apex_is_admin() then
    raise exception 'Admin access required' using errcode = '42501';
  end if;

  if v_status not in (
    'not_started', 'ready_to_send', 'sent', 'agent_action_required',
    'submitted', 'active', 'issue', 'declined', 'not_needed'
  ) then
    raise exception 'Invalid contract status';
  end if;

  if not exists (select 1 from public.agents where id = p_agent_id) then
    raise exception 'Agent not found';
  end if;

  select * into v_carrier from public.carriers where id = p_carrier_id and coalesce(is_active, true);
  if v_carrier.id is null then raise exception 'Carrier not found'; end if;

  select contract_status into v_previous
  from public.agent_carrier_comp
  where agent_id = p_agent_id and carrier_name = v_carrier.name;

  insert into public.agent_carrier_comp (
    agent_id, carrier_id, carrier_name, contract_status,
    contract_sent_at, contract_sent_by, contract_completed_at,
    contract_status_note, updated_at
  ) values (
    p_agent_id, v_carrier.id, v_carrier.name, v_status,
    case when v_status in ('sent','agent_action_required','submitted','active','issue','declined') then now() else null end,
    case when v_status in ('sent','agent_action_required','submitted','active','issue','declined') then auth.uid() else null end,
    case when v_status = 'active' then now() else null end,
    nullif(trim(coalesce(p_note, '')), ''), now()
  )
  on conflict (agent_id, carrier_name) do update set
    carrier_id = excluded.carrier_id,
    contract_status = excluded.contract_status,
    contract_sent_at = case
      when excluded.contract_status in ('sent','agent_action_required','submitted','active','issue','declined')
        then coalesce(agent_carrier_comp.contract_sent_at, now())
      else null
    end,
    contract_sent_by = case
      when excluded.contract_status in ('sent','agent_action_required','submitted','active','issue','declined')
        then coalesce(agent_carrier_comp.contract_sent_by, auth.uid())
      else null
    end,
    contract_completed_at = case
      when excluded.contract_status = 'active' then coalesce(agent_carrier_comp.contract_completed_at, now())
      else null
    end,
    contract_status_note = coalesce(excluded.contract_status_note, agent_carrier_comp.contract_status_note),
    updated_at = now()
  returning * into v_row;

  insert into public.agent_contract_status_history (
    agent_id, carrier_id, carrier_name, from_status, to_status, note, changed_by
  ) values (
    p_agent_id, v_carrier.id, v_carrier.name,
    coalesce(v_previous, 'not_started'), v_status,
    nullif(trim(coalesce(p_note, '')), ''), auth.uid()
  );

  return v_row;
end;
$$;

revoke all on function public.apex_agent_contract_checklist(uuid) from public, anon;
revoke all on function public.apex_set_agent_contract_status(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.apex_agent_contract_checklist(uuid) to authenticated;
grant execute on function public.apex_set_agent_contract_status(uuid,uuid,text,text) to authenticated;

grant select on public.agent_contract_status_history to authenticated;
