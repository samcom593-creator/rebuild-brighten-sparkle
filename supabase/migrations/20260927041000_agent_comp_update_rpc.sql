-- Admin-gated comp/contract update from the agent drawer. Stamps who/when. EXCEPTION-safe.
create or replace function public.rp_update_agent_comp(p_agent_id uuid, p_comp numeric default null, p_contract numeric default null)
returns text language plpgsql security definer set search_path=public as $fn$
declare v_out text;
begin
  if not (public.has_role(auth.uid(),'admin') or public.has_role(auth.uid(),'manager')) then
    raise exception 'not authorized';
  end if;
  update public.agents set
    comp_percentage     = coalesce(p_comp, comp_percentage),
    contract_percentage = coalesce(p_contract, contract_percentage),
    comp_approval_status= 'approved',
    comp_approved_by    = auth.uid(),
    comp_approved_at    = now(),
    updated_at          = now()
  where id = p_agent_id;
  if not found then raise exception 'agent not found'; end if;
  select 'comp='||coalesce(comp_percentage::text,'-')||' contract='||coalesce(contract_percentage::text,'-')
    into v_out from public.agents where id=p_agent_id;
  return v_out;
end $fn$;
grant execute on function public.rp_update_agent_comp(uuid,numeric,numeric) to authenticated;
