-- One-click contracting worklist: the Sam-owned gaps from v_contracting_audit,
-- each markable "handled" so it drops off and stays off across reloads — but
-- re-surfaces automatically if the next roster sync shows the SAME gap still
-- open (the ack is keyed on agent_id + the exact next_action, so once the agent
-- moves to a different stage the old ack no longer applies).

create table if not exists public.contracting_worklist_ack (
  id           uuid primary key default gen_random_uuid(),
  agent_id     uuid not null,
  next_action  text not null,
  acked_by     uuid,
  note         text,
  acked_at     timestamptz not null default now(),
  unique (agent_id, next_action)
);

alter table public.contracting_worklist_ack enable row level security;

drop policy if exists worklist_ack_admin_all on public.contracting_worklist_ack;
create policy worklist_ack_admin_all on public.contracting_worklist_ack
  for all using (has_role(auth.uid(), 'admin'::app_role)) with check (has_role(auth.uid(), 'admin'::app_role));

-- The Sam-owned queue with its handled state joined in.
create or replace view public.v_contracting_worklist
with (security_invoker = true) as
select
  a.agent_id,
  a.display_name,
  a.manager_name,
  a.next_action,
  a.license_status,
  a.npn_db,
  a.email,
  a.al_id,
  a.ethos_status,
  (k.agent_id is not null)  as handled,
  k.acked_at,
  k.note
from public.v_contracting_audit a
left join public.contracting_worklist_ack k
  on k.agent_id = a.agent_id and k.next_action = a.next_action
where a.next_action in (
  'resolve_npn_conflict','backfill_npn_from_source','merge_duplicate_agent_rows',
  'create_agentlink_profile','complete_agentlink_profile','upline_assign_in_agentlink',
  'fix_rejected_contracts','no_active_carrier_contracts','add_to_ethos_sheet',
  'ethos_agent_update_comp_level'
);

create or replace function public.contracting_worklist_ack(
  p_agent_id uuid, p_next_action text, p_note text default null
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not has_role(auth.uid(), 'admin'::app_role) then
    raise exception 'admin only' using errcode = '42501';
  end if;
  insert into public.contracting_worklist_ack (agent_id, next_action, acked_by, note)
  values (p_agent_id, p_next_action, auth.uid(), nullif(btrim(coalesce(p_note,'')), ''))
  on conflict (agent_id, next_action)
  do update set acked_by = auth.uid(), acked_at = now(),
                note = coalesce(nullif(btrim(coalesce(p_note,'')), ''), public.contracting_worklist_ack.note);
  return jsonb_build_object('ok', true, 'agent_id', p_agent_id, 'next_action', p_next_action, 'handled', true);
end;
$function$;

create or replace function public.contracting_worklist_unack(
  p_agent_id uuid, p_next_action text
) returns jsonb
language plpgsql security definer set search_path to 'public'
as $function$
begin
  if not has_role(auth.uid(), 'admin'::app_role) then
    raise exception 'admin only' using errcode = '42501';
  end if;
  delete from public.contracting_worklist_ack
   where agent_id = p_agent_id and next_action = p_next_action;
  return jsonb_build_object('ok', true, 'agent_id', p_agent_id, 'next_action', p_next_action, 'handled', false);
end;
$function$;

grant execute on function public.contracting_worklist_ack(uuid, text, text) to authenticated;
grant execute on function public.contracting_worklist_unack(uuid, text) to authenticated;
