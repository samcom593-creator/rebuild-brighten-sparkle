-- Review the version displayed, with the existing owner, team and invite gates.
-- No publishing RPC, outbound request, campaign activation or new table grant.
set lock_timeout = '3s';

create or replace function public.social_draft_review(p_id bigint)
returns jsonb
language plpgsql stable security definer
set search_path = public
as $$
declare r public.social_bot_drafts%rowtype;
begin
  if auth.uid() is null or not coalesce(public.is_sam() or public.can_view_sold_calls(), false) then
    raise exception 'Content review access required' using errcode = '42501';
  end if;
  select * into r from public.social_bot_drafts
   where id = p_id and (public.is_sam() or status in ('awaiting_approval','awaiting_film','approved'));
  if not found then return null; end if;
  -- The team sees only the same active review scope as social_command_center.
  -- Include copy/media/destination for review; omit notes, credentials and internal IDs.
  return jsonb_build_object(
    'id', r.id, 'title', r.title, 'hook', r.hook, 'body', r.body,
    'caption', r.caption, 'cta', r.cta, 'hashtags', r.hashtags,
    'platform', r.platform, 'account', r.account, 'file_path', r.file_path,
    'status', r.status, 'content_hash', r.content_hash,
    'approved_content_hash', r.approved_content_hash,
    'shipped_at', r.shipped_at, 'shipped_url', r.shipped_url
  );
end;
$$;
revoke all on function public.social_draft_review(bigint) from public, anon;
grant execute on function public.social_draft_review(bigint) to authenticated;

create or replace function public.social_draft_review_set_status(p_id bigint, p_seen_hash text, p_status text)
returns text
language plpgsql security definer
set search_path = public
as $$
declare r public.social_bot_drafts%rowtype;
begin
  if auth.uid() is null or not coalesce(public.can_view_sold_calls(), false) then
    raise exception 'Social command access required' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('approved','archived','rejected') then
    raise exception 'Unsupported review status' using errcode = '22023';
  end if;
  select * into r from public.social_bot_drafts
   where id = p_id and status in ('awaiting_approval','awaiting_film','approved') for update;
  if not found then return 'not_found'; end if;
  if r.content_hash is distinct from p_seen_hash then return 'changed'; end if;
  if r.status = p_status then return 'already_handled'; end if;
  update public.social_bot_drafts
     set status = p_status,
         approved_at = case when p_status = 'approved' then now() else approved_at end,
         approved_by = case when p_status = 'approved' then auth.uid()::text else approved_by end,
         updated_at = now()
   where id = p_id returning * into r;
  if not found then return 'not_found'; end if;
  if r.status is distinct from p_status or (p_status = 'approved' and r.approved_content_hash is distinct from p_seen_hash) then
    raise exception 'Review write was not confirmed' using errcode = '40001';
  end if;
  return r.status;
end;
$$;
revoke all on function public.social_draft_review_set_status(bigint, text, text) from public, anon;
grant execute on function public.social_draft_review_set_status(bigint, text, text) to authenticated;

-- Keep the established owner RPC and its status restriction. Confirm the actual write.
create or replace function public.approve_social_draft(p_id bigint, p_seen_hash text)
returns text
language plpgsql security definer
set search_path = public
as $$
declare r public.social_bot_drafts%rowtype;
begin
  if auth.uid() is null or not coalesce(public.is_sam(), false) then
    raise exception 'Owner access required' using errcode = '42501';
  end if;
  select * into r from public.social_bot_drafts where id = p_id for update;
  if not found then return 'not_found'; end if;
  if r.status is distinct from 'awaiting_approval' then return 'already_handled'; end if;
  if r.content_hash is distinct from p_seen_hash then return 'changed'; end if;
  update public.social_bot_drafts
     set status = 'approved', approved_at = now(), approved_by = 'sam', updated_at = now()
   where id = p_id returning * into r;
  if not found then return 'not_found'; end if;
  if r.status is distinct from 'approved' or r.approved_content_hash is distinct from p_seen_hash then
    raise exception 'Approval write was not confirmed' using errcode = '40001';
  end if;
  return 'approved';
end;
$$;
revoke all on function public.approve_social_draft(bigint, text) from public, anon;
grant execute on function public.approve_social_draft(bigint, text) to authenticated;

-- Old clients may still archive/reject, but cannot approve unseen or changed content.
create or replace function public.social_draft_set_status(p_id bigint, p_status text, p_note text default null)
returns jsonb
language plpgsql security definer
set search_path = public
as $$
declare r public.social_bot_drafts%rowtype;
begin
  if not coalesce(public.can_view_sold_calls(), false) then
    raise exception 'Social command access required' using errcode = '42501';
  end if;
  if p_status = 'approved' then
    raise exception 'Open the complete draft and approve its reviewed version' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('archived','rejected','awaiting_film','awaiting_approval') then
    raise exception 'Unsupported draft status' using errcode = '22023';
  end if;
  update public.social_bot_drafts set
    status = p_status,
    notes = case when p_note is null or p_note = '' then notes else coalesce(notes,'') || E'\n' || p_note end,
    updated_at = now()
  where id = p_id returning * into r;
  if not found then raise exception 'Draft not found' using errcode = 'P0002'; end if;
  if r.status is distinct from p_status then raise exception 'Draft write was not confirmed' using errcode = '40001'; end if;
  return jsonb_build_object('id', r.id, 'status', r.status, 'approved_at', r.approved_at);
end;
$$;
revoke all on function public.social_draft_set_status(bigint, text, text) from public, anon;
grant execute on function public.social_draft_set_status(bigint, text, text) to authenticated, service_role;

-- Invoker trigger: an authenticated table write cannot bypass the reviewed RPC.
-- current_user changes inside SECURITY DEFINER; a client-set GUC is not trusted.
create or replace function public.trg_social_draft_approval_binding()
returns trigger language plpgsql set search_path = public
as $$
declare v_new_hash text := md5(coalesce(new.title, '') || chr(31) || coalesce(new.hook, '') || chr(31) || coalesce(new.body, '') || chr(31) ||
  coalesce(new.caption, '') || chr(31) || coalesce(new.hashtags, '') || chr(31) || coalesce(new.cta, '') || chr(31) ||
  coalesce(new.file_path, '') || chr(31) || coalesce(new.platform, '') || chr(31) || coalesce(new.account, ''));
begin
  if current_user in ('authenticated','anon') then
    if tg_op = 'INSERT' then
      if new.status in ('approved','shipped') or new.approved_at is not null or new.approved_by is not null or new.approved_content_hash is not null or new.shipped_at is not null or new.shipped_url is not null then
        raise exception 'Use the reviewed approval or publishing workflow' using errcode = '42501';
      end if;
    elsif (new.status = 'approved' and new.status is distinct from old.status)
       or new.approved_at is distinct from old.approved_at
       or new.approved_by is distinct from old.approved_by
       or new.approved_content_hash is distinct from old.approved_content_hash then
      raise exception 'Use the reviewed approval or publishing workflow' using errcode = '42501';
    end if;
    -- Preserve the owner's existing 'I posted it' receipt entry. It can record only
    -- an unchanged, version-approved draft and must carry the actual post URL/time.
    if tg_op = 'UPDATE' and ((new.status = 'shipped' and old.status is distinct from 'shipped')
        or new.shipped_at is distinct from old.shipped_at or new.shipped_url is distinct from old.shipped_url) then
      if new.status is distinct from 'shipped' or old.status is distinct from 'approved'
         or old.approved_content_hash is distinct from old.content_hash
         or v_new_hash is distinct from old.content_hash
         or new.shipped_at is null or not coalesce(public.content_publish_url_ok(new.shipped_url), false) then
        raise exception 'Record a post URL and time for the approved version' using errcode = '42501';
      end if;
    end if;
  end if;
  if new.status = 'shipped' and (tg_op = 'INSERT' or old.status is distinct from 'shipped') then
    if new.shipped_at is null or not coalesce(public.content_publish_url_ok(new.shipped_url), false) then
      raise exception 'A publishing receipt needs a valid post URL and publication time' using errcode = '22023';
    end if;
  end if;
  if new.status = 'approved' and (tg_op = 'INSERT' or old.status is distinct from 'approved') then
    new.approved_content_hash := v_new_hash;
  elsif new.status = 'approved' and old.status = 'approved'
      and v_new_hash is distinct from old.approved_content_hash then
    new.status := 'awaiting_approval';
    new.approved_at := null;
    new.approved_by := null;
    new.approved_content_hash := null;
  elsif new.status not in ('approved','shipped') then
    new.approved_content_hash := null;
  end if;
  return new;
end;
$$;
drop trigger if exists trg_social_draft_approval_binding on public.social_bot_drafts;
create trigger trg_social_draft_approval_binding before insert or update on public.social_bot_drafts
for each row execute function public.trg_social_draft_approval_binding();

-- Content Queue has its own owner/invite predicate; keep it separate from the team gate.
create or replace function public.content_queue_review_set_status(p_content_id text, p_seen_updated_at timestamptz, p_status text)
returns text
language plpgsql security definer
set search_path = public
as $$
declare r public.content_queue%rowtype;
begin
  if auth.uid() is null or not coalesce(public.content_can_access(), false) then
    raise exception 'Content access required' using errcode = '42501';
  end if;
  if p_status is null or p_status not in ('APPROVED','REWORK') then
    raise exception 'Unsupported review status' using errcode = '22023';
  end if;
  select * into r from public.content_queue where content_id = p_content_id for update;
  if not found then return 'not_found'; end if;
  if r.updated_at is distinct from p_seen_updated_at then return 'changed'; end if;
  if r.status = p_status or r.status is null or r.status not in ('INBOX','EDITING','NEEDS_REVIEW','APPROVED','READY','REWORK')
     or (p_status = 'APPROVED' and r.status = 'READY') then return 'already_handled'; end if;
  if p_status = 'APPROVED' and (coalesce(r.privacy_risk,'') like 'FLAG:%' or coalesce(r.earnings_claim_risk,'') like 'FLAG:%') then
    raise exception 'Review flagged content before approving' using errcode = '22023';
  end if;
  update public.content_queue
     set status = p_status,
         approved_by = case when p_status = 'APPROVED' then auth.uid()::text else approved_by end,
         edited_at = clock_timestamp()
   where content_id = p_content_id returning * into r;
  if not found then return 'not_found'; end if;
  if r.status is distinct from p_status then raise exception 'Review write was not confirmed' using errcode = '40001'; end if;
  return r.status;
end;
$$;
revoke all on function public.content_queue_review_set_status(text, timestamptz, text) from public, anon;
grant execute on function public.content_queue_review_set_status(text, timestamptz, text) to authenticated;

create or replace function public.content_queue_guard_update()
returns trigger language plpgsql set search_path = public
as $$
begin
  if auth.role() = 'authenticated' then
    if not coalesce(public.content_can_access(), false) then raise exception 'Content access required'; end if;
    if current_user = 'authenticated' and ((new.status = 'APPROVED' and new.status is distinct from old.status) or new.approved_by is distinct from old.approved_by) then
      raise exception 'Use the versioned review workflow' using errcode = '42501';
    end if;
    if new.status is distinct from old.status and new.status not in ('APPROVED','REWORK') then
      raise exception 'Use the archive workflow to record publishing';
    end if;
    if new.status = 'APPROVED' and (coalesce(new.privacy_risk,'') like 'FLAG:%' or coalesce(new.earnings_claim_risk,'') like 'FLAG:%') then
      raise exception 'Review flagged content before approving';
    end if;
    new.edited_at := clock_timestamp();
  elsif old.edited_at is not null then
    -- Preserve the existing phone-edit priority over a later Mac sync.
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
  if old.status in ('APPROVED','READY') and row(new.hook, new.caption, new.cta, new.brand, new.pillar,
      new.target_instagram, new.target_tiktok, new.target_youtube, new.target_snapchat,
      new.sha256, new.media_path, new.permission_confirmed, new.privacy_risk, new.earnings_claim_risk)
      is distinct from row(old.hook, old.caption, old.cta, old.brand, old.pillar,
      old.target_instagram, old.target_tiktok, old.target_youtube, old.target_snapchat,
      old.sha256, old.media_path, old.permission_confirmed, old.privacy_risk, old.earnings_claim_risk) then
    new.status := 'NEEDS_REVIEW';
    new.approved_by := null;
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;

comment on function public.social_draft_review(bigint) is 'Full version review: owner scope or existing active team review scope. No publication action.';
comment on function public.social_draft_review_set_status(bigint, text, text) is 'Existing Social Command gate; row lock and displayed content hash. Returns confirmed status or changed/already_handled/not_found.';
comment on function public.content_queue_review_set_status(text, timestamptz, text) is 'Existing content owner/invite gate; row lock and displayed updated_at. Returns confirmed status or changed/already_handled/not_found.';
