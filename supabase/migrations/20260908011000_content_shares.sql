-- 20260908011000_content_shares.sql
-- Copy-paste share links (Sam, 2026-09-07: "share using copy and paste to give
-- access to view and download things"). A share is a token + a set of clip ids
-- (+ optional label/expiry). The public page /share/<token> calls the
-- content-share edge function, which reads with the service role and returns
-- previews, titles and the current direct download links. Creating a share is
-- admin/manager only; nobody reads this table directly from the client.
create table if not exists public.content_shares (
  token        text primary key,
  label        text not null default '',
  clip_ids     uuid[] not null default '{}',
  created_by   uuid,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz,
  view_count   integer not null default 0,
  last_viewed_at timestamptz
);
alter table public.content_shares enable row level security;
grant select, insert, update, delete on public.content_shares to authenticated;
grant all on public.content_shares to service_role;
drop policy if exists content_shares_admin_all on public.content_shares;
create policy content_shares_admin_all on public.content_shares
  for all to authenticated
  using  (has_role(auth.uid(),'admin'::app_role) or has_role(auth.uid(),'manager'::app_role))
  with check (has_role(auth.uid(),'admin'::app_role) or has_role(auth.uid(),'manager'::app_role));
