-- "Never again": a monitorable gap view for hires that did not notify.
-- trg_notify_agent_hired queues the Slack outbox event synchronously with the
-- hire, so a gap can only appear if the trigger is disabled/dropped. This view
-- makes that state queryable (apex-doctor + any dashboard). Anchored at the fix
-- deploy instant so it monitors forward and never nags about pre-fix history.
create or replace view public.v_hire_notification_gaps as
select a.id as agent_id, a.display_name, a.created_at
from public.agents a
where a.status = 'active'
  and coalesce(a.is_deactivated, false) = false
  and coalesce(a.is_inactive, false) = false
  and coalesce(a.agent_code, '') not like 'GHOST_%'
  and a.created_at > timestamptz '2026-08-27 02:00:00+00'
  and not exists (
    select 1 from public.outbox_events o
    where o.idempotency_key = 'agent.hired:' || a.id::text || ':slack'
  );
grant select on public.v_hire_notification_gaps to authenticated, service_role;
