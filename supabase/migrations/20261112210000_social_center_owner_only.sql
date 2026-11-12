-- MP-302 part 4 (2026-11-12): the Social Media Center is the owner's, at the database.
--
-- Before: social_bot_drafts, social_bot_inbound, social_bot_blockers and keyword_dm_log were
-- readable and writable by any login holding the admin role, and the page route was
-- requireAdmin. Owner-only was a property of who happens to be an admin today.
-- After: direct access to the four tables answers to is_sam() only, and approval is bound to
-- the exact content approved.
-- Bots and edge functions use the service role and are unaffected.

set lock_timeout = '3s';

do $$
declare t text;
begin
  foreach t in array array['social_bot_drafts', 'social_bot_inbound', 'social_bot_blockers', 'keyword_dm_log'] loop
    execute format('drop policy if exists %I on public.%I', t || '_admin_all', t);
    execute format('drop policy if exists %I on public.%I', t || '_sam_only', t);
    execute format('create policy %I on public.%I for all to authenticated using (public.is_sam()) with check (public.is_sam())', t || '_sam_only', t);
  end loop;
end $$;

-- NOT registered as private tables, on purpose. Registering them made fn_private_surface_audit()
-- report social_command_center() and social_draft_set_status() as back doors (measured: the
-- audit went from 0 rows to 6). Those are the team Social Command surface, gated on the
-- sold_calls grant, and they read the queue by design. So: direct table access is the owner's
-- alone (the policies above), and the team surface keeps its own gated functions.
insert into public.private_surface_registry (kind, name, why) values
  ('reviewed_not_private', 'social_bot_drafts', 'direct access is_sam() only; the team Social Command reads it through its own grant-gated functions'),
  ('reviewed_not_private', 'social_bot_inbound', 'direct access is_sam() only; team Social Command reads through grant-gated functions'),
  ('reviewed_not_private', 'social_bot_blockers', 'direct access is_sam() only; holds blocker text, no message content'),
  ('reviewed_not_private', 'keyword_dm_log', 'direct access is_sam() only; keyword and handle, no message content')
on conflict (kind, name) do update set why = excluded.why;

-- The content a post is approved as: copy, media and destination. The date is not content.
alter table public.social_bot_drafts
  add column if not exists content_hash text generated always as (
    md5(coalesce(title, '') || chr(31) || coalesce(hook, '') || chr(31) || coalesce(body, '') || chr(31) ||
        coalesce(caption, '') || chr(31) || coalesce(hashtags, '') || chr(31) || coalesce(cta, '') || chr(31) ||
        coalesce(file_path, '') || chr(31) || coalesce(platform, '') || chr(31) || coalesce(account, ''))
  ) stored;
alter table public.social_bot_drafts add column if not exists approved_content_hash text;

-- Approval is of one version. Approving stamps that version; changing the copy, media or
-- destination of an approved draft sends it back for review.
create or replace function public.trg_social_draft_approval_binding()
returns trigger
language plpgsql
set search_path to 'public'
as $$
declare
  v_new_hash text := md5(coalesce(new.title, '') || chr(31) || coalesce(new.hook, '') || chr(31) || coalesce(new.body, '') || chr(31) ||
        coalesce(new.caption, '') || chr(31) || coalesce(new.hashtags, '') || chr(31) || coalesce(new.cta, '') || chr(31) ||
        coalesce(new.file_path, '') || chr(31) || coalesce(new.platform, '') || chr(31) || coalesce(new.account, ''));
begin
  if new.status = 'approved' and old.status is distinct from 'approved' then
    new.approved_content_hash := v_new_hash;
  elsif new.status = 'approved' and old.status = 'approved'
        and old.approved_content_hash is not null and v_new_hash <> old.approved_content_hash then
    new.status := 'awaiting_approval';
    new.approved_at := null;
    new.approved_by := null;
    new.approved_content_hash := null;
  elsif new.status not in ('approved', 'shipped') then
    new.approved_content_hash := null;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_social_draft_approval_binding on public.social_bot_drafts;
create trigger trg_social_draft_approval_binding
  before update on public.social_bot_drafts
  for each row execute function public.trg_social_draft_approval_binding();

-- Approve exactly what was on screen. The page sends back the content_hash it displayed.
create or replace function public.approve_social_draft(p_id bigint, p_seen_hash text)
returns text
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.social_bot_drafts%rowtype;
begin
  if not public.is_sam() then
    raise exception 'Owner access required' using errcode = '42501';
  end if;
  select * into v_row from public.social_bot_drafts where id = p_id for update;
  if not found then return 'not_found'; end if;
  if v_row.status <> 'awaiting_approval' then return 'already_handled'; end if;
  if v_row.content_hash is distinct from p_seen_hash then return 'changed'; end if;
  update public.social_bot_drafts
     set status = 'approved', approved_at = now(), approved_by = 'sam', updated_at = now()
   where id = p_id;
  return 'approved';
end;
$$;

revoke all on function public.approve_social_draft(bigint, text) from public, anon;
grant execute on function public.approve_social_draft(bigint, text) to authenticated;

comment on function public.approve_social_draft(bigint, text) is
  'Owner approval of one draft version (MP-302): approves only if the draft is still awaiting approval and its content_hash equals the one the page displayed. Returns approved | changed | already_handled | not_found.';
