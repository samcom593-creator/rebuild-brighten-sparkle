-- Launch Board accounts & analytics (Sam 2026-10-06): every post, per account, short vs long,
-- purposeful vs not. YouTube rows come from ~/business-ops/scripts/apex-youtube-sync.py
-- (yt-dlp public stats, every 3h); Instagram/TikTok/etc. are logged with one tap on the Launch Board.
create table if not exists public.content_posts (
  id bigserial primary key,
  platform text not null check (platform in ('youtube','instagram','tiktok','facebook','other')),
  format text not null check (format in ('short','long')),
  external_id text,
  url text,
  title text,
  posted_at timestamptz not null default now(),
  duration_s integer,
  views bigint,
  likes bigint,
  comments bigint,
  purposeful boolean,
  source text not null default 'manual' check (source in ('manual','youtube_sync','board')),
  stats_at timestamptz,
  created_at timestamptz not null default now(),
  unique (platform, external_id)
);
create index if not exists content_posts_posted_at_idx on public.content_posts (posted_at desc);
alter table public.content_posts enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where tablename = 'content_posts' and policyname = 'content_posts_admin_all') then
    create policy content_posts_admin_all on public.content_posts for all
      using (has_role(auth.uid(), 'admin'::app_role) or has_role(auth.uid(), 'manager'::app_role))
      with check (has_role(auth.uid(), 'admin'::app_role) or has_role(auth.uid(), 'manager'::app_role));
  end if;
  if not exists (select 1 from pg_policies where tablename = 'content_posts' and policyname = 'content_posts_invited_all') then
    create policy content_posts_invited_all on public.content_posts for all using (content_can_access()) with check (content_can_access());
  end if;
end $$;
alter table public.content_posts add column if not exists account text;
create index if not exists content_posts_platform_account_idx on public.content_posts (platform, account);
alter table public.content_posts add column if not exists category text;
comment on column public.content_posts.category is 'Sam''s content category: fitness | cars | my_life | insurance | top_of_funnel | education (free text so new ones can be added)';
-- This project has no default grants for new tables: without these the page reads 0 rows silently.
grant select, insert, update, delete on public.content_posts to authenticated;
grant usage, select on sequence public.content_posts_id_seq to authenticated;
grant all on public.content_posts to service_role;
grant usage, select on sequence public.content_posts_id_seq to service_role;

-- Thumbnails, watch %, and vidIQ as a source (applied live 2026-10-07; kept idempotent so a replay is safe).
alter table public.content_posts add column if not exists thumb_url text;
alter table public.content_posts add column if not exists watched_pct numeric;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'content_posts_source_check_v2') then
    alter table public.content_posts add constraint content_posts_source_check_v2
      check (source in ('manual','youtube_sync','board','vidiq'));
  end if;
end $$;
alter table public.content_posts drop constraint if exists content_posts_source_check;
