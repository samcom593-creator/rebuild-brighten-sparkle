-- Exact schema fingerprints only. No application functions, customer rows or mutations.
with wanted_functions(signature) as (values
  ('public.deal_coverage_name(text,text)'),
  ('public.deal_coverage_phone(text)'),
  ('public.deal_coverage_payload_hash(jsonb,uuid)'),
  ('public.deal_coverage_candidates(uuid,date,text,text,uuid)'),
  ('public.deal_coverage_manager_access(uuid,uuid)'),
  ('public.deal_coverage_can_decide(uuid,uuid,uuid[])'),
  ('public.deal_coverage_requires_admin(uuid,uuid[])'),
  ('public.enforce_deal_coverage_review()'),
  ('public.submit_apex_deal(uuid,jsonb,uuid)'),
  ('public.decide_deal_coverage_review(uuid,text,text,integer)'),
  ('public.resume_deal_coverage_review(uuid,integer)'),
  ('public.deal_coverage_review_queue()'),
  ('public.submit_apex_deal_before_coverage_review(uuid,jsonb,uuid)'),
  ('public.submit_apex_deal_ledger_impl(uuid,jsonb,uuid)')
), function_shapes as (
  select 'function'::text as kind,w.signature as name,p.oid is not null as present,
    case when p.oid is not null then encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') end as source_sha256,
    case when p.oid is not null then jsonb_build_object(
      'language',l.lanname,'owner',pg_get_userbyid(p.proowner),
      'return_type',format_type(p.prorettype,null),'returns_set',p.proretset,
      'argument_types',(select coalesce(jsonb_agg(format_type(a.typ,null) order by a.position),'[]'::jsonb)
        from unnest(p.proargtypes::oid[]) with ordinality a(typ,position)),
      'argument_names',to_jsonb(p.proargnames),'argument_modes',to_jsonb(p.proargmodes),
      'default_count',p.pronargdefaults,'defaults',pg_get_expr(p.proargdefaults,0),
      'security_definer',p.prosecdef,'strict',p.proisstrict,'leakproof',p.proleakproof,
      'volatility',p.provolatile,'parallel',p.proparallel,'function_kind',p.prokind,
      'configuration',to_jsonb(p.proconfig)) end as shape
  from wanted_functions w left join pg_proc p on p.oid=to_regprocedure(w.signature)
  left join pg_language l on l.oid=p.prolang
), wanted_tables(name) as (values ('deal_coverage_reviews'),('deal_coverage_post_permits')),
table_shapes as (
  select 'table'::text as kind,'public.'||w.name as name,c.oid is not null as present,null::text as source_sha256,
    case when c.oid is not null then jsonb_build_object(
      'kind',c.relkind,'persistence',c.relpersistence,'owner',pg_get_userbyid(c.relowner),
      'rls_enabled',c.relrowsecurity,'rls_forced',c.relforcerowsecurity,
      'columns',(select coalesce(jsonb_agg(jsonb_build_object(
        'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'not_null',a.attnotnull,
        'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated,
        'collation',co.collname) order by a.attnum),'[]'::jsonb)
        from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
        left join pg_collation co on co.oid=a.attcollation
        where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),
      'constraints',(select coalesce(jsonb_agg(jsonb_build_object(
        'name',k.conname,'type',k.contype,'validated',k.convalidated,
        'deferrable',k.condeferrable,'initially_deferred',k.condeferred,'no_inherit',k.connoinherit,
        'columns',(select coalesce(jsonb_agg(a.attname order by v.position),'[]'::jsonb)
          from unnest(k.conkey) with ordinality v(num,position)
          join pg_attribute a on a.attrelid=k.conrelid and a.attnum=v.num),
        'referenced_relation',case when k.confrelid<>0 then (select n.nspname||'.'||r.relname
          from pg_class r join pg_namespace n on n.oid=r.relnamespace where r.oid=k.confrelid) end,
        'referenced_columns',(select coalesce(jsonb_agg(a.attname order by v.position),'[]'::jsonb)
          from unnest(k.confkey) with ordinality v(num,position)
          join pg_attribute a on a.attrelid=k.confrelid and a.attnum=v.num),
        'foreign_match',k.confmatchtype,'foreign_delete',k.confdeltype,'foreign_update',k.confupdtype,
        'check_expression',pg_get_expr(k.conbin,k.conrelid)) order by k.conname),'[]'::jsonb)
        from pg_constraint k where k.conrelid=c.oid and k.contype<>'n'),
      'policy_count',(select count(*) from pg_policy p where p.polrelid=c.oid),
      'user_trigger_count',(select count(*) from pg_trigger t where t.tgrelid=c.oid and not t.tgisinternal),
      'rule_count',(select count(*) from pg_rewrite r where r.ev_class=c.oid)) end as shape
  from wanted_tables w left join pg_class c on c.oid=to_regclass('public.'||w.name)
), wanted_indexes(name) as (values
  ('deal_coverage_reviews_pkey'),('deal_coverage_reviews_owner_user_id_idempotency_key_key'),
  ('deal_coverage_reviews_work_idx'),('deal_coverage_post_permits_pkey'),('deals_coverage_identity_idx')
), index_shapes as (
  select 'index'::text as kind,'public.'||w.name as name,i.indexrelid is not null as present,null::text as source_sha256,
    case when i.indexrelid is not null then jsonb_build_object(
      'relation',tn.nspname||'.'||t.relname,'method',am.amname,'unique',i.indisunique,'primary',i.indisprimary,
      'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive,'immediate',i.indimmediate,
      'key_count',i.indnkeyatts,'attribute_count',i.indnatts,'nulls_not_distinct',i.indnullsnotdistinct,
      'keys',(select coalesce(jsonb_agg(a.attname order by v.position),'[]'::jsonb)
        from unnest(i.indkey::smallint[]) with ordinality v(num,position)
        left join pg_attribute a on a.attrelid=i.indrelid and a.attnum=v.num),
      'options',to_jsonb(i.indoption::smallint[]),
      'operator_classes',(select coalesce(jsonb_agg(n.nspname||'.'||o.opcname order by v.position),'[]'::jsonb)
        from unnest(i.indclass::oid[]) with ordinality v(num,position)
        join pg_opclass o on o.oid=v.num join pg_namespace n on n.oid=o.opcnamespace),
      'expressions',pg_get_expr(i.indexprs,i.indrelid),'predicate',pg_get_expr(i.indpred,i.indrelid)) end as shape
  from wanted_indexes w left join pg_index i on i.indexrelid=to_regclass('public.'||w.name)
  left join pg_class c on c.oid=i.indexrelid left join pg_am am on am.oid=c.relam
  left join pg_class t on t.oid=i.indrelid left join pg_namespace tn on tn.oid=t.relnamespace
), trigger_shapes as (
  select 'trigger'::text as kind,'public.deals.zz_deal_coverage_review_guard'::text as name,
    t.oid is not null as present,null::text as source_sha256,
    case when t.oid is not null then jsonb_build_object(
      'function',n.nspname||'.'||p.proname||'()','event_mask',t.tgtype,'enabled',t.tgenabled,
      'internal',t.tgisinternal,'deferrable',t.tgdeferrable,'initially_deferred',t.tginitdeferred,
      'columns',(select coalesce(jsonb_agg(a.attname order by a.attname),'[]'::jsonb)
        from unnest(t.tgattr::smallint[]) v(num) join pg_attribute a on a.attrelid=t.tgrelid and a.attnum=v.num),
      'argument_count',t.tgnargs,'arguments',encode(t.tgargs,'hex'),'condition',pg_get_expr(t.tgqual,t.tgrelid)) end as shape
  from (select 1) seed left join pg_trigger t on t.tgrelid=to_regclass('public.deals') and t.tgname='zz_deal_coverage_review_guard'
  left join pg_proc p on p.oid=t.tgfoid left join pg_namespace n on n.oid=p.pronamespace
), objects as (
  select * from function_shapes union all select * from table_shapes
  union all select * from index_shapes union all select * from trigger_shapes
)
select jsonb_build_object(
  'application_functions_executed',false,'customer_rows_read',false,'mutations_executed',false,
  'migration_version','20261127050000',
  'objects',(select jsonb_agg(jsonb_build_object('kind',o.kind,'name',o.name,'present',o.present,
    'source_sha256',o.source_sha256,'shape_sha256',case when o.shape is not null then encode(sha256(convert_to(o.shape::text,'UTF8')),'hex') end)
    order by o.kind,o.name) from objects o)
) as coverage_fingerprint
