-- MP-430 — the home scoreboard "never loads": production truth, materialized.
--
-- Sam: "My production score[board] literally never ever loads." Measured
-- 2026-09-04: the authenticated role carries statement_timeout=8s and the
-- PostgREST call to scoped_production_scoreboard() had 29,369 calls, mean
-- 2,285 ms, MAX 7,996 ms — the max IS the timeout, i.e. every call that
-- crossed 8s died and rendered a skeleton forever. The RPC took 17–43 s
-- under sync load and 1.9 s idle, on tables under 2,000 rows. Not a data
-- problem: a per-row function problem. fn_agent_contract_pct() (catalog
-- lookup + regex, ~35 ms), fn_agent_subagency(), fn_agent_is_roster_excluded()
-- and fn_hierarchy_first_hops() (recursive walk that re-evaluates a view)
-- were called once per production row and per agent on EVERY request, so
-- v_production_comp_truth cost 1.1 s idle and 22 s under load, and the
-- projection RPC (10.9 s) could never answer inside 8 s at all (the live
-- 500 on rpc/scoped_production_projection in the dashboard console).
--
-- The fix is the class, not the query: precompute the per-agent facts
-- (canonical id, roster exclusion, sub-agency, contract pct) and the
-- hierarchy closure into materialized views, and materialize the production
-- truth on top of them. Every reader keeps its name and signature; the
-- public helper functions become lookups into the materialized rows with a
-- fallback to the original computation (kept as *_live) for an id the last
-- refresh has not seen. A dirty-flag table + a 30-second pg_cron tick keep
-- them fresh; the native deal-post path refreshes synchronously so a deal
-- Sam posts is on the board when the dialog closes, not 30 s later.
--
-- Staleness contract: ≤30 s after any write (agents / comp / book / deals),
-- which is tighter than the 120 s staleTime every consumer already holds.

create table if not exists public.truth_refresh_state (
  name text primary key,
  dirty boolean not null default true,
  refreshed_at timestamptz,
  refresh_ms integer,
  last_error text,
  updated_at timestamptz not null default now()
);
insert into public.truth_refresh_state(name) values ('agent_flags'),('hierarchy'),('production')
on conflict (name) do nothing;
revoke all on public.truth_refresh_state from public, anon;
grant select on public.truth_refresh_state to authenticated, service_role;

-- ── the original computations, kept verbatim under *_live ───────────────────
CREATE OR REPLACE FUNCTION public.fn_agent_is_roster_excluded_live(p_agent_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select exists (
    select 1 from public.roster_exclusions x
    where x.agent_id = coalesce(
      (select m.canonical_agent_id from public.v_agent_canonical_map m where m.agent_id = p_agent_id),
      p_agent_id)
  );
$function$;

CREATE OR REPLACE FUNCTION public.fn_agent_subagency_live(p_agent_id uuid)
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with target as (
    select coalesce(public.fn_canonical_agent_id(p_agent_id), p_agent_id) as canonical_id
  )
  select case
    when p_agent_id is null then null
    when p_agent_id = '00000000-0000-0000-0000-00000000a008'::uuid then 'vantage'
    when target.canonical_id = '431dff0d-7c82-4134-a85e-457e5226fc7f'::uuid then 'vantage'
    when exists (
      select 1
      from public.agents a
      left join public.v_agent_canonical_map manager_map on manager_map.agent_id = a.manager_id
      where a.id in (p_agent_id, target.canonical_id)
        and coalesce(manager_map.canonical_agent_id, a.manager_id) =
          '431dff0d-7c82-4134-a85e-457e5226fc7f'::uuid
    ) then 'vantage'
    else null
  end
  from target;
$function$;

CREATE OR REPLACE FUNCTION public.fn_agent_contract_pct_live(p_agent_id uuid)
 RETURNS TABLE(pct numeric, provenance text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.fn_hierarchy_first_hops_live(p_roots uuid[])
 RETURNS TABLE(member uuid, first_hop uuid, depth integer, parent_candidates integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;


-- ── per-agent truth ─────────────────────────────────────────────────────────
drop materialized view if exists public.mv_hierarchy_hops;
drop materialized view if exists public.mv_production_comp_truth;
drop materialized view if exists public.mv_agent_truth;
create materialized view public.mv_agent_truth as
select a.id as agent_id,
       coalesce(m.canonical_agent_id, a.id) as canonical_id,
       public.fn_agent_is_roster_excluded_live(a.id) as roster_excluded,
       public.fn_agent_subagency_live(a.id) as subagency,
       p.pct as contract_pct,
       p.provenance as contract_provenance
from public.agents a
left join public.v_agent_canonical_map m on m.agent_id = a.id
cross join lateral public.fn_agent_contract_pct_live(a.id) p;
create unique index mv_agent_truth_agent_idx on public.mv_agent_truth(agent_id);
create index mv_agent_truth_canon_idx on public.mv_agent_truth(canonical_id);

-- ── hierarchy closure: every canonical agent as a root ───────────────────────
create materialized view public.mv_hierarchy_hops as
with recursive edges as (
  select distinct
    coalesce(pm.canonical_id, c.parent_raw) as parent_canon,
    coalesce(cm.canonical_id, c.id) as child_canon
  from (
    select a.id, coalesce(a.manager_id, a.switched_to_manager_id, a.invited_by_manager_id) as parent_raw
    from public.agents a
  ) c
  left join public.mv_agent_truth cm on cm.agent_id = c.id
  left join public.mv_agent_truth pm on pm.agent_id = c.parent_raw
  where c.parent_raw is not null
    and coalesce(pm.canonical_id, c.parent_raw) <> coalesce(cm.canonical_id, c.id)
), roots as (
  select distinct canonical_id as id from public.mv_agent_truth
), walk(root, member, first_hop, depth, path) as (
  select r.id, e.child_canon, e.child_canon, 1, array[r.id, e.child_canon]
  from roots r join edges e on e.parent_canon = r.id
  union all
  select w.root, e.child_canon, w.first_hop, w.depth + 1, w.path || e.child_canon
  from walk w join edges e on e.parent_canon = w.member
  where not (e.child_canon = any(w.path)) and w.depth < 40
)
select distinct on (w.root, w.member)
  w.root, w.member, w.first_hop, w.depth,
  (select count(distinct x.parent_canon) from edges x where x.child_canon = w.member)::integer as parent_candidates
from walk w
order by w.root, w.member, w.depth desc, w.first_hop;
create unique index mv_hierarchy_hops_pk on public.mv_hierarchy_hops(root, member);

-- ── public helpers become lookups (fallback to *_live for unseen ids) ───────
create or replace function public.fn_agent_is_roster_excluded(p_agent_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $f$
  select coalesce((select t.roster_excluded from public.mv_agent_truth t where t.agent_id = p_agent_id),
                  public.fn_agent_is_roster_excluded_live(p_agent_id));
$f$;
create or replace function public.fn_agent_subagency(p_agent_id uuid)
returns text language sql stable security definer set search_path to 'public' as $f$
  select case when p_agent_id is null then null
              when exists (select 1 from public.mv_agent_truth t where t.agent_id = p_agent_id)
                then (select t.subagency from public.mv_agent_truth t where t.agent_id = p_agent_id)
              else public.fn_agent_subagency_live(p_agent_id) end;
$f$;
create or replace function public.fn_agent_contract_pct(p_agent_id uuid)
returns table(pct numeric, provenance text) language sql stable security definer set search_path to 'public' as $f$
  select t.contract_pct, coalesce(t.contract_provenance, 'unknown')
  from public.mv_agent_truth t where t.agent_id = p_agent_id
  union all
  select l.pct, l.provenance from public.fn_agent_contract_pct_live(p_agent_id) l
  where not exists (select 1 from public.mv_agent_truth t where t.agent_id = p_agent_id)
  limit 1;
$f$;
create or replace function public.fn_hierarchy_first_hops(p_roots uuid[])
returns table(member uuid, first_hop uuid, depth integer, parent_candidates integer)
language sql stable security definer set search_path to 'public' as $f$
  with roots as (
    select distinct coalesce(t.canonical_id, r.id) as id
    from unnest(coalesce(p_roots, '{}'::uuid[])) as r(id)
    left join public.mv_agent_truth t on t.agent_id = r.id
    union
    select r.id from unnest(coalesce(p_roots, '{}'::uuid[])) as r(id)
    where exists (select 1 from public.mv_agent_truth t where t.canonical_id = r.id)
  )
  select distinct on (h.member) h.member, h.first_hop, h.depth, h.parent_candidates
  from public.mv_hierarchy_hops h
  where h.root in (select id from roots)
    and h.member not in (select id from roots)
  order by h.member, h.depth desc, h.first_hop;
$f$;

-- ── production truth, materialized ──────────────────────────────────────────
create materialized view public.mv_production_comp_truth as
select c.row_key, c.origin, c.raw_agent_id, c.agent_id, c.agent_name, c.client_name, c.carrier,
       c.product, c.policy_number, c.annual_premium, c.posted_date, c.effective_date, c.status,
       c.synced_at, c.seller_comp_pct, c.direct_estimate,
       case when c.origin = 'external_daily_gap' or t.subagency = 'vantage'
            then 'Vantage Financial' else 'APEX Financial' end as agency
from public.v_production_comp_truth c
left join public.mv_agent_truth t on t.agent_id = c.raw_agent_id;
create unique index mv_production_comp_truth_pk on public.mv_production_comp_truth(row_key);
create index mv_production_comp_truth_posted_idx on public.mv_production_comp_truth(posted_date);
create index mv_production_comp_truth_agent_idx on public.mv_production_comp_truth(agent_id);

-- ── refresh: dirty-flag driven, serialized, never throws ────────────────────
create or replace function public.refresh_production_truth(p_force boolean default false)
returns jsonb language plpgsql security definer set search_path to 'public' as $f$
declare
  r record; t0 timestamptz; v_out jsonb := '{}'::jsonb; v_prod_dirty boolean;
begin
  if not pg_try_advisory_xact_lock(hashtext('refresh_production_truth')) then
    return jsonb_build_object('skipped', 'another refresh holds the lock');
  end if;
  -- agent facts feed the hierarchy and the production truth: refresh in that order,
  -- and anything upstream being dirty makes everything downstream dirty.
  for r in select name, dirty from public.truth_refresh_state
           order by case name when 'agent_flags' then 1 when 'hierarchy' then 2 else 3 end loop
    v_prod_dirty := p_force or r.dirty
      or (r.name in ('hierarchy','production') and (v_out ? 'agent_flags'))
      or (r.name = 'production' and (v_out ? 'hierarchy'));
    if not v_prod_dirty then continue; end if;
    t0 := clock_timestamp();
    begin
      if r.name = 'agent_flags' then refresh materialized view concurrently public.mv_agent_truth;
      elsif r.name = 'hierarchy' then refresh materialized view concurrently public.mv_hierarchy_hops;
      else refresh materialized view concurrently public.mv_production_comp_truth; end if;
      update public.truth_refresh_state
         set dirty = false, refreshed_at = now(), last_error = null, updated_at = now(),
             refresh_ms = (extract(epoch from clock_timestamp() - t0) * 1000)::integer
       where name = r.name;
      v_out := v_out || jsonb_build_object(r.name, (extract(epoch from clock_timestamp() - t0) * 1000)::integer);
    exception when others then
      update public.truth_refresh_state set last_error = sqlerrm, updated_at = now() where name = r.name;
      v_out := v_out || jsonb_build_object(r.name, 'error: ' || sqlerrm);
    end;
  end loop;
  return v_out;
end
$f$;
revoke all on function public.refresh_production_truth(boolean) from public, anon;
grant execute on function public.refresh_production_truth(boolean) to authenticated, service_role;

-- ── dirty marks: statement-level, so a 1,068-row sync costs one flag write ──
create or replace function public.trg_mark_truth_dirty() returns trigger language plpgsql security definer set search_path to 'public' as $f$
begin
  update public.truth_refresh_state set dirty = true, updated_at = now()
   where name = any(string_to_array(tg_argv[0], ','));
  return null;
end
$f$;
do $d$
declare t text; names text;
begin
  foreach t in array array['agents','agent_contract_levels','agent_comp_levels','roster_exclusions'] loop
    if to_regclass('public.'||t) is not null then
      execute format('drop trigger if exists trg_truth_dirty on public.%I', t);
      execute format('create trigger trg_truth_dirty after insert or update or delete on public.%I for each statement execute function public.trg_mark_truth_dirty(%L)', t, 'agent_flags,hierarchy,production');
    end if;
  end loop;
  foreach t in array array['agentlink_book','deals','production_external_deals','production_external_daily_snapshots','carriers'] loop
    if to_regclass('public.'||t) is not null then
      execute format('drop trigger if exists trg_truth_dirty on public.%I', t);
      execute format('create trigger trg_truth_dirty after insert or update or delete on public.%I for each statement execute function public.trg_mark_truth_dirty(%L)', t, 'production');
    end if;
  end loop;
end $d$;

-- ── consumers read the materialized truth ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.scoped_production_scoreboard(p_start date, p_end date)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      c.agency
    from public.mv_production_comp_truth c
    where c.posted_date >= v_start
      and c.posted_date < v_end
      and (
        (c.origin <> 'external_daily_gap' and c.agent_id = any(v_scope_ids))
        or (
          c.origin = 'external_daily_gap'
          and (
            v_is_admin
            or (v_gap_visible and c.agency = 'Vantage Financial')
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
    'source', 'mv_production_comp_truth (materialized, refresh_production_truth) + agent_contract_levels'
  ) into v_out;

  return v_out;
end;
$function$;

CREATE OR REPLACE FUNCTION public.scoped_production_projection()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_today date := (now() at time zone 'America/Phoenix')::date;
  v_month_start date := date_trunc('month', v_today)::date;
  v_month_end date := (date_trunc('month', v_today) + interval '1 month')::date;
  v_elapsed_days integer := extract(day from v_today)::integer;
  v_days_in_month integer := extract(day from (v_month_end - interval '1 day'))::integer;
  v_is_admin boolean := public.apex_is_admin();
  v_has_profile boolean;
  v_personal_ids uuid[] := '{}'::uuid[];
  v_hier_ids uuid[] := '{}'::uuid[];
  v_scope_ids uuid[] := '{}'::uuid[];
  v_vantage_head constant uuid := '431dff0d-7c82-4134-a85e-457e5226fc7f';
  v_gap_visible boolean := false;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'authentication required';
  end if;

  select exists(select 1 from public.agents a where a.user_id = auth.uid())
    into v_has_profile;

  select coalesce(array_agg(distinct coalesce(m.canonical_agent_id, a.id)), '{}'::uuid[])
    into v_personal_ids
  from public.agents a
  left join public.v_agent_canonical_map m on m.agent_id = a.id
  where a.user_id = auth.uid();

  select coalesce(array_agg(distinct h.member)
    filter (where not public.fn_agent_is_roster_excluded(h.member)), '{}'::uuid[])
    into v_hier_ids
  from public.fn_hierarchy_first_hops(v_personal_ids) h;

  if v_is_admin then
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

  -- A legacy aggregate Vantage snapshot is visible to the owner/admin only.
  -- It contributes to agency/IMO pace, but never to a named producer's pace.
  v_gap_visible := v_is_admin or (v_vantage_head = any(v_scope_ids));

  with production as (
    select
      c.origin,
      c.agent_id,
      c.raw_agent_id,
      c.annual_premium,
      c.posted_date,
      (c.agent_id = any(v_personal_ids) and c.origin <> 'external_daily_gap') as is_self,
      c.agency
    from public.mv_production_comp_truth c
    where c.posted_date >= v_month_start
      and c.posted_date < v_month_end
      and (
        (c.origin <> 'external_daily_gap' and c.agent_id = any(v_scope_ids))
        or (c.origin = 'external_daily_gap' and v_gap_visible)
      )
  ), buckets as (
    select 'personal'::text as bucket, 'Personal'::text as label,
      annual_premium, posted_date
    from production where is_self
    union all
    select 'team', 'Team', annual_premium, posted_date from production
    union all
    select 'imo', 'Full IMO', annual_premium, posted_date from production
      where v_is_admin
  ), bucket_metrics as (
    select bucket, label,
      count(*)::integer as policies,
      round(coalesce(sum(annual_premium), 0), 2) as mtd_ap,
      count(distinct posted_date)::integer as active_days
    from buckets
    group by bucket, label
  ), bucket_complete as (
    select seed.bucket, seed.label,
      coalesce(m.policies, 0) as policies,
      coalesce(m.mtd_ap, 0) as mtd_ap,
      coalesce(m.active_days, 0) as active_days
    from (values ('personal', 'Personal'), ('team', 'Team'), ('imo', 'Full IMO')) seed(bucket, label)
    left join bucket_metrics m on m.bucket = seed.bucket
    where seed.bucket <> 'imo' or v_is_admin
  ), bucket_json as (
    select jsonb_object_agg(bucket, jsonb_build_object(
      'label', label,
      'mtd_ap', mtd_ap,
      'policies', policies,
      'active_days', active_days,
      'projected_ap', case
        when active_days < 3 or mtd_ap <= 0 then mtd_ap
        else round(least(greatest(mtd_ap, mtd_ap / greatest(v_elapsed_days, 1) * v_days_in_month), mtd_ap * 5), 2)
      end,
      'confidence', case when active_days >= 10 then 'high' when active_days >= 5 then 'medium' else 'low' end
    )) as value
    from bucket_complete
  ), agency_metrics as (
    select agency,
      count(*)::integer as policies,
      round(coalesce(sum(annual_premium), 0), 2) as mtd_ap,
      count(distinct posted_date)::integer as active_days
    from production
    group by agency
  ), agencies as (
    select coalesce(jsonb_agg(jsonb_build_object(
      'agency', agency,
      'mtd_ap', mtd_ap,
      'policies', policies,
      'active_days', active_days,
      'projected_ap', case
        when active_days < 3 or mtd_ap <= 0 then mtd_ap
        else round(least(greatest(mtd_ap, mtd_ap / greatest(v_elapsed_days, 1) * v_days_in_month), mtd_ap * 5), 2)
      end,
      'confidence', case when active_days >= 10 then 'high' when active_days >= 5 then 'medium' else 'low' end
    ) order by mtd_ap desc), '[]'::jsonb) as value
    from agency_metrics
  )
  select jsonb_build_object(
    'as_of', v_today,
    'month_start', v_month_start,
    'month_end_exclusive', v_month_end,
    'elapsed_calendar_days', v_elapsed_days,
    'days_in_month', v_days_in_month,
    'has_producer_profile', v_has_profile,
    'scope_label', case
      when v_is_admin then 'Full agency'
      when cardinality(v_hier_ids) = 0 then 'Personal book'
      else 'You + ' || cardinality(v_hier_ids) || ' downline'
    end,
    'personal', coalesce((select value -> 'personal' from bucket_json), '{}'::jsonb),
    'team', coalesce((select value -> 'team' from bucket_json), '{}'::jsonb),
    'imo', case when v_is_admin then (select value -> 'imo' from bucket_json) else null end,
    'agencies', (select value from agencies),
    'basis', 'Projected month-end ALP = current MTD pace across elapsed Phoenix calendar days, capped at 5x MTD. Fewer than 3 selling days stays at MTD and is labelled low confidence.'
  ) into v_result;

  return v_result;
end;
$function$;


-- ── freshness view for the doctor + the UI ──────────────────────────────────
create or replace view public.v_production_truth_freshness as
select name, dirty, refreshed_at, refresh_ms, last_error,
       extract(epoch from (now() - refreshed_at))::integer as age_seconds
from public.truth_refresh_state;
grant select on public.v_production_truth_freshness to authenticated, service_role;

-- ── 30-second tick ──────────────────────────────────────────────────────────
select cron.unschedule(jobid) from cron.job where jobname = 'refresh-production-truth';
select cron.schedule('refresh-production-truth', '30 seconds', $$select public.refresh_production_truth(false)$$);
