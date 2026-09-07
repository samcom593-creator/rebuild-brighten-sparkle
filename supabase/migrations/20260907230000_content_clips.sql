-- 20260907230000_content_clips.sql
-- Launch Board v2 (Sam, 2026-09-07): "pull content in one generation from my
-- Dropbox — YouTube and TikToks." The Dropbox video library is the source
-- archive (YouTube/ = horizontal, Reels/ = vertical; ~4,000 clips). This table
-- is a METADATA index of it — path, name, size, modified — so the board can
-- search the library, attach a clip to a card, or mint a card from a clip.
-- No bytes are copied and nothing is hydrated; the refresh is
-- ~/business-ops/scripts/refresh-content-clips.sh (rclone lsjson -> upsert),
-- run from the existing 6-hourly mini snapshot job, never a new daemon.

create table if not exists public.content_clips (
  id           uuid primary key default gen_random_uuid(),
  path         text not null unique,          -- "YouTube/2026/09/DJI_0001.mp4"
  name         text not null,
  folder       text not null,                 -- "YouTube" | "Reels"
  kind         text not null default 'horizontal' check (kind in ('horizontal','vertical')),
  size_bytes   bigint not null default 0,
  modified_at  timestamptz,
  indexed_at   timestamptz not null default now(),
  used_by_card uuid references public.content_cards(id) on delete set null
);

alter table public.content_clips enable row level security;
grant select, insert, update, delete on public.content_clips to authenticated;
grant all on public.content_clips to service_role;

drop policy if exists content_clips_admin_all on public.content_clips;
create policy content_clips_admin_all on public.content_clips
  for all to authenticated
  using  (has_role(auth.uid(),'admin'::app_role) or has_role(auth.uid(),'manager'::app_role))
  with check (has_role(auth.uid(),'admin'::app_role) or has_role(auth.uid(),'manager'::app_role));

create index if not exists content_clips_modified_idx on public.content_clips (modified_at desc);
create index if not exists content_clips_folder_idx on public.content_clips (folder);
create index if not exists content_clips_name_trgm_idx on public.content_clips (lower(name));

-- Upsert entry point for the refresh script: one JSON array in, counts out.
create or replace function public.content_clips_upsert(p_rows jsonb)
returns jsonb language plpgsql security definer set search_path to 'public' as $$
declare v_n integer;
begin
  insert into public.content_clips (path, name, folder, kind, size_bytes, modified_at, indexed_at)
  select r->>'path', r->>'name', r->>'folder',
         case when r->>'folder' = 'Reels' then 'vertical' else 'horizontal' end,
         coalesce((r->>'size')::bigint, 0),
         nullif(r->>'modified','')::timestamptz,
         now()
  from jsonb_array_elements(p_rows) r
  on conflict (path) do update
    set name = excluded.name, folder = excluded.folder, kind = excluded.kind,
        size_bytes = excluded.size_bytes, modified_at = excluded.modified_at, indexed_at = now();
  get diagnostics v_n = row_count;
  return jsonb_build_object('upserted', v_n, 'total', (select count(*) from public.content_clips));
end $$;
revoke all on function public.content_clips_upsert(jsonb) from public, anon, authenticated;
