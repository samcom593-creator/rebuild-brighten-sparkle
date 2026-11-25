-- Fixed identity/task catalog preflight. No application function is executed,
-- no identity or task row is read, and no authentication claim is changed.
with contracts(name,signature) as (values
  ('current_agent_id','public.current_agent_id()'),
  ('fn_user_login_blocked','public.fn_user_login_blocked(uuid)'),
  ('fn_user_is_suspended','public.fn_user_is_suspended(uuid)'),
  ('fn_agent_is_suspended','public.fn_agent_is_suspended(uuid)'),
  ('personal_task_identity','public.personal_task_identity()'),
  ('personal_task_list','public.personal_task_list(uuid)'),
  ('personal_task_set_completed','public.personal_task_set_completed(uuid,uuid,boolean)'),
  ('personal_task_create','public.personal_task_create(uuid,text,text,date,text)')
), functions as (
  select c.name,c.signature,p.oid,p.proconfig,p.prosecdef,p.provolatile,p.proacl,p.proowner
  from contracts c left join pg_catalog.pg_proc p on p.oid=to_regprocedure(c.signature)
), tables as (
  select n.name,c.oid,c.relkind,c.relrowsecurity,c.relforcerowsecurity
  from (values ('agents'),('agent_tasks')) n(name)
  left join pg_catalog.pg_class c on c.oid=to_regclass('public.' || n.name)
), identity_columns as (
  select n.name,a.attnum,a.attrelid
  from (values ('id'),('user_id'),('canonical_agent_id'),('status'),('is_inactive'),('is_deactivated')) n(name)
  left join pg_catalog.pg_attribute a on a.attrelid=to_regclass('public.agents')
    and a.attname=n.name and a.attnum>0 and not a.attisdropped
), guards as (
  select t.oid,t.tgname,t.tgenabled,t.tgisinternal,t.tgtype,p.proname,p.prosecdef,
    p.provolatile,p.proconfig,p.oid as function_oid,n.nspname as function_schema
  from pg_catalog.pg_trigger t
  join pg_catalog.pg_proc p on p.oid=t.tgfoid
  join pg_catalog.pg_namespace n on n.oid=p.pronamespace
  where t.tgrelid=to_regclass('public.agents')
    and (t.tgtype::integer & 2)=2 and (t.tgtype::integer & 20)<>0
)
select jsonb_build_object(
  'application_functions_executed',false,
  'identity_rows_read',false,
  'task_rows_read',false,
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
  'tables',(select jsonb_agg(jsonb_build_object(
    'name',t.name,'present',t.oid is not null,'kind',t.relkind,
    'rls_enabled',coalesce(t.relrowsecurity,false),'rls_forced',coalesce(t.relforcerowsecurity,false),
    'authenticated_select',case when t.oid is not null then has_table_privilege('authenticated',t.oid,'SELECT') else false end,
    'authenticated_insert',case when t.oid is not null then has_table_privilege('authenticated',t.oid,'INSERT') else false end,
    'authenticated_update',case when t.oid is not null then has_table_privilege('authenticated',t.oid,'UPDATE') else false end,
    'authenticated_delete',case when t.oid is not null then has_table_privilege('authenticated',t.oid,'DELETE') else false end
  ) order by t.name) from tables t),
  'agents_update_columns',(select jsonb_agg(jsonb_build_object(
    'name',c.name,'present',c.attnum is not null,
    'authenticated_update',case when c.attnum is not null then has_column_privilege('authenticated',c.attrelid,c.attnum,'UPDATE') else false end
  ) order by c.name) from identity_columns c),
  'policies',(select coalesce(jsonb_agg(jsonb_build_object(
    'table',p.tablename,'name',p.policyname,'permissive',p.permissive,
    'roles',p.roles,'command',p.cmd,'using_expression',p.qual,'check_expression',p.with_check
  ) order by p.tablename,p.policyname),'[]'::jsonb)
  from pg_catalog.pg_policies p where p.schemaname='public' and p.tablename in ('agents','agent_tasks')),
  'agents_before_write_triggers',(select coalesce(jsonb_agg(jsonb_build_object(
    'name',g.tgname,'enabled',g.tgenabled,'internal',g.tgisinternal,
    'before_insert',(g.tgtype::integer & 4)=4,'before_update',(g.tgtype::integer & 16)=16,
    'definition',pg_get_triggerdef(g.oid,true),
    'function_schema',g.function_schema,'function_name',g.proname,
    'function_definition',pg_get_functiondef(g.function_oid),
    'security_definer',g.prosecdef,'volatility',g.provolatile,'proconfig',g.proconfig
  ) order by g.tgname),'[]'::jsonb) from guards g),
  'task_columns',(select coalesce(jsonb_agg(jsonb_build_object(
    'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,
    'default_expression',pg_get_expr(d.adbin,d.adrelid)
  ) order by a.attnum),'[]'::jsonb)
  from pg_catalog.pg_attribute a left join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
  where a.attrelid=to_regclass('public.agent_tasks') and a.attnum>0 and not a.attisdropped),
  'task_indexes',(select coalesce(jsonb_agg(jsonb_build_object(
    'name',i.indexname,'definition',i.indexdef
  ) order by i.indexname),'[]'::jsonb)
  from pg_catalog.pg_indexes i where i.schemaname='public' and i.tablename='agent_tasks'),
  'migration',jsonb_build_object('version','20261125120000','recorded',exists (
    select 1 from supabase_migrations.schema_migrations where version::text='20261125120000'
  ))
) as task_identity
