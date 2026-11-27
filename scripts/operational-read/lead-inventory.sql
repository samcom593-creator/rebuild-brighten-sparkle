-- Fixed aggregate and schema inspection. No lead identity, phone, contact, payload,
-- or free-form error data is selected or returned. No application RPC is executed.
with rm as (
  select count(*) as records,
    count(phone10) as dialable_records,
    count(distinct phone10) as unique_dialable_phones,
    min(pulled_at) as oldest_pull,
    max(pulled_at) as latest_pull,
    count(*) filter (where pulled_at >= now() - interval '24 hours') as records_pulled_last_24h
  from public.readymode_leads
), pools as (
  select source, count(*) as records, count(distinct phone10) as unique_phones
  from public.mat_lead_pool_slim group by source
), phc as (
  select p.oid, p.prosecdef, p.provolatile, p.proconfig, p.proacl, p.proowner,
    pg_get_functiondef(p.oid) as definition
  from pg_proc p where p.oid=to_regprocedure('public.phc_admin_leads()')
)
select jsonb_build_object(
  'application_functions_executed', false,
  'customer_rows_returned', false,
  'mutations_executed', false,
  'readymode', (select to_jsonb(rm) from rm),
  'pool_snapshot', (select jsonb_build_object('refreshed_at', refreshed_at, 'started_at', started_at,
    'rows', rows, 'duration_ms', duration_ms, 'has_error', last_error is not null, 'error_at', error_at)
    from public.lead_pool_snapshot_meta where id=true),
  'pools', (select coalesce(jsonb_agg(to_jsonb(pools) order by source), '[]'::jsonb) from pools),
  'policy_leads', (select count(*) from public.phc_leads where status <> 'spam'),
  'recruiting_applications', (select count(*) from public.applications),
  'migration_recorded', exists(select 1 from supabase_migrations.schema_migrations where version='20261127060000'),
  'phc_function', (select jsonb_build_object(
    'present', true, 'definition', definition,
    'security_definer', prosecdef, 'stable', provolatile='s',
    'public_search_path', proconfig @> array['search_path=public']::text[],
    'authenticated_execute', has_function_privilege('authenticated',oid,'EXECUTE'),
    'service_execute', has_function_privilege('service_role',oid,'EXECUTE'),
    'anon_execute', has_function_privilege('anon',oid,'EXECUTE'),
    'public_execute', exists(select 1 from aclexplode(coalesce(proacl,acldefault('f',proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE')
  ) from phc)
) as lead_inventory
