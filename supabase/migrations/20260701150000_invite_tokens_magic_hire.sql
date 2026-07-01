-- MP-233: Magic Hire Link — /hire/:token
--
-- Adds invite_tokens table + generate_invite_token RPC.
-- Consume path lives in edge fn `consume-invite-token` (service role).
--
-- Scope of THIS migration (narrow): hire-link primitive only.
-- /join/:token, /admin/invite-links, and cohort-router hooks are follow-on work.
--
-- Idempotent: `create table if not exists` + `create or replace function`.

-- 1. Table
create table if not exists public.invite_tokens (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('hire', 'join')),
  token text not null unique,
  created_by uuid not null references public.agents(id),
  created_by_user_id uuid references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '7 days'),
  used_at timestamptz,
  used_by_agent_id uuid references public.agents(id),
  used_by_application_id uuid references public.applications(id),
  target_role text check (target_role in ('agent','hired_unlicensed','hired_licensed','manager_candidate','referral_prospect')),
  target_manager_id uuid references public.agents(id),
  prefill_json jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  revoked_at timestamptz,
  revoked_by uuid references public.agents(id),
  notes text
);

create index if not exists invite_tokens_token_idx
  on public.invite_tokens (token)
  where is_active and used_at is null;

create index if not exists invite_tokens_created_by_idx
  on public.invite_tokens (created_by, created_at desc);

create index if not exists invite_tokens_kind_active_idx
  on public.invite_tokens (kind, is_active, expires_at);

-- 2. RLS
alter table public.invite_tokens enable row level security;

drop policy if exists invite_tokens_admin_all on public.invite_tokens;
create policy invite_tokens_admin_all on public.invite_tokens
  for all to authenticated
  using (
    exists (
      select 1 from public.user_roles ur
       where ur.user_id = auth.uid()
         and ur.role in ('admin','manager')
    )
    or created_by_user_id = auth.uid()
  )
  with check (
    exists (
      select 1 from public.user_roles ur
       where ur.user_id = auth.uid()
         and ur.role in ('admin','manager')
    )
    or created_by_user_id = auth.uid()
  );

-- Anonymous consume path uses the edge fn service-role key; no public RLS read.

-- 3. Generator RPC
create or replace function public.generate_invite_token(
  p_kind text,
  p_expires_hours int default 168,
  p_target_role text default null,
  p_target_manager_id uuid default null,
  p_prefill jsonb default '{}'::jsonb,
  p_notes text default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_agent_id uuid;
  v_token text;
  v_row public.invite_tokens%rowtype;
  v_recent_count int;
  v_hours int;
begin
  -- Caller must be an active agent linked to an admin/manager role OR the
  -- referrer themselves. We resolve the agent id from auth.uid().
  select id into v_agent_id
    from public.agents
   where user_id = auth.uid()
     and coalesce(is_deactivated, false) = false
   limit 1;

  if v_agent_id is null then
    raise exception 'unauthorized: no active agent for caller';
  end if;

  if p_kind not in ('hire','join') then
    raise exception 'invalid kind: %', p_kind;
  end if;

  -- Hard cap expiry at 720h (30d), min 1h.
  v_hours := greatest(1, least(coalesce(p_expires_hours, 168), 720));

  -- Rate limit: 20 tokens/hour/agent.
  select count(*) into v_recent_count
    from public.invite_tokens
   where created_by = v_agent_id
     and created_at > now() - interval '1 hour';

  if v_recent_count >= 20 then
    raise exception 'rate_limit: 20 tokens/hour cap reached';
  end if;

  -- 24 random bytes -> url-safe base64 (approx 32 chars after strip).
  v_token := encode(gen_random_bytes(24), 'base64');
  v_token := replace(replace(replace(v_token, '+','-'), '/','_'), '=','');

  insert into public.invite_tokens (
    kind, token, created_by, created_by_user_id,
    expires_at, target_role, target_manager_id, prefill_json, notes
  ) values (
    p_kind, v_token, v_agent_id, auth.uid(),
    now() + make_interval(hours => v_hours),
    p_target_role, p_target_manager_id, coalesce(p_prefill,'{}'::jsonb), p_notes
  ) returning * into v_row;

  return jsonb_build_object(
    'token', v_row.token,
    'url',   'https://apex-financial.org/' || v_row.kind || '/' || v_row.token,
    'kind',  v_row.kind,
    'expires_at', v_row.expires_at,
    'id', v_row.id
  );
end;
$$;

grant execute on function public.generate_invite_token(text,int,text,uuid,jsonb,text) to authenticated;

-- 4. Public prefill helper (safe subset only)
create or replace function public.get_invite_token_prefill(p_token text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.invite_tokens%rowtype;
begin
  select * into v_row
    from public.invite_tokens
   where token = p_token
     and is_active
     and used_at is null
     and expires_at > now()
   limit 1;

  if v_row.id is null then
    return jsonb_build_object('ok', false, 'reason', 'invalid_or_used');
  end if;

  return jsonb_build_object(
    'ok', true,
    'kind', v_row.kind,
    'expires_at', v_row.expires_at,
    'prefill', jsonb_build_object(
      'full_name', v_row.prefill_json->>'full_name',
      'phone',     v_row.prefill_json->>'phone',
      'email',     v_row.prefill_json->>'email',
      'state',     v_row.prefill_json->>'state'
    )
  );
end;
$$;

grant execute on function public.get_invite_token_prefill(text) to anon, authenticated;

comment on table public.invite_tokens is
  'MP-233 magic-hire/join link primitive. One-use, 7d default, rate-limited 20/hr/agent.';
