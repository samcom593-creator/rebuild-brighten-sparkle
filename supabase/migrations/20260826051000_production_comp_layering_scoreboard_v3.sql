-- Production truth v3: comp layering, hierarchy scoping, "who sold what".
--
-- MEASURED 2026-08-25 before writing a line:
--   * agents.contract_percentage is 120 on 184 of 187 rows and 60 on the other
--     3. The 120 is the legacy placeholder. The 60 is ALSO a placeholder: it is
--     the column default (20260825211500 set it) on three rows created
--     2026-08-26 02:18-02:47Z. Zero rows hold a deliberately entered contract
--     level, so a "real" comp level had nowhere to live. This migration gives
--     it one: public.agent_contract_levels, and one resolver,
--     public.fn_agent_contract_pct, that every scoreboard number reads.
--   * KJ Vaughn (431dff0d, Vantage Financial agency head) is at 105% per Sam's
--     directive of 2026-08-25. Sam (7c3c5581) is the IMO top; his 120 is
--     recorded with provenance 'imo_top_assumed' until he edits it.
--   * The live scoreboard walked THREE edges (manager_id, switched_to_manager_id,
--     invited_by_manager_id) as a union. That put 15 APEX-only agents into KJ's
--     scope (every one of them: invited_by = KJ, manager = Sam) and printed
--     "You + 32 downline". fn_agent_subagency() already defines Vantage by the
--     manager_id chain, so hierarchy here is single-parent:
--     coalesce(manager_id, switched_to_manager_id, invited_by_manager_id).
--     Under that edge KJ's downline is 19 raw / 17 canonical rows, all Vantage,
--     the graph has no cycles, and the deepest chain from Sam is 2.
--   * Three canonical agents (Landon Boyd, Loren Lail, Xaviar Watts) have alias
--     rows under BOTH Sam and KJ. fn_agent_subagency calls them Vantage when any
--     alias sits under KJ, so the first-hop walk prefers the deepest path, which
--     keeps the comp path and the agency label consistent.
--
-- LAYERING (Sam's directive, verbatim intent): "KJ at 105% means Sam's override
-- on a Vantage deal is Sam's pct - 105, NOT Sam's pct - the selling agent's pct".
-- For viewer V and scope member M, first_hop = V's direct child on the path to
-- M; override_pct(V, M) = V.pct - pct(first_hop). For M = V it is V.pct (direct
-- comp). Members not under V earn V nothing. Any unknown level on that path is
-- filled with 60 AND counted in comp.unknown_levels_in_scope so the estimate is
-- labelled partial instead of pretending.
--
-- This migration touches the scoreboard RPC and adds tables/functions. It does
-- NOT redefine v_production_comp_truth, finances_overview or leaderboard_board;
-- those still resolve seller comp the old way (KJ reads 60 there, 105 here).

begin;

-- ---------------------------------------------------------------------------
-- 1. Comp level source of truth
-- ---------------------------------------------------------------------------
create table if not exists public.agent_contract_levels (
  agent_id uuid primary key references public.agents(id) on delete cascade,
  contract_pct numeric not null check (contract_pct between 0 and 200),
  source text not null,
  note text,
  set_by uuid,
  effective_from date not null default (now() at time zone 'America/Phoenix')::date,
  updated_at timestamptz not null default now()
);

comment on table public.agent_contract_levels is
  'Deliberately recorded contract (comp) percentage per canonical agent. Read through fn_agent_contract_pct; never through agents.contract_percentage, which is a placeholder on every row as of 2026-08-25.';
comment on column public.agent_contract_levels.source is
  'Where the number came from: sam_directive_<date>, imo_top_assumed, admin_ui. imo_top_assumed means nobody has confirmed it yet.';

alter table public.agent_contract_levels enable row level security;

drop policy if exists agent_contract_levels_admin_all on public.agent_contract_levels;
create policy agent_contract_levels_admin_all
  on public.agent_contract_levels
  for all to authenticated
  using (public.apex_is_admin())
  with check (public.apex_is_admin());

drop policy if exists agent_contract_levels_self_read on public.agent_contract_levels;
create policy agent_contract_levels_self_read
  on public.agent_contract_levels
  for select to authenticated
  using (
    agent_id in (
      select coalesce(a.canonical_agent_id, a.id) from public.agents a where a.user_id = auth.uid()
      union
      select a.id from public.agents a where a.user_id = auth.uid()
    )
  );

revoke all on public.agent_contract_levels from public, anon;
grant select, insert, update, delete on public.agent_contract_levels to authenticated;
grant all on public.agent_contract_levels to service_role;

insert into public.agent_contract_levels (agent_id, contract_pct, source, note)
values
  ('431dff0d-7c82-4134-a85e-457e5226fc7f', 105, 'sam_directive_2026-08-25',
   'KJ Vaughn, Vantage Financial agency head. Sam: "KJ is at 105% comp" (2026-08-25).'),
  ('7c3c5581-3544-437f-bfe2-91391afb217d', 120, 'imo_top_assumed',
   'Samuel James, IMO top. Carried from the legacy agents.contract_percentage value; assumed until Sam edits it.')
on conflict (agent_id) do nothing;

-- ---------------------------------------------------------------------------
-- 2. One resolver for "what is this agent''s comp level"
-- ---------------------------------------------------------------------------
-- Precedence:
--   1. agent_contract_levels row for the canonical id (or any alias), newest
--      wins; provenance = that row''s source.
--   2. agents.contract_percentage on any alias when it is not null, within
--      0..200, and not a placeholder. Placeholders are 120 AND whatever the
--      column default currently is (60 today), read live from pg_attrdef so a
--      future default change cannot silently turn defaults into "real" levels.
--      provenance = 'account'.
--   3. agent_comp_levels.avg_comp_pct matched on whitespace-normalised
--      canonical display name / profile full name. provenance = 'carrier_avg'.
--   4. null with provenance 'unknown'. Callers decide the fallback and must
--      label the estimate partial.
create or replace function public.fn_agent_contract_pct(p_agent_id uuid)
returns table(pct numeric, provenance text)
language sql
stable
security definer
set search_path = public
as $$
  with target as (
    select coalesce(public.fn_canonical_agent_id(p_agent_id), p_agent_id) as canon
  ), aliases as (
    select a.id, a.contract_percentage, a.display_name, a.user_id, a.profile_id
    from public.agents a, target t
    where coalesce(a.canonical_agent_id, a.id) = t.canon
  ), placeholders as (
    select array_remove(array[
      120::numeric,
      (
        select case
          when pg_get_expr(d.adbin, d.adrelid) ~ '^[0-9]+(\.[0-9]+)?$'
            then pg_get_expr(d.adbin, d.adrelid)::numeric
          else null::numeric
        end
        from pg_attrdef d
        join pg_attribute att on att.attrelid = d.adrelid and att.attnum = d.adnum
        where d.adrelid = 'public.agents'::regclass
          and att.attname = 'contract_percentage'
      )
    ], null::numeric) as vals
  ), explicit_level as (
    select l.contract_pct as pct, l.source as provenance
    from public.agent_contract_levels l, target t
    where l.agent_id = t.canon
       or l.agent_id in (select id from aliases)
    order by (l.agent_id = t.canon) desc, l.updated_at desc
    limit 1
  ), account_level as (
    select max(al.contract_percentage) as pct, 'account'::text as provenance
    from aliases al, placeholders ph
    where al.contract_percentage is not null
      and al.contract_percentage between 0 and 200
      and not (al.contract_percentage = any(ph.vals))
  ), names as (
    select lower(regexp_replace(btrim(n), '\s+', ' ', 'g')) as key
    from (
      select al.display_name as n from aliases al
      union
      select p.full_name
      from aliases al
      join public.profiles p
        on p.id = al.user_id or p.id = al.profile_id or p.user_id = al.user_id
    ) x
    where nullif(btrim(n), '') is not null
  ), carrier_level as (
    select max(c.avg_comp_pct) as pct, 'carrier_avg'::text as provenance
    from public.agent_comp_levels c
    where c.avg_comp_pct between 0 and 200
      and lower(regexp_replace(btrim(c.agent_name), '\s+', ' ', 'g')) in (select key from names)
  ), resolved as (
    select 1 as rank, pct, provenance from explicit_level where pct is not null
    union all
    select 2, pct, provenance from account_level where pct is not null
    union all
    select 3, pct, provenance from carrier_level where pct is not null
    union all
    select 4, null::numeric, 'unknown'::text
  )
  select r.pct, r.provenance from resolved r order by r.rank limit 1;
$$;

revoke all on function public.fn_agent_contract_pct(uuid) from public, anon;
grant execute on function public.fn_agent_contract_pct(uuid) to authenticated, service_role;

comment on function public.fn_agent_contract_pct(uuid) is
  'Resolved comp level for a canonical agent: agent_contract_levels row -> non-placeholder agents.contract_percentage -> carrier average by name -> unknown (null). Placeholders are 120 and the live column default.';

-- Admin-only write path. Always lands on the canonical id.
create or replace function public.set_agent_contract_pct(
  p_agent_id uuid,
  p_pct numeric,
  p_note text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $fn$
declare
  v_canon uuid;
  v_row public.agent_contract_levels;
  v_pct numeric;
  v_prov text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if not public.apex_is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;
  if p_agent_id is null then raise exception 'agent id required'; end if;
  if p_pct is null or p_pct < 0 or p_pct > 200 then
    raise exception 'contract percentage must be between 0 and 200';
  end if;

  v_canon := coalesce(public.fn_canonical_agent_id(p_agent_id), p_agent_id);
  if not exists (select 1 from public.agents a where a.id = v_canon) then
    raise exception 'unknown agent %', p_agent_id;
  end if;

  insert into public.agent_contract_levels (
    agent_id, contract_pct, source, note, set_by, effective_from, updated_at
  ) values (
    v_canon, p_pct, 'admin_ui', nullif(btrim(p_note), ''), auth.uid(),
    (now() at time zone 'America/Phoenix')::date, now()
  )
  on conflict (agent_id) do update set
    contract_pct = excluded.contract_pct,
    source = 'admin_ui',
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
$fn$;

revoke all on function public.set_agent_contract_pct(uuid, numeric, text) from public, anon;
grant execute on function public.set_agent_contract_pct(uuid, numeric, text) to authenticated, service_role;

comment on function public.set_agent_contract_pct(uuid, numeric, text) is
  'Admin-only upsert into agent_contract_levels (source admin_ui) on the canonical agent id. Returns the stored row plus the resolved pct/provenance.';

-- ---------------------------------------------------------------------------
-- 3. Hierarchy walk that remembers the first hop
-- ---------------------------------------------------------------------------
-- Canonical-level, single-parent edge (manager_id, else switched_to_manager_id,
-- else invited_by_manager_id). Returns every canonical member under any of the
-- roots with the root''s direct child on the path to it. When a member is
-- reachable by more than one path (alias rows under different managers) the
-- deepest path wins so the comp path agrees with fn_agent_subagency.
create or replace function public.fn_hierarchy_first_hops(p_roots uuid[])
returns table(member uuid, first_hop uuid, depth integer, parent_candidates integer)
language sql
stable
security definer
set search_path = public
as $$
  with recursive roots as (
    select distinct coalesce(m.canonical_agent_id, a.id) as id
    from public.agents a
    left join public.v_agent_canonical_map m on m.agent_id = a.id
    where a.id = any(coalesce(p_roots, '{}'::uuid[]))
       or coalesce(m.canonical_agent_id, a.id) = any(coalesce(p_roots, '{}'::uuid[]))
  ), edges as (
    select distinct
      coalesce(pm.canonical_agent_id, c.parent_raw) as parent_canon,
      coalesce(cm.canonical_agent_id, c.id) as child_canon
    from (
      select a.id,
        coalesce(a.manager_id, a.switched_to_manager_id, a.invited_by_manager_id) as parent_raw
      from public.agents a
    ) c
    left join public.v_agent_canonical_map cm on cm.agent_id = c.id
    left join public.v_agent_canonical_map pm on pm.agent_id = c.parent_raw
    where c.parent_raw is not null
      and coalesce(pm.canonical_agent_id, c.parent_raw) <> coalesce(cm.canonical_agent_id, c.id)
  ), walk(member, first_hop, depth, path) as (
    select e.child_canon, e.child_canon, 1, array[r.id, e.child_canon]
    from roots r
    join edges e on e.parent_canon = r.id
    where e.child_canon not in (select id from roots)
    union all
    select e.child_canon, w.first_hop, w.depth + 1, w.path || e.child_canon
    from walk w
    join edges e on e.parent_canon = w.member
    where not (e.child_canon = any(w.path))
      and e.child_canon not in (select id from roots)
      and w.depth < 40
  ), ranked as (
    select distinct on (w.member)
      w.member, w.first_hop, w.depth,
      (select count(distinct x.parent_canon) from edges x where x.child_canon = w.member)::integer
        as parent_candidates
    from walk w
    order by w.member, w.depth desc, w.first_hop
  )
  select r.member, r.first_hop, r.depth, r.parent_candidates from ranked r;
$$;

revoke all on function public.fn_hierarchy_first_hops(uuid[]) from public, anon;
grant execute on function public.fn_hierarchy_first_hops(uuid[]) to authenticated, service_role;

comment on function public.fn_hierarchy_first_hops(uuid[]) is
  'Canonical downline of the given roots over the single-parent manager edge, with the root''s direct child on the path to each member (deepest path wins on alias ambiguity).';

-- ---------------------------------------------------------------------------
-- 4. Scoreboard v3
-- ---------------------------------------------------------------------------
create or replace function public.scoped_production_scoreboard(
  p_start date,
  p_end date
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_start date := coalesce(p_start, v_today);
  v_end date := coalesce(p_end, v_today + 1);
  v_is_admin boolean := public.apex_is_admin();
  v_has_profile boolean;
  v_personal_ids uuid[] := '{}'::uuid[];
  v_direct_ids uuid[] := '{}'::uuid[];
  v_hier_ids uuid[] := '{}'::uuid[];
  v_scope_ids uuid[] := '{}'::uuid[];
  v_downline_count integer := 0;
  v_vantage_head constant uuid := '431dff0d-7c82-4134-a85e-457e5226fc7f';
  v_gap_visible boolean := false;
  v_fallback constant numeric := 60;
  v_viewer_pct numeric;
  v_viewer_prov text;
  v_out jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if v_end <= v_start then raise exception 'end date must be after start date'; end if;

  select exists(select 1 from public.agents a where a.user_id = auth.uid())
    into v_has_profile;

  select coalesce(array_agg(distinct coalesce(m.canonical_agent_id, a.id)), '{}'::uuid[])
    into v_personal_ids
  from public.agents a
  left join public.v_agent_canonical_map m on m.agent_id = a.id
  where a.user_id = auth.uid();

  -- Hierarchy under the caller: members and the caller's direct children.
  select
    coalesce(array_agg(distinct h.member)
      filter (where not public.fn_agent_is_roster_excluded(h.member)), '{}'::uuid[]),
    coalesce(array_agg(distinct h.first_hop)
      filter (where not public.fn_agent_is_roster_excluded(h.first_hop)), '{}'::uuid[])
    into v_hier_ids, v_direct_ids
  from public.fn_hierarchy_first_hops(v_personal_ids) h;

  if v_is_admin then
    -- Everything is APEX Financial at the top: the full roster, Vantage included.
    select coalesce(array_agg(distinct coalesce(m.canonical_agent_id, a.id)), '{}'::uuid[])
      into v_scope_ids
    from public.agents a
    left join public.v_agent_canonical_map m on m.agent_id = a.id
    where not public.fn_agent_is_roster_excluded(a.id);
  else
    select coalesce(array_agg(distinct t.id), '{}'::uuid[])
      into v_scope_ids
    from unnest(v_personal_ids || v_hier_ids) as t(id);
  end if;

  v_downline_count := greatest(
    coalesce(cardinality(v_scope_ids), 0) - coalesce(cardinality(v_personal_ids), 0), 0
  );

  -- The Vantage daily gap is an agency aggregate. It belongs to the agency head
  -- and to whoever sits above the head, never to a leaf Vantage agent's "team".
  v_gap_visible := v_is_admin or (v_vantage_head = any(v_scope_ids));

  select p.pct, p.provenance
    into v_viewer_pct, v_viewer_prov
  from unnest(v_personal_ids) as u(id)
  cross join lateral public.fn_agent_contract_pct(u.id) p
  order by p.pct desc nulls last
  limit 1;
  if v_viewer_prov is null then v_viewer_prov := 'unknown'; end if;

  with production as (
    select
      c.row_key, c.origin, c.raw_agent_id, c.agent_id, c.agent_name,
      c.annual_premium, c.posted_date, c.synced_at,
      c.policy_number, c.carrier, c.client_name, c.effective_date,
      case
        when c.origin = 'external_daily_gap' or public.fn_agent_subagency(c.raw_agent_id) = 'vantage'
          then 'Vantage Financial' else 'APEX Financial'
      end as agency
    from public.v_production_comp_truth c
    where c.posted_date >= v_start
      and c.posted_date < v_end
      and (
        (c.origin <> 'external_daily_gap' and c.agent_id = any(v_scope_ids))
        or (
          c.origin = 'external_daily_gap'
          and (
            v_is_admin
            or (v_gap_visible and public.fn_agent_subagency(c.raw_agent_id) = 'vantage')
          )
        )
      )
  ), hops as (
    select h.member, h.first_hop, h.depth, h.parent_candidates
    from public.fn_hierarchy_first_hops(v_personal_ids) h
  ), producing as (
    select
      p.agent_id,
      max(p.agent_name) as name,
      max(p.agency) as agency,
      count(*)::integer as policies,
      round(coalesce(sum(p.annual_premium), 0), 2) as ap,
      max(p.posted_date) as last_sale
    from production p
    where p.origin <> 'external_daily_gap'
    group by p.agent_id
  ), needed as (
    select pr.agent_id as id from producing pr
    union
    select h.first_hop from hops h where h.member in (select agent_id from producing)
    union
    select v_vantage_head where v_gap_visible
    union
    select u.id from unnest(v_personal_ids) as u(id)
  ), pcts as (
    select n.id, f.pct, f.provenance
    from needed n
    cross join lateral public.fn_agent_contract_pct(n.id) f
    where n.id is not null
  ), member_comp as (
    select
      pr.agent_id,
      coalesce(pr.agent_id = any(v_personal_ids), false) as is_self,
      sp.pct as seller_pct_raw,
      coalesce(sp.provenance, 'unknown') as seller_prov,
      h.first_hop,
      fp.pct as first_hop_pct_raw,
      coalesce(fp.provenance, 'unknown') as first_hop_prov,
      case
        when coalesce(pr.agent_id = any(v_personal_ids), false) then v_viewer_pct
        when h.first_hop is null then 0::numeric
        else greatest(v_viewer_pct - coalesce(fp.pct, v_fallback), 0)
      end as override_pct
    from producing pr
    left join pcts sp on sp.id = pr.agent_id
    left join hops h on h.member = pr.agent_id
    left join pcts fp on fp.id = h.first_hop
  ), per_row as (
    select p.*, coalesce(mc.is_self, false) as is_self,
      coalesce(mc.override_pct, 0) as override_pct,
      coalesce(mc.seller_pct_raw, v_fallback) as seller_pct
    from production p
    left join member_comp mc on mc.agent_id = p.agent_id
  ), head as (
    select pc.pct, pc.provenance from pcts pc where pc.id = v_vantage_head
  ), totals as (
    select
      coalesce(sum(annual_premium) filter (where is_self and origin <> 'external_daily_gap'), 0)
        as personal_ap,
      count(*) filter (where is_self and origin <> 'external_daily_gap')::integer
        as personal_policies,
      coalesce(sum(annual_premium) filter (
        where agent_id = any(v_direct_ids) and origin <> 'external_daily_gap'), 0) as direct_ap,
      count(*) filter (
        where agent_id = any(v_direct_ids) and origin <> 'external_daily_gap')::integer
        as direct_policies,
      coalesce(sum(annual_premium), 0) as recursive_ap,
      count(*)::integer as recursive_policies,
      coalesce(sum(annual_premium) filter (where origin = 'external_daily_gap'), 0)
        as external_ap,
      count(*) filter (where origin = 'external_daily_gap')::integer as external_policies,
      max(synced_at) as last_synced_at
    from per_row
  ), earnings as (
    select
      coalesce(round(sum(annual_premium * v_viewer_pct / 100.0)
        filter (where is_self and origin <> 'external_daily_gap'), 2), 0) as direct,
      coalesce(round(sum(annual_premium * override_pct / 100.0)
        filter (where not is_self and origin <> 'external_daily_gap'), 2), 0) as override,
      coalesce(round(sum(annual_premium * seller_pct / 100.0)
        filter (where origin <> 'external_daily_gap'), 2), 0) as team_estimated,
      coalesce(round(sum(annual_premium *
          greatest(v_viewer_pct - coalesce((select pct from head), v_fallback), 0) / 100.0)
        filter (where origin = 'external_daily_gap' and agency = 'Vantage Financial'), 2), 0)
        as external_gap_at_head
    from per_row
  ), by_agent as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'agent_id', pr.agent_id,
      'name', pr.name,
      'agency', pr.agency,
      'policies', pr.policies,
      'ap', pr.ap,
      'seller_pct', coalesce(mc.seller_pct_raw, v_fallback),
      'seller_pct_provenance', mc.seller_prov,
      'override_pct_for_viewer', round(mc.override_pct, 2),
      'est_override', round(pr.ap * mc.override_pct / 100.0, 2),
      'is_self', mc.is_self,
      'first_hop_id', mc.first_hop,
      'first_hop_name', (
        select coalesce(p.full_name, a.display_name)
        from public.agents a
        left join public.profiles p on p.id = a.user_id
        where a.id = mc.first_hop
        limit 1
      ),
      'first_hop_pct', case when mc.first_hop is null then null
        else coalesce(mc.first_hop_pct_raw, v_fallback) end,
      'first_hop_pct_provenance', case when mc.first_hop is null then null
        else mc.first_hop_prov end,
      'last_sale_date', pr.last_sale
    ) order by pr.ap desc, pr.name), '[]'::jsonb) as value
    from producing pr
    join member_comp mc on mc.agent_id = pr.agent_id
  ), sources as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'origin', origin, 'policies', policies, 'ap', ap
    ) order by origin), '[]'::jsonb) as value
    from (
      select origin, count(*)::integer as policies,
        round(coalesce(sum(annual_premium), 0), 2) as ap
      from production group by origin
    ) grouped
  ), agencies as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'agency', agency, 'policies', policies, 'ap', ap
    ) order by agency), '[]'::jsonb) as value
    from (
      select agency, count(*)::integer as policies,
        round(coalesce(sum(annual_premium), 0), 2) as ap
      from production group by agency
    ) grouped
  ), duplicate_candidates as (
    select count(*)::integer as groups
    from (
      select case
        when nullif(btrim(policy_number), '') is not null then
          'policy:' || lower(btrim(coalesce(carrier, ''))) || ':' || lower(btrim(policy_number))
        when agent_id is not null
          and nullif(btrim(client_name), '') is not null
          and effective_date is not null then
          'fallback:' || agent_id::text || ':' || md5(lower(btrim(client_name))) || ':' ||
          annual_premium::text || ':' || effective_date::text
        else null
      end as identity_key
      from public.v_production_canonical
      where posted_date >= v_start and posted_date < v_end
    ) candidates
    where identity_key is not null
    group by identity_key
    having count(*) > 1
  ), ambiguities as (
    select count(*)::integer as members
    from hops h
    where h.parent_candidates > 1 and h.member = any(v_scope_ids)
  )
  select jsonb_build_object(
    'as_of', v_today,
    'window', jsonb_build_object('start', v_start, 'end_exclusive', v_end),
    'has_producer_profile', v_has_profile,
    'scope_label', case
      when v_is_admin then 'Full agency'
      when v_downline_count = 0 then 'Personal book'
      else 'You + ' || v_downline_count || ' downline'
    end,
    'downline_agents', v_downline_count,
    'all_members_count', coalesce(cardinality(v_scope_ids), 0),
    'personal', jsonb_build_object(
      'ap', (select personal_ap from totals),
      'policies', (select personal_policies from totals)
    ),
    'direct_team', jsonb_build_object(
      'ap', (select direct_ap from totals),
      'policies', (select direct_policies from totals),
      'agents', coalesce(cardinality(v_direct_ids), 0)
    ),
    'recursive_team', jsonb_build_object(
      'ap', (select recursive_ap from totals),
      'policies', (select recursive_policies from totals),
      'agents', v_downline_count
    ),
    -- Compatibility alias for clients shipped before scopes were explicit.
    'team', jsonb_build_object(
      'ap', (select recursive_ap from totals),
      'policies', (select recursive_policies from totals)
    ),
    'imo', case when v_is_admin then jsonb_build_object(
      'ap', (select recursive_ap from totals),
      'policies', (select recursive_policies from totals),
      'agents', coalesce(cardinality(v_scope_ids), 0)
    ) else null end,
    'comp', jsonb_build_object(
      'viewer_pct', coalesce(v_viewer_pct, v_fallback),
      'provenance', v_viewer_prov,
      'unknown_levels_in_scope', (select count(*) from pcts where provenance = 'unknown'),
      'fallback_pct', v_fallback,
      'basis', 'Layered: your override on a member is your comp minus the comp of your direct child on the path to that member, never minus the seller''s own comp.'
    ),
    'earnings', jsonb_build_object(
      'estimated', (select direct + override from earnings)
        + case when v_is_admin then (select external_gap_at_head from earnings) else 0 end,
      'direct', (select direct from earnings),
      'override', (select override from earnings),
      'team_estimated', (select team_estimated from earnings),
      'external_gap_override', case when v_gap_visible then jsonb_build_object(
        'policies', (select external_policies from totals),
        'ap', (select external_ap from totals),
        'agency', 'Vantage Financial',
        'agency_head_name', 'KJ Vaughn',
        'agency_head_pct', coalesce((select pct from head), v_fallback),
        'agency_head_pct_provenance', coalesce((select provenance from head), 'unknown'),
        'override_pct', case when v_is_admin
          then greatest(coalesce(v_viewer_pct, v_fallback) - coalesce((select pct from head), v_fallback), 0)
          else null end,
        'est', case when v_is_admin then (select external_gap_at_head from earnings) else null end,
        'basis', case when v_is_admin
          then 'Estimated at the agency head''s comp (your comp minus the head''s) because the individual sellers have not synced yet.'
          else 'Sellers are unattributed until their policies sync, so your override on this production cannot be estimated yet.' end
      ) else null end,
      'basis', case when v_is_admin
        then 'Direct at your comp on your own policies + layered override (your comp minus your first-hop comp) on downline policies + external agency gap at the agency head comp.'
        else 'Direct at your comp on your own policies + layered override (your comp minus your first-hop comp) on downline policies. Unattributed agency production never estimates commission.' end
    ),
    'by_agent', (select value from by_agent),
    'reconciliation', jsonb_build_object(
      'sources', (select value from sources),
      'agencies', (select value from agencies),
      'external_unattributed', jsonb_build_object(
        'ap', (select external_ap from totals),
        'policies', (select external_policies from totals)
      ),
      'duplicate_candidate_groups', (select count(*) from duplicate_candidates),
      'hierarchy_ambiguities', (select members from ambiguities)
    ),
    'last_synced_at', (select last_synced_at from totals),
    'source', 'v_production_comp_truth + agent_contract_levels'
  ) into v_out;

  return v_out;
end;
$fn$;

revoke all on function public.scoped_production_scoreboard(date, date) from public, anon;
grant execute on function public.scoped_production_scoreboard(date, date) to authenticated, service_role;

comment on function public.scoped_production_scoreboard(date, date) is
  'Phoenix-window personal / direct / recursive / IMO production with layered comp: override = viewer comp minus first-hop comp. Admin sees the full roster plus external agency gaps; everyone else sees their own single-parent hierarchy only. by_agent lists who sold what.';

-- ---------------------------------------------------------------------------
-- 5. Reconciliation receipt (admin / service only)
-- ---------------------------------------------------------------------------
create or replace function public.production_reconciliation_receipt(p_business_date date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $fn$
declare
  v_date date := coalesce(p_business_date, (now() at time zone 'America/Phoenix')::date);
  v_result jsonb;
begin
  if auth.role() <> 'service_role' and not public.apex_is_admin() then
    raise exception 'admin only' using errcode = '42501';
  end if;

  with rows as (
    select u.*,
      case when public.fn_agent_subagency(u.agent_id) = 'vantage'
        then 'Vantage Financial' else 'APEX Financial' end as agency
    from public.v_production_unified u
    where u.posted_date = v_date
  ), by_source as (
    select coalesce(jsonb_agg(to_jsonb(g) order by g.origin), '[]'::jsonb) value
    from (
      select origin, count(*)::integer policies, round(sum(annual_premium), 2) alp
      from rows group by origin
    ) g
  ), by_agency as (
    select coalesce(jsonb_agg(to_jsonb(g) order by g.agency), '[]'::jsonb) value
    from (
      select agency, count(*)::integer policies, round(sum(annual_premium), 2) alp
      from rows group by agency
    ) g
  ), snapshots as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'agency', agency_name,
      'source', source,
      'external_ref', external_ref,
      'reported_policies', reported_policies,
      'reported_alp', reported_alp,
      'reported_at', reported_at
    ) order by agency_name, source), '[]'::jsonb) value
    from public.production_external_daily_snapshots
    where business_date = v_date
  ), duplicate_groups as (
    select identity_type, md5(identity_key) identity_fingerprint,
      count(*)::integer candidate_rows,
      array_agg(distinct origin order by origin) origins,
      round(sum(annual_premium), 2) candidate_alp
    from (
      select origin, annual_premium,
        case
          when nullif(btrim(policy_number), '') is not null then 'carrier_policy'
          else 'agent_client_premium_effective_date'
        end identity_type,
        case
          when nullif(btrim(policy_number), '') is not null then
            'policy:' || lower(btrim(coalesce(carrier, ''))) || ':' || lower(btrim(policy_number))
          when agent_id is not null
            and nullif(btrim(client_name), '') is not null
            and effective_date is not null then
            'fallback:' || coalesce(public.fn_canonical_agent_id(agent_id), agent_id)::text || ':' ||
            md5(lower(btrim(client_name))) || ':' || annual_premium::text || ':' || effective_date::text
          else null
        end identity_key
      from public.v_production_canonical
      where posted_date = v_date
    ) candidates
    where identity_key is not null
    group by identity_type, identity_key
    having count(*) > 1
  ), duplicates as (
    select coalesce(jsonb_agg(to_jsonb(d) order by d.identity_fingerprint), '[]'::jsonb) value,
      count(*)::integer groups
    from duplicate_groups d
  )
  select jsonb_build_object(
    'checked_at', now(),
    'business_timezone', 'America/Phoenix',
    'business_date', v_date,
    'totals', jsonb_build_object(
      'policies', (select count(*) from rows),
      'alp', (select round(coalesce(sum(annual_premium), 0), 2) from rows)
    ),
    'by_source', (select value from by_source),
    'by_agency', (select value from by_agency),
    'external_snapshots', (select value from snapshots),
    'duplicate_candidate_groups', (select groups from duplicates),
    'duplicate_candidates', (select value from duplicates)
  ) into v_result;

  return v_result;
end;
$fn$;

revoke all on function public.production_reconciliation_receipt(date) from public, anon;
grant execute on function public.production_reconciliation_receipt(date) to authenticated, service_role;

comment on function public.production_reconciliation_receipt(date) is
  'Admin/service-only per-business-date receipt: unified totals by source and agency, external snapshots, and duplicate identity candidates.';

commit;
