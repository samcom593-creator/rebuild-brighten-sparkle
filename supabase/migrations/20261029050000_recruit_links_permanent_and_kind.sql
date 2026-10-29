-- OVERHAUL-1 (2026-10-29) — recruiting links: permanent or temporary, one list per kind.
--
-- Sam: "there should be an option to make permanent link or make a temporary link."
-- Invite an agent mints hire invitations (/hire/<token>) and Refer a recruit now mints
-- prospect join links (/join/<token>), both through create_invitation(). Until now every
-- invitation expired within 1 to 720 hours (fn_invite_insert clamps it), so "permanent"
-- could not be stored.
--
-- WHAT THIS DOES (additive; no row is deleted or rewritten):
--   1. A permanent invitation stores expires_at = 'infinity'. One column, one truth:
--      fn_invitation_status() is untouched ('infinity' <= now() is false, so the row stays
--      pending until it is used, revoked or replaced), the column stays NOT NULL, and a
--      missing expiry still reads as expired. JSON never carries 'infinity': every RPC
--      below returns expires_at null with permanent true, so no client parses it as a date.
--   2. create_invitation gains p_permanent (default false). The old signature is dropped so
--      PostgREST has exactly one candidate; callers that never pass p_permanent behave as
--      before. Same authority (fn_invite_authorize), rate limit (fn_invite_insert), grants.
--   3. regenerate_invitation keeps a permanent link permanent when no new lifetime is asked
--      for. Its interval arithmetic would otherwise cast an infinite interval to an integer.
--   4. list_invitations gains p_kind ('hire' | 'join' | null = both) so each page lists and
--      COUNTS only its own links: the counts stay over the full scoped set of that kind.
--   5. get_invite_token_prefill reports a permanent link as permanent (expires_at null), so
--      /hire and /join never print an unreadable date.
--
-- Single use is unchanged: a permanent link still lets one person in. Public recruiting
-- links (/r/<slug>, agents.ref_slug) are untouched; nothing here reads or expires them.

-- ─── 1. create_invitation(..., p_permanent) ─────────────────────────────────
drop function if exists public.create_invitation(text, text, uuid, text, text, text, text, numeric, jsonb, integer, text);

create or replace function public.create_invitation(
  p_kind text default 'hire',
  p_target_role text default 'hired_unlicensed',
  p_target_manager_id uuid default null,
  p_recipient_email text default null,
  p_recipient_name text default null,
  p_recipient_phone text default null,
  p_license_status text default null,
  p_offered_comp_pct numeric default null,
  p_carrier_exceptions jsonb default '[]'::jsonb,
  p_expires_hours integer default 168,
  p_notes text default null,
  p_permanent boolean default false
) returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_auth jsonb;
  v_row public.invite_tokens%rowtype;
  v_email text := nullif(lower(btrim(coalesce(p_recipient_email, ''))), '');
  v_license text := case when p_license_status in ('licensed', 'unlicensed') then p_license_status end;
  v_prefill jsonb;
begin
  if v_email is not null and v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
    raise exception 'recipient email is not a valid address' using errcode = '22023';
  end if;

  v_auth := public.fn_invite_authorize(p_kind, p_target_role, p_target_manager_id,
                                       p_offered_comp_pct, coalesce(p_carrier_exceptions, '[]'::jsonb));

  v_prefill := jsonb_strip_nulls(jsonb_build_object(
    'full_name', nullif(btrim(coalesce(p_recipient_name, '')), ''),
    'email', v_email,
    'phone', nullif(regexp_replace(coalesce(p_recipient_phone, ''), '\D', '', 'g'), ''),
    'license_status', v_license,
    'license_status_locked', case when v_license is not null then true end
  ));

  v_row := public.fn_invite_insert(p_kind, v_auth, p_expires_hours, v_email, p_recipient_name, v_prefill, p_notes);

  -- Permanent: the row never reaches its expiry. Everything else about it (single use,
  -- recipient lock, revoke, replace) is exactly what a temporary invitation has.
  if coalesce(p_permanent, false) then
    update public.invite_tokens
       set expires_at = 'infinity'::timestamptz
     where id = v_row.id
    returning * into v_row;
  end if;

  return jsonb_build_object(
    'id', v_row.id,
    'kind', v_row.kind,
    'token', v_row.token,
    'path', '/' || v_row.kind || '/' || v_row.token,
    'expires_at', case when isfinite(v_row.expires_at) then v_row.expires_at end,
    'permanent', not isfinite(v_row.expires_at),
    'status', public.fn_invitation_status(v_row.used_at, v_row.superseded_by, v_row.is_active, v_row.revoked_at, v_row.expires_at),
    'offered_comp_pct', v_row.offered_comp_pct,
    'carrier_exceptions', v_row.carrier_exceptions,
    'agency_key', v_row.agency_key,
    'target_role', v_row.target_role,
    'target_manager_id', v_row.target_manager_id
  );
end;
$$;

revoke all on function public.create_invitation(text, text, uuid, text, text, text, text, numeric, jsonb, integer, text, boolean) from public, anon;
grant execute on function public.create_invitation(text, text, uuid, text, text, text, text, numeric, jsonb, integer, text, boolean) to authenticated, service_role;

-- ─── 2. regenerate_invitation: a permanent link is replaced by a permanent link ─
create or replace function public.regenerate_invitation(p_id uuid, p_expires_hours integer default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  old public.invite_tokens%rowtype;
  v_new public.invite_tokens%rowtype;
  v_status text;
  v_auth jsonb;
  v_hours int;
  v_permanent boolean;
begin
  if not public.fn_invite_can_manage(p_id) then
    raise exception 'not allowed to manage this invitation' using errcode = '42501';
  end if;
  select * into old from public.invite_tokens where id = p_id for update;
  v_status := public.fn_invitation_status(old.used_at, old.superseded_by, old.is_active, old.revoked_at, old.expires_at);
  if v_status = 'accepted' then
    raise exception 'invitation_already_accepted' using errcode = '22023';
  end if;
  if v_status = 'superseded' then
    raise exception 'invitation_already_superseded' using errcode = '22023';
  end if;
  if old.claimed_at is not null and old.claimed_at > now() - interval '3 minutes' then
    raise exception 'invitation_being_accepted' using errcode = '55P03';
  end if;

  -- The terms are re-authorized for the person regenerating: a manager cannot
  -- launder an admin-only offer by reissuing it.
  v_auth := public.fn_invite_authorize(old.kind, old.target_role, old.target_manager_id,
                                       old.offered_comp_pct, old.carrier_exceptions);

  -- No lifetime asked for: keep the old one. A permanent link stays permanent; a temporary
  -- one gets the same span it was minted with.
  v_permanent := p_expires_hours is null and not isfinite(old.expires_at);
  v_hours := case
    when p_expires_hours is not null then p_expires_hours
    when isfinite(old.expires_at) then greatest(1, least(720, ceil(extract(epoch from (old.expires_at - old.created_at)) / 3600.0)::int))
    else 168
  end;

  v_new := public.fn_invite_insert(old.kind, v_auth, v_hours, old.recipient_email, old.recipient_name,
                                   old.prefill_json, old.notes);

  if v_permanent then
    update public.invite_tokens
       set expires_at = 'infinity'::timestamptz
     where id = v_new.id
    returning * into v_new;
  end if;

  update public.invite_tokens
     set is_active = false,
         superseded_by = v_new.id,
         superseded_at = now(),
         claimed_at = null,
         claim_id = null
   where id = old.id;

  return jsonb_build_object(
    'id', v_new.id,
    'kind', v_new.kind,
    'token', v_new.token,
    'path', '/' || v_new.kind || '/' || v_new.token,
    'expires_at', case when isfinite(v_new.expires_at) then v_new.expires_at end,
    'permanent', not isfinite(v_new.expires_at),
    'status', 'pending',
    'superseded_id', old.id
  );
end;
$$;

-- ─── 3. list_invitations(..., p_kind) ───────────────────────────────────────
drop function if exists public.list_invitations(boolean, text, integer);

create or replace function public.list_invitations(
  p_include_history boolean default false,
  p_search text default null,
  p_limit integer default 200,
  p_kind text default null
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  c record;
  v_search text := nullif(btrim(coalesce(p_search, '')), '');
  v_like text;
  v_counts jsonb;
  v_rows jsonb;
  v_limit int := greatest(1, least(coalesce(p_limit, 200), 1000));
  v_kind text := nullif(btrim(coalesce(p_kind, '')), '');
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  if v_kind is not null and v_kind not in ('hire', 'join') then
    raise exception 'invalid kind: %', v_kind using errcode = '22023';
  end if;
  select * into c from public.fn_invite_caller();
  if not c.is_admin and c.agent_id is null then
    raise exception 'unauthorized: no active agent for caller' using errcode = '42501';
  end if;
  if v_search is not null then
    v_like := '%' || replace(replace(replace(v_search, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  with scope as (
    select t.id,
           public.fn_invitation_status(t.used_at, t.superseded_by, t.is_active, t.revoked_at, t.expires_at) as status
      from public.invite_tokens t
      left join public.agents ua on ua.id = t.used_by_agent_id
     where (c.is_admin
            or t.created_by_user_id = auth.uid()
            or (c.is_manager and c.agent_id is not null and (
                  t.target_manager_id = c.agent_id
               or exists (select 1 from public.fn_hierarchy_first_hops(array[c.agent_id]) h
                           where h.member = t.target_manager_id))))
       and (v_kind is null or t.kind = v_kind)
       and (v_like is null
            or coalesce(t.notes, '') ilike v_like escape '\'
            or coalesce(t.recipient_name, '') ilike v_like escape '\'
            or coalesce(t.recipient_email, '') ilike v_like escape '\'
            or coalesce(t.accepted_email, '') ilike v_like escape '\'
            or coalesce(ua.display_name, '') ilike v_like escape '\')
  ),
  -- Counts are over the FULL scoped set of this kind, never the returned page.
  counts as (
    select jsonb_build_object(
             'total', count(*),
             'pending', count(*) filter (where status = 'pending'),
             'accepted', count(*) filter (where status = 'accepted'),
             'expired', count(*) filter (where status = 'expired'),
             'revoked', count(*) filter (where status = 'revoked'),
             'superseded', count(*) filter (where status = 'superseded')) as j
      from scope
  ),
  page as (
    select t.created_at,
           jsonb_build_object(
             'id', t.id,
             'kind', t.kind,
             'status', s.status,
             'notes', t.notes,
             'recipient_name', t.recipient_name,
             'recipient_email', t.recipient_email,
             'target_role', t.target_role,
             'target_manager_id', t.target_manager_id,
             'upline_name', coalesce(nullif(btrim(m.display_name), ''), mp.full_name),
             'agency_key', t.agency_key,
             'offered_comp_pct', t.offered_comp_pct,
             'carrier_exceptions', t.carrier_exceptions,
             'created_at', t.created_at,
             'created_by_name', coalesce(nullif(btrim(cb.display_name), ''), cbp.full_name),
             'expires_at', case when isfinite(t.expires_at) then t.expires_at end,
             'permanent', not isfinite(t.expires_at),
             'license_status', case when t.prefill_json->>'license_status' in ('licensed', 'unlicensed')
                                    then t.prefill_json->>'license_status' end,
             'used_at', t.used_at,
             'used_by_agent_id', t.used_by_agent_id,
             'accepted_agent_name', ua.display_name,
             'revoked_at', t.revoked_at,
             'superseded_by', t.superseded_by,
             'superseded_at', t.superseded_at,
             'share_count', t.share_count,
             'last_shared_at', t.last_shared_at
           ) as r
      from scope s
      join public.invite_tokens t on t.id = s.id
      left join public.agents m on m.id = t.target_manager_id
      left join public.profiles mp on mp.id = m.profile_id
      left join public.agents cb on cb.id = t.created_by
      left join public.profiles cbp on cbp.id = cb.profile_id
      left join public.agents ua on ua.id = t.used_by_agent_id
     where coalesce(p_include_history, false) or s.status = 'pending'
     order by t.created_at desc
     limit v_limit
  )
  select (select j from counts),
         coalesce((select jsonb_agg(r order by created_at desc) from page), '[]'::jsonb)
    into v_counts, v_rows;

  return jsonb_build_object('counts', v_counts, 'rows', v_rows, 'limit', v_limit, 'kind', v_kind);
end;
$$;

revoke all on function public.list_invitations(boolean, text, integer, text) from public, anon;
grant execute on function public.list_invitations(boolean, text, integer, text) to authenticated, service_role;

-- ─── 4. get_invite_token_prefill: permanent reads as permanent ──────────────
create or replace function public.get_invite_token_prefill(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_row public.invite_tokens%rowtype;
  v_status text;
  v_locked boolean;
  v_license_status text;
  v_upline_name text;
  v_hint text;
  v_at int;
begin
  select * into v_row from public.invite_tokens where token = p_token limit 1;
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'invite_invalid');
  end if;
  v_status := public.fn_invitation_status(v_row.used_at, v_row.superseded_by, v_row.is_active, v_row.revoked_at, v_row.expires_at);
  if v_status <> 'pending' then
    return jsonb_build_object('ok', false, 'reason', case v_status
      when 'accepted' then 'invite_already_used'
      when 'superseded' then 'invite_superseded'
      when 'revoked' then 'invite_revoked'
      else 'invite_expired' end);
  end if;

  v_locked := lower(coalesce(v_row.prefill_json->>'license_status_locked', 'false')) in ('true', 't', '1', 'yes');
  v_license_status := case when v_row.prefill_json->>'license_status' in ('licensed', 'unlicensed')
                           then v_row.prefill_json->>'license_status' end;

  select coalesce(nullif(btrim(a.display_name), ''), p.full_name) into v_upline_name
    from public.agents a left join public.profiles p on p.id = a.profile_id
   where a.id = coalesce(v_row.target_manager_id, v_row.created_by);

  if v_row.recipient_email is not null then
    v_at := position('@' in v_row.recipient_email);
    v_hint := case when v_at > 1 then left(v_row.recipient_email, 1) || '***' || substr(v_row.recipient_email, v_at) else '***' end;
  end if;

  return jsonb_build_object(
    'ok', true,
    'kind', v_row.kind,
    'target_role', v_row.target_role,
    'expires_at', case when isfinite(v_row.expires_at) then v_row.expires_at end,
    'permanent', not isfinite(v_row.expires_at),
    'prefill', jsonb_build_object(
      'full_name', coalesce(v_row.prefill_json->>'full_name', v_row.recipient_name),
      'phone', v_row.prefill_json->>'phone',
      'email', coalesce(v_row.prefill_json->>'email', v_row.recipient_email),
      'state', v_row.prefill_json->>'state',
      'license_status', v_license_status,
      'license_status_locked', v_locked
    ),
    -- Only THIS recipient's offer: no inviter comp, no margin, no other agent.
    'offered_terms', jsonb_build_object(
      'comp_pct', v_row.offered_comp_pct,
      'carrier_exceptions', coalesce((
        select jsonb_agg(jsonb_build_object('carrier_name', e->>'carrier_name', 'pct', (e->>'pct')::numeric))
          from jsonb_array_elements(v_row.carrier_exceptions) e), '[]'::jsonb),
      'upline_name', v_upline_name,
      'agency_key', v_row.agency_key
    ),
    'recipient', jsonb_build_object(
      'restricted', v_row.recipient_email is not null,
      'email_hint', v_hint
    )
  );
end;
$$;
