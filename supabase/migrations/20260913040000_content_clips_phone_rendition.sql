-- 20260913040000_content_clips_phone_rendition.sql
-- Sam, 2026-09-13: "download to camera roll from mobile still doesn't work, it
-- just keeps infinitely loading." Measured: testimonial videos are 4K originals,
-- median 283 MB, mean 1.5 GB, max 11.7 GB. The phone was asked to pull the
-- whole original into memory before the share sheet could open. It never got
-- there. The classifier daemon now renders a phone-size copy (720p H.264,
-- ~20 MB/min, faststart) of every testimonial video into the public
-- content-library bucket, and the Save button uses that when it exists.
alter table public.content_clips
  add column if not exists phone_url text,
  add column if not exists phone_bytes bigint,
  add column if not exists phone_at timestamptz;
create index if not exists content_clips_phone_pending_idx on public.content_clips (size_bytes) where testimonial is true and media = 'video' and phone_url is null and missing_at is null;
