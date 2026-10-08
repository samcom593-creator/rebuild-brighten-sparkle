-- Allow source = 'instagram_graph' on content_posts (apex-instagram-sync.py, 2026-10-08).
-- The Instagram sync pulls reels from the Instagram Graph API into content_posts so the Launch
-- Board shows Instagram as a live, auto-updating platform. Mirrors the change applied live via
-- bot-sql. Idempotent: drop and re-add the full allowed set so a fresh `db push` matches prod.
alter table public.content_posts drop constraint if exists content_posts_source_check_v2;
alter table public.content_posts add constraint content_posts_source_check_v2
  check (source = any (array['manual'::text, 'youtube_sync'::text, 'board'::text, 'vidiq'::text, 'instagram_graph'::text]));
