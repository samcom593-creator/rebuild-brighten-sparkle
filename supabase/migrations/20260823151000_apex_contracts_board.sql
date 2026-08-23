-- APEX Contracting surface — real contract board + invite role application.
--
-- WHY THIS EXISTS
--
-- 1. /dashboard/contracting rendered a link grid and ZERO contracts. The page's
--    only contract source was v_my_carrier_contracts filtered `.eq(user_id, …)`
--    — and that view has 0 of 21 rows with a non-null user_id, so the filter
--    matched nothing for every user who has ever loaded the page. The Documents
--    tab's search box and three status buttons filtered a permanently empty
--    array: controls that look right and do nothing.
--    Meanwhile agentlink_contracts holds 467 real rows (220 active, 130
--    submitted, 42 requested, 29 pending upline, 20 rejected, 18 issue,
--    5 ready to contract, 3 jail) that nothing on the site displayed.
--
-- 2. agentlink_contracts RLS is admin-only (al_contracts_admin). A producer
--    reading it directly gets zero rows — indistinguishable from "you have no
--    contracts". These functions are SECURITY DEFINER so scoping is decided
--    here, once, instead of every caller re-deriving it.
--
-- 3. Counts are aggregated server-side. PostgREST caps at 1000 rows, so a
--    headline derived from a client array length would silently under-report
--    the moment the book crosses that line.
--
-- 4. invite_tokens.target_role was recorded and never applied. A link minted
--    "Invite As: Manager" produced an agent indistinguishable from one minted
--    "Agent" — no app_role grant, no is_manager. The role is applied here, at
--    the moment the token is stamped consumed, because that is the one event
--    that proves a real person completed signup.

-- ─────────────────────────────────────────────────────────────────────────────
-- Shared scope resolver. One definition so the list and the summary can never
-- disagree about which contracts a caller is entitled to see.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.apex_contract_scope_agents(p_scope text)
returns table (agent_id uuid)
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v_agent_id uuid;
  v_is_admin boolean;
  v_scope text := lower(coalesce(p_scope, 'agency'));
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select a.id into v_agent_id
    from public.agents a
   where a.user_id = auth.uid()
     and coalesce(a.is_deactivated, false) = false
   order by a.created_at nulls last
   limit 1;

  v_is_admin := public.apex_is_admin();

  -- Total IMO is the whole book, and only an admin may see it. A manager
  -- asking for it gets their agency, never a silent empty set.
  if v_scope = 'imo' and v_is_admin then
    return query select a.id from public.agents a;
    return;
  end if;

  if v_scope = 'mine' then
    if v_agent_id is null then
      return;  -- caller has no producer record; honest empty, not everyone's book
    end if;
    return query select v_agent_id;
    return;
  end if;

  -- 'agency' (and any unrecognised scope): the caller plus their downline.
  -- An admin's agency is the whole roster, which is what Sam expects to see.
  if v_is_admin then
    return query select a.id from public.agents a;
    return;
  end if;

  if v_agent_id is null then
    return;
  end if;

  return query
    select a.id
    from public.agents a
    where public.apex_can_read_agent(a.id);
end;
$$;

comment on function public.apex_contract_scope_agents(text) is
  'APEX contracting: resolves scope (mine|agency|imo) to the agent ids a caller may see. Single source for apex_contracts_list and apex_contracts_summary so the row list and the headline counts cannot drift.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Row list. Carrier name comes from public.carriers (the uuid FK target) — NOT
-- agentlink_carriers, whose integer id does not join to this table at all.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.apex_try_jsonb(p_value text)
returns jsonb
language plpgsql
immutable
set search_path to 'public'
as $$
begin
  return p_value::jsonb;
exception when others then
  return null;
end;
$$;

create or replace function public.apex_contracts_list(
  p_scope text default 'agency',
  p_status text default 'all',
  p_search text default null,
  p_limit int default 100,
  p_offset int default 0
)
returns table (
  id uuid,
  carrier_name text,
  agent_name text,
  agent_id uuid,
  status text,
  commission_level text,
  writing_number text,
  contract_number text,
  requested_at timestamptz,
  activated_date timestamptz
)
language sql
stable
security definer
set search_path to 'public'
as $$
  select
    c.id,
    coalesce(ca.name, c.raw_payload -> 'carrier' ->> 'name')                as carrier_name,
    coalesce(
      nullif(trim(a.display_name), ''),
      nullif(trim(concat_ws(' ',
        c.raw_payload -> 'agent' ->> 'firstName',
        c.raw_payload -> 'agent' ->> 'lastName')), '')
    )                                                                       as agent_name,
    c.agent_id,
    c.status,
    -- commission_level is text that sometimes holds a JSON object. Show the
    -- level name when it parses, the raw string when it doesn't, null when
    -- there is nothing on file. Never a fabricated level.
    coalesce(
      case when c.commission_level ~ '^\s*\{' then
        nullif(public.apex_try_jsonb(c.commission_level) ->> 'levelName', '')
      else nullif(trim(c.commission_level), '') end,
      nullif(c.raw_payload -> 'commissionLevel' ->> 'levelName', '')
    )                                                                       as commission_level,
    c.writing_number,
    c.contract_number,
    c.requested_at,
    c.activated_date
  from public.agentlink_contracts c
  left join public.carriers ca on ca.id = c.carrier_id
  left join public.agents   a  on a.id  = c.agent_id
  where c.agent_id in (select s.agent_id from public.apex_contract_scope_agents(p_scope) s)
    and not public.fn_agent_is_roster_excluded(c.agent_id)
    and (coalesce(nullif(lower(p_status), ''), 'all') = 'all'
         or lower(c.status) = lower(p_status))
    and (
      p_search is null or btrim(p_search) = ''
      or coalesce(ca.name, '')        ilike '%' || btrim(p_search) || '%'
      or coalesce(a.display_name, '') ilike '%' || btrim(p_search) || '%'
      or coalesce(c.writing_number,'') ilike '%' || btrim(p_search) || '%'
      or coalesce(c.contract_number,'') ilike '%' || btrim(p_search) || '%'
    )
  order by
    case lower(c.status) when 'issue' then 0 when 'jail' then 1 else 2 end,
    c.requested_at desc nulls last,
    c.id
  limit greatest(1, least(coalesce(p_limit, 100), 500))
  offset greatest(0, coalesce(p_offset, 0));
$$;

comment on function public.apex_contracts_list(text,text,text,int,int) is
  'APEX contracting board rows. Joins agentlink_contracts to public.carriers (uuid FK) and agents. Roster-excluded agents are filtered out. Hard-capped at 500 rows per call.';

-- ─────────────────────────────────────────────────────────────────────────────
-- Headline counts + per-status chip counts, aggregated in the database.
-- Returns exactly one row in every state, including an empty book, so the
-- caller can never read "no rows" as "nothing wrong".
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.apex_contracts_summary(
  p_scope text default 'agency',
  p_search text default null
)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  with scoped as (
    select c.status, c.id
      from public.agentlink_contracts c
      left join public.carriers ca on ca.id = c.carrier_id
      left join public.agents   a  on a.id  = c.agent_id
     where c.agent_id in (select s.agent_id from public.apex_contract_scope_agents(p_scope) s)
       and not public.fn_agent_is_roster_excluded(c.agent_id)
       and (
         p_search is null or btrim(p_search) = ''
         or coalesce(ca.name, '')          ilike '%' || btrim(p_search) || '%'
         or coalesce(a.display_name, '')   ilike '%' || btrim(p_search) || '%'
         or coalesce(c.writing_number,'')  ilike '%' || btrim(p_search) || '%'
         or coalesce(c.contract_number,'') ilike '%' || btrim(p_search) || '%'
       )
  )
  select jsonb_build_object(
    'total',     (select count(*) from scoped),
    'active',    (select count(*) from scoped where lower(status) = 'active'),
    'requested', (select count(*) from scoped where lower(status) in ('requested','ready_to_contract')),
    'issues',    (select count(*) from scoped where lower(status) in ('issue','jail','rejected')),
    'by_status', coalesce((
      select jsonb_object_agg(status_key, n)
        from (
          select coalesce(lower(status), 'unknown') as status_key, count(*) n
          from scoped
          group by coalesce(lower(status), 'unknown')
        ) t
    ), '{}'::jsonb)
  );
$$;

comment on function public.apex_contracts_summary(text,text) is
  'APEX contracting headline + per-status counts, aggregated server-side. Always returns one row so an empty book is reported as zeros, never as a blank that reads like health.';

revoke all on function public.apex_contract_scope_agents(text) from public, anon, authenticated;
revoke all on function public.apex_try_jsonb(text) from public, anon, authenticated;
revoke all on function public.apex_contracts_list(text,text,text,int,int) from public, anon, authenticated;
revoke all on function public.apex_contracts_summary(text,text) from public, anon, authenticated;
grant execute on function public.apex_contract_scope_agents(text) to authenticated;
grant execute on function public.apex_contracts_list(text,text,text,int,int) to authenticated;
grant execute on function public.apex_contracts_summary(text,text) to authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- Apply the invite's role when — and only when — the token is stamped consumed.
--
-- consume-invite-token writes the agents row and then marks the token used with
-- used_by_agent_id. Until now target_role died there. This makes the choice on
-- the Invite Links form mean something: a Manager link grants the manager role,
-- Staff/agency-owner links grant the roles they name.
--
-- EXCEPTION-wrapped: a role grant failing must never roll back the signup that
-- already succeeded. A person with an account and a missing role is recoverable;
-- a person whose account vanished because of a role grant is not.
-- ─────────────────────────────────────────────────────────────────────────────
create or replace function public.fn_apply_invite_target_role()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_user_id uuid;
  v_role app_role;
begin
  if new.used_by_agent_id is null or new.target_role is null then
    return new;
  end if;
  if old.used_by_agent_id is not null then
    return new;  -- already applied; never re-grant
  end if;

  begin
    select a.user_id into v_user_id
      from public.agents a where a.id = new.used_by_agent_id;
    if v_user_id is null then
      return new;
    end if;

    v_role := case new.target_role
      when 'hired_manager' then 'manager'::app_role
      when 'manager'       then 'manager'::app_role
      when 'agency_owner'  then 'manager'::app_role
      when 'staff'         then 'va'::app_role
      else 'agent'::app_role
    end;

    insert into public.user_roles (user_id, role)
    values (v_user_id, v_role)
    on conflict do nothing;

    -- A manager-shaped invite also needs the agents flag the UI reads.
    if v_role = 'manager' then
      update public.agents set is_manager = true where id = new.used_by_agent_id;
    end if;
  exception when others then
    raise warning 'fn_apply_invite_target_role failed for token % : %', new.id, sqlerrm;
  end;

  return new;
end;
$$;

drop trigger if exists trg_apply_invite_target_role on public.invite_tokens;
create trigger trg_apply_invite_target_role
  after update of used_by_agent_id on public.invite_tokens
  for each row execute function public.fn_apply_invite_target_role();

comment on function public.fn_apply_invite_target_role() is
  'Grants the invite link''s target_role at the moment the token is stamped consumed. EXCEPTION-wrapped so a failed grant can never roll back a completed signup.';

revoke all on function public.fn_apply_invite_target_role() from public, anon, authenticated;
