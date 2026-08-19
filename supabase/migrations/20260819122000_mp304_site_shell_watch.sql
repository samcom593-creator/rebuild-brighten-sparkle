-- MP-304 (2026-08-19): off-laptop watcher for apex-financial.org's shell + asset graph.
--
-- Idempotent by construction. This object was applied live via bot-sql before this
-- file existed (the established pattern in this project), so the migration must be
-- safe to replay over the deployed table -- re-applying a CREATE over a live object
-- is the failure MP-284 caught in the deploy pipeline.
create table if not exists public.site_shell_watch (
  id            bigserial primary key,
  ts            timestamptz not null default now(),
  verdict       text        not null,
  reason        text,
  entry_hash    text,
  assets        jsonb       not null default '[]'::jsonb,
  js_count      int,
  css_count     int,
  elapsed_ms    int,
  confirmed     boolean,
  episode_open  boolean     not null default false,
  episode_paged boolean     not null default false,
  paged         boolean     not null default false,
  page_error    text
);
create index if not exists site_shell_watch_ts_idx on public.site_shell_watch (ts desc);
alter table public.site_shell_watch enable row level security;

comment on table public.site_shell_watch is
  'MP-304. Off-laptop site shell watcher (edge fn site-shell-watch on pg_cron */10). SUBORDINATE floor: asserts only the shared subset of apex-site-health.sh (shell 200 + every /assets/*.js|css index.html declares resolves with the right content-type). It never issues an all-clear about the deep checks (data layer MP-300, write path MP-302) - those stay with the laptop probe. Exists because the laptop StartInterval probe measured 66.9% interval coverage (7.42h unwatched in 21h, longest blind window 176 min, every blind minute inside 09:00-19:00 Phoenix) since a StartInterval job cannot tick through Deep Idle.';
