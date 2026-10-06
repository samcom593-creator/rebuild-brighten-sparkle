-- §8 APEX OS redesign — invitation lifecycle, offered comp terms, server-side authority.
--
-- WHAT WAS WRONG (docs/audits/apex-os-redesign-2026-10-05/07-invitations-comp-links.md):
--   * invite_tokens carried no comp, no agency, no carrier exceptions and no
--     recipient restriction; prefill_json.email was never compared at accept.
--   * generate_invite_token let ANY active agent mint ANY target_role
--     (manager / agency_owner / staff included) under ANY upline.
--   * Revocation was a client UPDATE under an RLS policy that let every manager
--     read every raw token and rewrite anyone's invitation.
--   * There was no Expired / Superseded state, no regenerate, no history search;
--     23 rows were expired but still is_active.
--   * Two concurrent accepts of one token both passed the read-time checks.
--
-- WHAT THIS DOES (additive; no row is deleted or rewritten):
--   1. invite_tokens gains the offered terms (recipient, offered comp, carrier
--      exceptions, server-derived agency), supersession, share receipts, an
--      accept lease and the accepted-terms snapshot.
--   2. Status is DERIVED, never stored: fn_invitation_status() is the single
--      definition (pending / accepted / expired / revoked / superseded), so no
--      sweeper can drift from it. src/lib/invitationState.ts mirrors it.
--   3. Authority lives in fn_invite_authorize(): admin may mint anything; a
--      manager may mint agent-shaped roles under self or downline and offer comp
--      only from APPROVED existing values at or below their own resolved level
--      (and never above 100 — that needs an admin, same rule as Add Agent);
--      any other active agent may invite under self / downline with no comp.
--   4. Acceptance is claimed atomically (row lock + 3-minute lease), terms are
--      applied from the ROW (never from the URL or body), and completion is
--      single-use (used_at IS NULL + matching claim id).
--   5. OFFERED comp lands on agents.comp_percentage (+ comp_approval_*), which is
--      the value the contracting intake snapshots for the carrier request.
--      CARRIER-CONFIRMED comp (agent_contract_levels / agent_carrier_comp) is
--      never written by an invitation.
--   6. Writes to invite_tokens go through SECURITY DEFINER RPCs only; the
--      authenticated SELECT policy narrows to admin + the row's creator.
--
-- Public recruiting links (/r/<slug>, agents.ref_slug) are untouched: nothing
-- here reads or expires them.

-- ─── 1. Columns ─────────────────────────────────────────────────────────────
alter table public.invite_tokens
  add column if not exists recipient_email text,
  add column if not exists recipient_name text,
  add column if not exists offered_comp_pct numeric,
  add column if not exists carrier_exceptions jsonb not null default '[]'::jsonb,
  add column if not exists agency_key text,
  add column if not exists superseded_by uuid references public.invite_tokens(id) on delete set null,
  add column if not exists superseded_at timestamptz,
  add column if not exists share_count integer not null default 0,
  add column if not exists last_shared_at timestamptz,
  add column if not exists claimed_at timestamptz,
  add column if not exists claim_id uuid,
  add column if not exists accepted_email text,
  add column if not exists accepted_terms jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'invite_tokens_offered_comp_range') then
    -- Same bounds as agents_comp_percentage_range: an offer the agents row
    -- could not store must not be mintable.
    alter table public.invite_tokens add constraint invite_tokens_offered_comp_range
      check (offered_comp_pct is null or (offered_comp_pct >= 50 and offered_comp_pct <= 200));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'invite_tokens_recipient_email_shape') then
    alter table public.invite_tokens add constraint invite_tokens_recipient_email_shape
      check (recipient_email is null or (recipient_email = lower(btrim(recipient_email))
             and recipient_email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
             and length(recipient_email) <= 254));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'invite_tokens_carrier_exceptions_array') then
    alter table public.invite_tokens add constraint invite_tokens_carrier_exceptions_array
      check (jsonb_typeof(carrier_exceptions) = 'array' and jsonb_array_length(carrier_exceptions) <= 25);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'invite_tokens_agency_key_vocab') then
    alter table public.invite_tokens add constraint invite_tokens_agency_key_vocab
      check (agency_key is null or agency_key in ('primary', 'vantage'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'invite_tokens_share_count_nonneg') then
    alter table public.invite_tokens add constraint invite_tokens_share_count_nonneg
      check (share_count >= 0);
  end if;
end $$;

create index if not exists invite_tokens_created_by_user_idx on public.invite_tokens (created_by_user_id);
create index if not exists invite_tokens_target_manager_idx on public.invite_tokens (target_manager_id);
create index if not exists invite_tokens_used_by_agent_idx on public.invite_tokens (used_by_agent_id);

comment on column public.invite_tokens.offered_comp_pct is
  'OFFERED comp approved by the inviter (fn_invite_authorize). Applied to agents.comp_percentage at accept. Never carrier-confirmed comp.';
comment on column public.invite_tokens.carrier_exceptions is
  'Offered per-carrier exceptions [{carrier_id, carrier_name, pct, note}], names resolved server-side from public.carriers.';
comment on column public.invite_tokens.agency_key is
  'Agency derived server-side from the upline (fn_agent_subagency): primary | vantage. Never taken from the client.';
comment on column public.invite_tokens.accepted_terms is
  'Immutable snapshot of the terms the recipient accepted, written once by invitation_complete().';

-- ─── 2. Status: one definition ──────────────────────────────────────────────
create or replace function public.fn_invitation_status(
  p_used_at timestamptz,
  p_superseded_by uuid,
  p_is_active boolean,
  p_revoked_at timestamptz,
  p_expires_at timestamptz,
  p_now timestamptz default now()
) returns text
language sql
immutable
set search_path to 'public'
as $$
  -- Precedence is deliberate: an accepted invitation stays accepted even when a
  -- later revoke touched the row (1 live row carries both), and a superseded one
  -- is reported as superseded rather than as the revoke that accompanies it.
  select case
    when p_used_at is not null then 'accepted'
    when p_superseded_by is not null then 'superseded'
    when coalesce(p_is_active, false) = false or p_revoked_at is not null then 'revoked'
    when p_expires_at is null or p_expires_at <= p_now then 'expired'
    else 'pending'
  end;
$$;

-- ─── 3. Approved comp values (single source) ────────────────────────────────
create or replace function public.fn_invite_comp_levels()
returns numeric[]
language sql
stable
security definer
set search_path to 'public'
as $$
  -- "Approved" means a human with authority decided it: an admin / Sam
  -- directive / manager row on agent_contract_levels, or an approved
  -- agents.comp_percentage. Carrier-derived maxima (agentlink_carrier_max_*)
  -- are carrier-CONFIRMED levels, not approvals, and are excluded on purpose.
  select coalesce(array_agg(v order by v), '{}'::numeric[])
  from (
    select distinct round(l.contract_pct, 2) as v
      from public.agent_contract_levels l
     where (l.source = 'admin_ui' or l.source = 'manager_ui' or l.source like 'sam_directive%')
       and l.contract_pct between 50 and 200
    union
    select distinct round(a.comp_percentage, 2)
      from public.agents a
     where a.comp_approval_status = 'approved'
       and a.comp_percentage between 50 and 200
  ) s;
$$;

-- ─── 4. Caller scope + authority ────────────────────────────────────────────
create or replace function public.fn_invite_caller()
returns table (user_id uuid, agent_id uuid, is_admin boolean, is_manager boolean, cap_pct numeric)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_agent uuid;
begin
  select coalesce(a.canonical_agent_id, a.id) into v_agent
    from public.agents a
   where a.user_id = auth.uid()
     and coalesce(a.is_deactivated, false) = false
   order by (a.canonical_agent_id is null) desc, a.created_at
   limit 1;

  return query
  select auth.uid(),
         v_agent,
         coalesce(public.apex_is_admin(), false),
         coalesce(public.has_role(auth.uid(), 'manager'::app_role), false),
         (select f.pct from public.fn_agent_contract_pct(v_agent) f where v_agent is not null);
end;
$$;

create or replace function public.fn_invite_authorize(
  p_kind text,
  p_target_role text,
  p_target_manager_id uuid,
  p_offered_comp_pct numeric,
  p_carrier_exceptions jsonb
) returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  c record;
  v_upline uuid;
  v_upline_ok boolean;
  v_levels numeric[];
  v_ex jsonb;
  v_norm jsonb := '[]'::jsonb;
  v_carrier record;
  v_pct numeric;
  v_seen uuid[] := '{}';
  v_agency text;
  v_role text := coalesce(nullif(btrim(coalesce(p_target_role, '')), ''), 'hired_unlicensed');
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;

  select * into c from public.fn_invite_caller();

  if p_kind not in ('hire', 'join') then
    raise exception 'invalid kind: %', p_kind using errcode = '22023';
  end if;

  -- Admins may mint any role the table accepts. An admin with no agent row
  -- still needs an upline on the invitation, so the target must be explicit.
  if not c.is_admin then
    if c.agent_id is null then
      raise exception 'unauthorized: no active agent for caller' using errcode = '42501';
    end if;
    if v_role not in ('agent', 'hired_unlicensed', 'hired_licensed', 'manager_candidate', 'referral_prospect') then
      raise exception 'only an admin can invite someone as %', replace(v_role, '_', ' ') using errcode = '42501';
    end if;
  end if;

  v_upline := coalesce(public.fn_canonical_agent_id(p_target_manager_id), p_target_manager_id, c.agent_id);
  if v_upline is null then
    raise exception 'choose an upline for this invitation' using errcode = '22023';
  end if;

  if not exists (
    select 1 from public.agents a
     where a.id = v_upline
       and coalesce(a.is_deactivated, false) = false
       and a.status::text = 'active'
  ) then
    raise exception 'that upline is not an active agent' using errcode = '22023';
  end if;

  if not c.is_admin and v_upline <> c.agent_id then
    -- Same recursive walk set_agent_contract_pct uses, so "who may I place
    -- under" and "who do I manage" cannot drift apart.
    select exists (
      select 1 from public.fn_hierarchy_first_hops(array[c.agent_id]) h where h.member = v_upline
    ) into v_upline_ok;
    if not coalesce(v_upline_ok, false) then
      raise exception 'that upline is not in your downline' using errcode = '42501';
    end if;
  end if;

  if p_kind = 'join' and (p_offered_comp_pct is not null
      or jsonb_array_length(coalesce(p_carrier_exceptions, '[]'::jsonb)) > 0) then
    raise exception 'a prospect join link cannot carry comp terms' using errcode = '22023';
  end if;

  v_levels := public.fn_invite_comp_levels();

  if p_offered_comp_pct is not null then
    if p_offered_comp_pct < 50 or p_offered_comp_pct > 200 then
      raise exception 'offered comp must be between 50 and 200 percent' using errcode = '22023';
    end if;
    if not c.is_admin then
      if not c.is_manager then
        raise exception 'only a manager or admin can offer comp' using errcode = '42501';
      end if;
      if not (round(p_offered_comp_pct, 2) = any (v_levels)) then
        raise exception 'offered comp % percent is not an approved level', p_offered_comp_pct using errcode = '42501';
      end if;
      if p_offered_comp_pct > 100 then
        raise exception 'comp above 100 percent needs an admin' using errcode = '42501';
      end if;
      if c.cap_pct is null then
        raise exception 'your own comp level is not set, so a cap cannot be applied' using errcode = '42501';
      end if;
      if p_offered_comp_pct > c.cap_pct then
        raise exception 'you cannot offer above your own level' using errcode = '42501';
      end if;
    end if;
  end if;

  if p_carrier_exceptions is not null and jsonb_typeof(p_carrier_exceptions) <> 'array' then
    raise exception 'carrier exceptions must be a list' using errcode = '22023';
  end if;

  for v_ex in select value from jsonb_array_elements(coalesce(p_carrier_exceptions, '[]'::jsonb)) loop
    if not c.is_admin and not c.is_manager then
      raise exception 'only a manager or admin can offer carrier exceptions' using errcode = '42501';
    end if;
    begin
      v_pct := (v_ex->>'pct')::numeric;
    exception when others then
      raise exception 'carrier exception percent is not a number' using errcode = '22023';
    end;
    select ca.id, ca.name into v_carrier
      from public.carriers ca
     where ca.id = case when (v_ex->>'carrier_id') ~* '^[0-9a-f-]{36}$' then (v_ex->>'carrier_id')::uuid end
       and coalesce(ca.is_active, true);
    if v_carrier.id is null then
      raise exception 'unknown or inactive carrier in exceptions' using errcode = '22023';
    end if;
    if v_carrier.id = any (v_seen) then
      raise exception 'carrier % is listed twice', v_carrier.name using errcode = '22023';
    end if;
    v_seen := v_seen || v_carrier.id;
    if v_pct is null or v_pct < 50 or v_pct > 200 then
      raise exception 'carrier exception for % must be between 50 and 200 percent', v_carrier.name using errcode = '22023';
    end if;
    if not c.is_admin then
      if not (round(v_pct, 2) = any (v_levels)) then
        raise exception 'carrier exception % percent is not an approved level', v_pct using errcode = '42501';
      end if;
      if v_pct > 100 or c.cap_pct is null or v_pct > c.cap_pct then
        raise exception 'carrier exception for % exceeds what you can offer', v_carrier.name using errcode = '42501';
      end if;
    end if;
    v_norm := v_norm || jsonb_build_array(jsonb_build_object(
      'carrier_id', v_carrier.id,
      'carrier_name', v_carrier.name,
      'pct', round(v_pct, 2),
      'note', nullif(left(btrim(coalesce(v_ex->>'note', '')), 200), '')
    ));
  end loop;

  v_agency := case when public.fn_agent_subagency(v_upline) = 'vantage' then 'vantage' else 'primary' end;

  return jsonb_build_object(
    'caller_agent_id', c.agent_id,
    'is_admin', c.is_admin,
    'target_role', v_role,
    'target_manager_id', v_upline,
    'agency_key', v_agency,
    'offered_comp_pct', case when p_offered_comp_pct is null then null else round(p_offered_comp_pct, 2) end,
    'carrier_exceptions', v_norm
  );
end;
$$;

-- Who may manage (copy / share / revoke / regenerate) an existing invitation.
create or replace function public.fn_invite_can_manage(p_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  c record;
  t public.invite_tokens%rowtype;
begin
  if auth.uid() is null then return false; end if;
  select * into t from public.invite_tokens where id = p_id;
  if t.id is null then return false; end if;
  select * into c from public.fn_invite_caller();
  if c.is_admin then return true; end if;
  if t.created_by_user_id = auth.uid() then return true; end if;
  if c.agent_id is null or not c.is_manager then return false; end if;
  return t.target_manager_id = c.agent_id or exists (
    select 1 from public.fn_hierarchy_first_hops(array[c.agent_id]) h where h.member = t.target_manager_id
  );
end;
$$;

-- ─── 5. Mint ────────────────────────────────────────────────────────────────
create or replace function public.fn_invite_insert(
  p_kind text,
  p_auth jsonb,
  p_expires_hours integer,
  p_recipient_email text,
  p_recipient_name text,
  p_prefill jsonb,
  p_notes text
) returns public.invite_tokens
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_row public.invite_tokens%rowtype;
  v_token text;
  v_hours int := greatest(1, least(coalesce(p_expires_hours, 168), 720));
  v_creator uuid := nullif(p_auth->>'caller_agent_id', '')::uuid;
  v_email text := nullif(lower(btrim(coalesce(p_recipient_email, ''))), '');
  v_recent int;
begin
  select count(*) into v_recent
    from public.invite_tokens
   where created_by_user_id = auth.uid()
     and created_at > now() - interval '1 hour';
  if v_recent >= 20 then
    raise exception 'rate_limit: 20 invitations/hour cap reached' using errcode = '54000';
  end if;

  v_token := encode(extensions.gen_random_bytes(24), 'base64');
  v_token := replace(replace(replace(v_token, '+', '-'), '/', '_'), '=', '');

  insert into public.invite_tokens (
    kind, token, created_by, created_by_user_id, expires_at,
    target_role, target_manager_id, prefill_json, notes,
    recipient_email, recipient_name, offered_comp_pct, carrier_exceptions, agency_key
  ) values (
    p_kind, v_token, v_creator, auth.uid(), now() + make_interval(hours => v_hours),
    p_auth->>'target_role', (p_auth->>'target_manager_id')::uuid,
    coalesce(p_prefill, '{}'::jsonb), nullif(left(btrim(coalesce(p_notes, '')), 200), ''),
    v_email, nullif(left(btrim(coalesce(p_recipient_name, '')), 120), ''),
    nullif(p_auth->>'offered_comp_pct', '')::numeric,
    coalesce(p_auth->'carrier_exceptions', '[]'::jsonb),
    p_auth->>'agency_key'
  ) returning * into v_row;

  return v_row;
end;
$$;

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
  p_notes text default null
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

  return jsonb_build_object(
    'id', v_row.id,
    'kind', v_row.kind,
    'token', v_row.token,
    'path', '/' || v_row.kind || '/' || v_row.token,
    'expires_at', v_row.expires_at,
    'status', public.fn_invitation_status(v_row.used_at, v_row.superseded_by, v_row.is_active, v_row.revoked_at, v_row.expires_at),
    'offered_comp_pct', v_row.offered_comp_pct,
    'carrier_exceptions', v_row.carrier_exceptions,
    'agency_key', v_row.agency_key,
    'target_role', v_row.target_role,
    'target_manager_id', v_row.target_manager_id
  );
end;
$$;

-- Legacy signature kept for AddAgentModal / AgentProfileDrawer, now behind the
-- same authority check. Return shape unchanged.
create or replace function public.generate_invite_token(
  p_kind text,
  p_expires_hours integer default 168,
  p_target_role text default null,
  p_target_manager_id uuid default null,
  p_prefill jsonb default '{}'::jsonb,
  p_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_auth jsonb;
  v_row public.invite_tokens%rowtype;
begin
  v_auth := public.fn_invite_authorize(p_kind, p_target_role, p_target_manager_id, null, '[]'::jsonb);
  v_row := public.fn_invite_insert(
    -- A legacy prefill email stays a form hint, never a recipient restriction.
    p_kind, v_auth, p_expires_hours, null,
    p_prefill->>'full_name', p_prefill, p_notes);

  return jsonb_build_object(
    'token', v_row.token,
    'url', 'https://apex-financial.org/' || v_row.kind || '/' || v_row.token,
    'kind', v_row.kind,
    'expires_at', v_row.expires_at,
    'id', v_row.id
  );
end;
$$;

-- ─── 6. Manage ──────────────────────────────────────────────────────────────
create or replace function public.invitation_mint_options()
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  c record;
  v_uplines jsonb;
  v_levels numeric[];
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select * into c from public.fn_invite_caller();
  if not c.is_admin and c.agent_id is null then
    raise exception 'unauthorized: no active agent for caller' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id,
           'name', coalesce(nullif(btrim(a.display_name), ''), nullif(btrim(p.full_name), ''), 'Unnamed agent'),
           'agency_key', case when public.fn_agent_subagency(a.id) = 'vantage' then 'vantage' else 'primary' end,
           'is_self', a.id = c.agent_id
         ) order by (a.id = c.agent_id) desc, coalesce(a.display_name, p.full_name)), '[]'::jsonb)
    into v_uplines
    from public.agents a
    left join public.profiles p on p.id = a.profile_id
   where a.canonical_agent_id is null
     and coalesce(a.is_deactivated, false) = false
     and a.status::text = 'active'
     and (c.is_admin
          or a.id = c.agent_id
          or exists (select 1 from public.fn_hierarchy_first_hops(array[c.agent_id]) h where h.member = a.id));

  v_levels := public.fn_invite_comp_levels();

  return jsonb_build_object(
    'is_admin', c.is_admin,
    'is_manager', c.is_manager,
    'caller_agent_id', c.agent_id,
    -- The caller's OWN cap only; never another agent's comp.
    'cap_pct', case when c.is_admin then 200 else c.cap_pct end,
    'can_offer_comp', c.is_admin or (c.is_manager and c.cap_pct is not null),
    'comp_levels', to_jsonb(case when c.is_admin then v_levels
                                 else array(select v from unnest(v_levels) v
                                             where v <= least(coalesce(c.cap_pct, 0), 100)) end),
    'roles', case when c.is_admin
                  then '["hired_unlicensed","hired_licensed","hired_manager","agency_owner","staff"]'::jsonb
                  else '["hired_unlicensed","hired_licensed"]'::jsonb end,
    'uplines', v_uplines,
    'carriers', coalesce((select jsonb_agg(jsonb_build_object('id', ca.id, 'name', ca.name) order by ca.name)
                            from public.carriers ca where coalesce(ca.is_active, true)), '[]'::jsonb)
  );
end;
$$;

create or replace function public.list_invitations(
  p_include_history boolean default false,
  p_search text default null,
  p_limit integer default 200
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
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
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
       and (v_like is null
            or coalesce(t.notes, '') ilike v_like escape '\'
            or coalesce(t.recipient_name, '') ilike v_like escape '\'
            or coalesce(t.recipient_email, '') ilike v_like escape '\'
            or coalesce(t.accepted_email, '') ilike v_like escape '\'
            or coalesce(ua.display_name, '') ilike v_like escape '\')
  ),
  -- Counts are over the FULL scoped set, never the returned page.
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
             'expires_at', t.expires_at,
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

  return jsonb_build_object('counts', v_counts, 'rows', v_rows, 'limit', v_limit);
end;
$$;

create or replace function public.invitation_link(p_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  t public.invite_tokens%rowtype;
  v_status text;
begin
  if not public.fn_invite_can_manage(p_id) then
    raise exception 'not allowed to manage this invitation' using errcode = '42501';
  end if;
  select * into t from public.invite_tokens where id = p_id;
  v_status := public.fn_invitation_status(t.used_at, t.superseded_by, t.is_active, t.revoked_at, t.expires_at);
  if v_status <> 'pending' then
    -- A terminal link is never handed back out; copying it would share a dead URL.
    return jsonb_build_object('ok', false, 'status', v_status);
  end if;
  return jsonb_build_object('ok', true, 'status', v_status, 'token', t.token,
                            'path', '/' || t.kind || '/' || t.token, 'recipient_email', t.recipient_email);
end;
$$;

create or replace function public.record_invitation_share(p_id uuid, p_channel text default 'copy')
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  t public.invite_tokens%rowtype;
  v_status text;
begin
  if not public.fn_invite_can_manage(p_id) then
    raise exception 'not allowed to manage this invitation' using errcode = '42501';
  end if;
  select * into t from public.invite_tokens where id = p_id for update;
  v_status := public.fn_invitation_status(t.used_at, t.superseded_by, t.is_active, t.revoked_at, t.expires_at);
  if v_status <> 'pending' then
    return jsonb_build_object('ok', false, 'status', v_status);
  end if;
  -- A share is a link handed to the operator (clipboard / their own mail app).
  -- It is recorded as SHARED, never as delivered: nothing here sends anything.
  update public.invite_tokens
     set share_count = share_count + 1,
         last_shared_at = now()
   where id = p_id
  returning * into t;
  return jsonb_build_object('ok', true, 'status', v_status, 'token', t.token,
                            'path', '/' || t.kind || '/' || t.token,
                            'recipient_email', t.recipient_email,
                            'share_count', t.share_count, 'last_shared_at', t.last_shared_at,
                            'channel', left(coalesce(p_channel, 'copy'), 20), 'delivered', false);
end;
$$;

create or replace function public.revoke_invitation(p_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  t public.invite_tokens%rowtype;
  v_status text;
begin
  if not public.fn_invite_can_manage(p_id) then
    raise exception 'not allowed to manage this invitation' using errcode = '42501';
  end if;
  select * into t from public.invite_tokens where id = p_id for update;
  v_status := public.fn_invitation_status(t.used_at, t.superseded_by, t.is_active, t.revoked_at, t.expires_at);
  if v_status = 'accepted' then
    raise exception 'invitation_already_accepted' using errcode = '22023';
  end if;
  if v_status = 'pending' or v_status = 'expired' then
    update public.invite_tokens
       set is_active = false, revoked_at = coalesce(revoked_at, now()),
           revoked_by = (select f.agent_id from public.fn_invite_caller() f),
           claimed_at = null, claim_id = null
     where id = p_id
    returning * into t;
  end if;
  return jsonb_build_object('ok', true, 'id', p_id,
    'status', public.fn_invitation_status(t.used_at, t.superseded_by, t.is_active, t.revoked_at, t.expires_at));
end;
$$;

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
  v_hours := coalesce(p_expires_hours,
                      greatest(1, least(720, ceil(extract(epoch from (old.expires_at - old.created_at)) / 3600.0)::int)));

  v_new := public.fn_invite_insert(old.kind, v_auth, v_hours, old.recipient_email, old.recipient_name,
                                   old.prefill_json, old.notes);

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
    'expires_at', v_new.expires_at,
    'status', 'pending',
    'superseded_id', old.id
  );
end;
$$;

-- Offered terms for one agent, kept apart from carrier-confirmed comp.
create or replace function public.agent_invitation_terms(p_agent_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  c record;
  v_canon uuid := coalesce(public.fn_canonical_agent_id(p_agent_id), p_agent_id);
  t public.invite_tokens%rowtype;
  v_offered numeric;
  v_approval text;
begin
  if auth.uid() is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  select * into c from public.fn_invite_caller();
  if not (c.is_admin
          or c.agent_id = v_canon
          or (c.is_manager and exists (select 1 from public.fn_hierarchy_first_hops(array[c.agent_id]) h
                                        where h.member = v_canon))) then
    raise exception 'not allowed to read this agent''s terms' using errcode = '42501';
  end if;

  select * into t from public.invite_tokens
   where used_by_agent_id = v_canon or used_by_agent_id = p_agent_id
   order by used_at desc nulls last
   limit 1;
  select a.comp_percentage, a.comp_approval_status into v_offered, v_approval
    from public.agents a where a.id = v_canon;

  return jsonb_build_object(
    'agent_id', v_canon,
    'offered_comp_pct', v_offered,
    'offered_comp_approval', v_approval,
    'invitation', case when t.id is null then null else jsonb_build_object(
      'id', t.id, 'accepted_at', t.used_at, 'terms', t.accepted_terms) end
  );
end;
$$;

-- ─── 7. Public prefill (recipient view) ─────────────────────────────────────
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
    'expires_at', v_row.expires_at,
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

-- ─── 8. Acceptance (service role only; called by consume-invite-token) ──────
create or replace function public.invitation_claim(p_token text, p_email text)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  t public.invite_tokens%rowtype;
  v_status text;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_claim uuid := gen_random_uuid();
  v_at int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if coalesce(length(p_token), 0) < 8 then
    return jsonb_build_object('ok', false, 'error', 'invite_invalid');
  end if;

  select * into t from public.invite_tokens where token = p_token for update;
  if t.id is null then
    return jsonb_build_object('ok', false, 'error', 'invite_invalid');
  end if;

  v_status := public.fn_invitation_status(t.used_at, t.superseded_by, t.is_active, t.revoked_at, t.expires_at);
  if v_status = 'accepted' then return jsonb_build_object('ok', false, 'error', 'invite_already_used'); end if;
  if v_status = 'superseded' then return jsonb_build_object('ok', false, 'error', 'invite_superseded'); end if;
  if v_status = 'revoked' then return jsonb_build_object('ok', false, 'error', 'invite_revoked'); end if;
  if v_status = 'expired' then return jsonb_build_object('ok', false, 'error', 'invite_expired'); end if;

  if t.recipient_email is not null and v_email <> t.recipient_email then
    v_at := position('@' in t.recipient_email);
    return jsonb_build_object('ok', false, 'error', 'recipient_mismatch',
      'email_hint', case when v_at > 1 then left(t.recipient_email, 1) || '***' || substr(t.recipient_email, v_at) else '***' end);
  end if;

  if t.claimed_at is not null and t.claimed_at > now() - interval '3 minutes' then
    return jsonb_build_object('ok', false, 'error', 'invite_in_progress');
  end if;

  update public.invite_tokens set claimed_at = now(), claim_id = v_claim where id = t.id;

  return jsonb_build_object(
    'ok', true,
    'claim_id', v_claim,
    'invitation', jsonb_build_object(
      'id', t.id,
      'kind', t.kind,
      'target_role', t.target_role,
      'target_manager_id', t.target_manager_id,
      'created_by', t.created_by,
      'created_by_user_id', t.created_by_user_id,
      'prefill_json', t.prefill_json,
      'recipient_email', t.recipient_email,
      'offered_comp_pct', t.offered_comp_pct,
      'carrier_exceptions', t.carrier_exceptions,
      'agency_key', t.agency_key
    )
  );
end;
$$;

create or replace function public.invitation_release(p_invitation_id uuid, p_claim_id uuid)
returns boolean
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  v_n int;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  update public.invite_tokens set claimed_at = null, claim_id = null
   where id = p_invitation_id and claim_id = p_claim_id and used_at is null;
  get diagnostics v_n = row_count;
  return v_n = 1;
end;
$$;

create or replace function public.invitation_apply_terms(p_invitation_id uuid, p_claim_id uuid, p_agent_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  t public.invite_tokens%rowtype;
  v_canon uuid := coalesce(public.fn_canonical_agent_id(p_agent_id), p_agent_id);
  v_prior numeric;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  select * into t from public.invite_tokens
   where id = p_invitation_id and claim_id = p_claim_id and used_at is null
   for update;
  if t.id is null then
    return jsonb_build_object('ok', false, 'error', 'claim_lost');
  end if;
  select a.comp_percentage into v_prior from public.agents a where a.id = v_canon;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'agent_not_found');
  end if;

  if t.offered_comp_pct is not null then
    -- OFFERED comp: the approved number contracting will request from carriers.
    -- agent_contract_levels (carrier-confirmed / resolved) is deliberately not
    -- touched — an offer never overwrites what a carrier confirmed.
    update public.agents
       set comp_percentage = t.offered_comp_pct,
           comp_approval_status = 'approved',
           comp_approved_at = now(),
           comp_approved_by = t.created_by_user_id
     where id = v_canon;
  end if;

  return jsonb_build_object('ok', true, 'agent_id', v_canon,
    'offered_comp_pct', t.offered_comp_pct, 'prior_comp_pct', v_prior,
    'applied', t.offered_comp_pct is not null);
end;
$$;

create or replace function public.invitation_complete(
  p_invitation_id uuid,
  p_claim_id uuid,
  p_email text,
  p_agent_id uuid default null,
  p_application_id uuid default null,
  p_intake_id uuid default null,
  p_prior_comp_pct numeric default null
) returns jsonb
language plpgsql
volatile
security definer
set search_path to 'public'
as $$
declare
  t public.invite_tokens%rowtype;
  v_upline_name text;
  v_terms jsonb;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_agent_id is null and p_application_id is null then
    raise exception 'an accepted invitation must name the person it created' using errcode = '22023';
  end if;

  select * into t from public.invite_tokens where id = p_invitation_id for update;
  if t.id is null then
    return jsonb_build_object('ok', false, 'error', 'invite_invalid');
  end if;
  if t.used_at is not null then
    return jsonb_build_object('ok', false, 'error', 'invite_already_used');
  end if;
  if t.claim_id is distinct from p_claim_id then
    return jsonb_build_object('ok', false, 'error', 'claim_lost');
  end if;

  select coalesce(nullif(btrim(a.display_name), ''), p.full_name) into v_upline_name
    from public.agents a left join public.profiles p on p.id = a.profile_id
   where a.id = coalesce(t.target_manager_id, t.created_by);

  v_terms := jsonb_build_object(
    'offered_comp_pct', t.offered_comp_pct,
    'prior_comp_pct', p_prior_comp_pct,
    'carrier_exceptions', t.carrier_exceptions,
    'agency_key', t.agency_key,
    'target_role', t.target_role,
    'target_manager_id', coalesce(t.target_manager_id, t.created_by),
    'upline_name', v_upline_name,
    'approved_by_user_id', t.created_by_user_id,
    'accepted_at', now(),
    'contracting_intake_id', p_intake_id
  );

  update public.invite_tokens
     set used_at = now(),
         used_by_agent_id = p_agent_id,
         used_by_application_id = p_application_id,
         accepted_email = nullif(lower(btrim(coalesce(p_email, ''))), ''),
         accepted_terms = v_terms,
         claimed_at = null,
         claim_id = null
   where id = t.id
     and used_at is null;

  -- A replayed intake was enriched before the offer existed; stamp the offer
  -- onto the intake this acceptance produced so the carrier request carries it.
  if p_intake_id is not null and t.offered_comp_pct is not null then
    update public.contracting_intakes set comp_percentage = t.offered_comp_pct where id = p_intake_id;
  end if;

  return jsonb_build_object('ok', true, 'id', t.id, 'terms', v_terms);
end;
$$;

-- ─── 9. Privileges ──────────────────────────────────────────────────────────
revoke all on function public.fn_invitation_status(timestamptz, uuid, boolean, timestamptz, timestamptz, timestamptz) from public;
grant execute on function public.fn_invitation_status(timestamptz, uuid, boolean, timestamptz, timestamptz, timestamptz) to authenticated, service_role;

revoke all on function public.fn_invite_comp_levels() from public, anon;
revoke all on function public.fn_invite_caller() from public, anon;
revoke all on function public.fn_invite_authorize(text, text, uuid, numeric, jsonb) from public, anon;
revoke all on function public.fn_invite_can_manage(uuid) from public, anon;
revoke all on function public.fn_invite_insert(text, jsonb, integer, text, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.fn_invite_comp_levels() to authenticated, service_role;
grant execute on function public.fn_invite_caller() to authenticated, service_role;
grant execute on function public.fn_invite_authorize(text, text, uuid, numeric, jsonb) to authenticated, service_role;
grant execute on function public.fn_invite_can_manage(uuid) to authenticated, service_role;
grant execute on function public.fn_invite_insert(text, jsonb, integer, text, text, jsonb, text) to service_role;

revoke all on function public.create_invitation(text, text, uuid, text, text, text, text, numeric, jsonb, integer, text) from public, anon;
revoke all on function public.generate_invite_token(text, integer, text, uuid, jsonb, text) from public, anon;
revoke all on function public.invitation_mint_options() from public, anon;
revoke all on function public.list_invitations(boolean, text, integer) from public, anon;
revoke all on function public.invitation_link(uuid) from public, anon;
revoke all on function public.record_invitation_share(uuid, text) from public, anon;
revoke all on function public.revoke_invitation(uuid) from public, anon;
revoke all on function public.regenerate_invitation(uuid, integer) from public, anon;
revoke all on function public.agent_invitation_terms(uuid) from public, anon;
grant execute on function public.create_invitation(text, text, uuid, text, text, text, text, numeric, jsonb, integer, text) to authenticated;
grant execute on function public.generate_invite_token(text, integer, text, uuid, jsonb, text) to authenticated;
grant execute on function public.invitation_mint_options() to authenticated;
grant execute on function public.list_invitations(boolean, text, integer) to authenticated;
grant execute on function public.invitation_link(uuid) to authenticated;
grant execute on function public.record_invitation_share(uuid, text) to authenticated;
grant execute on function public.revoke_invitation(uuid) to authenticated;
grant execute on function public.regenerate_invitation(uuid, integer) to authenticated;
grant execute on function public.agent_invitation_terms(uuid) to authenticated;

grant execute on function public.get_invite_token_prefill(text) to anon, authenticated;

revoke all on function public.invitation_claim(text, text) from public, anon, authenticated;
revoke all on function public.invitation_release(uuid, uuid) from public, anon, authenticated;
revoke all on function public.invitation_apply_terms(uuid, uuid, uuid) from public, anon, authenticated;
revoke all on function public.invitation_complete(uuid, uuid, text, uuid, uuid, uuid, numeric) from public, anon, authenticated;
grant execute on function public.invitation_claim(text, text) to service_role;
grant execute on function public.invitation_release(uuid, uuid) to service_role;
grant execute on function public.invitation_apply_terms(uuid, uuid, uuid) to service_role;
grant execute on function public.invitation_complete(uuid, uuid, text, uuid, uuid, uuid, numeric) to service_role;

-- ─── 10. Table access: reads scoped, writes only through the RPCs above ────
drop policy if exists invite_tokens_admin_all on public.invite_tokens;
drop policy if exists invite_tokens_select_scoped on public.invite_tokens;
create policy invite_tokens_select_scoped on public.invite_tokens
  for select to authenticated
  using (public.apex_is_admin() or created_by_user_id = auth.uid());

revoke insert, update, delete, truncate on public.invite_tokens from anon, authenticated;
-- anon never reads the table; the recipient view is get_invite_token_prefill().
revoke select on public.invite_tokens from anon;
