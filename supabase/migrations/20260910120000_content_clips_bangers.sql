-- 20260910120000_content_clips_bangers.sql
-- Sam, 2026-09-10: modeled 5 short-form creators (@BRICKBOYDIOR, @HunterVess,
-- @samm_zia, @sooweigoh, @roasbrez) whose titles pop. He wants his own library
-- to carry a scroll-stopping HOOK TITLE (not the flat AI description) and a
-- BANGER METER — a 0-100 traction-potential score — so he can see what's worth
-- posting fast. Generated locally on the mini (llama3.2 via Ollama, no API cost)
-- from the frame description + tags already captured.
alter table public.content_clips
  add column if not exists hook_title    text,
  add column if not exists banger_score  integer,
  add column if not exists banger_reason text,
  add column if not exists bangered_at   timestamptz;
create index if not exists content_clips_banger_idx on public.content_clips (banger_score desc nulls last);
