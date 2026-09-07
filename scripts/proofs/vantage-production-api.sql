-- Run in the same transaction as the migration, then ROLLBACK.
-- These assertions exercise real view dependencies without persisting fixtures.
create temporary table vantage_canonical_before as select count(*) as n from public.v_production_canonical;
create temporary table vantage_apex_before as
select count(*) as n, sum(annual_premium) as alp from public.v_production_unified
where public.fn_agent_subagency(agent_id) is distinct from 'vantage';

insert into public.production_external_daily_snapshots
  (agency_name,business_date,reported_policies,reported_alp,source,external_ref,metadata)
values ('Vantage Financial','2026-09-03',2,4044.72,'agentcloud_production_api','test-only',
  '{"verified":true,"organization_id":"00000000-0000-0000-0000-000000000001"}')
on conflict (agency_name,business_date,source) do update set
  reported_policies=2,reported_alp=4044.72,metadata=excluded.metadata;

do $$ declare n integer; alp numeric; begin
  select count(*),sum(annual_premium) into n,alp from public.v_production_unified
    where posted_date='2026-09-03' and public.fn_agent_subagency(agent_id)='vantage';
  if n<>2 or alp<>4044.72 then raise exception 'API rollup mismatch: % %',n,alp; end if;
  if exists(select 1 from public.v_production_unified where posted_date='2026-09-03'
    and public.fn_agent_subagency(agent_id)='vantage' and origin<>'external_daily_gap')
    then raise exception 'Duplicate legacy Vantage row'; end if;
  if (select b.n from vantage_canonical_before b)<>(select count(*) from public.v_production_canonical)
    then raise exception 'Canonical records changed'; end if;
  if exists(select * from vantage_apex_before except
    select count(*),sum(annual_premium) from public.v_production_unified
    where public.fn_agent_subagency(agent_id) is distinct from 'vantage')
    then raise exception 'APEX production changed'; end if;
  if has_table_privilege('anon','public.production_external_daily_snapshots','select')
    then raise exception 'Anonymous production access'; end if;
end $$;

-- A provider correction to zero must also supersede stale Discord totals.
update public.production_external_daily_snapshots set reported_alp=0,reported_policies=0
where agency_name='Vantage Financial' and business_date='2026-09-03' and source='agentcloud_production_api';
do $$ begin
  if exists(select 1 from public.v_production_unified where posted_date='2026-09-03'
    and public.fn_agent_subagency(agent_id)='vantage') then raise exception 'Zero correction left stale production'; end if;
end $$;
