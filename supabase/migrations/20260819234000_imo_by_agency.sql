-- 2026-08-19 (Sam, Vantage sub-agency): TOTAL IMO BY AGENCY. KJ Vaughn already
-- had a 12-agent downline in the data but was not flagged is_manager; set it,
-- then split book production into Vantage (KJ's subtree) vs APEX Financial
-- (everyone else). Real hierarchy, no reparenting. Applied live via bot-sql.
update public.agents set is_manager = true
where id = '431dff0d-7c82-4134-a85e-457e5226fc7f' and is_manager is distinct from true;

create or replace view public.v_imo_by_agency as
with vantage_ids as (
  select '431dff0d-7c82-4134-a85e-457e5226fc7f'::uuid as id
  union select id from agents where manager_id = '431dff0d-7c82-4134-a85e-457e5226fc7f'
),
scoped as (
  select b.annual_premium, b.posted_date,
    (a.id in (select id from vantage_ids)) as is_vantage
  from agentlink_book b join agents a on a.id = b.agent_id
  where not coalesce(b.is_dead, false)
)
select
  case when is_vantage then 'Vantage Financial' else 'APEX Financial' end as agency,
  (not is_vantage) as is_primary,
  count(*)::int as policies,
  round(sum(annual_premium)::numeric, 0) as alp,
  round(coalesce(sum(annual_premium) filter (where posted_date >= (date_trunc('month', (now() at time zone 'America/Phoenix')::date))), 0)::numeric, 0) as alp_mtd
from scoped group by 1, 2 order by alp desc;
grant select on public.v_imo_by_agency to authenticated, anon;
