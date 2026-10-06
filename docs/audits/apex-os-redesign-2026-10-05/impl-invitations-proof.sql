-- Rolled-back proof for supabase/migrations/20261006140000_invitation_lifecycle.sql.
-- Run as: BEGIN; <migration body>; <this file>; ROLLBACK;  (nothing persists)
-- Callers are simulated by setting request.jwt.claims; every write below is
-- discarded by the surrounding ROLLBACK. Synthetic recipients use example.com.
--
-- Fixtures (read-only real ids, chosen by measurement 2026-10-06):
--   admin    user 71826bba-5577-4810-a226-1f6f2ad5288a (agent 7c3c5581-…)
--   manager  user eeeba599-eadc-4bbc-bed0-2ebdbe8a0dcb (agent a60e70c5-…, resolved cap 85, 9 downline)
--   agent    user fb6f7538-4c79-4249-830e-9d78c25d6c29 (agent 0c922dfe-…, active, in manager's downline, not a manager)

create temp table proof (ord serial, step text, result text);
grant all on proof to authenticated;
grant all on proof_ord_seq to authenticated;

create function pg_temp.as_user(p_uid text) returns void language sql as $f$
  select set_config('request.jwt.claims', json_build_object('sub', p_uid, 'role', 'authenticated')::text, true);
$f$;
create function pg_temp.as_service() returns void language sql as $f$
  select set_config('request.jwt.claims', '{"role":"service_role"}', true);
$f$;
create function pg_temp.try(p_sql text) returns text language plpgsql as $f$
declare v jsonb;
begin
  execute p_sql into v;
  return coalesce(v::text, 'null');
exception when others then
  return 'ERR ' || sqlstate || ': ' || sqlerrm;
end;
$f$;
create function pg_temp.log(p_step text, p_result text) returns void language sql as $f$
  insert into proof (step, result) values (p_step, p_result);
$f$;

do $proof$
declare
  c_admin  text := '71826bba-5577-4810-a226-1f6f2ad5288a';
  c_mgr    text := 'eeeba599-eadc-4bbc-bed0-2ebdbe8a0dcb';
  c_agent  text := 'fb6f7538-4c79-4249-830e-9d78c25d6c29';
  a_mgr    uuid := 'a60e70c5-f2d4-4a3d-bcdb-0002327f8e3f';
  a_down   uuid := '0c922dfe-66fd-4560-8c77-bb4bcb89cc22';
  a_sam    uuid := '7c3c5581-3544-437f-bfe2-91391afb217d';
  v_ethos  uuid;
  r jsonb; r2 jsonb; i1 jsonb; i2 jsonb; i3 jsonb; i4 jsonb; i5 jsonb;
  claim1 jsonb; v_agent uuid; v_n int; v_txt text;
  v_recipient text := 'synthetic.invitee.proof@example.com';
begin
  select id into v_ethos from public.carriers where name = 'Ethos';
  perform pg_temp.log('fixture: approved comp levels', public.fn_invite_comp_levels()::text);
  perform pg_temp.log('fixture: sam outside manager downline',
    (not exists (select 1 from public.fn_hierarchy_first_hops(array[a_mgr]) h where h.member = a_sam))::text);

  -- ── Authority ────────────────────────────────────────────────────────────
  perform pg_temp.as_user(c_mgr);
  perform pg_temp.log('options as manager',
    pg_temp.try($q$select jsonb_build_object('is_admin', o->'is_admin', 'cap', o->'cap_pct', 'levels', o->'comp_levels',
      'roles', o->'roles', 'uplines', jsonb_array_length(o->'uplines')) from public.invitation_mint_options() o$q$));
  perform pg_temp.log('manager: agent invite under downline at approved 80% -> ok',
    pg_temp.try(format($q$select jsonb_build_object('status', r->'status', 'comp', r->'offered_comp_pct', 'agency', r->'agency_key')
      from public.create_invitation('hire','hired_licensed',%L,%L,'Synthetic Recipient',null,'licensed',80,'[]'::jsonb,168,'proof') r$q$,
      a_down, 'synthetic.a@example.com')));
  perform pg_temp.log('manager: agency_owner role -> refused',
    pg_temp.try(format($q$select public.create_invitation('hire','agency_owner',%L)$q$, a_down)));
  perform pg_temp.log('manager: upline outside downline -> refused',
    pg_temp.try(format($q$select public.create_invitation('hire','hired_unlicensed',%L)$q$, a_sam)));
  perform pg_temp.log('manager: unapproved 90% -> refused',
    pg_temp.try(format($q$select public.create_invitation('hire','hired_licensed',%L,null,null,null,'licensed',90)$q$, a_down)));
  perform pg_temp.log('manager: 105% (>100 and > own cap) -> refused',
    pg_temp.try(format($q$select public.create_invitation('hire','hired_licensed',%L,null,null,null,'licensed',105)$q$, a_down)));
  perform pg_temp.log('manager: carrier exception Ethos 75% -> ok, name resolved server-side',
    pg_temp.try(format($q$select r->'carrier_exceptions' from public.create_invitation('hire','hired_licensed',%L,null,null,null,'licensed',80,
      jsonb_build_array(jsonb_build_object('carrier_id',%L,'pct',75,'carrier_name','SPOOFED NAME'))) r$q$, a_down, v_ethos)));
  perform pg_temp.log('manager: unknown carrier exception -> refused',
    pg_temp.try(format($q$select public.create_invitation('hire','hired_licensed',%L,null,null,null,'licensed',80,
      jsonb_build_array(jsonb_build_object('carrier_id',%L,'pct',75)))$q$, a_down, gen_random_uuid())));
  perform pg_temp.log('manager: legacy generate_invite_token as hired_manager -> refused',
    pg_temp.try($q$select public.generate_invite_token('hire',168,'hired_manager',null,'{}'::jsonb,'proof')$q$));

  perform pg_temp.as_user(c_agent);
  perform pg_temp.log('plain agent: comp offer -> refused',
    pg_temp.try($q$select public.create_invitation('hire','hired_licensed',null,null,null,null,'licensed',60)$q$));
  perform pg_temp.log('plain agent: no-comp invite under self -> ok',
    pg_temp.try($q$select jsonb_build_object('status', r->'status', 'upline_is_self', (r->>'target_manager_id') = '0c922dfe-66fd-4560-8c77-bb4bcb89cc22') from public.create_invitation('hire','hired_unlicensed') r$q$));

  perform pg_temp.as_user(c_admin);
  perform pg_temp.log('admin: agency_owner at 125% under sam -> ok',
    pg_temp.try(format($q$select jsonb_build_object('status', r->'status', 'comp', r->'offered_comp_pct', 'role', r->'target_role') from public.create_invitation('hire','agency_owner',%L,null,null,null,'licensed',125) r$q$, a_sam)));

  -- ── Acceptance (consume-invite-token's SQL legs) ─────────────────────────
  i1 := public.create_invitation('hire','hired_licensed',a_down,v_recipient,'Synthetic Invitee',null,'licensed',80,'[]'::jsonb,168,'proof-accept');
  perform pg_temp.as_service();
  perform pg_temp.log('tampered token -> invite_invalid',
    pg_temp.try(format($q$select public.invitation_claim(%L, %L)$q$, (i1->>'token') || 'x', v_recipient)));
  perform pg_temp.log('fabricated token -> invite_invalid',
    pg_temp.try(format($q$select public.invitation_claim('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', %L)$q$, v_recipient)));
  perform pg_temp.log('wrong recipient -> recipient_mismatch',
    pg_temp.try(format($q$select public.invitation_claim(%L, 'someone.else@example.com')$q$, i1->>'token')));

  claim1 := public.invitation_claim(i1->>'token', upper(v_recipient));
  perform pg_temp.log('right recipient (case-insensitive) -> claimed', jsonb_build_object('ok', claim1->'ok', 'comp', claim1->'invitation'->'offered_comp_pct')::text);
  perform pg_temp.log('second concurrent claim -> invite_in_progress',
    pg_temp.try(format($q$select public.invitation_claim(%L, %L)$q$, i1->>'token', v_recipient)));

  -- The edge function's agent write, then the terms + completion legs.
  insert into public.agents (display_name, status, manager_id, invited_by_manager_id, license_status, onboarding_stage)
  values ('Synthetic Invite Proof', 'active', a_down, a_down, 'licensed', 'onboarding')
  returning id into v_agent;
  perform pg_temp.log('apply terms (offered comp -> agents.comp_percentage)',
    pg_temp.try(format($q$select public.invitation_apply_terms(%L, %L, %L)$q$, i1->>'id', claim1->>'claim_id', v_agent)));
  perform pg_temp.log('agent row after accept',
    (select jsonb_build_object('comp_percentage', comp_percentage, 'approval', comp_approval_status,
       'approved_by_is_inviter', comp_approved_by = c_admin::uuid, 'manager_is_target', manager_id = a_down)
       from public.agents where id = v_agent)::text);
  perform pg_temp.log('carrier-confirmed level untouched (no agent_contract_levels row)',
    (select count(*) from public.agent_contract_levels where agent_id = v_agent)::text);
  perform pg_temp.log('complete -> accepted, terms persisted',
    pg_temp.try(format($q$select jsonb_build_object('ok', r->'ok', 'offered', r->'terms'->'offered_comp_pct', 'upline', r->'terms'->'target_manager_id')
      from public.invitation_complete(%L, %L, %L, %L) r$q$, i1->>'id', claim1->>'claim_id', v_recipient, v_agent)));
  perform pg_temp.log('row status after accept',
    (select jsonb_build_object('status', public.fn_invitation_status(used_at, superseded_by, is_active, revoked_at, expires_at),
       'used_by_is_agent', used_by_agent_id = v_agent, 'accepted_email', accepted_email,
       'terms_comp', accepted_terms->'offered_comp_pct', 'lease_cleared', claimed_at is null)
       from public.invite_tokens where id = (i1->>'id')::uuid)::text);
  perform pg_temp.log('role trigger granted agent role? (no user on synthetic agent -> skipped safely)', 'n/a');

  perform pg_temp.log('reused token -> invite_already_used',
    pg_temp.try(format($q$select public.invitation_claim(%L, %L)$q$, i1->>'token', v_recipient)));
  perform pg_temp.log('replayed completion with the old claim -> invite_already_used',
    pg_temp.try(format($q$select public.invitation_complete(%L, %L, %L, %L)$q$, i1->>'id', claim1->>'claim_id', v_recipient, v_agent)));
  select count(*) into v_n from public.agents where display_name = 'Synthetic Invite Proof';
  perform pg_temp.log('double accept -> exactly one agent created', v_n::text);

  -- Expired
  perform pg_temp.as_user(c_admin);
  i2 := public.create_invitation('hire','hired_unlicensed',a_sam,null,null,null,null,null,'[]'::jsonb,24,'proof-expired');
  update public.invite_tokens set expires_at = now() - interval '1 minute' where id = (i2->>'id')::uuid;
  perform pg_temp.as_service();
  perform pg_temp.log('expired -> invite_expired',
    pg_temp.try(format($q$select public.invitation_claim(%L, 'x.y@example.com')$q$, i2->>'token')));
  perform pg_temp.log('expired prefill (anon view) -> invite_expired',
    pg_temp.try(format($q$select public.get_invite_token_prefill(%L)$q$, i2->>'token')));

  -- Revoked
  perform pg_temp.as_user(c_mgr);
  i3 := public.create_invitation('hire','hired_unlicensed',a_down,null,null,null,null,null,'[]'::jsonb,24,'proof-revoke');
  perform pg_temp.log('revoke by creator -> revoked', pg_temp.try(format($q$select public.revoke_invitation(%L)$q$, i3->>'id')));
  perform pg_temp.as_user(c_agent);
  perform pg_temp.log('revoke by unrelated agent -> refused', pg_temp.try(format($q$select public.revoke_invitation(%L)$q$, i3->>'id')));
  perform pg_temp.as_service();
  perform pg_temp.log('revoked -> invite_revoked',
    pg_temp.try(format($q$select public.invitation_claim(%L, 'x.y@example.com')$q$, i3->>'token')));
  perform pg_temp.as_user(c_admin);
  perform pg_temp.log('revoke an accepted invitation -> refused',
    pg_temp.try(format($q$select public.revoke_invitation(%L)$q$, i1->>'id')));

  -- Superseded (regenerate)
  perform pg_temp.as_user(c_mgr);
  i4 := public.create_invitation('hire','hired_licensed',a_down,'synthetic.regen@example.com','Synthetic Regen',null,'licensed',75,'[]'::jsonb,72,'proof-regen');
  i5 := public.regenerate_invitation((i4->>'id')::uuid);
  perform pg_temp.log('regenerate -> new pending link, old superseded',
    (select jsonb_build_object('new_status', i5->'status', 'old_status',
       public.fn_invitation_status(used_at, superseded_by, is_active, revoked_at, expires_at),
       'old_points_to_new', superseded_by = (i5->>'id')::uuid)
       from public.invite_tokens where id = (i4->>'id')::uuid)::text);
  perform pg_temp.log('regenerated terms carried over',
    (select jsonb_build_object('comp', offered_comp_pct, 'recipient', recipient_email, 'upline_is_target', target_manager_id = a_down)
       from public.invite_tokens where id = (i5->>'id')::uuid)::text);
  perform pg_temp.as_service();
  perform pg_temp.log('superseded token -> invite_superseded',
    pg_temp.try(format($q$select public.invitation_claim(%L, 'synthetic.regen@example.com')$q$, i4->>'token')));
  perform pg_temp.log('recipient prefill shows only their own offer (no token, no inviter comp)',
    pg_temp.try(format($q$select jsonb_build_object('offered_terms', p->'offered_terms', 'recipient', p->'recipient',
      'has_token_key', p ? 'token', 'has_cap_key', (p->'offered_terms') ? 'cap_pct') from public.get_invite_token_prefill(%L) p$q$, i5->>'token')));

  -- History / search
  perform pg_temp.as_user(c_mgr);
  perform pg_temp.log('manager list: active only by default, history searchable',
    pg_temp.try($q$select jsonb_build_object(
      'active_rows_all_pending', (select bool_and(e->>'status' = 'pending') from jsonb_array_elements(a->'rows') e),
      'counts', a->'counts',
      'history_finds_superseded', (select count(*) from jsonb_array_elements(h->'rows') e where e->>'status' = 'superseded' and e->>'notes' = 'proof-regen'),
      'rows_expose_token', (select bool_or(e ? 'token') from jsonb_array_elements(h->'rows') e))
      from public.list_invitations(false) a, public.list_invitations(true, 'proof-regen') h$q$));
  perform pg_temp.as_user(c_agent);
  perform pg_temp.log('plain agent sees only invitations they created',
    pg_temp.try($q$select jsonb_build_object('total', l->'counts'->'total') from public.list_invitations(true) l$q$));
  perform pg_temp.log('plain agent cannot copy someone else''s link',
    pg_temp.try(format($q$select public.invitation_link(%L)$q$, i5->>'id')));
end
$proof$;

-- Grants (who may call what)
insert into proof (step, result)
select 'grants', jsonb_build_object(
  'anon_claim', has_function_privilege('anon', 'public.invitation_claim(text,text)', 'execute'),
  'authenticated_claim', has_function_privilege('authenticated', 'public.invitation_claim(text,text)', 'execute'),
  'authenticated_complete', has_function_privilege('authenticated', 'public.invitation_complete(uuid,uuid,text,uuid,uuid,uuid,numeric)', 'execute'),
  'anon_create', has_function_privilege('anon', 'public.create_invitation(text,text,uuid,text,text,text,text,numeric,jsonb,integer,text)', 'execute'),
  'authenticated_create', has_function_privilege('authenticated', 'public.create_invitation(text,text,uuid,text,text,text,text,numeric,jsonb,integer,text)', 'execute'),
  'anon_prefill', has_function_privilege('anon', 'public.get_invite_token_prefill(text)', 'execute'),
  'authenticated_update_table', has_table_privilege('authenticated', 'public.invite_tokens', 'update'),
  'anon_select_table', has_table_privilege('anon', 'public.invite_tokens', 'select'))::text;

-- RLS as a real authenticated manager: only rows they created are readable.
select set_config('request.jwt.claims', json_build_object('sub', 'eeeba599-eadc-4bbc-bed0-2ebdbe8a0dcb', 'role', 'authenticated')::text, true);
set local role authenticated;
insert into proof (step, result)
select 'RLS: manager reads only own invite_tokens rows',
       jsonb_build_object('visible', count(*), 'foreign', count(*) filter (where created_by_user_id <> 'eeeba599-eadc-4bbc-bed0-2ebdbe8a0dcb'))::text
  from public.invite_tokens;
reset role;

select string_agg(lpad(ord::text, 2, '0') || ' ' || step || ' => ' || result, E'\n' order by ord) as proof from proof;
