-- Reliable NEW-HIRE notifications on both channels (Sam 2026-08-27: hired Daniel
-- Bridges, got NOTHING on Slack or Discord).
--
-- Root cause, measured on Daniel (agent 00f5cdae, created 01:46):
--   1. There was NO Slack route for a hire at all — the new-hire flow never
--      queued an outbox event, so a hire could not reach Slack by any path.
--   2. Discord hires went only through broadcast_to_all_channels: a
--      fire-and-forget net.http_post, gated by a SHARED 5/hour 'broadcast'
--      rate limit, wrapped in EXCEPTION WHEN OTHERS THEN RETURN NEW — any skip
--      or failure vanished with no error and no receipt.
--
-- Fix: hires now go through the DURABLE outbox for Slack (delivery receipts +
-- retries via apex-outbox-dispatcher) AND a direct Discord post on a DEDICATED
-- category ('agent_hired', cap 50/hr) so a busy hour can never suppress a hire.
-- The notification carries the contracting link. A notification failure never
-- rolls back the hire, but it RAISEs a WARNING (visible in logs) — never a
-- silent RETURN.

create or replace function public.fn_notify_agent_hired()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'extensions', 'net'
as $fn$
declare
  v_manager text;
  v_webhook text;
  v_first   text;
  v_body    jsonb;
begin
  -- Only real, active, non-ghost hires.
  if coalesce(new.status::text, '') <> 'active' then return new; end if;
  if coalesce(new.is_deactivated, false) or coalesce(new.is_inactive, false) then return new; end if;
  if coalesce(new.agent_code, '') like 'GHOST_%' then return new; end if;

  -- Exactly once per agent — survives every later UPDATE that re-fires this trigger.
  if exists (
    select 1 from public.outbox_events
    where idempotency_key = 'agent.hired:' || new.id::text || ':slack'
  ) then
    return new;
  end if;

  select display_name into v_manager from public.agents where id = new.manager_id;
  v_first := coalesce(nullif(split_part(new.display_name, ' ', 1), ''), 'A new producer');

  -- 1) SLACK — durable outbox. apex-outbox-dispatcher renders + posts with a
  --    per-destination delivery receipt, so a failed hire ping is provable and
  --    retried, never silent.
  insert into public.outbox_events(
    aggregate_type, aggregate_id, event_type, destination, payload,
    idempotency_key, correlation_id
  ) values (
    'agent', new.id, 'agent.hired', 'slack',
    jsonb_strip_nulls(jsonb_build_object(
      'agentName', new.display_name,
      'agentCode', new.agent_code,
      'managerName', v_manager,
      'licenseStatus', new.license_status::text,
      'contractingUrl', 'https://apex-financial.org/dashboard/contracting/ops',
      'openUrl', 'https://apex-financial.org/dashboard/profile?agentId=' || new.id::text
    )),
    'agent.hired:' || new.id::text || ':slack',
    gen_random_uuid()
  ) on conflict (idempotency_key) do nothing;

  -- 2) DISCORD — direct, DEDICATED category so a hire is never caught by the
  --    shared 'broadcast' 5/hr cap. net._http_response records the request, so
  --    delivery is provable (204).
  if public.should_post_to_discord('agent_hired', 50) then
    select value into v_webhook from public.system_settings where key = 'discord_webhook_url';
    if v_webhook is not null then
      v_body := jsonb_build_object(
        'username', 'APEX Hires',
        'embeds', jsonb_build_array(jsonb_build_object(
          'title', '🎯 NEW HIRE — ' || coalesce(new.display_name, 'unnamed agent'),
          'description',
            'Welcome ' || v_first || ' to the Apex Empire 👑' ||
            case when new.agent_code is not null then E'\nAgent code: ' || new.agent_code else '' end ||
            case when v_manager is not null then E'\nManager: ' || v_manager else '' end ||
            E'\n📋 Contracting: https://apex-financial.org/dashboard/contracting/ops',
          'color', 16766720,
          'timestamp', to_char(now(), 'YYYY-MM-DD"T"HH24:MI:SSZ'))));
      perform net.http_post(
        url := v_webhook,
        headers := jsonb_build_object('Content-Type', 'application/json'),
        body := v_body,
        timeout_milliseconds := 10000);
    end if;
  end if;

  return new;
exception when others then
  -- A notification problem must NEVER roll back the hire, but it must NEVER be
  -- silent either (the disease this migration fixes). The Slack leg above is
  -- already committed if it ran; log the rest loudly.
  raise warning 'fn_notify_agent_hired failed for agent % (%): %', new.id, new.display_name, sqlerrm;
  return new;
end;
$fn$;

drop trigger if exists trg_notify_agent_hired on public.agents;
create trigger trg_notify_agent_hired
  after insert or update of status, onboarding_stage, license_status on public.agents
  for each row execute function public.fn_notify_agent_hired();

-- Route agent.hired to the recruiting staff channel.
do $block$
declare v_inst uuid; v_dest uuid;
begin
  select id into v_inst from public.messaging_workspace_installations
  where provider = 'slack' and environment = 'production' and status = 'active'
  order by installed_at desc nulls last, created_at desc limit 1;
  if v_inst is null then raise notice 'no active Slack installation; agent.hired route not bound'; return; end if;
  select id into v_dest from public.messaging_destinations
  where installation_id = v_inst and purpose = 'recruiting_growth'
    and scope_type = 'organization' and scope_key is null and is_enabled;
  if v_dest is null then raise notice 'no recruiting_growth destination; agent.hired route not bound'; return; end if;
  insert into public.messaging_route_rules(installation_id, event_type, destination_id, audience_scope, priority, batch_policy, is_enabled)
  values (v_inst, 'agent.hired', v_dest, 'organization', 1, 'instant', true)
  on conflict (installation_id, event_type, destination_id, audience_scope)
    do update set is_enabled = true, priority = excluded.priority, updated_at = now();
end;
$block$;
