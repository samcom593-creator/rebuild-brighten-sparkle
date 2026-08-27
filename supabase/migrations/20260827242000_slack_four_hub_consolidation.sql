-- Consolidate Slack operations into four clear hubs while preserving channel
-- history. Automations are rerouted before retired destinations are disabled.
-- Kept: Company, Sales Wins, Recruiting/Hiring, Training/Contracting.

begin;

do $block$
declare
  v_inst uuid;
  v_general uuid;
  v_sales uuid;
  v_recruiting uuid;
  v_contracting uuid;
  v_route record;
  v_target uuid;
begin
  select id into v_inst
  from public.messaging_workspace_installations
  where provider = 'slack'
    and environment = 'production'
    and status = 'active'
  order by installed_at desc nulls last, created_at desc
  limit 1;

  if v_inst is null then
    raise notice 'No active production Slack installation; nothing to consolidate';
    return;
  end if;

  -- Slack's permanent #general channel is the company hub. Rebind the
  -- existing semantic destination before archiving the redundant role split.
  update public.messaging_destinations
     set channel_id = 'C0BSRRNVC2V',
         channel_name = 'general',
         privacy_level = 'public',
         is_enabled = true,
         verified_at = now(),
         updated_at = now()
   where installation_id = v_inst
     and purpose = 'general_licensed'
     and scope_type = 'organization'
     and scope_key is null;

  select id into v_general from public.messaging_destinations
   where installation_id = v_inst and purpose = 'general_licensed'
     and scope_type = 'organization' and scope_key is null;
  select id into v_sales from public.messaging_destinations
   where installation_id = v_inst and purpose = 'sales_wins'
     and scope_type = 'organization' and scope_key is null;
  select id into v_recruiting from public.messaging_destinations
   where installation_id = v_inst and purpose = 'recruiting_growth'
     and scope_type = 'organization' and scope_key is null;
  select id into v_contracting from public.messaging_destinations
   where installation_id = v_inst and purpose = 'contracting_support'
     and scope_type = 'organization' and scope_key is null;

  if v_general is null or v_sales is null or v_recruiting is null or v_contracting is null then
    raise exception 'One or more required Slack hubs are missing';
  end if;

  -- Clone active rules from retired destinations into the appropriate hub.
  -- ON CONFLICT keeps this migration idempotent and prevents duplicate posts.
  for v_route in
    select r.*, d.purpose as old_purpose
    from public.messaging_route_rules r
    join public.messaging_destinations d on d.id = r.destination_id
    where r.installation_id = v_inst
      and r.is_enabled
      and d.purpose not in ('general_licensed', 'sales_wins', 'recruiting_growth', 'contracting_support')
  loop
    v_target := case
      when v_route.old_purpose in ('licensing_support', 'training', 'trainer_coaching',
                                   'admin_contracting', 'help') then v_contracting
      when v_route.old_purpose in ('announcements', 'manager_ops', 'leadership_builders',
                                   'system_alerts', 'finance_ops', 'general_unlicensed') then v_general
      when v_route.event_type like 'deal.%' or v_route.event_type like 'production.%' then v_sales
      when v_route.event_type like 'candidate.%' or v_route.event_type like 'agent.%'
        or v_route.event_type like 'recruiting.%' then v_recruiting
      else v_general
    end;

    insert into public.messaging_route_rules(
      installation_id, event_type, destination_id, audience_scope,
      hierarchy_rule, template_version, priority,
      quiet_hours_start, quiet_hours_end, quiet_hours_timezone,
      batch_policy, is_enabled, created_by
    ) values (
      v_inst, v_route.event_type, v_target, v_route.audience_scope,
      v_route.hierarchy_rule, v_route.template_version, v_route.priority,
      v_route.quiet_hours_start, v_route.quiet_hours_end, v_route.quiet_hours_timezone,
      v_route.batch_policy, true, v_route.created_by
    ) on conflict (installation_id, event_type, destination_id, audience_scope)
      do update set
        hierarchy_rule = excluded.hierarchy_rule,
        template_version = excluded.template_version,
        priority = least(public.messaging_route_rules.priority, excluded.priority),
        quiet_hours_start = excluded.quiet_hours_start,
        quiet_hours_end = excluded.quiet_hours_end,
        quiet_hours_timezone = excluded.quiet_hours_timezone,
        batch_policy = excluded.batch_policy,
        is_enabled = true,
        updated_at = now();
  end loop;

  update public.messaging_route_rules r
     set is_enabled = false, updated_at = now()
    from public.messaging_destinations d
   where r.destination_id = d.id
     and r.installation_id = v_inst
     and d.purpose not in ('general_licensed', 'sales_wins', 'recruiting_growth', 'contracting_support');

  update public.messaging_destinations
     set is_enabled = purpose in ('general_licensed', 'sales_wins', 'recruiting_growth', 'contracting_support'),
         updated_at = now()
   where installation_id = v_inst;
end;
$block$;

commit;
