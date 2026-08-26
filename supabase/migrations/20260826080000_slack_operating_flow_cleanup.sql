-- Slack operating-flow cleanup (2026-08-26, Sam: "fix Slack — a lot of things
-- in there not needed; the operating flow should be clear").
--
-- Before: 15 destinations all enabled (10 with zero routes), and
-- candidate.licensing_milestone fanned out to BOTH recruiting_growth and
-- licensing_support — the same event in two channels is noise. After: each
-- event posts to exactly one channel, and destinations that are neither routed
-- to nor an agent-join channel are disabled so the routing table reflects
-- reality. Idempotent — safe to re-run; mirrors what was applied live.
--
-- Kept enabled destinations (7): recruiting_growth, manager_ops, sales_wins,
-- contracting_support, licensing_support (all routed) + general_licensed,
-- general_unlicensed (agents are told to JOIN these in SlackJoinCard, so they
-- stay live even with no server route).

do $block$
declare v_inst uuid;
begin
  select id into v_inst from public.messaging_workspace_installations
  where provider = 'slack' and environment = 'production' and status = 'active'
  order by installed_at desc nulls last, created_at desc limit 1;
  if v_inst is null then raise notice 'no active Slack installation; nothing to clean'; return; end if;

  -- One channel per event: drop the licensing-milestone duplicate into recruiting_growth.
  update public.messaging_route_rules r
     set is_enabled = false, updated_at = now()
    from public.messaging_destinations d
   where r.destination_id = d.id
     and r.installation_id = v_inst
     and r.event_type = 'candidate.licensing_milestone'
     and d.purpose = 'recruiting_growth';

  -- Disable destinations that are neither routed to nor an agent-join channel.
  update public.messaging_destinations
     set is_enabled = false, updated_at = now()
   where installation_id = v_inst
     and purpose in ('admin_contracting','finance_ops','help','leadership_builders',
                     'system_alerts','trainer_coaching','training','announcements')
     and not exists (
       select 1 from public.messaging_route_rules r
       where r.destination_id = messaging_destinations.id and r.is_enabled
     );
end;
$block$;
