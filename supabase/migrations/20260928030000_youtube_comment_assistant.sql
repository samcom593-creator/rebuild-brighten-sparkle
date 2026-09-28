-- YouTube comment assistant: OAuth connection + per-comment ledger (applied live via bot-sql 2026-09-28, mirrored here).
create table if not exists public.youtube_connections (
  id uuid primary key default gen_random_uuid(),
  channel_id text not null unique,
  channel_title text,
  refresh_token text not null,
  access_token text,
  token_expires_at timestamptz,
  scopes text,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.youtube_comment_events (
  comment_id text primary key,
  video_id text not null,
  author_channel_id text,
  author_name text,
  text text,
  published_at timestamptz,
  intent text,
  public_reply text,
  reply_comment_id text,
  replied_at timestamptz,
  error text,
  created_at timestamptz not null default now()
);
alter table public.youtube_connections enable row level security;
alter table public.youtube_comment_events enable row level security;
