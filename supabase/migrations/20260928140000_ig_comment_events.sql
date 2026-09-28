-- Instagram comment backfill ledger (applied live via bot-sql 2026-09-28, mirrored here).
create table if not exists public.ig_comment_events (
  comment_id text primary key, media_id text, username text, text text, commented_at timestamptz,
  intent text, public_reply text, reply_id text, dm_sent boolean default false, error text,
  created_at timestamptz not null default now()
);
alter table public.ig_comment_events enable row level security;
