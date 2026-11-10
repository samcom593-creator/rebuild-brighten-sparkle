-- MP-MEDIA-LIBRARY (2026-11-10): widen content_clips.kind to allow 'photo'.
-- The media-library indexer (business-ops/scripts/media-library-sync.sh, launchd
-- com.samjames.media-library on Sam's MacBook) now indexes dropbox:Photos (4,427
-- stills) into content_clips alongside YouTube/Reels video, so the `media` /
-- `clip` CLIs and the Launch Board share one searchable archive. Additive only:
-- existing rows and every kind='horizontal'/'vertical' query are untouched.
-- Already applied live via bot-sql 2026-11-10; idempotent on re-apply.
alter table public.content_clips drop constraint if exists content_clips_kind_check;
alter table public.content_clips add constraint content_clips_kind_check
  check (kind = any (array['horizontal'::text, 'vertical'::text, 'photo'::text]));
