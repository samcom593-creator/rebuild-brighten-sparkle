-- MP-331b — add "Agency Owner" account mode.
--
-- Sam: "I should be able to change them from agency owner, recruiter, VA, agent,
-- etc." Agency Owner = someone who runs their own sub-agency under Sam (e.g. KJ /
-- Vantage). It carries MANAGER-level permissions, so rather than add a new
-- app_role and re-plumb every RLS policy that checks has_role(uid,'manager'),
-- the mode maps to the 'manager' user_role while account_mode records the
-- distinct 'agency_owner' label that drives role-specific screens.

create or replace function public.set_account_mode(p_agent_id uuid, p_mode text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_mode text := lower(btrim(coalesce(p_mode, '')));
  v_role public.app_role;
  v_uid uuid;
  v_name text;
begin
  if not public.apex_is_admin() then
    raise exception 'Only admins may switch account mode' using errcode = '42501';
  end if;
  if v_mode not in ('agent','manager','agency_owner','recruiter','va','va_manager') then
    raise exception 'Invalid account mode %; allowed: agent, manager, agency_owner, recruiter, va, va_manager', p_mode
      using errcode = '22023';
  end if;

  -- Mode → auth role. agency_owner runs a team, so it grants manager permissions.
  v_role := (case when v_mode = 'agency_owner' then 'manager' else v_mode end)::public.app_role;

  select a.user_id, a.display_name into v_uid, v_name
  from public.agents a where a.id = p_agent_id;
  if not found then
    raise exception 'Agent % not found', p_agent_id using errcode = '23503';
  end if;

  update public.agents
     set account_mode = v_mode,
         is_manager = (v_mode in ('manager','agency_owner')),
         updated_at = now()
   where id = p_agent_id;

  if v_uid is not null then
    delete from public.user_roles
     where user_id = v_uid
       and role in ('agent','manager','recruiter','va','va_manager');
    insert into public.user_roles (user_id, role)
    values (v_uid, v_role)
    on conflict (user_id, role) do nothing;
  end if;

  return jsonb_build_object('ok', true, 'agent_id', p_agent_id, 'name', v_name, 'mode', v_mode, 'auth_role', v_role::text, 'user_linked', v_uid is not null);
exception when others then
  return jsonb_build_object('ok', false, 'agent_id', p_agent_id, 'error', sqlerrm);
end;
$fn$;

revoke all on function public.set_account_mode(uuid, text) from public, anon;
grant execute on function public.set_account_mode(uuid, text) to authenticated, service_role;
