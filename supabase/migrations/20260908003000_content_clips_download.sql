-- 20260908003000_content_clips_download.sql
-- One-click downloads (Sam, 2026-09-07: "find a clip, download it within a
-- click, straight into the editor"). Dropbox temporary links are direct CDN
-- URLs to the ORIGINAL file, valid 4 hours, minted by the mini for every clip
-- every 3 hours (clip-links.py); the Library's Download button uses the stored
-- link when unexpired and falls back to the Dropbox page otherwise.
alter table public.content_clips
  add column if not exists download_url text,
  add column if not exists download_expires_at timestamptz;
create index if not exists content_clips_download_exp_idx on public.content_clips (download_expires_at);
