-- MP-CONTENT-2: invite-only access to the Content page. Admins always; anyone else only while their login email sits un-revoked in content_access.
-- Applied via connector 2026-09-09; idempotent.
create table if not exists public.content_access (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  label text,
  added_by text,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);
create unique index if not exists content_access_email_key on public.content_access (lower(email));
alter table public.content_access enable row level security;
revoke all on public.content_access from anon, authenticated;
grant all on public.content_access to service_role;
grant select, insert, update on public.content_access to authenticated;
drop policy if exists content_access_admin_all on public.content_access;
create policy content_access_admin_all on public.content_access for all to authenticated
  using (public.apex_is_admin()) with check (public.apex_is_admin());

create or replace function public.content_can_access()
returns boolean language sql stable security definer set search_path = public as $$
  select public.apex_is_admin() or exists (
    select 1 from public.content_access a
    where a.revoked_at is null
      and lower(a.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke all on function public.content_can_access() from public, anon;
grant execute on function public.content_can_access() to authenticated, service_role;

drop policy if exists content_queue_admin_read on public.content_queue;
create policy content_queue_admin_read on public.content_queue for select to authenticated using (public.content_can_access());
drop policy if exists content_queue_admin_update on public.content_queue;
create policy content_queue_admin_update on public.content_queue for update to authenticated using (public.content_can_access()) with check (public.content_can_access());
drop policy if exists content_media_admin_read on storage.objects;
create policy content_media_admin_read on storage.objects for select to authenticated
  using (bucket_id = 'content-media' and public.content_can_access());

create or replace function public.content_queue_guard_update() returns trigger
language plpgsql set search_path = public as $$
begin
  if auth.role() = 'authenticated' then
    if not public.content_can_access() then raise exception 'Content access required'; end if;
    if new.status is distinct from old.status and new.status not in ('APPROVED','REWORK') then
      raise exception 'Use the archive workflow to record publishing';
    end if;
    if new.status = 'APPROVED' and (coalesce(new.privacy_risk,'') like 'FLAG:%' or coalesce(new.earnings_claim_risk,'') like 'FLAG:%') then
      raise exception 'Review flagged content before approving';
    end if;
    new.edited_at := clock_timestamp();
  elsif old.edited_at is not null then
    new.approved_by := old.approved_by;
    new.brand := old.brand;
    new.caption := old.caption;
    new.cta := old.cta;
    new.earnings_claim_risk := old.earnings_claim_risk;
    new.hook := old.hook;
    new.notes := old.notes;
    new.permission_confirmed := old.permission_confirmed;
    new.pillar := old.pillar;
    new.priority := old.priority;
    new.privacy_risk := old.privacy_risk;
    new.proof_type := old.proof_type;
    new.scheduled_at := old.scheduled_at;
    new.status := old.status;
    new.target_instagram := old.target_instagram;
    new.target_snapchat := old.target_snapchat;
    new.target_tiktok := old.target_tiktok;
    new.target_youtube := old.target_youtube;
    new.edited_at := old.edited_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
