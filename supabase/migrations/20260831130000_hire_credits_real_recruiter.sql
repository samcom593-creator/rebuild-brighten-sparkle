begin;
CREATE OR REPLACE FUNCTION public.fn_notify_agent_hired()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_manager text;
  v_payload jsonb;
begin
  if coalesce(new.status::text, '') <> 'active' then return new; end if;
  if coalesce(new.is_deactivated, false) or coalesce(new.is_inactive, false) then return new; end if;
  if coalesce(new.agent_code, '') like 'GHOST_%' then return new; end if;

  -- Credit the person who ACTUALLY recruited them. manager_id defaults to the
  -- owner: measured on 44 hires in 90 days, 10 carried an invited_by_manager_id
  -- that disagreed with manager_id and manager_id was "Samuel James" on all ten
  -- while invited_by held the real recruiter. Reading manager_id here meant
  -- every hire announcement in Slack and Discord credited Sam — Ramon Lopez
  -- posted under Sam when he belongs to Obiajulu Ifediora. Same precedence the
  -- recruiting milestones and show-up tracking already use.
  select display_name into v_manager from public.agents
   where id = coalesce(new.invited_by_manager_id, new.manager_id);
  v_payload := jsonb_strip_nulls(jsonb_build_object(
    'agentName', new.display_name,
    'agentCode', new.agent_code,
    'managerName', v_manager,
    'licenseStatus', new.license_status::text,
    'contractingUrl', 'https://apex-financial.org/start-contracting',
    'openUrl', 'https://apex-financial.org/dashboard/profile?agentId=' || new.id::text
  ));

  insert into public.outbox_events(
    aggregate_type, aggregate_id, event_type, destination, payload,
    idempotency_key, correlation_id
  ) values
    ('agent', new.id, 'agent.hired', 'slack', v_payload,
     'agent.hired:' || new.id::text || ':slack', gen_random_uuid()),
    ('agent', new.id, 'agent.hired', 'discord', v_payload,
     'agent.hired:' || new.id::text || ':discord', gen_random_uuid())
  on conflict (idempotency_key) do nothing;

  return new;
exception when others then
  raise warning 'fn_notify_agent_hired failed for agent % (%): %', new.id, new.display_name, sqlerrm;
  return new;
end;
$function$;

commit;
