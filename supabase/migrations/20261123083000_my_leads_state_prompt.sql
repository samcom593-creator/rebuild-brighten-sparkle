-- MP-MORNING-LEADS part 2 (2026-11-23): a licensed agent with no licence state on file answers one question in
-- their own portal and gets their leads.
--
-- After the first morning run 21 of 51 licensed agents had no state in any of the six places it is recorded
-- (15 of them with working access and no leads). The owner can save it from Home, one person at a time. This
-- lets the agent supply it: the same trust as the licensed states they typed on their application.
--
--   my_leads_state_prompt()      -> {needs_state}: true only for a signed-in active licensed agent with exactly
--                                   one live record, no state anywhere, and nothing else holding their leads back.
--   my_leads_set_state(states[]) -> writes agents.license_states (only while the prompt applies), records that the
--                                   agent declared it, and grants their leads in the same call.

create or replace function public.fn_my_leads_state_gate(p_user_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  v_agent uuid;
  v_n integer;
begin
  if p_user_id is null then
    return null;
  end if;
  if coalesce(lower(btrim((select s.value from public.system_settings s where s.key = 'morning_leads_enabled'))), 'false') <> 'true' then
    return null;
  end if;
  select count(*), (array_agg(a.id))[1] into v_n, v_agent
    from public.agents a
   where a.user_id = p_user_id
     and a.status::text = 'active'
     and coalesce(a.is_deactivated, false) = false
     and coalesce(a.is_inactive, false) = false
     and (a.canonical_agent_id is null or a.canonical_agent_id = a.id)
     and a.license_status::text = 'licensed'
     and coalesce(a.account_mode, 'agent') <> 'admin';
  -- two live records on one login: an identity problem for staff, never a guess here
  if v_n <> 1 then
    return null;
  end if;
  if public.fn_agent_is_suspended(v_agent) or public.fn_user_login_blocked(p_user_id) then
    return null;
  end if;
  if public.fn_agent_interview_state(v_agent) in ('upcoming', 'missed', 'never') then
    return null;
  end if;
  if exists (select 1 from public.fn_agent_lead_states(v_agent)) then
    return null;
  end if;
  return v_agent;
end;
$function$;
revoke all on function public.fn_my_leads_state_gate(uuid) from public, anon, authenticated;

create or replace function public.my_leads_state_prompt()
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $function$
  select jsonb_build_object('needs_state', public.fn_my_leads_state_gate(auth.uid()) is not null)
$function$;
revoke all on function public.my_leads_state_prompt() from public, anon;
grant execute on function public.my_leads_state_prompt() to authenticated;

create or replace function public.my_leads_set_state(p_states text[])
returns jsonb
language plpgsql
security definer
set search_path to 'public'
set statement_timeout to '30s'
as $function$
declare
  v_uid uuid := auth.uid();
  v_agent uuid;
  v_states text[];
begin
  v_agent := public.fn_my_leads_state_gate(v_uid);
  if v_agent is null then
    raise exception 'Your license state is already on file, or your account is not set up for leads yet.' using errcode = '42501';
  end if;
  select array_agg(distinct s order by s) into v_states
    from (select upper(btrim(x)) as s from unnest(coalesce(p_states, '{}'::text[])) x) q
   where q.s in (select z.state from public.us_state_timezones z);
  if v_states is null then
    raise exception 'Choose the state you are licensed in.' using errcode = '22023';
  end if;
  if cardinality(v_states) > 15 then
    raise exception 'Choose up to 15 states.' using errcode = '22023';
  end if;
  update public.agents
     set license_states = v_states,
         metadata = coalesce(metadata, '{}'::jsonb)
                    || jsonb_build_object('license_states_source', 'self_declared', 'license_states_set_at', now())
   where id = v_agent;
  return jsonb_build_object('ok', true, 'states', to_jsonb(v_states), 'leads', public.fn_morning_leads_grant_one(v_agent));
end;
$function$;
revoke all on function public.my_leads_set_state(text[]) from public, anon;
grant execute on function public.my_leads_set_state(text[]) to authenticated;
