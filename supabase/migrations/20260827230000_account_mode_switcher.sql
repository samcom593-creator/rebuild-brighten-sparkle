-- MP-331 — switchable account mode + "pure recruiter".
--
-- Sam: "give me the ability to switch people's account mode. Also add pure
-- recruiter." Roles lived only in user_roles (admin/agent/manager/va/va_manager)
-- with agents.is_manager as a side flag, and there was no admin RPC to change a
-- person's mode and no recruiter role. This adds:
--   1. app_role value 'recruiter' (added separately, before this migration).
--   2. agents.account_mode — the explicit, switchable mode an admin sets.
--   3. set_account_mode(agent, mode) — admin-gated, syncs account_mode +
--      is_manager + user_roles in one guarded write.
--
-- "Pure recruiter" = recruits only, no production book / no manager team. It is a
-- distinct mode, not manager-who-also-recruits.

-- 1. The switchable mode column (single source of truth for a person's mode).
alter table public.agents
  add column if not exists account_mode text not null default 'agent';

-- 2. Backfill from the roles that already exist so no one's mode reads wrong on
--    day one. Precedence: admin > va_manager > va > manager/is_manager > agent.
--    (No recruiters exist yet.)
update public.agents a set account_mode = m.mode
from (
  select a.id,
    case
      when exists (select 1 from public.user_roles ur where ur.user_id = a.user_id and ur.role = 'admin') then 'admin'
      when exists (select 1 from public.user_roles ur where ur.user_id = a.user_id and ur.role = 'va_manager') then 'va_manager'
      when exists (select 1 from public.user_roles ur where ur.user_id = a.user_id and ur.role = 'va') then 'va'
      when exists (select 1 from public.user_roles ur where ur.user_id = a.user_id and ur.role = 'manager') or coalesce(a.is_manager, false) then 'manager'
      else 'agent'
    end as mode
  from public.agents a
) m
where m.id = a.id and a.account_mode is distinct from m.mode;

comment on column public.agents.account_mode is
  'Switchable operating mode set by admins via set_account_mode(): agent | manager | recruiter (pure recruiter, recruits only) | va | va_manager | admin. Kept in sync with user_roles by the RPC.';

-- Non-sensitive (like is_manager) — every surface may read a person's mode. New
-- columns do not inherit the base table's column grants, so grant it explicitly
-- or the admin edit dialog's read 403s.
grant select (account_mode) on public.agents to authenticated, anon;

-- 3. The admin-gated switcher. One guarded write keeps account_mode, is_manager,
--    and the user_roles operational role in agreement so no surface can disagree
--    about a person's mode.
create or replace function public.set_account_mode(p_agent_id uuid, p_mode text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_mode text := lower(btrim(coalesce(p_mode, '')));
  v_uid uuid;
  v_name text;
begin
  if not public.apex_is_admin() then
    raise exception 'Only admins may switch account mode' using errcode = '42501';
  end if;
  -- Operational modes only. admin / super_admin are deliberately NOT settable
  -- here — privilege escalation must be a deliberate, separate action.
  if v_mode not in ('agent','manager','recruiter','va','va_manager') then
    raise exception 'Invalid account mode %; allowed: agent, manager, recruiter, va, va_manager', p_mode
      using errcode = '22023';
  end if;

  select a.user_id, a.display_name into v_uid, v_name
  from public.agents a where a.id = p_agent_id;
  if not found then
    raise exception 'Agent % not found', p_agent_id using errcode = '23503';
  end if;

  update public.agents
     set account_mode = v_mode,
         is_manager = (v_mode = 'manager'),
         updated_at = now()
   where id = p_agent_id;

  -- Sync the auth role. Only touch OPERATIONAL roles; never strip admin /
  -- super_admin (an admin who is also actively selling stays admin).
  if v_uid is not null then
    delete from public.user_roles
     where user_id = v_uid
       and role in ('agent','manager','recruiter','va','va_manager');
    insert into public.user_roles (user_id, role)
    values (v_uid, v_mode::public.app_role)
    on conflict (user_id, role) do nothing;
  end if;

  return jsonb_build_object('ok', true, 'agent_id', p_agent_id, 'name', v_name, 'mode', v_mode, 'user_linked', v_uid is not null);
exception when others then
  return jsonb_build_object('ok', false, 'agent_id', p_agent_id, 'error', sqlerrm);
end;
$fn$;

revoke all on function public.set_account_mode(uuid, text) from public, anon;
grant execute on function public.set_account_mode(uuid, text) to authenticated, service_role;
