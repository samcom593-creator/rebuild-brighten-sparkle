-- 20260912220000_content_clips_testimonials.sql
-- Sam, 2026-09-12: "filter out every single testimonial... FaceTime videos or
-- videos in which I'm talking to somebody... screenshots or text messages of
-- people saying how good it is... make the download easy, it's time to build
-- collage testimonials."
--
-- The visual describer that fills title/description/tags never hears the
-- audio and never sees a screenshot, so a word-match on its output found 9
-- testimonial-shaped rows out of 6,098. The verdict now lives on the row:
--   media              'video' (default, every existing row) | 'image'
--                      (screenshots indexed from Dropbox _Screenshots/ and
--                      Photos/Screenshots/ + Photos/*/phone/*.PNG)
--   transcript         whisper on the first 60s of audio (video) or Vision
--                      OCR text (image) — what the clip SAYS, searchable
--   testimonial        NULL = not judged yet, true/false = judged
--   testimonial_kind   video_call | spoken | text_message | comment | review | other
--   testimonial_reason one line a human can check
--   testimonial_source 'auto' (classifier) | 'manual' (Sam tapped) — the
--                      classifier never overwrites a manual verdict
--   missing_at         Dropbox says path/not_found (file moved/deleted) —
--                      hidden from the Library instead of showing a dead
--                      Download button
alter table public.content_clips
  add column if not exists media text not null default 'video',
  add column if not exists transcript text,
  add column if not exists testimonial boolean,
  add column if not exists testimonial_kind text,
  add column if not exists testimonial_reason text,
  add column if not exists testimonial_source text,
  add column if not exists testimonial_at timestamptz,
  add column if not exists missing_at timestamptz;
create index if not exists content_clips_testimonial_idx on public.content_clips (testimonial) where testimonial is true;
create index if not exists content_clips_unjudged_idx on public.content_clips (media, testimonial_at) where testimonial is null and missing_at is null;

-- One row, every state, never blank: how far the classifier has got, so the
-- Library can say "N judged, M waiting" instead of implying the filter is done.
create or replace view public.v_testimonial_classifier_health
with (security_invoker = true) as
select
  (select count(*)::int from public.content_clips where missing_at is null)                                              as rows_live,
  (select count(*)::int from public.content_clips where missing_at is null and testimonial is not null)                 as judged,
  (select count(*)::int from public.content_clips where missing_at is null and testimonial is true)                     as testimonials,
  (select count(*)::int from public.content_clips where missing_at is null and testimonial is true and media = 'video')  as testimonial_videos,
  (select count(*)::int from public.content_clips where missing_at is null and testimonial is true and media = 'image')  as testimonial_images,
  (select count(*)::int from public.content_clips where missing_at is null and testimonial is null)                     as waiting,
  (select count(*)::int from public.content_clips where missing_at is not null)                                         as missing,
  (select count(*)::int from public.content_clips where missing_at is null and (download_expires_at is null or download_expires_at < now() + interval '1 minute')) as stale_links,
  (select max(testimonial_at) from public.content_clips)                                                                as last_judged_at;
grant select on public.v_testimonial_classifier_health to authenticated;
