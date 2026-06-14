-- wave-94: SWEEP-FOR-SAME-PATTERN. wave-93 fixed the recruitment-side leaderboards
-- (v_recruiting_leaderboard + v_recruiter_pipeline). The same v_agent_canonical_map gap
-- remained in every production-side view. Concrete impact today: all 33 daily_production
-- rows + 105 deals attributed to Sam are keyed under SJAMES02 (the dup), so SJAMES01
-- (canonical) appears with $0 MTD on every dashboard, and Top Producers / 20K Target /
-- Lifetime Production show the wrong row.
--
-- Fix: rewrite 4 production views to canonicalize agent_id via v_agent_canonical_map.
--   1) agent_lifetime_production       — daily_production rollup
--   2) v_top_producers_mtd             — MTD leaderboard (top 20)
--   3) v_agent_20k_target_leaderboard  — pace-to-$20K leaderboard
--   4) v_manager_hierarchy_mtd         — manager-level team rollup
--
-- Pattern (same as wave-93):
--   - For per-agent views: start from canonical rows only (canonical_agent_id IS NULL)
--     and join child tables through v_agent_canonical_map so dup-routed work rolls up.
--   - For agg-on-source-rows views: canonicalize the source's agent_id before GROUP BY.
--
-- Other identity-aggregating views (v_agent_with_downline_production,
-- v_recent_activations_alp, v_agent_command_center) defer to wave-95: they pull from
-- v_team_hierarchy or per-agent first-deal windows that need their own canonicalization
-- pass; bundling them risks half-fixes.

-- 1) agent_lifetime_production: canonicalize daily_production rows.
drop view if exists public.agent_lifetime_production cascade;
create view public.agent_lifetime_production as
select
  coalesce(m.canonical_agent_id, dp.agent_id) as agent_id,
  coalesce(sum(dp.aop), 0::numeric) as lifetime_alp,
  coalesce(sum(dp.deals_closed), 0::bigint)::integer as lifetime_deals,
  max(dp.production_date) as last_production_date
from daily_production dp
left join v_agent_canonical_map m on m.agent_id = dp.agent_id
group by coalesce(m.canonical_agent_id, dp.agent_id);

comment on view public.agent_lifetime_production is
  'wave-94 (2026-06-14): canonicalize daily_production.agent_id via v_agent_canonical_map before rollup. Without this, Sam''s 33 daily_production rows keyed to SJAMES02 (dup) made SJAMES01 (canonical) show $0 lifetime ALP on every surface.';

-- 2) v_top_producers_mtd: walk canonical agents only, attribute dup-routed deals.
drop view if exists public.v_top_producers_mtd cascade;
create view public.v_top_producers_mtd as
with canonical_agents as (
  -- canonical = no canonical_agent_id set (dup rows: canonical_agent_id IS NOT NULL)
  select a.id, a.display_name, a.invited_by_manager_id
  from agents a
  where a.canonical_agent_id is null
    and coalesce(a.is_inactive, false) = false
    and coalesce(a.is_deactivated, false) = false
),
deals_canon as (
  -- canonicalize deals.agent_id so dup-routed deals attribute to the canonical agent
  select
    coalesce(m.canonical_agent_id, d.agent_id) as canon_agent_id,
    d.id,
    d.annual_premium
  from deals d
  left join v_agent_canonical_map m on m.agent_id = d.agent_id
  where d.posted_at > date_trunc('month', now())
    and d.status <> all (array['rejected', 'cancelled'])
)
select
  ca.id as agent_id,
  ca.display_name,
  count(dc.id) as deals_mtd,
  coalesce(sum(dc.annual_premium), 0::numeric) as alp_mtd,
  coalesce(mgr.display_name, '(direct to Sam)'::text) as manager_name
from canonical_agents ca
left join agents mgr on mgr.id = ca.invited_by_manager_id
left join deals_canon dc on dc.canon_agent_id = ca.id
group by ca.id, ca.display_name, mgr.display_name
having count(dc.id) > 0
order by coalesce(sum(dc.annual_premium), 0::numeric) desc
limit 20;

comment on view public.v_top_producers_mtd is
  'wave-94 (2026-06-14): canonical agents only + deals.agent_id canonicalized via v_agent_canonical_map. Restores SJAMES01 to top producers (it was absent because all 105 of Sam''s deals key to SJAMES02).';

-- 3) v_agent_20k_target_leaderboard: same canonicalization + preserve pace logic.
drop view if exists public.v_agent_20k_target_leaderboard cascade;
create view public.v_agent_20k_target_leaderboard as
with canonical_agents as (
  select a.id, a.profile_id, a.license_status, a.created_at
  from agents a
  where a.canonical_agent_id is null
    and a.status = 'active'::agent_status
),
deals_canon as (
  select
    coalesce(m.canonical_agent_id, d.agent_id) as canon_agent_id,
    d.id,
    d.annual_premium,
    d.created_at,
    d.policy_number
  from deals d
  left join v_agent_canonical_map m on m.agent_id = d.agent_id
),
base as (
  select
    ca.id as agent_id,
    coalesce(p.full_name, 'Unknown'::text) as name,
    p.email,
    ca.license_status,
    ca.created_at::date as hired,
    count(dc.id) filter (where dc.created_at >= date_trunc('month', now())) as deals_mtd,
    coalesce(sum(dc.annual_premium) filter (where dc.created_at >= date_trunc('month', now())), 0::numeric)::integer as ap_mtd,
    count(dc.id) filter (where dc.created_at >= date_trunc('month', now()) and (dc.policy_number is null or dc.policy_number = '')) as deals_no_policy_mtd,
    coalesce(sum(dc.annual_premium) filter (where dc.created_at >= date_trunc('month', now()) and (dc.policy_number is null or dc.policy_number = '')), 0::numeric)::integer as ap_at_risk_mtd
  from canonical_agents ca
  left join profiles p on p.id = ca.profile_id
  left join deals_canon dc on dc.canon_agent_id = ca.id
  group by ca.id, p.full_name, p.email, ca.license_status, ca.created_at
)
select
  agent_id,
  name,
  email,
  license_status,
  hired,
  deals_mtd,
  ap_mtd,
  deals_no_policy_mtd,
  ap_at_risk_mtd,
  greatest(20000 - ap_mtd, 0) as ap_to_20k,
  case
    when (extract(day from now()))::integer = 0 then 0
    else (round(((ap_mtd::numeric / extract(day from now())) * extract(day from (date_trunc('month', now()) + interval '1 mon -1 days')))))::integer
  end as projected_eom_ap,
  case
    when ap_mtd >= 20000 then 'hit_20k'
    when ap_mtd > 0
      and ((ap_mtd::numeric / nullif(extract(day from now()), 0::numeric)) * extract(day from (date_trunc('month', now()) + interval '1 mon -1 days'))) >= 20000::numeric
      then 'on_pace_20k'
    when ap_mtd > 0 then 'below_pace'
    when hired > (now() - interval '30 days')::date then 'new_hire_grace'
    else 'zero_mtd'
  end as pace_verdict
from base
where deals_mtd > 0
   or ap_mtd > 0
   or hired > (now() - interval '30 days')::date
order by ap_mtd desc nulls last,
  case
    when (extract(day from now()))::integer = 0 then 0
    else (round(((ap_mtd::numeric / extract(day from now())) * extract(day from (date_trunc('month', now()) + interval '1 mon -1 days')))))::integer
  end desc;

comment on view public.v_agent_20k_target_leaderboard is
  'wave-94 (2026-06-14): canonical agents only + canonicalized deals. Pace verdict + hit_20k logic preserved exactly.';

-- 4) v_manager_hierarchy_mtd: canonicalize team-size counts + deals attribution.
drop view if exists public.v_manager_hierarchy_mtd cascade;
create view public.v_manager_hierarchy_mtd as
with canonical_agents as (
  select a.id, a.invited_by_manager_id
  from agents a
  where a.canonical_agent_id is null
    and coalesce(a.is_inactive, false) = false
    and coalesce(a.is_deactivated, false) = false
),
deals_canon as (
  select
    coalesce(m.canonical_agent_id, d.agent_id) as canon_agent_id,
    d.id,
    d.annual_premium
  from deals d
  left join v_agent_canonical_map m on m.agent_id = d.agent_id
  where d.posted_at > date_trunc('month', now())
    and d.status <> all (array['rejected', 'cancelled'])
)
select
  coalesce(mgr.id, '00000000-0000-0000-0000-000000000000'::uuid) as manager_id,
  coalesce(mgr.display_name, '(direct to Sam)'::text) as manager_name,
  count(distinct ca.id) as team_size,
  coalesce(sum(dc.annual_premium), 0::numeric) as team_alp_mtd,
  count(dc.id) as team_deals_mtd,
  count(distinct dc.canon_agent_id) as producing_team_mtd
from canonical_agents ca
left join agents mgr on mgr.id = ca.invited_by_manager_id
left join deals_canon dc on dc.canon_agent_id = ca.id
group by mgr.id, mgr.display_name
having count(distinct ca.id) > 0
order by coalesce(sum(dc.annual_premium), 0::numeric) desc;

comment on view public.v_manager_hierarchy_mtd is
  'wave-94 (2026-06-14): canonical agents only + canonicalized deals. team_size no longer double-counts dup agents; team_alp_mtd attributes dup-routed deals to the canonical agent under the right manager.';
