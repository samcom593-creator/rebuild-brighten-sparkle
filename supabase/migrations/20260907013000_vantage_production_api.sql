-- Provider-attested daily totals supersede overlapping Vantage estimates in
-- production rollups. Original AgentLink, Discord, client and policy records
-- remain intact. No agent, credential, access or hierarchy records change.
begin;

create or replace view public.v_production_unified
with (security_invoker = on) as
with api_days as (
  select * from public.production_external_daily_snapshots
  where source = 'agentcloud_production_api'
    and agency_name = 'Vantage Financial'
    and metadata->>'organization_id' = '00000000-0000-0000-0000-000000000001'
    and metadata->>'verified' = 'true'
), legacy as (
  select c.* from public.v_production_canonical c
  where not exists (
    select 1 from api_days a where a.business_date = c.posted_date
      and public.fn_agent_subagency(c.agent_id) = 'vantage'
  )
  union all
  select
    'external-gap:' || lower(replace(g.agency_name, ' ', '-')) || ':' || g.business_date::text || ':' || series.n::text,
    'external_daily_gap'::text,
    case when g.agency_name = 'Vantage Financial' then '00000000-0000-0000-0000-00000000a008'::uuid else null::uuid end,
    g.agency_name || ' (unattributed)', null::text, null::text, null::text, null::text,
    g.gap_alp / nullif(g.gap_policies, 0), g.business_date, null::date,
    'reported_external'::text, g.synced_at
  from public.v_external_production_gap g
  cross join lateral generate_series(1, g.gap_policies) series(n)
  where g.gap_policies > 0 and g.gap_alp > 0
    and not exists (select 1 from api_days a where a.business_date = g.business_date and a.agency_name = g.agency_name)
)
select * from legacy
union all
select
  'agentcloud-total:' || a.business_date::text || ':' || series.n::text,
  -- Existing aggregate origin excludes synthetic units from personal
  -- leaderboards and commission estimates. These are not client policies.
  'external_daily_gap'::text,
  '00000000-0000-0000-0000-00000000a008'::uuid,
  'Vantage Financial (API aggregate)'::text,
  null::text, null::text, null::text, null::text,
  a.reported_alp / nullif(a.reported_policies, 0), a.business_date,
  null::date, 'reported_external'::text, a.updated_at
from api_days a
cross join lateral generate_series(1, a.reported_policies) series(n);

comment on view public.v_production_unified is
  'Production rollup: verified Agent Cloud daily Vantage totals take precedence only on covered dates. Original policy records remain in v_production_canonical. API aggregate units are not policies, do not fabricate client data and are excluded from personal commission estimates.';

commit;
