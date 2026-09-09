-- Shared contract for content-ops and the APEX phone page.
-- Reuses the existing public.apex_is_admin() predicate; JWT role=authenticated is not admin.
create table if not exists public.content_queue (
  content_id text primary key,
  original_filename text,
  current_filename text,
  sha256 text,
  media_type text,
  duration_seconds text,
  width text,
  height text,
  created_at text,
  source_path text,
  brand text,
  pillar text,
  format text,
  status text,
  hook text,
  caption text,
  cta text,
  target_instagram text,
  target_tiktok text,
  target_youtube text,
  target_snapchat text,
  priority text,
  permission_confirmed text,
  proof_type text,
  privacy_risk text,
  earnings_claim_risk text,
  approved_by text,
  scheduled_at text,
  published_urls text,
  notes text,
  updated_at timestamptz not null default now(),
  edited_at timestamptz,
  thumbnail_url text,
  source text not null default 'mac'
);
alter table public.content_queue enable row level security;
revoke all on public.content_queue from anon, authenticated;
grant all on public.content_queue to service_role;
grant select on public.content_queue to authenticated;
grant update (brand,pillar,hook,caption,cta,status,approved_by,privacy_risk,earnings_claim_risk,edited_at) on public.content_queue to authenticated;
drop policy if exists content_queue_admin_read on public.content_queue;
create policy content_queue_admin_read on public.content_queue for select to authenticated using (public.apex_is_admin());
drop policy if exists content_queue_admin_update on public.content_queue;
create policy content_queue_admin_update on public.content_queue for update to authenticated using (public.apex_is_admin()) with check (public.apex_is_admin());
create or replace function public.content_queue_guard_update() returns trigger
language plpgsql set search_path = public as $$
begin
  if auth.role() = 'authenticated' then
    if not public.apex_is_admin() then raise exception 'Admin access required'; end if;
    if new.status is distinct from old.status and new.status not in ('APPROVED','REWORK') then
      raise exception 'Use the archive workflow to record publishing';
    end if;
    if new.status = 'APPROVED' and (coalesce(new.privacy_risk,'') like 'FLAG:%' or coalesce(new.earnings_claim_risk,'') like 'FLAG:%') then
      raise exception 'Review flagged content before approving';
    end if;
    new.edited_at := clock_timestamp();
  elsif old.edited_at is not null then
    -- A phone edit that races a Mac upsert must still win.
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
drop trigger if exists content_queue_guard_update on public.content_queue;
create trigger content_queue_guard_update before update on public.content_queue for each row execute function public.content_queue_guard_update();
