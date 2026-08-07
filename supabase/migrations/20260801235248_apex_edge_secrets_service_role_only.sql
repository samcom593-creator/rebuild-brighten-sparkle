-- Mirror of a migration applied to xrzweoneiieddzxogewk before repo-based
-- deploys were reliable (recovered verbatim from schema_migrations 2026-08-07).
-- Already applied live; every statement is idempotent. Present so db push stops
-- erroring "Remote migration versions not found in local migrations directory".

-- Service-role-only secret store so edge functions can source credentials that
-- can't be set as Supabase env secrets in this session (the management PAT is
-- rotated/dead and there is no MCP set-secret tool). RLS ENABLED with NO
-- policies => anon + authenticated get zero rows; only the service-role key
-- (which edge functions use) bypasses RLS. This is the same trust boundary as
-- a Supabase secret, reachable via SQL.
create table if not exists public.apex_edge_secrets (
  key         text primary key,
  value       text not null,
  note        text,
  updated_at  timestamptz not null default now()
);
alter table public.apex_edge_secrets enable row level security;
-- intentionally no policies: service_role only.
comment on table public.apex_edge_secrets is
  'Service-role-only edge secret store (RLS on, no policies). Used when a Supabase env secret cannot be set programmatically. 2026-08-01: holds CALENDLY_API_TOKEN once Sam mints the MFA-gated PAT.';

-- Placeholder row makes the wiring visible + the reconciler''s not-set path honest.
insert into public.apex_edge_secrets (key, value, note)
values ('CALENDLY_API_TOKEN', '',
        'Awaiting Sam''s MFA-gated Calendly PAT. Set value via SQL; reconciler goes live on next tick.')
on conflict (key) do nothing;
