-- A person may recover more than once. Keep every closed case while allowing
-- at most one open case per agent, the status used by the current scanner/UI.
begin;
set local lock_timeout = '3s';

create unique index if not exists inactive_agent_queue_one_open_per_agent
  on public.inactive_agent_queue (agent_id)
  where status = 'open';

alter table public.inactive_agent_queue
  drop constraint if exists inactive_agent_queue_agent_id_status_key;

comment on index public.inactive_agent_queue_one_open_per_agent is
  'One open recovery case per agent; closed and legacy snoozed cases retain their full history.';

commit;
