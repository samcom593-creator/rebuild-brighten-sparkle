-- My Team contract check-offs (2026-10-09): a manual per-agent checklist Sam ticks on the CRM roster
-- (First contract / Aflac / Ethos / AgentLink / …), independent of the auto-synced AgentLink contract
-- data. Mirrors what was applied live via bot-sql. Idempotent.
create table if not exists public.agent_contract_checkoffs (
  agent_id uuid not null,
  contract_key text not null,
  checked_at timestamptz not null default now(),
  checked_by uuid,
  primary key (agent_id, contract_key)
);
alter table public.agent_contract_checkoffs enable row level security;
drop policy if exists acc_read on public.agent_contract_checkoffs;
create policy acc_read on public.agent_contract_checkoffs for select to authenticated using (true);

-- Writes go only through this gated RPC (no direct insert/update/delete policy = denied to users).
create or replace function public.toggle_agent_contract_checkoff(p_agent_id uuid, p_contract_key text, p_checked boolean)
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if not (has_role(auth.uid(), 'admin'::app_role) or has_role(auth.uid(), 'manager'::app_role)) then
    raise exception 'not authorized to set contract check-offs';
  end if;
  if coalesce(length(p_contract_key), 0) = 0 or length(p_contract_key) > 40 then
    raise exception 'bad contract_key';
  end if;
  if p_checked then
    insert into public.agent_contract_checkoffs(agent_id, contract_key, checked_by)
    values (p_agent_id, p_contract_key, auth.uid())
    on conflict (agent_id, contract_key) do update set checked_at = now(), checked_by = auth.uid();
  else
    delete from public.agent_contract_checkoffs where agent_id = p_agent_id and contract_key = p_contract_key;
  end if;
end $fn$;
grant execute on function public.toggle_agent_contract_checkoff(uuid, text, boolean) to authenticated;
