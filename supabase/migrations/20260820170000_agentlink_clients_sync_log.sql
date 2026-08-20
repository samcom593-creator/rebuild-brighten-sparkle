-- Receipt log for the clients-mirror sync (agentlink-clients-sync edge fn).
-- Separate from agentlink_sync_log on purpose: doctor gates grade that log's
-- deals semantics and must never see foreign rows (MP-279/MP-283 lesson).
create table if not exists public.agentlink_clients_sync_log (
  id uuid primary key default gen_random_uuid(),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  upstream_status int,
  clients_seen int,
  clients_upserted int,
  error text
);
alter table public.agentlink_clients_sync_log enable row level security;
-- RLS on, no user policies: service-role only, same posture as hh_applicants.
