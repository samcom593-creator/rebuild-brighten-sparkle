-- Mirror of a migration applied live 2026-08-07 via Supabase MCP (recorded
-- remotely as 20260807130032_hh_login_tokens). See 20260806214858 header for
-- why these mirrors exist.
--
-- Headhunter one-click magic login links (bearer tokens, hashed at rest).

create table public.hh_login_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  user_id uuid not null references public.hh_users(id) on delete cascade,
  expires_at timestamptz not null,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.hh_login_tokens enable row level security;
