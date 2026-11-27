-- Schema metadata only. No application function or customer row is read.
with wanted_migrations(version) as (values
  ('20261127043000'), ('20261127044000'), ('20261127045000'), ('20261127050000')
), wanted_functions(signature, kind) as (values
  ('public.social_draft_review(bigint)', 'authenticated'),
  ('public.social_draft_review_set_status(bigint,text,text)', 'authenticated'),
  ('public.approve_social_draft(bigint,text)', 'authenticated'),
  ('public.social_draft_set_status(bigint,text,text)', 'authenticated'),
  ('public.content_queue_review_set_status(text,timestamp with time zone,text)', 'authenticated'),
  ('public.training_canonical_self_id()', 'authenticated'),
  ('public.training_progress_access()', 'authenticated'),
  ('public.submit_apex_deal(uuid,jsonb,uuid)', 'authenticated'),
  ('public.deal_coverage_review_queue()', 'authenticated'),
  ('public.decide_deal_coverage_review(uuid,text,text,integer)', 'authenticated'),
  ('public.resume_deal_coverage_review(uuid,integer)', 'authenticated'),
  ('public.deal_coverage_name(text,text)', 'private'),
  ('public.deal_coverage_phone(text)', 'private'),
  ('public.deal_coverage_payload_hash(jsonb,uuid)', 'private'),
  ('public.deal_coverage_candidates(uuid,date,text,text,uuid)', 'private'),
  ('public.deal_coverage_manager_access(uuid,uuid)', 'private'),
  ('public.deal_coverage_can_decide(uuid,uuid,uuid[])', 'private'),
  ('public.deal_coverage_requires_admin(uuid,uuid[])', 'private'),
  ('public.enforce_deal_coverage_review()', 'private'),
  ('public.submit_apex_deal_before_coverage_review(uuid,jsonb,uuid)', 'private'),
  ('public.submit_apex_deal_ledger_impl(uuid,jsonb,uuid)', 'private')
), functions as (
  select w.signature, w.kind, p.oid is not null as present,
    coalesce(p.prosecdef, false) as security_definer,
    coalesce(has_function_privilege('authenticated', p.oid, 'EXECUTE'), false) as authenticated_execute,
    coalesce(has_function_privilege('anon', p.oid, 'EXECUTE'), false) as anon_execute,
    coalesce(has_function_privilege('service_role', p.oid, 'EXECUTE'), false) as service_role_execute,
    exists(select 1 from aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) a
      where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_execute
  from wanted_functions w left join pg_proc p on p.oid = to_regprocedure(w.signature)
), wanted_tables(name) as (values ('deal_coverage_reviews'), ('deal_coverage_post_permits')),
tables as (
  select w.name, c.oid is not null as present, coalesce(c.relrowsecurity,false) as rls_enabled,
    exists(select 1 from (values ('anon'), ('authenticated'), ('service_role')) roles(name),
      (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) privileges(name)
      where has_table_privilege(roles.name,c.oid,privileges.name)) as api_role_has_privilege,
    exists(select 1 from aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a
      where a.grantee=0) as public_has_privilege
  from wanted_tables w left join pg_class c on c.oid=to_regclass('public.' || w.name)
), wanted_policies(name, command) as (values
  ('Agents can view canonical training progress','r'),
  ('Agents can insert canonical training progress','a'),
  ('Agents can update canonical training progress','w')
), policies as (
  select w.name, p.oid is not null as present,
    coalesce(p.polcmd::text=w.command,false) as command_matches,
    coalesce((select oid from pg_roles where rolname='authenticated')=any(p.polroles),false) as authenticated_role,
    coalesce(position('training_canonical_self_id' in
      coalesce(pg_get_expr(p.polqual,p.polrelid),'') || ' ' || coalesce(pg_get_expr(p.polwithcheck,p.polrelid),''))>0,false) as canonical_identity_guard
  from wanted_policies w left join pg_policy p
    on p.polrelid=to_regclass('public.onboarding_progress') and p.polname=w.name
), wanted_guards(name, relation, function_signature, insert_required) as (values
  ('deal_coverage','public.deals','public.enforce_deal_coverage_review()',true),
  ('social_approval','public.social_bot_drafts','public.trg_social_draft_approval_binding()',true),
  ('content_approval','public.content_queue','public.content_queue_guard_update()',false)
), guards as (
  select w.name, exists(select 1 from pg_trigger t
    where t.tgrelid=to_regclass(w.relation) and t.tgfoid=to_regprocedure(w.function_signature)
      and not t.tgisinternal and t.tgenabled in ('O','A') and (t.tgtype::integer & 2)=2
      and (t.tgtype::integer & 16)=16
      and (not w.insert_required or (t.tgtype::integer & 4)=4)) as required_events_enabled
  from wanted_guards w
), recovery as (
  select coalesce(i.indisunique and i.indisvalid,false) as open_case_index_valid,
    pg_get_expr(i.indpred,i.indrelid) as open_case_index_predicate,
    not exists(select 1 from pg_constraint c
      where c.conrelid=to_regclass('public.inactive_agent_queue')
        and c.conname='inactive_agent_queue_agent_id_status_key') as old_constraint_removed
  from (select 1) seed left join pg_index i
    on i.indexrelid=to_regclass('public.inactive_agent_queue_one_open_per_agent')
)
select jsonb_build_object(
  'application_functions_executed',false,
  'customer_rows_read',false,
  'mutations_executed',false,
  'migrations',(select jsonb_agg(jsonb_build_object('version',w.version,'recorded',m.version is not null) order by w.version)
    from wanted_migrations w left join supabase_migrations.schema_migrations m on m.version=w.version),
  'functions',(select jsonb_agg(to_jsonb(f) order by f.signature) from functions f),
  'function_access_pass',(select bool_and(present and not anon_execute and not public_execute
    and authenticated_execute=(kind='authenticated') and (kind<>'private' or not service_role_execute)) from functions),
  'tables',(select jsonb_agg(to_jsonb(t) order by t.name) from tables t),
  'table_access_pass',(select bool_and(present and rls_enabled and not api_role_has_privilege and not public_has_privilege) from tables),
  'policies',(select jsonb_agg(to_jsonb(p) order by p.name) from policies p),
  'training_policy_pass',(select bool_and(present and command_matches and authenticated_role and canonical_identity_guard) from policies),
  'guards',(select jsonb_agg(to_jsonb(g) order by g.name) from guards g),
  'guards_pass',(select bool_and(required_events_enabled) from guards),
  'recovery',(select to_jsonb(r) from recovery r)
) as release_contracts
