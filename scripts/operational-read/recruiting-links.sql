-- Fixed metadata for the two stale-link generators. No application function is
-- called, no person or application row is read, and no auth claim is changed.
with contracts(name,signature) as (values
  ('my_recruiting_link','public.my_recruiting_link()'),
  ('my_referral_status','public.my_referral_status()')
), functions as (
  select c.name,c.signature,p.oid,p.proconfig,p.prosecdef,p.provolatile,p.proacl,p.proowner
  from contracts c left join pg_catalog.pg_proc p on p.oid=to_regprocedure(c.signature)
)
select jsonb_build_object(
  'application_functions_executed',false,
  'identity_rows_read',false,
  'application_rows_read',false,
  'auth_claims_changed',false,
  'functions',(select jsonb_object_agg(f.name,jsonb_build_object(
    'signature',f.signature,'present',f.oid is not null,
    'definition',case when f.oid is not null then pg_get_functiondef(f.oid) end,
    'return_type',case when f.oid is not null then pg_get_function_result(f.oid) end,
    'proconfig',f.proconfig,'security_definer',coalesce(f.prosecdef,false),'volatility',f.provolatile,
    'authenticated_execute',case when f.oid is not null then has_function_privilege('authenticated',f.oid,'EXECUTE') else false end,
    'anon_execute',case when f.oid is not null then has_function_privilege('anon',f.oid,'EXECUTE') else false end,
    'public_execute',case when f.oid is not null then exists (
      select 1 from aclexplode(coalesce(f.proacl,acldefault('f',f.proowner))) a
      where a.grantee=0 and a.privilege_type='EXECUTE'
    ) else false end
  )) from functions f),
  'migration',jsonb_build_object('version','20261125140000','recorded',exists (
    select 1 from supabase_migrations.schema_migrations where version::text='20261125140000'
  ))
) as recruiting_links
