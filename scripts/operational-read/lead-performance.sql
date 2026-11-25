-- Fixed catalog metadata only. Never invokes lead functions, reads lead rows,
-- changes authentication claims, or runs EXPLAIN ANALYZE against application data.
with contracts(name, signature) as (values
  ('lead_pool_counts', 'public.lead_pool_counts(text,jsonb)'),
  ('lead_pool_candidates', 'public.lead_pool_candidates(text,jsonb)'),
  ('lead_pool_filter_matches', 'public.lead_pool_filter_matches(text,integer,text,integer,jsonb,jsonb)'),
  ('lead_pool_candidates_for_phones', 'public.lead_pool_candidates_for_phones(text,jsonb,text[])'),
  ('lead_pool_static_filter_matches', 'public.lead_pool_static_filter_matches(text,integer,text,integer,jsonb)'),
  ('lead_pool_preview_candidates', 'public.lead_pool_preview_candidates(text,jsonb)'),
  ('lead_pool_assign', 'public.lead_pool_assign(text,jsonb,integer,uuid,text,text)'),
  ('sellable_pool', 'public.sellable_pool(text,jsonb)')
), functions as (
  select c.name, c.signature, p.oid, p.proconfig, p.prosecdef, p.provolatile, p.proacl, p.proowner
  from contracts c left join pg_catalog.pg_proc p on p.oid = to_regprocedure(c.signature)
), candidate_view as (
  select c.oid, c.relkind, c.reloptions, c.relacl, c.relowner
  from (select to_regclass('public.v_lead_pool_candidate_base')::oid as oid) t
  left join pg_catalog.pg_class c on c.oid=t.oid
)
select jsonb_build_object(
  'application_functions_executed', false,
  'lead_rows_read', false,
  'auth_claims_changed', false,
  'functions', (select jsonb_object_agg(f.name, jsonb_build_object(
    'signature', f.signature,
    'present', f.oid is not null,
    'definition', case when f.oid is not null then pg_get_functiondef(f.oid) end,
    'proconfig', f.proconfig,
    'security_definer', coalesce(f.prosecdef,false),
    'volatility', f.provolatile,
    'authenticated_execute', case when f.oid is not null then has_function_privilege('authenticated',f.oid,'EXECUTE') else false end,
    'anon_execute', case when f.oid is not null then has_function_privilege('anon',f.oid,'EXECUTE') else false end,
    'public_execute', case when f.oid is not null then exists (
      select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
      where a.grantee=0 and a.privilege_type='EXECUTE'
    ) else false end
  )) from functions f),
  'candidate_view', (select jsonb_build_object(
    'name','public.v_lead_pool_candidate_base',
    'present',v.oid is not null,
    'is_view',coalesce(v.relkind='v',false),
    'definition',case when v.relkind='v' then pg_get_viewdef(v.oid,true) end,
    'security_invoker',coalesce(v.reloptions @> array['security_invoker=true']::text[],false),
    'authenticated_select',case when v.oid is not null then has_table_privilege('authenticated',v.oid,'SELECT') else false end,
    'anon_select',case when v.oid is not null then has_table_privilege('anon',v.oid,'SELECT') else false end,
    'public_select',case when v.oid is not null then exists (
      select 1 from aclexplode(coalesce(v.relacl,acldefault('r',v.relowner))) a
      where a.grantee=0 and a.privilege_type='SELECT'
    ) else false end,
    'authenticated_any_privilege',case when v.oid is not null then has_table_privilege('authenticated',v.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') else false end,
    'anon_any_privilege',case when v.oid is not null then has_table_privilege('anon',v.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') else false end,
    'public_any_privilege',case when v.oid is not null then exists (
      select 1 from aclexplode(coalesce(v.relacl,acldefault('r',v.relowner))) a where a.grantee=0
    ) else false end
  ) from candidate_view v),
  'migration',jsonb_build_object('version','20261125110000','recorded',exists (
    select 1 from supabase_migrations.schema_migrations where version::text='20261125110000'
  )),
  'advanced_migration',jsonb_build_object('version','20261125130000','recorded',exists (
    select 1 from supabase_migrations.schema_migrations where version::text='20261125130000'
  )),
  'indexes', (select coalesce(jsonb_agg(jsonb_build_object(
    'table', i.tablename, 'name', i.indexname, 'definition', i.indexdef
  ) order by i.tablename, i.indexname), '[]'::jsonb)
  from pg_catalog.pg_indexes i
  where i.schemaname = 'public'
    and i.tablename in ('mat_lead_pool', 'lead_bundle_items', 'lead_bundle_events', 'lead_resale_ledger'))
) as lead_performance
