-- Applied to prod 2026-08-01 via MCP. Service-role-only edge secret store.
-- calendly-backfill reads CALENDLY_API_TOKEN from env first, then this table —
-- the DB fallback lets the MFA-gated Calendly PAT be delivered via SQL when the
-- Supabase env secret cannot be set programmatically (management PAT is dead,
-- no MCP set-secret tool). RLS ON with NO policies => anon/authenticated see
-- zero rows; only the service-role key (edge functions) bypasses RLS.
--
-- Note: the env CALENDLY_API_TOKEN turned out to already be set (the reconciler
-- reconciled 179 events live on 2026-08-01), so this store is currently the
-- belt-and-suspenders path — if the env token ever expires, drop a new PAT here
-- via activate-calendly-reconciler.sh with no redeploy.
create table if not exists public.apex_edge_secrets (
  key         text primary key,
  value       text not null,
  note        text,
  updated_at  timestamptz not null default now()
);
alter table public.apex_edge_secrets enable row level security;
comment on table public.apex_edge_secrets is
  'Service-role-only edge secret store (RLS on, no policies). Fallback delivery path for credentials that cannot be set as Supabase env secrets in-session.';

insert into public.apex_edge_secrets (key, value, note)
values ('CALENDLY_API_TOKEN', '',
        'Empty = env CALENDLY_API_TOKEN is authoritative. Set value here only if the env token expires.')
on conflict (key) do nothing;
