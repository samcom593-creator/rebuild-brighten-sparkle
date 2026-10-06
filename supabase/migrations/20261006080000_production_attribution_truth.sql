-- APEX OS redesign · production attribution truth (2026-10-06)
--
-- Measured before this change (October to date): Home's team production and "Total IMO by agency"
-- read every v_production_unified row with no attribution filter, so they included
--   * 2 AgentLink rows (user 1069) with NO agents row: $1,821,600 "annual premium" on a $500M face —
--     96% of the month, a face amount almost certainly captured as premium;
--   * 36 deals / $66,670 lifetime from Ayro Financial producers ("Dom Yous", "snow flake", "Travis N",
--     "Nels r" = Nails, "David Agbebaku") that ingest_ayro_sales_deal() minted as GHOST_AYRO_* agents and
--     z_default_agent_manager_to_sam() then parented to the owner.
-- The production scoreboard already scoped by agent; Home and the IMO card did not, so the same page
-- showed $1.88M and $58K for the same month (apex-doctor Check #34).
--
-- Rule after this change (one rule, everywhere it is computed): agency production counts a deal only
-- when it has an APEX agent identity in roster scope (canonical id, not roster-excluded). Everything
-- else is reported by production_attribution_exceptions() as a visible exception — never zeroed,
-- never summed into APEX. No deal row is edited or deleted; exclusions are identity-level and
-- reversible (delete the roster_exclusions row).
--
-- Not changed here: the Tyler Krejcha placeholder (GHOST_AYRO_TKREJCHA, 4 deals) has a real APEX
-- twin; merging is an identity decision for a human (/admin/agent-duplicates), so it stays attributed.

begin;

insert into public.roster_exclusions (agent_id, reason, excluded_at)
select a.id,
       'external producer: Ayro Financial ingest placeholder, not an APEX agent (owner directive 2026-10-05)',
       now()
from public.agents a
where a.agent_code in ('GHOST_AYRO_DOMYOUS_ba18', 'GHOST_AYRO_TRAVISN_d7ca', 'GHOST_AYRO_NELSR_62b7',
                       'GHOST_AYRO_SNOWFLAKE_fe6f', 'GHOST_AYRO_DAGBEBAKU')
on conflict (agent_id) do nothing;

-- Unmatched Ayro producers are external until a human links them to a real agent (merge).
create or replace function public.fn_exclude_external_placeholder()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  if new.agent_code like 'GHOST\_AYRO\_%' escape '\' then
    insert into public.roster_exclusions (agent_id, reason, excluded_at)
    values (new.id, 'external producer: unmatched Ayro ingest placeholder (auto at creation)', now())
    on conflict (agent_id) do nothing;
  end if;
  return new;
exception when others then
  -- Never let a bookkeeping row roll back the agent insert the ingest depends on; say so loudly.
  raise warning 'fn_exclude_external_placeholder(%): %', new.id, sqlerrm;
  return new;
end;
$$;

drop trigger if exists trg_exclude_external_placeholder on public.agents;
create trigger trg_exclude_external_placeholder
  after insert on public.agents
  for each row execute function public.fn_exclude_external_placeholder();

create or replace function public.imo_by_agency_period_uncached(p_start date, p_end date)
returns table(agency text, is_primary boolean, policies integer, alp numeric, owner_override_pct numeric, est_owner_override_alp numeric)
language sql
stable security definer
set search_path to 'public'
as $function$
  with owner as (
    select pct as owner_pct from public.fn_agent_contract_pct('7c3c5581-3544-437f-bfe2-91391afb217d'::uuid)
  ), heads(agency, head_pct) as (
    select 'Vantage Financial'::text, pct from public.fn_agent_contract_pct('431dff0d-7c82-4134-a85e-457e5226fc7f'::uuid)
  ), agg as (
    select case when coalesce(public.fn_agent_subagency(u.agent_id) = 'vantage', false)
                then 'Vantage Financial' else 'APEX Financial' end as agency,
           not coalesce(public.fn_agent_subagency(u.agent_id) = 'vantage', false) as is_primary,
           count(*)::integer as policies,
           round(coalesce(sum(u.annual_premium), 0), 0) as alp
    from public.v_production_unified u
    left join public.v_agent_canonical_map m on m.agent_id = u.agent_id
    where u.posted_date >= p_start and u.posted_date < p_end
      and u.agent_id is not null
      and not public.fn_agent_is_roster_excluded(coalesce(m.canonical_agent_id, u.agent_id))
    group by 1, 2
  )
  select agg.agency, agg.is_primary, agg.policies, agg.alp,
         greatest(coalesce(o.owner_pct, 120) - coalesce(h.head_pct, coalesce(o.owner_pct, 120)), 0) as owner_override_pct,
         round(agg.alp * greatest(coalesce(o.owner_pct, 120) - coalesce(h.head_pct, coalesce(o.owner_pct, 120)), 0) / 100.0, 0) as est_owner_override_alp
  from agg
  left join heads h on h.agency = agg.agency
  cross join owner o
  order by agg.alp desc;
$function$;

create or replace function public.production_attribution_exceptions(p_start date, p_end date)
returns table(kind text, policies integer, alp numeric, largest_label text, largest_alp numeric)
language sql
stable security definer
set search_path to 'public'
as $function$
  with x as (
    select case when u.agent_id is null then 'no_agent_identity' else 'excluded_producer' end as kind,
           coalesce(nullif(btrim(u.agent_name), ''), 'unnamed producer') as label,
           u.annual_premium
    from public.v_production_unified u
    left join public.v_agent_canonical_map m on m.agent_id = u.agent_id
    where u.posted_date >= p_start and u.posted_date < p_end
      and (public.apex_is_admin() or public.has_role(auth.uid(), 'manager'))
      and (u.agent_id is null or public.fn_agent_is_roster_excluded(coalesce(m.canonical_agent_id, u.agent_id)))
  )
  select x.kind,
         count(*)::integer,
         round(coalesce(sum(x.annual_premium), 0), 0),
         (array_agg(x.label order by x.annual_premium desc nulls last))[1],
         round(max(x.annual_premium), 0)
  from x
  group by x.kind
  order by 3 desc;
$function$;

revoke all on function public.production_attribution_exceptions(date, date) from public, anon;
grant execute on function public.production_attribution_exceptions(date, date) to authenticated;

-- Home: the same attribution rule as the scoreboard. Anchor must match exactly once.
do $$
declare
  d text;
  anchor text := E'      left join public.v_agent_canonical_map m on m.agent_id = b.agent_id\n  ),\n  daily as (';
  n integer;
begin
  d := pg_get_functiondef('public.apex_home_dashboard(text,date,date)'::regprocedure);
  n := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
  if n <> 1 then raise exception 'apex_home_dashboard: expected one scoped-CTE anchor, found %', n; end if;
  d := replace(d, anchor,
    E'      left join public.v_agent_canonical_map m on m.agent_id = b.agent_id\n' ||
    E'     where b.agent_id is not null\n' ||
    E'       and not public.fn_agent_is_roster_excluded(coalesce(m.canonical_agent_id, b.agent_id))\n' ||
    E'  ),\n  daily as (');
  execute d;
end;
$$;

do $$
declare
  d text;
  anchor text := E'           FROM v_production_unified u\n        ), owner AS (';
  n integer;
begin
  d := pg_get_viewdef('public.v_imo_by_agency'::regclass, true);
  n := (length(d) - length(replace(d, anchor, ''))) / length(anchor);
  if n <> 1 then raise exception 'v_imo_by_agency: expected one scoped anchor, found %', n; end if;
  d := replace(d, anchor,
    E'           FROM v_production_unified u\n' ||
    E'             LEFT JOIN v_agent_canonical_map m ON m.agent_id = u.agent_id\n' ||
    E'          WHERE u.agent_id IS NOT NULL AND NOT fn_agent_is_roster_excluded(COALESCE(m.canonical_agent_id, u.agent_id))\n' ||
    E'        ), owner AS (');
  d := regexp_replace(d, ';\s*$', '');
  execute 'create or replace view public.v_imo_by_agency as ' || d;
end;
$$;

-- Headcount: current people next to the historical graph size. "Current" = canonical, not a
-- placeholder, not deactivated, not terminated (inactive-but-on-the-team still counts). The
-- historical 'agents' keys are kept so nothing that reads them breaks; the UI now leads with current.
do $$
declare
  d text;
  a_direct text := E'''agents'', coalesce(cardinality(v_direct_ids), 0)';
  a_imo text := E'''agents'', coalesce(cardinality(v_scope_ids), 0)';
  eligible text := E'a.canonical_agent_id is null and not public.fn_agent_is_placeholder(a.id) and coalesce(a.is_deactivated, false) = false and a.status::text <> ''terminated''';
  n1 integer;
  n2 integer;
begin
  d := pg_get_functiondef('public.scoped_production_scoreboard_uncached(date,date)'::regprocedure);
  n1 := (length(d) - length(replace(d, a_direct, ''))) / length(a_direct);
  n2 := (length(d) - length(replace(d, a_imo, ''))) / length(a_imo);
  if n1 <> 1 or n2 <> 1 then raise exception 'scoreboard anchors: direct=% imo=% (expected 1 each)', n1, n2; end if;
  d := replace(d, a_direct, a_direct || E',\n      ''agents_current'', (select count(*) from public.agents a where a.id = any(v_direct_ids) and ' || eligible || ')');
  d := replace(d, a_imo, a_imo || E',\n      ''agents_current'', (select count(*) from public.agents a where a.id = any(v_scope_ids) and ' || eligible || ')');
  execute d;
end;
$$;

commit;
