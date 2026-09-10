-- MP-CONTENT-1: playable copy + thumbnail for the phone page. content-media is PRIVATE (admin signed URLs only); content-thumbs is public (tiny contact sheets, no captions).
-- Applied via connector 2026-09-09; idempotent.
alter table public.content_queue add column if not exists media_path text;
grant update (media_path, thumbnail_url) on public.content_queue to service_role;
insert into storage.buckets (id, name, public) values ('content-media', 'content-media', false) on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('content-thumbs', 'content-thumbs', true) on conflict (id) do nothing;
drop policy if exists content_media_admin_read on storage.objects;
create policy content_media_admin_read on storage.objects for select to authenticated
  using (bucket_id = 'content-media' and public.apex_is_admin());
drop policy if exists content_thumbs_public_read on storage.objects;
create policy content_thumbs_public_read on storage.objects for select to anon, authenticated
  using (bucket_id = 'content-thumbs');
