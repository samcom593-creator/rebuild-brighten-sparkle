-- 20260908001000_content_clips_previews.sql
-- Launch Board Library: previews + descriptive titles + search (Sam,
-- 2026-09-07: "see a preview, a title that describes what it is, pick clips
-- a lot faster... a search bar or filter where I type what I'm looking for").
-- thumb/preview live in the public clip-thumbs bucket (one frame + a 3s muted
-- loop per clip, made on the mini from byte-range reads — no full downloads).
-- title/tags/description are written by the local captioner (moondream via
-- Ollama on the mini, no API cost); until then the UI falls back to the name.
alter table public.content_clips
  add column if not exists thumb_url    text,
  add column if not exists preview_url  text,
  add column if not exists duration_s   numeric,
  add column if not exists width        integer,
  add column if not exists height       integer,
  add column if not exists title        text,
  add column if not exists description  text,
  add column if not exists tags         text[] not null default '{}',
  add column if not exists thumbed_at   timestamptz,
  add column if not exists captioned_at timestamptz;
create index if not exists content_clips_tags_gin on public.content_clips using gin (tags);
create index if not exists content_clips_search_idx on public.content_clips
  using gin (to_tsvector('simple', coalesce(title,'') || ' ' || coalesce(description,'') || ' ' || coalesce(name,'')));

-- One search entry point: words match title/description/name; tags match exactly.
create or replace function public.content_clips_search(p_q text, p_folder text default null, p_limit integer default 200)
returns setof public.content_clips language sql stable security invoker as $$
  select c.* from public.content_clips c
  where (p_folder is null or c.folder = p_folder)
    and (
      coalesce(p_q,'') = ''
      or to_tsvector('simple', coalesce(c.title,'') || ' ' || coalesce(c.description,'') || ' ' || coalesce(c.name,'')) @@ plainto_tsquery('simple', p_q)
      or c.tags && string_to_array(lower(p_q), ' ')
      or c.name ilike '%' || p_q || '%'
    )
  order by c.modified_at desc nulls last
  limit least(coalesce(p_limit,200), 500);
$$;
grant execute on function public.content_clips_search(text, text, integer) to authenticated;
