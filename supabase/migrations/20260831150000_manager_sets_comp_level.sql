-- MP-335: managers can set a comp level for their own people, any time.
--
-- Sam: "they didn't select commission level; also build where managers can
-- change it at any time."
--
-- WHAT "DIDN'T SELECT" ACTUALLY MEASURES. agents.contract_percentage looks
-- populated — 184 rows at 120 and 11 at 60, nothing null — but 120 is a
-- PLACEHOLDER and fn_agent_contract_pct discards it by name, so the column
-- being full proves nothing. Resolved through the real precedence
-- (agent_contract_levels -> account -> carrier -> unknown), 26 of the 53 LIVE
-- agents come back `unknown` — 49% of the roster with no comp level, and
-- finances_overview_base needs one at each hop to compute the layered spread.
--
-- The first cut of this number was 38 of 66 and it did not reconcile against
-- the worklist the migration itself ships. The gap is 12 rows carrying
-- status='active' while flagged is_deactivated, which is a departed agent, not
-- a missing decision. Counting them would have inflated the finding by 46% and
-- put twelve people nobody can contract onto a manager's to-do list.
--
-- WHY THIS WAS ADMIN-ONLY AND WHY THAT FAILED. set_agent_contract_pct raised
-- 42501 for anyone but an admin, so every level on the roster had to pass
-- through Sam. The provenance histogram shows the result: only 3 agents carry
-- 'admin_ui', while 112 fell back to a scraped carrier maximum. Routing a
-- routine per-hire decision through the owner is why it never got done.
--
-- THE GUARDRAIL IS NOT "TRUST MANAGERS". Comp level is money: it sets the
-- spread its own upline earns. A manager may set a level only for someone
-- inside their own downline, never for themselves, and never above their own
-- resolved level — you cannot contract someone above you. All eight active
-- managers resolve to a known pct today (70-120), so the cap is enforceable for
-- every one of them; a manager whose own level is unknown is refused rather
-- than defaulted, because defaulting the cap is how an unbounded write gets in.

begin;

create or replace function public.set_agent_contract_pct(
  p_agent_id uuid,
  p_pct numeric,
  p_note text default null::text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_canon uuid;
  v_row public.agent_contract_levels;
  v_pct numeric;
  v_prov text;
  v_is_admin boolean;
  v_caller_agent uuid;
  v_caller_pct numeric;
  v_source text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if p_agent_id is null then raise exception 'agent id required'; end if;
  if p_pct is null or p_pct < 0 or p_pct > 200 then
    raise exception 'contract percentage must be between 0 and 200';
  end if;

  v_canon := coalesce(public.fn_canonical_agent_id(p_agent_id), p_agent_id);
  if not exists (select 1 from public.agents a where a.id = v_canon) then
    raise exception 'unknown agent %', p_agent_id;
  end if;

  v_is_admin := public.apex_is_admin();

  if v_is_admin then
    v_source := 'admin_ui';
  else
    -- Resolve the caller's own agent row. A caller with no agent row is not a
    -- manager of anyone and is refused here rather than falling through.
    select a.id into v_caller_agent
      from public.agents a
     where a.user_id = auth.uid()
       and coalesce(a.is_deactivated, false) = false
     limit 1;

    if v_caller_agent is null then
      raise exception 'admin or manager only' using errcode = '42501';
    end if;

    v_caller_agent := coalesce(public.fn_canonical_agent_id(v_caller_agent), v_caller_agent);

    if v_caller_agent = v_canon then
      raise exception 'you cannot set your own comp level' using errcode = '42501';
    end if;

    -- Downline membership decided by the SAME walk the override is paid on, so
    -- "who may I edit" and "who do I earn on" cannot drift apart.
    if not exists (
      select 1 from public.fn_hierarchy_first_hops(array[v_caller_agent]) h
       where h.member = v_canon
    ) then
      raise exception 'that agent is not in your downline' using errcode = '42501';
    end if;

    select f.pct into v_caller_pct
      from public.fn_agent_contract_pct(v_caller_agent) f;

    if v_caller_pct is null then
      raise exception 'your own comp level is not set, so a cap cannot be applied'
        using errcode = '42501';
    end if;

    if p_pct > v_caller_pct then
      raise exception 'you cannot set a level above your own, which is % percent', v_caller_pct
        using errcode = '42501';
    end if;

    v_source := 'manager_ui';
  end if;

  insert into public.agent_contract_levels (
    agent_id, contract_pct, source, note, set_by, effective_from, updated_at
  ) values (
    v_canon, p_pct, v_source, nullif(btrim(p_note), ''), auth.uid(),
    (now() at time zone 'America/Phoenix')::date, now()
  )
  on conflict (agent_id) do update set
    contract_pct = excluded.contract_pct,
    source = excluded.source,
    note = excluded.note,
    set_by = excluded.set_by,
    effective_from = excluded.effective_from,
    updated_at = now()
  returning * into v_row;

  select f.pct, f.provenance into v_pct, v_prov
  from public.fn_agent_contract_pct(v_canon) f;

  return jsonb_build_object(
    'agent_id', v_canon,
    'contract_pct', v_row.contract_pct,
    'source', v_row.source,
    'note', v_row.note,
    'effective_from', v_row.effective_from,
    'updated_at', v_row.updated_at,
    'resolved_pct', v_pct,
    'resolved_provenance', v_prov
  );
end;
$function$;

comment on function public.set_agent_contract_pct(uuid, numeric, text) is
  'MP-335: admin sets any level; a manager may set one only for their own '
  'downline, never for themselves, and never above their own resolved level. '
  'Downline is decided by fn_hierarchy_first_hops so edit rights and override '
  'rights cannot drift apart.';

-- Who still has no comp level, scoped to the caller. This is the worklist that
-- makes "they didn't select commission level" fixable by the person who
-- actually knows the answer, instead of a number on the owner's report.
create or replace function public.my_agents_missing_comp_level()
returns table(
  agent_id uuid,
  display_name text,
  status text,
  hired_at timestamptz,
  resolved_pct numeric,
  provenance text,
  my_cap numeric
)
language sql
stable
security definer
set search_path to 'public'
as $function$
  with caller as (
    select coalesce(public.fn_canonical_agent_id(a.id), a.id) as id
    from public.agents a
    where a.user_id = auth.uid()
      and coalesce(a.is_deactivated, false) = false
    limit 1
  ), cap as (
    select f.pct from caller c, lateral public.fn_agent_contract_pct(c.id) f
  ), scope as (
    -- Admin sees the whole roster; a manager sees exactly their downline.
    select a.id
    from public.agents a
    where public.apex_is_admin()
    union
    select h.member
    from caller c, lateral public.fn_hierarchy_first_hops(array[c.id]) h
  )
  select a.id, a.display_name, a.status::text, a.created_at,
         r.pct, r.provenance,
         (select pct from cap)
  from public.agents a
  join scope s on s.id = a.id
  cross join lateral public.fn_agent_contract_pct(a.id) r
  where r.pct is null
    and a.status = 'active'
    and coalesce(a.is_deactivated, false) = false
  order by a.created_at desc nulls last;
$function$;

comment on function public.my_agents_missing_comp_level() is
  'MP-335: live agents with no resolved comp level, scoped to the caller. '
  '26 of 53 resolve to unknown, which is what Sam meant by "they did not '
  'select commission level". Excludes is_deactivated rows that still carry '
  'status=active: departed, not undecided.';

revoke all on function public.my_agents_missing_comp_level() from public;
grant execute on function public.my_agents_missing_comp_level() to authenticated;

commit;
