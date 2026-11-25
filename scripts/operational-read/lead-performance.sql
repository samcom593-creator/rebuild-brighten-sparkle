-- Fixed catalog metadata only. Never invokes lead functions, reads lead rows,
-- changes authentication claims, or runs EXPLAIN ANALYZE against application data.
with contracts(name, signature) as (values
  ('lead_pool_counts', 'public.lead_pool_counts(text,jsonb)'),
  ('lead_pool_candidates', 'public.lead_pool_candidates(text,jsonb)'),
  ('lead_pool_filter_matches', 'public.lead_pool_filter_matches(text,integer,text,integer,jsonb,jsonb)')
), functions as (
  select c.name, c.signature, p.oid, p.proconfig
  from contracts c left join pg_catalog.pg_proc p on p.oid = to_regprocedure(c.signature)
)
select jsonb_build_object(
  'application_functions_executed', false,
  'lead_rows_read', false,
  'auth_claims_changed', false,
  'functions', (select jsonb_object_agg(f.name, jsonb_build_object(
    'signature', f.signature,
    'present', f.oid is not null,
    'definition', case when f.oid is not null then pg_get_functiondef(f.oid) end,
    'proconfig', f.proconfig
  )) from functions f),
  'indexes', (select coalesce(jsonb_agg(jsonb_build_object(
    'table', i.tablename, 'name', i.indexname, 'definition', i.indexdef
  ) order by i.tablename, i.indexname), '[]'::jsonb)
  from pg_catalog.pg_indexes i
  where i.schemaname = 'public'
    and i.tablename in ('mat_lead_pool', 'lead_bundle_items', 'lead_bundle_events', 'lead_resale_ledger'))
) as lead_performance
