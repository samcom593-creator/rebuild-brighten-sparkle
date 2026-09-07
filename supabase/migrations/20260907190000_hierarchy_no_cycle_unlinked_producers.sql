-- 20260907190000_hierarchy_no_cycle_unlinked_producers.sql
-- 2026-09-07. Sam: "my commission earnings is completely off — showing $1,100
-- today while the team's at $20k production."
--
-- MEASURED: scoreboard today = team $19,572.24 / 7 policies, estimated $1,190.38
-- (direct 0, override 0, Vantage gap 15% on $7,935.84 = $1,190.38). The $11,636
-- of APEX-native production (Edwin Ac-lumor) earned Sam $0 because
-- agents.manager_id for Chudi Ifediora pointed at HIS OWN ROW, so
-- mv_hierarchy_hops has no path from Sam to Chudi or to the 9 agents under him
-- (Edwin Ac-lumor, Wendell Funderburg, Kolade Ayedun, Greg Montague, ...).
-- first_hop is null -> override_pct 0. Branch production last 30d: $43,387
-- (Wendell 19,481 + Chudi 12,270 + Edwin 11,636) at 0% instead of 120-85 = 35%.
--
-- The layered model itself is right (viewer comp minus first-hop comp, e.g.
-- Sam 120 - KJ 105 = 15 on every Vantage dollar, 120 - Aisha 70 = 50 on
-- Tre'va). The hierarchy DATA had a loop and nothing on the page said so.
--
-- 1) repair the loop      2) trigger: no self-loop / cycle on manager_id
-- 3) view of unreachable chains for apex-doctor   4) scoreboard exposes
-- unlinked producers (count + AP) so a broken chain is a number, not a $0.

-- 1) Repair: Chudi reports to Sam (contract 85 set via admin_ui; his sibling
--    Obiajulu Ifediora is a Sam direct at 85). Idempotent.
update public.agents
   set manager_id = '7c3c5581-3544-437f-bfe2-91391afb217d'
 where id = 'a60e70c5-f2d4-4a3d-bcdb-0002327f8e3f'
   and manager_id = id;

-- 2) Guard: a manager_id may never point at the row itself or close a cycle.
create or replace function public.fn_agents_manager_no_cycle()
returns trigger language plpgsql as $$
declare v_cur uuid; v_depth integer := 0;
begin
  if new.manager_id is null then return new; end if;
  if new.manager_id = new.id then
    raise exception 'agents.manager_id cannot be the agent itself (%): a self-loop disconnects the whole branch from the agency root', new.id;
  end if;
  v_cur := new.manager_id;
  while v_cur is not null and v_depth < 100 loop
    if v_cur = new.id then
      raise exception 'agents.manager_id = % would create a hierarchy cycle through %', new.manager_id, new.id;
    end if;
    select a.manager_id into v_cur from public.agents a where a.id = v_cur;
    v_depth := v_depth + 1;
  end loop;
  return new;
end $$;
drop trigger if exists trg_agents_manager_no_cycle on public.agents;
create trigger trg_agents_manager_no_cycle
  before insert or update of manager_id on public.agents
  for each row execute function public.fn_agents_manager_no_cycle();

-- 3) Roster agents whose upline chain never reaches an admin-linked root.
--    reason: cycle | dangling_manager | no_manager | chain_off_root.
create or replace view public.v_hierarchy_unreachable as
with recursive roots as (
  select a.id
  from public.agents a
  join public.user_roles r on r.user_id = a.user_id and r.role = 'admin'
), walk as (
  select a.id as start_id, a.id as cur, a.manager_id as nxt, 0 as depth, array[a.id] as path
  from public.agents a
  where not public.fn_agent_is_roster_excluded(a.id)
  union all
  select w.start_id, m.id, m.manager_id, w.depth + 1, w.path || m.id
  from walk w
  join public.agents m on m.id = w.nxt
  where w.depth < 50 and not (m.id = any(w.path))
), ends as (
  select w.start_id,
    bool_or(w.cur in (select id from roots)) as reaches_root,
    bool_or(w.nxt is not null and w.nxt = any(w.path)) as has_cycle,
    bool_or(w.nxt is not null and not exists (select 1 from public.agents x where x.id = w.nxt)) as dangling
  from walk w
  group by w.start_id
)
select a.id as agent_id, a.display_name, a.status, a.manager_id,
  case when e.has_cycle then 'cycle'
       when e.dangling then 'dangling_manager'
       when a.manager_id is null then 'no_manager'
       else 'chain_off_root' end as reason,
  coalesce((select round(sum(c.annual_premium), 2)
            from public.mv_production_comp_truth c
            where c.agent_id = a.id and c.posted_date >= current_date - 30), 0) as ap_30d
from ends e
join public.agents a on a.id = e.start_id
where not e.reaches_root
  and a.id not in (select id from roots);

-- 4) Scoreboard: unlinked producers become a visible reconciliation number.
CREATE OR REPLACE FUNCTION public.scoped_production_scoreboard_uncached(p_start date, p_end date)
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
  ), unlinked as (
    -- Producers in scope with no hierarchy path to the viewer earn the viewer
    -- 0 override by construction (first_hop is null). 2026-09-07: one
    -- self-referential manager_id (Chudi Ifediora -> Chudi Ifediora) cut a
    -- 10-agent branch off the root and $43k/30d of production read as $0 for
    -- Sam with nothing on the page saying why. Surface the count + AP so a
    -- broken chain is a visible number, never a silent zero.
    select count(*)::integer as agents, coalesce(round(sum(pr.ap), 2), 0) as ap
    from producing pr
    join member_comp mc on mc.agent_id = pr.agent_id
    where not mc.is_self and mc.first_hop is null
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
      'hierarchy_ambiguities', (select members from ambiguities),
      'unlinked_producers', (select agents from unlinked),
      'unlinked_ap', (select ap from unlinked)
    ),
    'last_synced_at', (select last_synced_at from totals),
    'source', 'mv_production_comp_truth (materialized, refresh_production_truth) + agent_contract_levels'
  ) into v_out;

  return v_out;
end;
$function$

