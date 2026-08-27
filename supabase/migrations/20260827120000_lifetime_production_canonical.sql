-- Head-to-toe audit 2026-08-27: agent_lifetime_production summed daily_production.aop
-- (manual log, FORBIDDEN_FOR_ALP) at ~1.85x canonical ($3.49M vs $1.88M), so
-- lifetime AP on the agent dashboard + CRM roster read inflated. Repointed to
-- v_production_unified (canonical, canonicalized, external gap excluded). Same
-- columns + staff guard.
create or replace view public.agent_lifetime_production as
select agent_id, lifetime_alp, lifetime_deals, last_production_date
from (
  select coalesce(m.canonical_agent_id, u.agent_id) as agent_id,
         coalesce(sum(u.annual_premium),0)::numeric as lifetime_alp,
         count(*)::integer as lifetime_deals,
         max(u.posted_date) as last_production_date
  from public.v_production_unified u
  left join public.v_agent_canonical_map m on m.agent_id = u.agent_id
  where u.origin <> 'external_daily_gap' and u.agent_id is not null
  group by coalesce(m.canonical_agent_id, u.agent_id)
) t
where public.is_agency_staff();
