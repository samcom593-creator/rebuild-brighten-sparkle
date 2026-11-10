-- MP-TEAM-CARRIER-CONTRACTS (2026-11-10)
-- Sam, My Team: "I can click whether they've received their contract — Chubb, Ethos,
-- American Home Life." One tap per carrier per agent, from the My Team person drawer.
--
-- Deliberately built on getting_started_progress.contracted_{chubb,ethos,ahl}_sent — the
-- SAME timestamps the contracting-stalled alert (fn_onboarding_contracting_stalled_alert)
-- and the agent's own Getting Started already read. So one click both records the fact AND
-- silences the weekly "contracting stalled" page for that carrier. NOT a third parallel
-- table. AHL is hidden for agents in OB's / Chudi's hierarchies, exactly as the alert skips
-- them (carrier_hierarchy_exemptions, recursive on manager_id + invited_by_manager_id).

-- 1) AHL exemption for ANY agent (the alert's own recursive set, parameterised).
create or replace function public.fn_agent_ahl_exempt(p_agent_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  with recursive down(id) as (
    select e.root_agent_id from carrier_hierarchy_exemptions e where e.carrier = 'american_home_life'
    union
    select ag.id from agents ag join down d on ag.manager_id = d.id or ag.invited_by_manager_id = d.id
  )
  select exists (select 1 from down where id = p_agent_id);
$$;

-- 2) Audit log — every toggle, who and when (full history, both directions).
create table if not exists public.team_carrier_contract_events (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null,
  carrier text not null,
  received boolean not null,
  acted_by uuid,
  acted_at timestamptz not null default now()
);
alter table public.team_carrier_contract_events enable row level security;
drop policy if exists tcce_read on public.team_carrier_contract_events;
create policy tcce_read on public.team_carrier_contract_events for select
  using (public.apex_can_read_agent(agent_id));
-- writes only through the SECURITY DEFINER RPC below; no direct insert grant.

-- 3) Status for one agent: which carrier contracts are marked received, + AHL exemption.
create or replace function public.team_carrier_contract_status(p_agent_id uuid)
returns jsonb language plpgsql stable security definer set search_path to 'public' as $$
declare v record; v_exempt boolean;
begin
  if auth.uid() is null or not public.apex_can_read_agent(p_agent_id) then
    raise exception 'Not permitted to view this agent' using errcode = '42501';
  end if;
  select contracted_chubb_sent, contracted_ethos_sent, contracted_ahl_sent
    into v from public.getting_started_progress where agent_id = p_agent_id;
  v_exempt := public.fn_agent_ahl_exempt(p_agent_id);
  return jsonb_build_object(
    'chubb', v.contracted_chubb_sent is not null, 'chubb_at', v.contracted_chubb_sent,
    'ethos', v.contracted_ethos_sent is not null, 'ethos_at', v.contracted_ethos_sent,
    'ahl',   v.contracted_ahl_sent   is not null, 'ahl_at',   v.contracted_ahl_sent,
    'ahl_exempt', v_exempt
  );
end;
$$;

-- 4) The toggle. Admin (Sam) or a manager over this agent (Aisha) only.
create or replace function public.set_team_carrier_contract(p_agent_id uuid, p_carrier text, p_received boolean)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_col text;
begin
  if auth.uid() is null or not (
    public.apex_is_admin()
    or (public.has_role(auth.uid(), 'manager'::app_role) and public.apex_can_read_agent(p_agent_id))
  ) then
    raise exception 'Not permitted to set contracts for this agent' using errcode = '42501';
  end if;
  v_col := case lower(p_carrier)
    when 'chubb' then 'contracted_chubb_sent'
    when 'ethos' then 'contracted_ethos_sent'
    when 'ahl' then 'contracted_ahl_sent'
    when 'american_home_life' then 'contracted_ahl_sent'
    else null end;
  if v_col is null then
    raise exception 'Unknown carrier % (expected chubb, ethos, ahl)', p_carrier using errcode = '22023';
  end if;
  -- the 6 agents without a Getting Started row still need to be markable
  insert into public.getting_started_progress (agent_id) values (p_agent_id)
    on conflict (agent_id) do nothing;
  -- coalesce on set keeps the ORIGINAL received-date if it was already marked (re-toggling
  -- on does not rewrite history); clearing sets null.
  execute format(
    'update public.getting_started_progress set %1$I = case when $1 then coalesce(%1$I, now()) else null end where agent_id = $2',
    v_col) using p_received, p_agent_id;
  insert into public.team_carrier_contract_events (agent_id, carrier, received, acted_by)
    values (p_agent_id, lower(p_carrier), p_received, auth.uid());
  return public.team_carrier_contract_status(p_agent_id);
end;
$$;

revoke all on function public.fn_agent_ahl_exempt(uuid) from public, anon;
revoke all on function public.team_carrier_contract_status(uuid) from public, anon;
revoke all on function public.set_team_carrier_contract(uuid, text, boolean) from public, anon;
grant execute on function public.team_carrier_contract_status(uuid) to authenticated, service_role;
grant execute on function public.set_team_carrier_contract(uuid, text, boolean) to authenticated, service_role;
grant execute on function public.fn_agent_ahl_exempt(uuid) to authenticated, service_role;
