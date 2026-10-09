-- Behavioural proof for My Team contracting follow-up (migration 20261009140000).
-- Everything runs inside ONE transaction that ends in ROLLBACK: synthetic managers, hires, a duplicate and 1,200 extra
-- people are created, exercised under real role claims (set local role authenticated + request.jwt.claims), and thrown away.
-- No real person is read for the assertions below and no real checkoff is touched.
-- Run:  python3 scripts/tests/run-team-contracting.py     Expected: every row PASS.
begin;

create temp table results(n serial, test text, outcome text, expected text, pass boolean);
create temp table discard(x int);
grant all on results to public;
grant all on discard to public;

-- run SQL as a given user and capture sqlstate/message instead of aborting
create or replace function pg_temp.as_user(uid uuid, stmt text, out ok boolean, out msg text, out state text)
language plpgsql as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin
    execute stmt;
    ok := true; msg := null; state := null;
  exception when others then
    ok := false; msg := sqlerrm; state := sqlstate;
  end;
  execute 'reset role';
end $$;

create or replace function pg_temp.status_as(uid uuid) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  r := public.team_contracting_status();
  execute 'reset role';
  return r;
end $$;

-- ── synthetic world ─────────────────────────────────────────────────────────────────────────────────────────
-- uA/uB managers, uV va, uP plain agent. mgrA has hireA1, subA(manager) -> hireA2. mgrB has hireB1.
insert into auth.users (id) values
  ('a0000000-0000-4000-8000-0000000000a1'), ('a0000000-0000-4000-8000-0000000000b1'),
  ('a0000000-0000-4000-8000-0000000000c1'), ('a0000000-0000-4000-8000-0000000000d1');
insert into public.user_roles (user_id, role) values
  ('a0000000-0000-4000-8000-0000000000a1', 'manager'), ('a0000000-0000-4000-8000-0000000000b1', 'manager'),
  ('a0000000-0000-4000-8000-0000000000c1', 'va'), ('a0000000-0000-4000-8000-0000000000d1', 'agent')
  on conflict do nothing;  -- a signup trigger already gives every new auth user the 'agent' role
insert into public.agents (id, user_id, display_name, agent_code, status, license_status, created_at, manager_id) values
  ('b0000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-0000000000a1', 'ZZ SYN MgrA', 'ZZ-MA', 'active', 'licensed', now() - interval '200 days', null),
  ('b0000000-0000-4000-8000-0000000000b1', 'a0000000-0000-4000-8000-0000000000b1', 'ZZ SYN MgrB', 'ZZ-MB', 'active', 'licensed', now() - interval '200 days', null),
  ('b0000000-0000-4000-8000-0000000000d1', 'a0000000-0000-4000-8000-0000000000d1', 'ZZ SYN Plain', 'ZZ-PL', 'active', 'licensed', now() - interval '200 days', null);
insert into public.agents (id, display_name, agent_code, status, license_status, created_at, manager_id) values
  ('b1000000-0000-4000-8000-0000000000a1', 'ZZ SYN HireA1', 'ZZ-A1', 'active', 'licensed', now() - interval '6 days', 'b0000000-0000-4000-8000-0000000000a1'),
  ('b1000000-0000-4000-8000-0000000000a2', 'ZZ SYN SubA',   'ZZ-SA', 'active', 'licensed', now() - interval '100 days', 'b0000000-0000-4000-8000-0000000000a1'),
  ('b1000000-0000-4000-8000-0000000000a3', 'ZZ SYN HireA2', 'ZZ-A2', 'active', 'licensed', now() - interval '4 days',  'b1000000-0000-4000-8000-0000000000a2'),
  ('b1000000-0000-4000-8000-0000000000b1', 'ZZ SYN HireB1', 'ZZ-B1', 'active', 'licensed', now() - interval '6 days',  'b0000000-0000-4000-8000-0000000000b1'),
  ('b1000000-0000-4000-8000-0000000000e1', 'ZZ SYN Unlicensed', 'ZZ-UL', 'active', 'unlicensed', now() - interval '9 days', 'b0000000-0000-4000-8000-0000000000a1'),
  ('b1000000-0000-4000-8000-0000000000e2', 'ZZ SYN Deactivated', 'ZZ-DA', 'active', 'licensed', now() - interval '9 days', 'b0000000-0000-4000-8000-0000000000a1'),
  ('b1000000-0000-4000-8000-0000000000e3', 'ZZ SYN Day3', 'ZZ-D3', 'active', 'licensed', now() - interval '3 days', 'b0000000-0000-4000-8000-0000000000a1'),
  ('b1000000-0000-4000-8000-0000000000e4', 'ZZ SYN Day2', 'ZZ-D2', 'active', 'licensed', now() - interval '2 days', 'b0000000-0000-4000-8000-0000000000a1'),
  ('b1000000-0000-4000-8000-0000000000e5', 'ZZ SYN Future', 'ZZ-FU', 'active', 'licensed', now() + interval '5 days', 'b0000000-0000-4000-8000-0000000000a1'),
  ('b1000000-0000-4000-8000-0000000000e6', 'ZZ SYN Veteran', 'ZZ-VT', 'active', 'licensed', now() - interval '400 days', 'b0000000-0000-4000-8000-0000000000a1');
update public.agents set is_deactivated = true where id = 'b1000000-0000-4000-8000-0000000000e2';
-- a duplicate row that points at HireA1 as its canonical
insert into public.agents (id, display_name, agent_code, status, license_status, created_at, manager_id, canonical_agent_id) values
  ('b1000000-0000-4000-8000-0000000000f1', 'ZZ SYN HireA1 twin', 'ZZ-A1T', 'active', 'licensed', now() - interval '6 days', 'b0000000-0000-4000-8000-0000000000a1', 'b1000000-0000-4000-8000-0000000000a1');
update public.contracting_followup_config set clock_basis = 'hired' where singleton;

-- ── 1. scope: a manager sees only their own downline ──────────────────────────────────────────────────────
insert into results(test, outcome, expected, pass)
select '1 manager A sees own row + A downline only (no B people)',
  (select string_agg(p->>'display_name', ',' order by p->>'display_name') from jsonb_array_elements(pg_temp.status_as('a0000000-0000-4000-8000-0000000000a1')->'people') p where p->>'display_name' like 'ZZ SYN%'),
  'ZZ SYN Day2,ZZ SYN Day3,ZZ SYN Future,ZZ SYN HireA1,ZZ SYN HireA2,ZZ SYN MgrA,ZZ SYN SubA,ZZ SYN Veteran', null;
update results set pass = (outcome = expected) where n = (select max(n) from results);

insert into results(test, outcome, expected, pass)
select '2 manager B sees own row + B hire only (no A people)',
  (select string_agg(p->>'display_name', ',' order by p->>'display_name') from jsonb_array_elements(pg_temp.status_as('a0000000-0000-4000-8000-0000000000b1')->'people') p where p->>'display_name' like 'ZZ SYN%'),
  'ZZ SYN HireB1,ZZ SYN MgrB', null;
update results set pass = (outcome = expected) where n = (select max(n) from results);

-- ── 2. roles: plain agent refused, va may read, anon cannot execute ───────────────────────────────────────
insert into results(test, outcome, expected, pass)
select '3 plain agent refused status', coalesce(state, 'allowed'), '42501', null from pg_temp.as_user('a0000000-0000-4000-8000-0000000000d1', 'select public.team_contracting_status()');
update results set pass = (outcome = expected) where n = (select max(n) from results);
insert into results(test, outcome, expected, pass)
select '4 va can read status', case when ok then 'allowed' else coalesce(state,'x') end, 'allowed', null from pg_temp.as_user('a0000000-0000-4000-8000-0000000000c1', 'select public.team_contracting_status()');
update results set pass = (outcome = expected) where n = (select max(n) from results);
insert into results(test, outcome, expected, pass)
select '5 va cannot tick a checkoff', coalesce(state,'allowed'), '42501', null from pg_temp.as_user('a0000000-0000-4000-8000-0000000000c1', $$select public.set_contract_checkoff('b1000000-0000-4000-8000-0000000000a1','aflac',true)$$);
update results set pass = (outcome = expected) where n = (select max(n) from results);
insert into results(test, outcome, expected, pass)
select '6 anon cannot execute status', (case when has_function_privilege('anon','public.team_contracting_status()','execute') then 'allowed' else 'denied' end), 'denied', null;
update results set pass = (outcome = expected) where n = (select max(n) from results);

-- ── 3. write scope ─────────────────────────────────────────────────────────────────────────────────────────
insert into results(test, outcome, expected, pass)
select '7 manager B cannot tick manager A hire', coalesce(state,'allowed'), '42501', null from pg_temp.as_user('a0000000-0000-4000-8000-0000000000b1', $$select public.set_contract_checkoff('b1000000-0000-4000-8000-0000000000a1','aflac',true)$$);
update results set pass = (outcome = expected) where n = (select max(n) from results);
insert into results(test, outcome, expected, pass)
select '8 manager A can tick own downline hire (sub-manager hire)', case when ok then 'allowed' else coalesce(state,'x') end, 'allowed', null from pg_temp.as_user('a0000000-0000-4000-8000-0000000000a1', $$select public.set_contract_checkoff('b1000000-0000-4000-8000-0000000000a3','aflac',true)$$);
update results set pass = (outcome = expected) where n = (select max(n) from results);
insert into results(test, outcome, expected, pass)
select '9 unknown key rejected', coalesce(state,'allowed'), '22023', null from pg_temp.as_user('a0000000-0000-4000-8000-0000000000a1', $$select public.set_contract_checkoff('b1000000-0000-4000-8000-0000000000a1','bogus',true)$$);
update results set pass = (outcome = expected) where n = (select max(n) from results);
insert into results(test, outcome, expected, pass)
select '10 null state rejected', coalesce(state,'allowed'), '22023', null from pg_temp.as_user('a0000000-0000-4000-8000-0000000000a1', $$select public.set_contract_checkoff('b1000000-0000-4000-8000-0000000000a1','aflac',null)$$);
update results set pass = (outcome = expected) where n = (select max(n) from results);

-- ── 4. milestone arithmetic through the real read (basis = hired; created_at is the clock) ─────────────────
-- HireA1 is day 6, Day3 is day 3, Day2 is day 2. Ticks so far: HireA2 aflac only.
create temp table snap as select pg_temp.status_as('a0000000-0000-4000-8000-0000000000a1') s;
insert into results(test, outcome, expected, pass)
select '11 day 6 hire: all four overdue, one person',
  (select (p->'overdue_keys')::text from jsonb_array_elements((select s->'people' from snap)) p where p->>'display_name'='ZZ SYN HireA1'),
  '["first_contract", "aflac", "ethos", "agentlink"]', null;
update results set pass = (outcome = expected) where n = (select max(n) from results);
insert into results(test, outcome, expected, pass)
select '12 day 3 hire: Aflac/Ethos amber, not red',
  (select concat((p->>'p1'), '/', (p->>'due_soon'), '/', (p->'due_soon_keys')::text) from jsonb_array_elements((select s->'people' from snap)) p where p->>'display_name'='ZZ SYN Day3'),
  'false/true/["aflac", "ethos"]', null;
update results set pass = (outcome = expected) where n = (select max(n) from results);
insert into results(test, outcome, expected, pass)
select '13 day 2 hire: nothing due',
  (select concat((p->>'p1'), '/', (p->>'due_soon')) from jsonb_array_elements((select s->'people' from snap)) p where p->>'display_name'='ZZ SYN Day2'),
  'false/false', null;
update results set pass = (outcome = expected) where n = (select max(n) from results);
insert into results(test, outcome, expected, pass)
select '14 day 4 hire A2 with Aflac ticked: only Ethos red (Aflac done)',
  (select (p->'overdue_keys')::text from jsonb_array_elements((select s->'people' from snap)) p where p->>'display_name'='ZZ SYN HireA2'),
  '["ethos"]', null;
update results set pass = (outcome = expected) where n = (select max(n) from results);
insert into results(test, outcome, expected, pass)
select '15 unlicensed and deactivated are absent; veteran is not tracked, not red',
  (select concat(
     (select count(*) from jsonb_array_elements((select s->'people' from snap)) p where p->>'display_name' in ('ZZ SYN Unlicensed','ZZ SYN Deactivated')),
     '/', (select p->>'p1' from jsonb_array_elements((select s->'people' from snap)) p where p->>'display_name'='ZZ SYN Veteran'),
     '/', (select p->'milestones'->0->>'state' from jsonb_array_elements((select s->'people' from snap)) p where p->>'display_name'='ZZ SYN Veteran'))),
  '0/false/not_tracked', null;
update results set pass = (outcome = expected) where n = (select max(n) from results);
insert into results(test, outcome, expected, pass)
select '16 future start goes to timing review, never overdue',
  (select concat((p->>'needs_review'), '/', (p->>'p1'), '/', (p->>'review_reason')) from jsonb_array_elements((select s->'people' from snap)) p where p->>'display_name'='ZZ SYN Future'),
  'true/false/Start date is in the future', null;
update results set pass = (outcome = expected) where n = (select max(n) from results);
insert into results(test, outcome, expected, pass)
select '17 duplicate twin is not its own person (canonical only)',
  (select count(*)::text from jsonb_array_elements((select s->'people' from snap)) p where p->>'display_name' like 'ZZ SYN HireA1%'),
  '1', null;
update results set pass = (outcome = expected) where n = (select max(n) from results);

-- ── 5. completing, partially completing and reopening ─────────────────────────────────────────────────────
insert into discard select 1 from pg_temp.as_user('a0000000-0000-4000-8000-0000000000a1', $$select public.set_contract_checkoff('b1000000-0000-4000-8000-0000000000a1','first_contract',true)$$);
insert into results(test, outcome, expected, pass)
select '18 one done, others still overdue: still Priority 1, completed one gone from reasons',
  (select concat(p->>'p1', '/', (p->'overdue_keys')::text) from jsonb_array_elements(pg_temp.status_as('a0000000-0000-4000-8000-0000000000a1')->'people') p where p->>'display_name'='ZZ SYN HireA1'),
  'true/["aflac", "ethos", "agentlink"]', null;
update results set pass = (outcome = expected) where n = (select max(n) from results);
-- tick through the TWIN id: it must land on the canonical
insert into discard select 1 from pg_temp.as_user('a0000000-0000-4000-8000-0000000000a1', $$select public.set_contract_checkoff('b1000000-0000-4000-8000-0000000000f1','aflac',true)$$);
insert into results(test, outcome, expected, pass)
select '19 tick via twin id lands on canonical',
  (select count(*)::text from public.agent_contract_checkoffs where agent_id = 'b1000000-0000-4000-8000-0000000000a1' and contract_key='aflac'), '1', null;
update results set pass = (outcome = expected) where n = (select max(n) from results);
insert into discard select 1 from pg_temp.as_user('a0000000-0000-4000-8000-0000000000a1', $$select public.set_contract_checkoff('b1000000-0000-4000-8000-0000000000a1','ethos',true)$$);
insert into discard select 1 from pg_temp.as_user('a0000000-0000-4000-8000-0000000000a1', $$select public.set_contract_checkoff('b1000000-0000-4000-8000-0000000000a1','agentlink',true)$$);
insert into results(test, outcome, expected, pass)
select '20 last overdue milestone done: Priority 1 clears',
  (select concat(p->>'p1', '/', (p->'overdue_keys')::text) from jsonb_array_elements(pg_temp.status_as('a0000000-0000-4000-8000-0000000000a1')->'people') p where p->>'display_name'='ZZ SYN HireA1'),
  'false/[]', null;
update results set pass = (outcome = expected) where n = (select max(n) from results);
insert into discard select 1 from pg_temp.as_user('a0000000-0000-4000-8000-0000000000a1', $$select public.set_contract_checkoff('b1000000-0000-4000-8000-0000000000a1','ethos',false)$$);
insert into results(test, outcome, expected, pass)
select '21 reopening a milestone brings it back from the clock rule',
  (select concat(p->>'p1', '/', (p->'overdue_keys')::text) from jsonb_array_elements(pg_temp.status_as('a0000000-0000-4000-8000-0000000000a1')->'people') p where p->>'display_name'='ZZ SYN HireA1'),
  'true/["ethos"]', null;
update results set pass = (outcome = expected) where n = (select max(n) from results);

-- ── 6. idempotency, compare-and-set, history ──────────────────────────────────────────────────────────────
insert into discard select 1 from pg_temp.as_user('a0000000-0000-4000-8000-0000000000a1', $$select public.set_contract_checkoff('b1000000-0000-4000-8000-0000000000a1','aflac',true)$$);
insert into results(test, outcome, expected, pass)
select '22 repeat check is a no-op: one event, original checker kept',
  (select count(*)::text from public.agent_contract_checkoff_events where agent_id='b1000000-0000-4000-8000-0000000000a1' and contract_key='aflac' and action='checked'), '1', null;
update results set pass = (outcome = expected) where n = (select max(n) from results);
create temp table cas(r1 jsonb, r2 jsonb);
do $$
declare a jsonb; b jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub','a0000000-0000-4000-8000-0000000000a1','role','authenticated')::text, true);
  execute 'set local role authenticated';
  a := public.set_contract_checkoff('b1000000-0000-4000-8000-0000000000a3','ethos',true,false);
  b := public.set_contract_checkoff('b1000000-0000-4000-8000-0000000000a3','ethos',false,false); -- stale belief: it believed unchecked, but it is now checked
  execute 'reset role';
  insert into cas values (a,b);
end $$;
insert into results(test, outcome, expected, pass)
select '23 rapid repeated taps: second stale tap gets a conflict, not a contradictory write',
  (select concat(r1->>'ok','/',r2->>'ok','/',coalesce(r2->>'conflict','')) from cas), 'true/false/true', null;
update results set pass = (outcome = expected) where n = (select max(n) from results);
insert into discard select 1 from pg_temp.as_user('a0000000-0000-4000-8000-0000000000a1', $$select public.set_contract_checkoff('b1000000-0000-4000-8000-0000000000a3','aflac',false)$$);
insert into results(test, outcome, expected, pass)
select '24 uncheck keeps history: row gone, event keeps who and when',
  (select concat((select count(*) from public.agent_contract_checkoffs where agent_id='b1000000-0000-4000-8000-0000000000a3' and contract_key='aflac'), '/',
                 (select count(*) from public.agent_contract_checkoff_events where agent_id='b1000000-0000-4000-8000-0000000000a3' and contract_key='aflac' and action='unchecked' and prev_checked_at is not null and prev_checked_by is not null))),
  '0/1', null;
update results set pass = (outcome = expected) where n = (select max(n) from results);

-- ── 7. follow-up: scope, validation, contacted-but-still-overdue, missed follow-up returns ────────────────
insert into results(test, outcome, expected, pass)
select '25 manager B cannot plan a follow-up for A hire', coalesce(state,'allowed'), '42501', null from pg_temp.as_user('a0000000-0000-4000-8000-0000000000b1', $$select public.set_contracting_followup('b1000000-0000-4000-8000-0000000000a1','{"next_action":"x"}')$$);
update results set pass = (outcome = expected) where n = (select max(n) from results);
insert into results(test, outcome, expected, pass)
select '26 bad waiting_on rejected by the table rule', coalesce(state,'allowed'), '23514', null from pg_temp.as_user('a0000000-0000-4000-8000-0000000000a1', $$select public.set_contracting_followup('b1000000-0000-4000-8000-0000000000a1','{"waiting_on":"bogus"}')$$);
update results set pass = (outcome = expected) where n = (select max(n) from results);
insert into results(test, outcome, expected, pass)
select '27 unknown field rejected', coalesce(state,'allowed'), '22023', null from pg_temp.as_user('a0000000-0000-4000-8000-0000000000a1', $$select public.set_contracting_followup('b1000000-0000-4000-8000-0000000000a1','{"phone":"1"}')$$);
update results set pass = (outcome = expected) where n = (select max(n) from results);
insert into discard select 1 from pg_temp.as_user('a0000000-0000-4000-8000-0000000000a1', format($f$select public.set_contracting_followup('b1000000-0000-4000-8000-0000000000a1', '{"follow_up_on":"%s","next_action":"Call about Ethos portal","waiting_on":"agent"}')$f$, ((now() at time zone 'America/Phoenix')::date + 3)::text));
insert into discard select 1 from pg_temp.as_user('a0000000-0000-4000-8000-0000000000a1', $$select public.set_contracting_checkin(null,'b1000000-0000-4000-8000-0000000000a1','call',true,'talked')$$);
insert into results(test, outcome, expected, pass)
select '28 contacted + future follow-up: STILL overdue, follow-up not due now',
  (select concat(p->>'p1', '/', (p->'followup'->>'due_now'), '/', (p->'followup'->>'last_outcome'), '/', (p->'followup'->>'call_count')) from jsonb_array_elements(pg_temp.status_as('a0000000-0000-4000-8000-0000000000a1')->'people') p where p->>'display_name'='ZZ SYN HireA1'),
  'true/false/talked/1', null;
update results set pass = (outcome = expected) where n = (select max(n) from results);
update public.contracting_checkins set follow_up_on = ((now() at time zone 'America/Phoenix')::date - 1) where agent_id = 'b1000000-0000-4000-8000-0000000000a1';
insert into results(test, outcome, expected, pass)
select '29 missed follow-up date returns to the immediate-action queue',
  (select (p->'followup'->>'due_now') from jsonb_array_elements(pg_temp.status_as('a0000000-0000-4000-8000-0000000000a1')->'people') p where p->>'display_name'='ZZ SYN HireA1'), 'true', null;
update results set pass = (outcome = expected) where n = (select max(n) from results);
insert into results(test, outcome, expected, pass)
select '30 sort: follow-up due or missing before a valid upcoming follow-up',
  (select string_agg(p->>'display_name', ' > ' order by (p->>'p1_rank')::int) from jsonb_array_elements(pg_temp.status_as('a0000000-0000-4000-8000-0000000000a1')->'people') p where p->>'p1' = 'true' and p->>'display_name' like 'ZZ SYN%'),
  'ZZ SYN HireA1 > ZZ SYN HireA2', null;
update results set pass = (outcome = expected) where n = (select max(n) from results);

-- ── 8. a clock rule that is not confirmed produces no urgency ─────────────────────────────────────────────
update public.contracting_followup_config set clock_basis = 'unset' where singleton;
insert into results(test, outcome, expected, pass)
select '31 unconfirmed clock: zero Priority 1, every state is policy_pending',
  (select concat((s->'counts'->>'p1_people'), '/', (select count(distinct m->>'state') from jsonb_array_elements(s->'people') p, jsonb_array_elements(p->'milestones') m where p->>'eligibility'='eligible' and not (m->>'state') in ('policy_pending','done')))),
  '0/0', null from (select pg_temp.status_as('a0000000-0000-4000-8000-0000000000a1') s) x;
update results set pass = (outcome = expected) where n = (select max(n) from results);
update public.contracting_followup_config set clock_basis = 'hired' where singleton;

select test, outcome, expected, case when pass then 'PASS' else 'FAIL' end verdict from results order by n;
rollback;
