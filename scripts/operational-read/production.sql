-- Fixed status/cohort aggregates. The runner encrypts all results before logging.
with owner_canonical as (
  select distinct coalesce(canonical_agent_id,id) id from public.agents where user_id::text like '71826bba%'
), owner_ids as (
  select a.id from public.agents a join owner_canonical c on coalesce(a.canonical_agent_id,a.id)=c.id
), groups as (
  select carrier,status_raw,status_pre,status_bucket as bucket,count(*) as rows,
    count(*) filter(where site_deal_id is not null) as site_linked,
    count(*) filter(where agent_id is null) as unassigned,
    min(last_seen_on) as oldest,max(last_seen_on) as newest
  from public.carrier_book_policies group by 1,2,3,4
), owner_groups as (
  select carrier,status_raw,status_pre,status_bucket as bucket,count(*) as rows,
    count(*) filter(where site_deal_id is not null) as site_linked,
    count(*) filter(where agent_id is null) as unassigned,
    min(last_seen_on) as oldest,max(last_seen_on) as newest
  from public.carrier_book_policies where agent_id in (select id from owner_ids) group by 1,2,3,4
)
select jsonb_build_object(
  'carrier_book',coalesce((select jsonb_agg(to_jsonb(g) order by carrier,rows desc) from groups g),'[]'::jsonb),
  'owner_carrier_book',coalesce((select jsonb_agg(to_jsonb(g) order by carrier,rows desc) from owner_groups g),'[]'::jsonb),
  'owner_canonical_records',(select count(*) from owner_canonical),
  'ambiguous_site_links',(select count(*) from (select site_deal_id from public.carrier_book_policies where site_deal_id is not null group by 1 having count(*)>1) s),
  'future_production_rows',(select count(*) from public.mv_production_comp_truth where posted_date>(now() at time zone 'America/Phoenix')::date),
  'current_month_native_rows',(select count(*) from public.deals where posted_at >= date_trunc('month',now() at time zone 'America/Phoenix') at time zone 'America/Phoenix' and posted_at<now() and source::text in ('apex_native','apex')),
  'metric_snapshots_with_placement',(select count(*) from public.carrier_live_metrics where placement_rate is not null and snapshot_on=(select max(snapshot_on) from public.carrier_live_metrics))
) as production
