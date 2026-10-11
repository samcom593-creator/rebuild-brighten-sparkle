-- Behavioural proof for the manual portal tracker (migration 20261009180000).
-- One transaction that ends in ROLLBACK: synthetic managers, a VA, a plain agent, merged/deactivated/placeholder rows, a
-- self-service agent, an ambiguous login and 1,200 bulk agents are created, exercised under real role claims
-- (set local role authenticated + request.jwt.claims) and thrown away. No real person is read or changed by an assertion.
-- The runner substitutes the migration body at the two markers below, so the SAME file that ships is what is proven,
-- and a deliberately broken copy can be substituted to prove each test can fail.
-- Run:  python3 scripts/tests/run-contract-review.py     Expected: every row PASS.
begin;

create temp table results(n serial, test text, outcome text, expected text, pass boolean);
grant all on results to public;
grant usage on sequence results_n_seq to public;

-- bot-sql accepts exactly one row-returning statement, so every assertion and side effect lands in a discard table
create temp table discard_i(x int);
create temp table discard_j(x jsonb);
create or replace function pg_temp.chk(t text, o text, e text) returns int language sql as $$
  insert into results(test, outcome, expected, pass) values (t, o, e, o is not distinct from e);
  select 1
$$;

-- run an expression as a user; return its jsonb value, or {_err: sqlstate, _msg}
create or replace function pg_temp.j(uid uuid, expr text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    execute 'select to_jsonb(' || expr || ')' into r;
  exception when others then
    r := jsonb_build_object('_err', sqlstate, '_msg', sqlerrm);
  end;
  execute 'reset role';
  return r;
end $$;

create temp table acts(name text primary key, j jsonb);
create or replace function pg_temp.act(n text, uid uuid, expr text) returns int language sql as $$
  insert into acts(name, j) values (n, pg_temp.j(uid, expr)); select 1
$$;
create or replace function pg_temp.a(n text) returns jsonb language sql as $$ select j from acts where name = n $$;
create or replace function pg_temp.tf(b boolean) returns text language sql as $$ select case when b then 'yes' when not b then 'no' end $$;
create or replace function pg_temp.err(uid uuid, expr text) returns text language sql as $$
  select coalesce(pg_temp.j(uid, expr)->>'_err', 'allowed')
$$;

-- ── synthetic world ─────────────────────────────────────────────────────────────────────────────────────────
-- uAd admin, uA/uB managers, uV va, uP plain agent, uS self-service agent, uM ambiguous login (two agent rows), uN no agent.
insert into auth.users (id) values
  ('a0000000-0000-4000-8000-0000000000ad'), ('a0000000-0000-4000-8000-0000000000a1'), ('a0000000-0000-4000-8000-0000000000b1'),
  ('a0000000-0000-4000-8000-0000000000c1'), ('a0000000-0000-4000-8000-0000000000d1'), ('a0000000-0000-4000-8000-0000000000e1'),
  ('a0000000-0000-4000-8000-0000000000f1'), ('a0000000-0000-4000-8000-0000000000f2');
insert into public.user_roles (user_id, role) values
  ('a0000000-0000-4000-8000-0000000000ad', 'admin'),
  ('a0000000-0000-4000-8000-0000000000a1', 'manager'), ('a0000000-0000-4000-8000-0000000000b1', 'manager'),
  ('a0000000-0000-4000-8000-0000000000c1', 'va'), ('a0000000-0000-4000-8000-0000000000d1', 'agent')
  on conflict do nothing;  -- a signup trigger already gives every new auth user the 'agent' role
insert into public.agents (id, user_id, display_name, agent_code, status, license_status, created_at, manager_id) values
  ('b0000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-0000000000a1', 'ZZ SYN MgrA', 'ZZ-MA', 'active', 'licensed', now() - interval '200 days', null),
  ('b0000000-0000-4000-8000-0000000000b1', 'a0000000-0000-4000-8000-0000000000b1', 'ZZ SYN MgrB', 'ZZ-MB', 'active', 'licensed', now() - interval '200 days', null),
  ('b0000000-0000-4000-8000-0000000000d1', 'a0000000-0000-4000-8000-0000000000d1', 'ZZ SYN Plain', 'ZZ-PL', 'active', 'licensed', now() - interval '200 days', null),
  ('b0000000-0000-4000-8000-0000000000e1', 'a0000000-0000-4000-8000-0000000000e1', 'ZZ SYN Self',  'ZZ-SF', 'active', 'licensed', now() - interval '20 days', 'b0000000-0000-4000-8000-0000000000a1'),
  ('b0000000-0000-4000-8000-0000000000f1', 'a0000000-0000-4000-8000-0000000000f1', 'ZZ SYN Amb1',  'ZZ-AM1', 'active', 'licensed', now() - interval '20 days', null),
  ('b0000000-0000-4000-8000-0000000000f2', 'a0000000-0000-4000-8000-0000000000f1', 'ZZ SYN Amb2',  'ZZ-AM2', 'active', 'licensed', now() - interval '20 days', null);
insert into public.agents (id, display_name, agent_code, status, license_status, created_at, manager_id) values
  ('b1000000-0000-4000-8000-0000000000a1', 'ZZ SYN HireA1', 'ZZ-A1', 'active', 'licensed', now() - interval '6 days', 'b0000000-0000-4000-8000-0000000000a1'),
  ('b1000000-0000-4000-8000-0000000000b1', 'ZZ SYN HireB1', 'ZZ-B1', 'active', 'licensed', now() - interval '6 days', 'b0000000-0000-4000-8000-0000000000b1'),
  ('b1000000-0000-4000-8000-0000000000b2', 'ZZ SYN HireB2', 'ZZ-B2', 'active', 'licensed', now() - interval '6 days', 'b0000000-0000-4000-8000-0000000000b1');
-- rows that must NOT be in the review
insert into public.agents (id, display_name, agent_code, status, license_status, created_at, manager_id) values
  ('b2000000-0000-4000-8000-000000000001', 'ZZ SYN Deactivated', 'ZZ-X1', 'active', 'licensed', now() - interval '9 days', 'b0000000-0000-4000-8000-0000000000a1'),
  ('b2000000-0000-4000-8000-000000000002', 'ZZ SYN Inactive',    'ZZ-X2', 'active', 'licensed', now() - interval '9 days', 'b0000000-0000-4000-8000-0000000000a1'),
  ('b2000000-0000-4000-8000-000000000003', 'ZZ SYN Ghost',       'GHOST_ZZ', 'active', 'licensed', now() - interval '9 days', 'b0000000-0000-4000-8000-0000000000a1'),
  ('b2000000-0000-4000-8000-000000000004', 'ZZ SYN Pending',     'ZZ-X4', 'pending', 'licensed', now() - interval '9 days', 'b0000000-0000-4000-8000-0000000000a1'),
  ('b2000000-0000-4000-8000-000000000005', 'ZZ SYN Terminated',  'ZZ-X5', 'terminated', 'licensed', now() - interval '9 days', 'b0000000-0000-4000-8000-0000000000a1');
update public.agents set is_deactivated = true where id = 'b2000000-0000-4000-8000-000000000001';
update public.agents set is_inactive = true where id = 'b2000000-0000-4000-8000-000000000002';
-- a merged duplicate that points at HireA1 as its canonical row
insert into public.agents (id, display_name, agent_code, status, license_status, created_at, manager_id, canonical_agent_id) values
  ('b2000000-0000-4000-8000-000000000006', 'ZZ SYN HireA1 twin', 'ZZ-A1T', 'active', 'licensed', now() - interval '6 days', 'b0000000-0000-4000-8000-0000000000a1', 'b1000000-0000-4000-8000-0000000000a1');
-- 1,200 bulk agents, no manager, to prove the read is not capped at 1,000 rows
insert into public.agents (id, display_name, agent_code, status, license_status, created_at)
select ('b3000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, 'ZZ SYN Bulk ' || lpad(g::text, 4, '0'), 'ZZ-BK' || g, 'active', 'licensed', now() - interval '30 days'
from generate_series(1, 1200) g;
-- legacy checkoffs on HireA1: the old process thought this person was done with three steps
insert into public.agent_contract_checkoffs (agent_id, contract_key, checked_by) values
  ('b1000000-0000-4000-8000-0000000000a1', 'aflac', 'a0000000-0000-4000-8000-0000000000a1'),
  ('b1000000-0000-4000-8000-0000000000a1', 'ethos', 'a0000000-0000-4000-8000-0000000000a1'),
  ('b1000000-0000-4000-8000-0000000000a1', 'first_contract', 'a0000000-0000-4000-8000-0000000000a1');
-- a contact profile for the self-service agent, so there is something to prefill (no signup trigger creates one here)
insert into public.profiles (user_id, email, full_name, state) values ('a0000000-0000-4000-8000-0000000000e1', 'zz.sela@example.invalid', 'ZZ SYN Self', 'tx')
  on conflict (user_id) do update set email = excluded.email, full_name = excluded.full_name, state = excluded.state;

-- @@MIGRATION_UNDER_TEST@@

create or replace function pg_temp.try(stmt text) returns text language plpgsql as $$
begin execute stmt; return 'allowed'; exception when others then return sqlstate || ':' || sqlerrm; end $$;

-- ── 1. who is in the review ──────────────────────────────────────────────────────────────────────────────────

create temp table r_admin as select pg_temp.j('a0000000-0000-4000-8000-0000000000ad', 'public.contract_review_roster()') j;

insert into discard_i select pg_temp.chk('1 the review holds exactly the active, canonical, real people (not deactivated/inactive/ghost/pending/terminated/twin)',
  (select string_agg(a->>'display_name', ',' order by a->>'display_name') from r_admin, jsonb_array_elements(j->'agents') a where a->>'display_name' like 'ZZ SYN%' and a->>'display_name' not like 'ZZ SYN Bulk%'),
  'ZZ SYN Amb1,ZZ SYN Amb2,ZZ SYN HireA1,ZZ SYN HireB1,ZZ SYN HireB2,ZZ SYN MgrA,ZZ SYN MgrB,ZZ SYN Plain,ZZ SYN Self');

insert into discard_i select pg_temp.chk('2 the read reports ok, an as-of date and review version 1',
  (select concat(j->>'ok', '/', pg_temp.tf((j->>'as_of') ~ '^\d{4}-\d{2}-\d{2}$'), '/', j->>'version') from r_admin),
  'true/yes/1');

insert into discard_i select pg_temp.chk('3 the four circles are in order Combine, AFLAC, GTO, Ethos',
  (select string_agg(c->>'label', ',' order by (c->>'position')::int) from r_admin, jsonb_array_elements(j->'carriers') c),
  'Combine,AFLAC,GTO,Ethos');

insert into discard_i select pg_temp.chk('4 only a verified portal address is offered (AFLAC yes, others none) and unresolved mappings are visible',
  (select string_agg((c->>'key') || '=' || coalesce(c->>'portal_url', '-') || '/' || (c->>'mapped'), ' ' order by (c->>'position')::int) from r_admin, jsonb_array_elements(j->'carriers') c),
  'combine=-/false aflac=https://login.aflac.com//true gto=-/false ethos=-/true');

-- ── 2. every active person starts Unmarked, whatever the old process recorded ─────────────────────────────────

insert into discard_i select pg_temp.chk('5 every synthetic person starts with zero marks',
  (select count(*)::text from r_admin, jsonb_array_elements(j->'agents') a where a->>'display_name' like 'ZZ SYN%' and (a->>'marked_count')::int <> 0),
  '0');

insert into discard_i select pg_temp.chk('6 the person the OLD process called done is still Unmarked on all four circles',
  (select concat(a->>'marked_count', '/', coalesce(a->'marks'->>'combine', 'null'), '/', coalesce(a->'marks'->>'aflac', 'null'), '/', coalesce(a->'marks'->>'gto', 'null'), '/', coalesce(a->'marks'->>'ethos', 'null')) from r_admin, jsonb_array_elements(j->'agents') a where a->>'display_name' = 'ZZ SYN HireA1'),
  '0/null/null/null/null');

insert into discard_i select pg_temp.chk('7 the legacy checkoffs are preserved untouched',
  (select count(*)::text from public.agent_contract_checkoffs where agent_id = 'b1000000-0000-4000-8000-0000000000a1'),
  '3');

-- The counts are judged against the rows of the same read, not against an empty roster: real people are being marked
-- on the live system (Sam confirmed three agents on 2026-10-09), so "all_four = 0" would fail for a correct read.
-- needs_review is everyone short of all four (unmarked AND partial), which is what the Needs review filter shows.
insert into discard_i select pg_temp.chk('8 an unmarked person counts as ''needs review'', never as done or late: counts equal the rows'' marks',
  (select concat(
     pg_temp.tf((j->'counts'->>'needs_review')::int = (select count(*) from jsonb_array_elements(j->'agents') a where (a->>'marked_count')::int < 4)), '/',
     pg_temp.tf((j->'counts'->>'all_four')::int = (select count(*) from jsonb_array_elements(j->'agents') a where (a->>'marked_count')::int = 4)), '/',
     pg_temp.tf((j->'counts'->>'partial')::int = (select count(*) from jsonb_array_elements(j->'agents') a where (a->>'marked_count')::int between 1 and 3)), '/',
     pg_temp.tf((select count(*) from jsonb_array_elements(j->'agents') a where a->>'display_name' like 'ZZ SYN%' and a->>'display_name' not like 'ZZ SYN Bulk%' and (a->>'marked_count')::int = 0) = 9))
   from r_admin),
  'yes/yes/yes/yes');

-- ── 3. scope: who may read ───────────────────────────────────────────────────────────────────────────────────

insert into discard_i select pg_temp.chk('9 manager A reads only their own downline (and themself)',
  (select string_agg(a->>'display_name', ',' order by a->>'display_name') from jsonb_array_elements(pg_temp.j('a0000000-0000-4000-8000-0000000000a1', 'public.contract_review_roster()')->'agents') a where a->>'display_name' like 'ZZ SYN%'),
  'ZZ SYN HireA1,ZZ SYN MgrA,ZZ SYN Self');

insert into discard_i select pg_temp.chk('10 manager B reads only their own downline (and themself)',
  (select string_agg(a->>'display_name', ',' order by a->>'display_name') from jsonb_array_elements(pg_temp.j('a0000000-0000-4000-8000-0000000000b1', 'public.contract_review_roster()')->'agents') a where a->>'display_name' like 'ZZ SYN%'),
  'ZZ SYN HireB1,ZZ SYN HireB2,ZZ SYN MgrB');

insert into discard_i select pg_temp.chk('11 a VA reads everyone',
  (select count(*)::text from jsonb_array_elements(pg_temp.j('a0000000-0000-4000-8000-0000000000c1', 'public.contract_review_roster()')->'agents') a where a->>'display_name' like 'ZZ SYN%' and a->>'display_name' not like 'ZZ SYN Bulk%'),
  '9');

insert into discard_i select pg_temp.chk('12 a plain agent is refused, and a refusal is an error, not an empty list that reads as ''all unmarked''',
  pg_temp.err('a0000000-0000-4000-8000-0000000000d1', 'public.contract_review_roster()'),
  '42501');

insert into discard_i select pg_temp.chk('13 no anonymous access to any entry point, and no signed-in access to the internal helpers',
  concat(has_function_privilege('anon', 'public.contract_review_roster()', 'execute'), '/', has_function_privilege('anon', 'public.set_contract_review_mark(uuid,text,boolean,boolean)', 'execute'), '/', has_function_privilege('anon', 'public.save_contract_review_profile(uuid,text,text,text,text,text)', 'execute'), '/', has_function_privilege('authenticated', 'public.fn_contract_review_population()', 'execute'), '/', has_function_privilege('authenticated', 'public.fn_contract_review_save_profile(uuid,text,text,text,text,text,text,boolean)', 'execute')),
  'f/f/f/f/f');

insert into discard_i select pg_temp.chk('14 the tables cannot be read or written directly by a signed-in user',
  concat(has_table_privilege('authenticated', 'public.contract_review_marks', 'select'), '/', has_table_privilege('authenticated', 'public.contract_review_marks', 'insert'), '/', has_table_privilege('authenticated', 'public.agent_contract_profile', 'select'), '/', has_table_privilege('authenticated', 'public.contract_review_events', 'insert')),
  'f/f/f/f');

-- ── 4. marks: independent, undoable, audited ─────────────────────────────────────────────────────────────────

insert into discard_i select pg_temp.act('m15', 'a0000000-0000-4000-8000-0000000000ad', $$public.set_contract_review_mark('b1000000-0000-4000-8000-0000000000a1','combine',true)$$);

insert into discard_i select pg_temp.chk('15 admin marks Combine for HireA1: ok, changed, with a timestamp, and exactly one mark row exists',
  (select concat(pg_temp.a('m15')->>'ok', '/', pg_temp.a('m15')->>'changed', '/', pg_temp.tf((pg_temp.a('m15')->>'confirmed_at') is not null), '/', (select count(*) from public.contract_review_marks where agent_id = 'b1000000-0000-4000-8000-0000000000a1' and carrier_key = 'combine'))),
  'true/true/yes/1');

insert into discard_i select pg_temp.chk('16 marking one circle leaves the other three Unmarked',
  (select concat(a->>'marked_count', '/', pg_temp.tf((a->'marks'->>'combine') is not null), '/', coalesce(a->'marks'->>'aflac', 'null'), '/', coalesce(a->'marks'->>'gto', 'null'), '/', coalesce(a->'marks'->>'ethos', 'null')) from (select a from jsonb_array_elements(pg_temp.j('a0000000-0000-4000-8000-0000000000ad', 'public.contract_review_roster()')->'agents') a where a->>'display_name' = 'ZZ SYN HireA1') t(a)),
  '1/yes/null/null/null');

create temp table first_at as select confirmed_at from public.contract_review_marks where agent_id = 'b1000000-0000-4000-8000-0000000000a1' and carrier_key = 'combine';

insert into discard_i select pg_temp.act('m17', 'a0000000-0000-4000-8000-0000000000ad', $$public.set_contract_review_mark('b1000000-0000-4000-8000-0000000000a1','combine',true)$$);

insert into discard_i select pg_temp.chk('17 a repeat confirm keeps the ORIGINAL who/when and logs nothing twice',
  (select concat(pg_temp.a('m17')->>'changed', '/', pg_temp.tf((select confirmed_at = (select confirmed_at from first_at) from public.contract_review_marks where agent_id = 'b1000000-0000-4000-8000-0000000000a1' and carrier_key = 'combine')), '/', (select count(*) from public.contract_review_events where agent_id = 'b1000000-0000-4000-8000-0000000000a1' and event_type = 'marked' and carrier_key = 'combine'))),
  'false/yes/1');

insert into discard_i select pg_temp.act('m18', 'a0000000-0000-4000-8000-0000000000ad', $$public.set_contract_review_mark('b1000000-0000-4000-8000-0000000000a1','combine',false,false)$$);

insert into discard_i select pg_temp.chk('18 a stale screen (thinks Unmarked, is marked) gets a conflict carrying the truth, and the mark survives',
  (select concat(pg_temp.a('m18')->>'ok', '/', pg_temp.a('m18')->>'conflict', '/', pg_temp.a('m18')->>'confirmed', '/', (select count(*) from public.contract_review_marks where agent_id = 'b1000000-0000-4000-8000-0000000000a1' and carrier_key = 'combine'))),
  'false/true/true/1');

insert into discard_i select pg_temp.act('m20', 'a0000000-0000-4000-8000-0000000000ad', $$public.set_contract_review_mark('b1000000-0000-4000-8000-0000000000a1','combine',false,true)$$);

insert into discard_i select pg_temp.chk('20 clearing with the right expectation returns to Unmarked and is logged with the prior who/when',
  (select concat(pg_temp.a('m20')->>'ok', '/', pg_temp.a('m20')->>'changed', '/', (select count(*) from public.contract_review_marks where agent_id = 'b1000000-0000-4000-8000-0000000000a1' and carrier_key = 'combine'), '/', (select count(*) from public.contract_review_events where agent_id = 'b1000000-0000-4000-8000-0000000000a1' and event_type = 'cleared' and carrier_key = 'combine' and detail ? 'was_confirmed_at'))),
  'true/true/0/1');

insert into discard_i select pg_temp.act('m21', 'a0000000-0000-4000-8000-0000000000ad', $$public.set_contract_review_mark('b1000000-0000-4000-8000-0000000000a1','combine',false)$$);

insert into discard_i select pg_temp.chk('21 clearing something already Unmarked changes nothing and logs nothing',
  (select concat(pg_temp.a('m21')->>'changed', '/', (select count(*) from public.contract_review_events where agent_id = 'b1000000-0000-4000-8000-0000000000a1' and event_type = 'cleared'))),
  'false/1');

insert into discard_i select pg_temp.act('m22', 'a0000000-0000-4000-8000-0000000000ad', $$public.set_contract_review_mark('b1000000-0000-4000-8000-0000000000a1','combine',true,false)$$);

insert into discard_i select pg_temp.chk('22 Undo after a clear: marking again works and is a fresh audited mark',
  (select concat(pg_temp.a('m22')->>'changed', '/', (select count(*) from public.contract_review_events where agent_id = 'b1000000-0000-4000-8000-0000000000a1' and event_type = 'marked' and carrier_key = 'combine'), '/', (select count(*) from public.contract_review_marks where agent_id = 'b1000000-0000-4000-8000-0000000000a1' and carrier_key = 'combine'))),
  'true/2/1');

insert into discard_i select pg_temp.act('m23aflac', 'a0000000-0000-4000-8000-0000000000ad', $$public.set_contract_review_mark('b1000000-0000-4000-8000-0000000000a1','aflac',true)$$);

insert into discard_i select pg_temp.act('m23gto', 'a0000000-0000-4000-8000-0000000000ad', $$public.set_contract_review_mark('b1000000-0000-4000-8000-0000000000a1','gto',true)$$);

insert into discard_i select pg_temp.act('m23ethos', 'a0000000-0000-4000-8000-0000000000ad', $$public.set_contract_review_mark('b1000000-0000-4000-8000-0000000000a1','ethos',true)$$);

insert into discard_i select pg_temp.act('m23b', 'a0000000-0000-4000-8000-0000000000ad', $$public.set_contract_review_mark('b1000000-0000-4000-8000-0000000000a1','aflac',false)$$);

insert into discard_i select pg_temp.chk('23 the four circles are independent: all four marked, then one cleared, leaves exactly the other three',
  (select string_agg(carrier_key, ',' order by carrier_key) from public.contract_review_marks where agent_id = 'b1000000-0000-4000-8000-0000000000a1'),
  'combine,ethos,gto');

insert into discard_i select pg_temp.chk('24 the roster reports three of four marked, with all four circles present in the marks object',
  (select concat(a->>'marked_count', '/', (select count(*) from jsonb_object_keys(a->'marks')), '/', (select count(*) from jsonb_each(a->'marks') e where e.value <> 'null'::jsonb)) from (select a from jsonb_array_elements(pg_temp.j('a0000000-0000-4000-8000-0000000000ad', 'public.contract_review_roster()')->'agents') a where a->>'display_name' = 'ZZ SYN HireA1') t(a)),
  '3/4/3');

insert into discard_i select pg_temp.chk('25 the counts come from marks only: the synthetic partial person is counted as partial, and every count equals its rows',
  (select concat(
     pg_temp.tf((select (a->>'marked_count')::int between 1 and 3 from jsonb_array_elements(j->'agents') a where a->>'display_name' = 'ZZ SYN HireA1')), '/',
     pg_temp.tf((j->'counts'->>'partial')::int = (select count(*) from jsonb_array_elements(j->'agents') a where (a->>'marked_count')::int between 1 and 3)), '/',
     pg_temp.tf((j->'counts'->>'all_four')::int = (select count(*) from jsonb_array_elements(j->'agents') a where (a->>'marked_count')::int = 4)), '/',
     pg_temp.tf((j->'counts'->>'needs_review')::int = (select count(*) from jsonb_array_elements(j->'agents') a where (a->>'marked_count')::int < 4)))
   from (select pg_temp.j('a0000000-0000-4000-8000-0000000000ad', 'public.contract_review_roster()') j) x),
  'yes/yes/yes/yes');

-- ── 5. mark permissions ──────────────────────────────────────────────────────────────────────────────────────

insert into discard_i select pg_temp.chk('26 manager B cannot mark manager A''s hire',
  pg_temp.err('a0000000-0000-4000-8000-0000000000b1', $$public.set_contract_review_mark('b1000000-0000-4000-8000-0000000000a1','aflac',true)$$),
  '42501');

insert into discard_i select pg_temp.chk('27 a VA is read-only',
  pg_temp.err('a0000000-0000-4000-8000-0000000000c1', $$public.set_contract_review_mark('b1000000-0000-4000-8000-0000000000a1','aflac',true)$$),
  '42501');

insert into discard_i select pg_temp.chk('28 a plain agent cannot mark',
  pg_temp.err('a0000000-0000-4000-8000-0000000000d1', $$public.set_contract_review_mark('b0000000-0000-4000-8000-0000000000d1','aflac',true)$$),
  '42501');

insert into discard_i select pg_temp.act('m29', 'a0000000-0000-4000-8000-0000000000a1', $$public.set_contract_review_mark('b0000000-0000-4000-8000-0000000000e1','aflac',true)$$);

insert into discard_i select pg_temp.chk('29 manager A can mark their own downline; who and when are recorded and shown',
  (select concat(pg_temp.a('m29')->>'ok', '/', (select a->'marks'->'aflac'->>'by_name' from (select a from jsonb_array_elements(pg_temp.j('a0000000-0000-4000-8000-0000000000a1', 'public.contract_review_roster()')->'agents') a where a->>'display_name' = 'ZZ SYN Self') t(a)), '/', (select confirmed_by::text from public.contract_review_marks where agent_id = 'b0000000-0000-4000-8000-0000000000e1' and carrier_key = 'aflac'))),
  'true/ZZ SYN MgrA/a0000000-0000-4000-8000-0000000000a1');

insert into discard_i select pg_temp.chk('30 an unknown carrier is rejected',
  pg_temp.err('a0000000-0000-4000-8000-0000000000ad', $$public.set_contract_review_mark('b1000000-0000-4000-8000-0000000000a1','bogus',true)$$),
  '22023');

insert into discard_i select pg_temp.chk('31 a null state is rejected',
  pg_temp.err('a0000000-0000-4000-8000-0000000000ad', $$public.set_contract_review_mark('b1000000-0000-4000-8000-0000000000a1','aflac',null)$$),
  '22023');

insert into discard_i select pg_temp.chk('32 a person outside the review cannot be marked (deactivated / inactive / ghost / terminated)',
  concat(pg_temp.err('a0000000-0000-4000-8000-0000000000ad', $$public.set_contract_review_mark('b2000000-0000-4000-8000-000000000001','aflac',true)$$), '/', pg_temp.err('a0000000-0000-4000-8000-0000000000ad', $$public.set_contract_review_mark('b2000000-0000-4000-8000-000000000002','aflac',true)$$), '/', pg_temp.err('a0000000-0000-4000-8000-0000000000ad', $$public.set_contract_review_mark('b2000000-0000-4000-8000-000000000003','aflac',true)$$), '/', pg_temp.err('a0000000-0000-4000-8000-0000000000ad', $$public.set_contract_review_mark('b2000000-0000-4000-8000-000000000005','aflac',true)$$)),
  'P0002/P0002/P0002/P0002');

insert into discard_i select pg_temp.act('m33', 'a0000000-0000-4000-8000-0000000000ad', $$public.set_contract_review_mark('b2000000-0000-4000-8000-000000000006','aflac',true)$$);

insert into discard_i select pg_temp.chk('33 marking through a merged duplicate lands on the canonical person, never on the twin',
  (select concat(pg_temp.a('m33')->>'ok', '/', (select count(*) from public.contract_review_marks where agent_id = 'b2000000-0000-4000-8000-000000000006'), '/', (select count(*) from public.contract_review_marks where agent_id = 'b1000000-0000-4000-8000-0000000000a1' and carrier_key = 'aflac'))),
  'true/0/1');

-- ── 6. the audit trail ───────────────────────────────────────────────────────────────────────────────────────

insert into discard_i select pg_temp.chk('34 the audit trail cannot be edited or erased, even by the table owner',
  concat(left(pg_temp.try($$update public.contract_review_events set detail = '{}'::jsonb where id = (select min(id) from public.contract_review_events)$$), 5), '/', left(pg_temp.try($$delete from public.contract_review_events where id = (select min(id) from public.contract_review_events)$$), 5)),
  '42501/42501');

insert into discard_i select pg_temp.chk('35 the audit survives removing a person (no foreign key ties it to the agent row)',
  (select count(*)::text from pg_constraint where conrelid = 'public.contract_review_events'::regclass and contype = 'f'),
  '0');

insert into discard_i select pg_temp.chk('36 a manager sees audit rows only for their own downline (realtime scope); a plain agent sees none',
  concat(pg_temp.j('a0000000-0000-4000-8000-0000000000b1', $$(select count(*) from public.contract_review_events where agent_id = 'b1000000-0000-4000-8000-0000000000a1')$$), '/', pg_temp.tf((pg_temp.j('a0000000-0000-4000-8000-0000000000a1', $$(select count(*) from public.contract_review_events where agent_id = 'b1000000-0000-4000-8000-0000000000a1')$$))::text::int > 0), '/', pg_temp.j('a0000000-0000-4000-8000-0000000000d1', $$(select count(*) from public.contract_review_events)$$)),
  '0/yes/0');

insert into discard_i select pg_temp.chk('37 history for one person is readable by scope and refused outside it',
  concat(pg_temp.err('a0000000-0000-4000-8000-0000000000a1', $$public.contract_review_history('b1000000-0000-4000-8000-0000000000a1')$$), '/', pg_temp.err('a0000000-0000-4000-8000-0000000000b1', $$public.contract_review_history('b1000000-0000-4000-8000-0000000000a1')$$), '/', pg_temp.err('a0000000-0000-4000-8000-0000000000c1', $$public.contract_review_history('b1000000-0000-4000-8000-0000000000a1')$$)),
  'allowed/42501/allowed');

-- ── 7. placement level: ONE agent-wide value, unset is visibly unset ─────────────────────────────────────────

insert into discard_i select pg_temp.chk('38 an agent with no level reads as unset (null), never as 0',
  (select coalesce(a->>'level', 'null') from (select a from jsonb_array_elements(pg_temp.j('a0000000-0000-4000-8000-0000000000ad', 'public.contract_review_roster()')->'agents') a where a->>'display_name' = 'ZZ SYN HireA1') t(a)),
  'null');

insert into discard_i select pg_temp.act('l39', 'a0000000-0000-4000-8000-0000000000ad', $$public.set_review_placement_level('b1000000-0000-4000-8000-0000000000a1', 80, null, true)$$);

insert into discard_i select pg_temp.chk('39 admin sets 80: stored once, agent-wide, shown on the roster',
  (select concat(pg_temp.a('l39')->>'ok', '/', pg_temp.a('l39')->>'changed', '/', (select contract_pct::int from public.agent_contract_levels where agent_id = 'b1000000-0000-4000-8000-0000000000a1'), '/', (select a->'level'->>'pct' from (select a from jsonb_array_elements(pg_temp.j('a0000000-0000-4000-8000-0000000000ad', 'public.contract_review_roster()')->'agents') a where a->>'display_name' = 'ZZ SYN HireA1') t(a)))),
  'true/true/80/80');

insert into discard_i select pg_temp.act('l40', 'a0000000-0000-4000-8000-0000000000ad', $$public.set_review_placement_level('b1000000-0000-4000-8000-0000000000a1', 80, 80)$$);

insert into discard_i select pg_temp.chk('40 setting the same value again changes nothing and logs nothing new',
  (select concat(pg_temp.a('l40')->>'changed', '/', (select count(*) from public.contract_review_events where agent_id = 'b1000000-0000-4000-8000-0000000000a1' and event_type = 'level_set'))),
  'false/1');

insert into discard_i select pg_temp.act('l41a', 'a0000000-0000-4000-8000-0000000000ad', $$public.set_review_placement_level('b1000000-0000-4000-8000-0000000000a1', 90, 70)$$);

insert into discard_i select pg_temp.act('l41b', 'a0000000-0000-4000-8000-0000000000ad', $$public.set_review_placement_level('b1000000-0000-4000-8000-0000000000a1', 90, null, true)$$);

insert into discard_i select pg_temp.act('l41c', 'a0000000-0000-4000-8000-0000000000ad', $$public.set_review_placement_level('b1000000-0000-4000-8000-0000000000b1', 90, 50)$$);

insert into discard_i select pg_temp.chk('41 a stale screen is refused: wrong expected value / ''thought it was unset'' / ''expected a value but none''',
  concat(pg_temp.a('l41a')->>'conflict', '/', pg_temp.a('l41b')->>'conflict', '/', pg_temp.a('l41c')->>'conflict'),
  'true/true/true');

insert into discard_i select pg_temp.chk('42 …and none of those wrote anything',
  (select concat(contract_pct::int, '/', (select count(*) from public.agent_contract_levels where agent_id = 'b1000000-0000-4000-8000-0000000000b1')) from public.agent_contract_levels where agent_id = 'b1000000-0000-4000-8000-0000000000a1'),
  '80/0');

insert into discard_i select pg_temp.chk('43 an out-of-range level is refused',
  pg_temp.err('a0000000-0000-4000-8000-0000000000ad', $$public.set_review_placement_level('b1000000-0000-4000-8000-0000000000a1', 201)$$),
  'P0001');

insert into public.agent_contract_levels (agent_id, contract_pct, source) values ('b0000000-0000-4000-8000-0000000000a1', 100, 'admin_ui');

insert into discard_i select pg_temp.act('l44', 'a0000000-0000-4000-8000-0000000000a1', $$public.set_review_placement_level('b0000000-0000-4000-8000-0000000000e1', 60, null, true)$$);

insert into discard_i select pg_temp.chk('44 a manager''s level change goes through the EXISTING downline rules (not bypassed): a person outside the hierarchy snapshot is refused and nothing is written',
  (select concat(pg_temp.a('l44')->>'_err', '/', (select count(*) from public.agent_contract_levels where agent_id = 'b0000000-0000-4000-8000-0000000000e1'), '/', (select count(*) from public.contract_review_events where agent_id = 'b0000000-0000-4000-8000-0000000000e1' and event_type = 'level_set'))),
  '42501/0/0');

insert into discard_i select pg_temp.chk('45 …but not above their own level, not for another manager''s people, and not for themself',
  concat(pg_temp.err('a0000000-0000-4000-8000-0000000000a1', $$public.set_review_placement_level('b0000000-0000-4000-8000-0000000000e1', 120)$$), '/', pg_temp.err('a0000000-0000-4000-8000-0000000000b1', $$public.set_review_placement_level('b0000000-0000-4000-8000-0000000000e1', 50)$$), '/', pg_temp.err('a0000000-0000-4000-8000-0000000000a1', $$public.set_review_placement_level('b0000000-0000-4000-8000-0000000000a1', 50)$$)),
  '42501/42501/42501');

insert into discard_i select pg_temp.act('l47pre', 'a0000000-0000-4000-8000-0000000000ad', $$public.set_review_placement_level('b0000000-0000-4000-8000-0000000000e1', 60, null, true)$$);

insert into discard_i select pg_temp.chk('46 a VA cannot set a level',
  pg_temp.err('a0000000-0000-4000-8000-0000000000c1', $$public.set_review_placement_level('b1000000-0000-4000-8000-0000000000a1', 70)$$),
  '42501');

insert into discard_i select pg_temp.chk('47a clearing a level is admin-only: a manager is refused and the level stays',
  concat(pg_temp.err('a0000000-0000-4000-8000-0000000000a1', $$public.set_review_placement_level('b0000000-0000-4000-8000-0000000000e1', null, 60)$$), '/', (select count(*) from public.agent_contract_levels where agent_id = 'b0000000-0000-4000-8000-0000000000e1')),
  '42501/1');

insert into discard_i select pg_temp.act('l47', 'a0000000-0000-4000-8000-0000000000ad', $$public.set_review_placement_level('b0000000-0000-4000-8000-0000000000e1', null, 60)$$);

insert into discard_i select pg_temp.chk('47b …an admin can clear it: back to unset (not 0), logged',
  (select concat(pg_temp.a('l47')->>'ok', '/', (select count(*) from public.agent_contract_levels where agent_id = 'b0000000-0000-4000-8000-0000000000e1'), '/', (select count(*) from public.contract_review_events where agent_id = 'b0000000-0000-4000-8000-0000000000e1' and event_type = 'level_cleared'), '/', (select coalesce(a->>'level', 'null') from (select a from jsonb_array_elements(pg_temp.j('a0000000-0000-4000-8000-0000000000ad', 'public.contract_review_roster()')->'agents') a where a->>'display_name' = 'ZZ SYN Self') t(a)))),
  'true/0/1/null');

insert into discard_i select pg_temp.chk('48 a level cannot be set for someone outside the review',
  pg_temp.err('a0000000-0000-4000-8000-0000000000ad', $$public.set_review_placement_level('b2000000-0000-4000-8000-000000000002', 70)$$),
  'P0002');

insert into discard_i select pg_temp.chk('49 the level change is audited with from and to',
  (select concat(coalesce(detail->>'from', 'unset'), '>', detail->>'to') from public.contract_review_events where agent_id = 'b1000000-0000-4000-8000-0000000000a1' and event_type = 'level_set' order by id desc limit 1),
  'unset>80');

-- ── 8. the five intake fields ────────────────────────────────────────────────────────────────────────────────

insert into discard_i select pg_temp.act('i50', 'a0000000-0000-4000-8000-0000000000ad', $$public.save_contract_review_profile('b1000000-0000-4000-8000-0000000000a1', '0123456', ' Hanna ', 'Hire', 'Hanna.Hire@Example.invalid', 'az')$$);

insert into discard_i select pg_temp.chk('50 a full profile saves; the NPN keeps its exact text including a leading zero; names trimmed; state upper-case; the roster says complete',
  (select concat(pg_temp.a('i50')->>'ok', '/', (select nipr_number from public.agents where id = 'b1000000-0000-4000-8000-0000000000a1'), '/', (select first_name || '|' || resident_state from public.agent_contract_profile where agent_id = 'b1000000-0000-4000-8000-0000000000a1'), '/', (select a->'profile'->>'complete' from (select a from jsonb_array_elements(pg_temp.j('a0000000-0000-4000-8000-0000000000ad', 'public.contract_review_roster()')->'agents') a where a->>'display_name' = 'ZZ SYN HireA1') t(a)))),
  'true/0123456/Hanna|AZ/true');

insert into discard_i select pg_temp.act('i52a', 'a0000000-0000-4000-8000-0000000000ad', $$public.save_contract_review_profile('b1000000-0000-4000-8000-0000000000a1', 'ABC123', 'Hanna', 'Hire', 'hanna.hire@example.invalid', 'AZ')$$);

insert into discard_i select pg_temp.act('i52b', 'a0000000-0000-4000-8000-0000000000ad', $$public.save_contract_review_profile('b1000000-0000-4000-8000-0000000000a1', '1234', 'Hanna', 'Hire', 'hanna.hire@example.invalid', 'AZ')$$);

insert into discard_i select pg_temp.chk('51 an NPN that is not 5-10 digits is refused with its field named, and the stored NPN is untouched',
  (select concat(pg_temp.a('i52a')->>'field', '/', pg_temp.a('i52b')->>'ok', '/', (select nipr_number from public.agents where id = 'b1000000-0000-4000-8000-0000000000a1'))),
  'npn/false/0123456');

insert into discard_i select pg_temp.act('i53a', 'a0000000-0000-4000-8000-0000000000ad', $$public.save_contract_review_profile('b1000000-0000-4000-8000-0000000000a1', '0123456', 'Hanna', 'Hire', 'not-an-email', 'AZ')$$);

insert into discard_i select pg_temp.act('i53b', 'a0000000-0000-4000-8000-0000000000ad', $$public.save_contract_review_profile('b1000000-0000-4000-8000-0000000000a1', '0123456', 'Hanna', 'Hire', 'hanna.hire@example.invalid', 'ZZ')$$);

insert into discard_i select pg_temp.chk('52 a bad email and a bad state are refused with their field named',
  concat(pg_temp.a('i53a')->>'field', '/', pg_temp.a('i53b')->>'field'),
  'email/resident_state');

insert into discard_i select pg_temp.act('i54', 'a0000000-0000-4000-8000-0000000000ad', $$public.save_contract_review_profile('b1000000-0000-4000-8000-0000000000b1', '0123456', 'Bo', 'Hire', 'bo.hire@example.invalid', 'TX')$$);

insert into discard_i select pg_temp.chk('53 an NPN already on another person is a surfaced conflict naming them, never a merge, and nothing is saved',
  (select concat(pg_temp.a('i54')->>'ok', '/', pg_temp.a('i54')->>'conflict', '/', pg_temp.a('i54')->>'other_name', '/', (select count(*) from public.agent_contract_profile where agent_id = 'b1000000-0000-4000-8000-0000000000b1'), '/', (select coalesce(nipr_number, 'null') from public.agents where id = 'b1000000-0000-4000-8000-0000000000b1'))),
  'false/npn_in_use/ZZ SYN HireA1/0/null');

insert into discard_i select pg_temp.act('i55', 'a0000000-0000-4000-8000-0000000000ad', $$public.save_contract_review_profile('b1000000-0000-4000-8000-0000000000b1', '7654321', 'Bo', 'Hire', 'HANNA.HIRE@example.invalid', 'TX')$$);

insert into discard_i select pg_temp.chk('54 the same email on another person (any letter case) is a surfaced conflict, and nothing is saved',
  (select concat(pg_temp.a('i55')->>'ok', '/', pg_temp.a('i55')->>'conflict', '/', (select count(*) from public.agent_contract_profile where agent_id = 'b1000000-0000-4000-8000-0000000000b1'), '/', (select coalesce(nipr_number, 'null') from public.agents where id = 'b1000000-0000-4000-8000-0000000000b1'))),
  'false/email_in_use/0/null');

insert into discard_i select pg_temp.act('i56', 'a0000000-0000-4000-8000-0000000000ad', $$public.save_contract_review_profile('b1000000-0000-4000-8000-0000000000a1', '0123456', 'Hanna', 'Hire', 'hanna.hire@example.invalid', 'AZ')$$);

insert into discard_i select pg_temp.chk('55 re-saving a person''s own values is not a conflict with themself',
  pg_temp.a('i56')->>'ok',
  'true');

insert into discard_i select pg_temp.act('i57', 'a0000000-0000-4000-8000-0000000000ad', $$public.save_contract_review_profile('b1000000-0000-4000-8000-0000000000b2', '', 'Bea', null, null, null)$$);

insert into discard_i select pg_temp.chk('56 a partial save by staff is allowed and the roster says incomplete (not zero, not done)',
  (select concat(pg_temp.a('i57')->>'ok', '/', (select a->'profile'->>'complete' from (select a from jsonb_array_elements(pg_temp.j('a0000000-0000-4000-8000-0000000000ad', 'public.contract_review_roster()')->'agents') a where a->>'display_name' = 'ZZ SYN HireB2') t(a)), '/', (select first_name from public.agent_contract_profile where agent_id = 'b1000000-0000-4000-8000-0000000000b2'))),
  'true/false/Bea');

update public.agents set nipr_verified = true where id = 'b1000000-0000-4000-8000-0000000000a1';

insert into discard_i select pg_temp.act('i59', 'a0000000-0000-4000-8000-0000000000ad', $$public.save_contract_review_profile('b1000000-0000-4000-8000-0000000000a1', '0123456', 'Hanna', 'Hire', 'hanna.hire@example.invalid', 'AZ')$$);

insert into discard_i select pg_temp.chk('57 saving the same NPN keeps it verified',
  (select nipr_verified::text from public.agents where id = 'b1000000-0000-4000-8000-0000000000a1'),
  'true');

insert into discard_i select pg_temp.act('i60', 'a0000000-0000-4000-8000-0000000000ad', $$public.save_contract_review_profile('b1000000-0000-4000-8000-0000000000a1', '9988776', 'Hanna', 'Hire', 'hanna.hire@example.invalid', 'AZ')$$);

insert into discard_i select pg_temp.chk('58 changing the NPN clears the verified flag',
  (select concat(nipr_verified::text, '/', nipr_number) from public.agents where id = 'b1000000-0000-4000-8000-0000000000a1'),
  'false/9988776');

insert into discard_i select pg_temp.chk('59 intake permissions: manager B and a VA are refused for manager A''s hire; manager A is allowed',
  concat(pg_temp.err('a0000000-0000-4000-8000-0000000000b1', $$public.save_contract_review_profile('b1000000-0000-4000-8000-0000000000a1', '9988776', 'H', 'H', 'h@example.invalid', 'AZ')$$), '/', pg_temp.err('a0000000-0000-4000-8000-0000000000c1', $$public.save_contract_review_profile('b1000000-0000-4000-8000-0000000000a1', '9988776', 'H', 'H', 'h@example.invalid', 'AZ')$$), '/', pg_temp.err('a0000000-0000-4000-8000-0000000000a1', $$public.save_contract_review_profile('b1000000-0000-4000-8000-0000000000a1', '9988776', 'Hanna', 'Hire', 'hanna.hire@example.invalid', 'AZ')$$)),
  '42501/42501/allowed');

insert into discard_i select pg_temp.act('i62', 'a0000000-0000-4000-8000-0000000000ad', $$public.save_contract_review_profile('b2000000-0000-4000-8000-000000000006', '9988776', 'Hanna', 'Hire', 'hanna.hire@example.invalid', 'AZ')$$);

insert into discard_i select pg_temp.chk('60 saving through a merged duplicate lands on the canonical person, never on the twin',
  (select concat(pg_temp.a('i62')->>'ok', '/', (select count(*) from public.agent_contract_profile where agent_id = 'b2000000-0000-4000-8000-000000000006'))),
  'true/0');

insert into discard_i select pg_temp.chk('61 intake saves are audited with before and after',
  (select concat(pg_temp.tf(count(*) >= 4), '/', pg_temp.tf(bool_and(detail ? 'before' and detail ? 'after'))) from public.contract_review_events where agent_id = 'b1000000-0000-4000-8000-0000000000a1' and event_type = 'intake_saved'),
  'yes/yes');

-- ── 9. the person's own form ─────────────────────────────────────────────────────────────────────────────────

insert into discard_i select pg_temp.chk('62 the self-service save takes NO agent id: a person can only ever write to their own profile',
  pg_temp.tf(pg_get_function_identity_arguments('public.save_my_contracting_profile(text,text,text,text,text)'::regprocedure) !~* 'uuid'),
  'yes');

insert into discard_i select pg_temp.act('s65', 'a0000000-0000-4000-8000-0000000000e1', 'public.get_my_contracting_profile()');

insert into discard_i select pg_temp.chk('63 the form is prefilled from existing records and says nothing is saved yet',
  (select concat(j->>'ok', '/', j->>'first_name', '/', j->>'last_name', '/', j->>'email', '/', j->>'resident_state', '/', j->>'saved') from (select pg_temp.a('s65') j) x),
  'true/ZZ/SYN Self/zz.sela@example.invalid/TX/false');

insert into discard_i select pg_temp.act('s66', 'a0000000-0000-4000-8000-0000000000e1', $$public.save_my_contracting_profile('5544332', 'Sela', 'Synthetic', 'zz.sela@example.invalid', null)$$);

insert into discard_i select pg_temp.chk('64 submitting with a field missing is refused and saves nothing',
  (select concat(pg_temp.a('s66')->>'field', '/', (select count(*) from public.agent_contract_profile where agent_id = 'b0000000-0000-4000-8000-0000000000e1'), '/', (select coalesce(nipr_number, 'null') from public.agents where id = 'b0000000-0000-4000-8000-0000000000e1'))),
  'all/0/null');

insert into discard_i select pg_temp.act('s67', 'a0000000-0000-4000-8000-0000000000e1', $$public.save_my_contracting_profile('5544332', 'Sela', 'Synthetic', 'zz.sela@example.invalid', 'tx')$$);

insert into discard_i select pg_temp.chk('65 a complete submission lands on their own profile (source = self) and is NOT carrier contracting: no new marks appear',
  (select concat(pg_temp.a('s67')->>'ok', '/', (select source from public.agent_contract_profile where agent_id = 'b0000000-0000-4000-8000-0000000000e1'), '/', (select nipr_number from public.agents where id = 'b0000000-0000-4000-8000-0000000000e1'), '/', (select count(*) from public.contract_review_marks where agent_id = 'b0000000-0000-4000-8000-0000000000e1' and carrier_key <> 'aflac'))),
  'true/self/5544332/0');

insert into discard_i select pg_temp.act('s68a', 'a0000000-0000-4000-8000-0000000000f1', 'public.get_my_contracting_profile()');

insert into discard_i select pg_temp.act('s68b', 'a0000000-0000-4000-8000-0000000000f1', $$public.save_my_contracting_profile('1122334', 'A', 'B', 'amb@example.invalid', 'AZ')$$);

insert into discard_i select pg_temp.chk('66 a login linked to TWO agent profiles is refused, never guessed, and neither row is written',
  (select concat(pg_temp.a('s68a')->>'ok', '/', pg_temp.a('s68b')->>'ok', '/', (select count(*) from public.agent_contract_profile where agent_id in ('b0000000-0000-4000-8000-0000000000f1', 'b0000000-0000-4000-8000-0000000000f2')))),
  'false/false/0');

insert into discard_i select pg_temp.act('s69a', 'a0000000-0000-4000-8000-0000000000ad', 'public.get_my_contracting_profile()');

insert into discard_i select pg_temp.act('s69b', 'a0000000-0000-4000-8000-0000000000ad', $$public.save_my_contracting_profile('1122334', 'A', 'B', 'noagent@example.invalid', 'AZ')$$);

insert into discard_i select pg_temp.chk('67 a login with no agent profile is told so and nothing is created',
  concat(pg_temp.a('s69a')->>'ok', '/', pg_temp.a('s69b')->>'ok', '/', (select count(*) from public.agent_contract_profile where email = 'noagent@example.invalid')),
  'false/false/0');

insert into discard_i select pg_temp.chk('68 the self-service functions have no anonymous access',
  concat(has_function_privilege('anon', 'public.get_my_contracting_profile()', 'execute'), '/', has_function_privilege('anon', 'public.save_my_contracting_profile(text,text,text,text,text)', 'execute')),
  'f/f');

-- ── 10. scale: 1,200 extra people come back in ONE read, not a page capped at 1,000 ──────────────────────────

create temp table t0 as select clock_timestamp() t;

create temp table r_big as select pg_temp.j('a0000000-0000-4000-8000-0000000000ad', 'public.contract_review_roster()') j;

insert into discard_i select pg_temp.chk('72 all 1,200 bulk people are returned and the count matches the list (no 1,000-row truncation)',
  (select concat(pg_temp.tf((select count(*) from r_big, jsonb_array_elements(j->'agents') a where a->>'display_name' like 'ZZ SYN Bulk%') = 1200), '/', pg_temp.tf((j->'counts'->>'agents')::int = jsonb_array_length(j->'agents')), '/', j->>'ok') from r_big),
  'yes/yes/true');

insert into discard_i select pg_temp.chk('73 the full read takes under 5 seconds',
  pg_temp.tf(clock_timestamp() - (select t from t0) < interval '5 seconds'),
  'yes');

-- ── 11. a re-run of the migration (deploy, refresh, second apply) never resets anything ─────────────────────

create temp table before_rerun as select
  (select count(*) from public.contract_review_marks) marks,
  (select string_agg(agent_id || carrier_key || confirmed_at::text || coalesce(confirmed_by::text, ''), '|' order by agent_id, carrier_key) from public.contract_review_marks) mark_fp,
  (select count(*) from public.contract_review_events) events, (select started_at::text from public.contract_review_config) started,
  (select string_agg(agent_id || coalesce(first_name, '') || coalesce(email, ''), '|' order by agent_id) from public.agent_contract_profile) profile_fp,
  (select string_agg(agent_id || contract_pct::text, '|' order by agent_id) from public.agent_contract_levels) level_fp;

-- @@MIGRATION_RERUN@@

insert into discard_i select pg_temp.chk('69 after re-running the migration every mark (who, when), event, config, profile and level is exactly as it was',
  (select concat(
   pg_temp.tf((select marks from before_rerun) = (select count(*) from public.contract_review_marks)), '/',
   pg_temp.tf((select mark_fp from before_rerun) is not distinct from (select string_agg(agent_id || carrier_key || confirmed_at::text || coalesce(confirmed_by::text, ''), '|' order by agent_id, carrier_key) from public.contract_review_marks)), '/',
   pg_temp.tf((select events from before_rerun) = (select count(*) from public.contract_review_events)), '/',
   pg_temp.tf((select started from before_rerun) = (select started_at::text from public.contract_review_config)), '/',
   pg_temp.tf((select profile_fp from before_rerun) is not distinct from (select string_agg(agent_id || coalesce(first_name, '') || coalesce(email, ''), '|' order by agent_id) from public.agent_contract_profile)), '/',
   pg_temp.tf((select level_fp from before_rerun) is not distinct from (select string_agg(agent_id || contract_pct::text, '|' order by agent_id) from public.agent_contract_levels)))),
  'yes/yes/yes/yes/yes/yes');

insert into discard_i select pg_temp.chk('70 …the version is still 1, there are still exactly four circles, and the legacy checkoffs are still there',
  (select concat((select version from public.contract_review_config), '/', (select count(*) from public.contract_review_carriers), '/', (select count(*) from public.agent_contract_checkoffs where agent_id = 'b1000000-0000-4000-8000-0000000000a1'))),
  '1/4/3');

insert into discard_i select pg_temp.chk('71 …and a person nobody marked is STILL Unmarked after the re-run',
  (select concat(a->>'marked_count', '/', coalesce(a->'marks'->>'aflac', 'null')) from (select a from jsonb_array_elements(pg_temp.j('a0000000-0000-4000-8000-0000000000ad', 'public.contract_review_roster()')->'agents') a where a->>'display_name' = 'ZZ SYN HireB1') t(a)),
  '0/null');

select test, outcome, expected, case when pass then 'PASS' else 'FAIL' end verdict from results order by n;
rollback;
