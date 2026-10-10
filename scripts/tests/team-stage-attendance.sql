-- Behavioural proof for migration 20261009200000 (training stage, weekday work commitments, workday attendance).
-- One transaction that ends in ROLLBACK, run under real role claims. The runner substitutes the migration at the markers, so the file that
-- ships is what is proven, and a deliberately broken copy can be substituted to prove each test can fail.
-- Run:  python3 scripts/tests/run-team-stage-attendance.py     Expected: every row PASS.
begin;

create temp table results(n serial, test text, outcome text, expected text, pass boolean);
grant all on results to public;
grant usage on sequence results_n_seq to public;
create temp table discard_i(x int);
create temp table acts(name text primary key, j jsonb);
create or replace function pg_temp.chk(t text, o text, e text) returns int language sql as $$
  insert into results(test, outcome, expected, pass) values (t, o, e, o is not distinct from e); select 1
$$;
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
create or replace function pg_temp.act(n text, uid uuid, expr text) returns int language sql as $$
  insert into acts(name, j) values (n, pg_temp.j(uid, expr)); select 1
$$;
create or replace function pg_temp.a(n text) returns jsonb language sql as $$ select j from acts where name = n $$;
create or replace function pg_temp.err(uid uuid, expr text) returns text language sql as $$ select coalesce(pg_temp.j(uid, expr)->>'_err', 'allowed') $$;
create or replace function pg_temp.tf(b boolean) returns text language sql as $$ select case when b then 'yes' when not b then 'no' end $$;
create or replace function pg_temp.try(stmt text) returns text language plpgsql as $$
begin execute stmt; return 'allowed'; exception when others then return sqlstate || ':' || sqlerrm; end $$;
-- the most recent date on or before today (Phoenix) with this ISO weekday (Mon=1 ... Sun=7)
create or replace function pg_temp.last_dow(n int) returns date language sql stable as $$
  select public.fn_phoenix_today() - (((extract(isodow from public.fn_phoenix_today())::int - n) + 7) % 7)
$$;
create or replace function pg_temp.person(day jsonb, id uuid) returns jsonb language sql as $$
  select e from jsonb_array_elements(day->'people') e where e->>'agent_id' = id::text
$$;

-- synthetic world
insert into auth.users (id) values ('a0000000-0000-4000-8000-0000000000ad'), ('a0000000-0000-4000-8000-0000000000a1'), ('a0000000-0000-4000-8000-0000000000b1'), ('a0000000-0000-4000-8000-0000000000c1'), ('a0000000-0000-4000-8000-0000000000d1');
insert into public.user_roles (user_id, role) values ('a0000000-0000-4000-8000-0000000000ad', 'admin'), ('a0000000-0000-4000-8000-0000000000a1', 'manager'), ('a0000000-0000-4000-8000-0000000000b1', 'manager'), ('a0000000-0000-4000-8000-0000000000c1', 'va'), ('a0000000-0000-4000-8000-0000000000d1', 'agent') on conflict do nothing;
insert into public.agents (id, user_id, display_name, agent_code, status, license_status, created_at, manager_id) values
  ('b0000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-0000000000a1', 'ZZ SYN MgrA', 'ZZ-MA', 'active', 'licensed', now() - interval '200 days', null),
  ('b0000000-0000-4000-8000-0000000000b1', 'a0000000-0000-4000-8000-0000000000b1', 'ZZ SYN MgrB', 'ZZ-MB', 'active', 'licensed', now() - interval '200 days', null),
  ('b0000000-0000-4000-8000-0000000000d1', 'a0000000-0000-4000-8000-0000000000d1', 'ZZ SYN Plain', 'ZZ-PL', 'active', 'licensed', now() - interval '200 days', null);
insert into public.agents (id, display_name, agent_code, status, license_status, created_at, manager_id) values
  ('b1000000-0000-4000-8000-0000000000a1', 'ZZ SYN HireA1', 'ZZ-A1', 'active', 'licensed', now() - interval '90 days', 'b0000000-0000-4000-8000-0000000000a1'),
  ('b1000000-0000-4000-8000-0000000000a2', 'ZZ SYN HireA2', 'ZZ-A2', 'active', 'licensed', now() - interval '90 days', 'b0000000-0000-4000-8000-0000000000a1'),
  ('b1000000-0000-4000-8000-0000000000b1', 'ZZ SYN HireB1', 'ZZ-B1', 'active', 'licensed', now() - interval '90 days', 'b0000000-0000-4000-8000-0000000000b1'),
  ('b2000000-0000-4000-8000-000000000007', 'ZZ SYN StartsLater', 'ZZ-LT', 'active', 'licensed', now() - interval '90 days', 'b0000000-0000-4000-8000-0000000000a1');
update public.agents set start_date = public.fn_phoenix_today() + 5 where id = 'b2000000-0000-4000-8000-000000000007';
insert into public.agents (id, display_name, agent_code, status, license_status, created_at, manager_id, canonical_agent_id) values
  ('b2000000-0000-4000-8000-000000000006', 'ZZ SYN HireA1 twin', 'ZZ-A1T', 'active', 'licensed', now() - interval '90 days', 'b0000000-0000-4000-8000-0000000000a1', 'b1000000-0000-4000-8000-0000000000a1');
insert into public.agents (id, display_name, agent_code, status, license_status, created_at, manager_id) values
  ('b2000000-0000-4000-8000-000000000003', 'ZZ SYN Ghost', 'GHOST_ZZ', 'active', 'licensed', now() - interval '90 days', 'b0000000-0000-4000-8000-0000000000a1');
-- mapping fixtures: their trigger-made stage rows are removed so the mapping rule (re-run below) is what places them
insert into public.agents (id, display_name, agent_code, status, license_status, created_at, manager_id, onboarding_stage, first_deal_at) values
  ('b4000000-0000-4000-8000-000000000001', 'ZZ SYN MapTrainingOnline', 'ZZ-M1', 'active', 'licensed', now() - interval '90 days', 'b0000000-0000-4000-8000-0000000000b1', 'training_online', null),
  ('b4000000-0000-4000-8000-000000000002', 'ZZ SYN MapLive', 'ZZ-M2', 'active', 'licensed', now() - interval '90 days', 'b0000000-0000-4000-8000-0000000000b1', 'live', null),
  ('b4000000-0000-4000-8000-000000000003', 'ZZ SYN MapFirstDeal', 'ZZ-M3', 'active', 'licensed', now() - interval '90 days', 'b0000000-0000-4000-8000-0000000000b1', 'onboarding', now() - interval '10 days'),
  ('b4000000-0000-4000-8000-000000000004', 'ZZ SYN MapInFieldTraining', 'ZZ-M4', 'active', 'licensed', now() - interval '90 days', 'b0000000-0000-4000-8000-0000000000b1', 'in_field_training', null),
  ('b4000000-0000-4000-8000-000000000005', 'ZZ SYN MapOnboarding', 'ZZ-M5', 'active', 'licensed', now() - interval '90 days', 'b0000000-0000-4000-8000-0000000000b1', 'onboarding', null),
  ('b4000000-0000-4000-8000-000000000006', 'ZZ SYN MapNoStage', 'ZZ-M6', 'active', 'licensed', now() - interval '90 days', 'b0000000-0000-4000-8000-0000000000b1', null, null);
delete from public.agent_stage where agent_id in ('b4000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000002','b4000000-0000-4000-8000-000000000003','b4000000-0000-4000-8000-000000000004','b4000000-0000-4000-8000-000000000005','b4000000-0000-4000-8000-000000000006');
create temp table real_stages as select agent_id, stage, source, set_at from public.agent_stage where agent_id not in (select id from public.agents where display_name like 'ZZ SYN%');

-- @@MIGRATION_UNDER_TEST@@

-- ── 1. the three stages ─────────────────────────────────────────────────────────────────────────────────────

insert into discard_i select pg_temp.chk('1 the labels are exactly ''Online training'', ''Training'' and ''Released in field''',
  (select concat(public.fn_stage_label('online_training'), '|', public.fn_stage_label('training'), '|', public.fn_stage_label('released_in_field'), '|', coalesce(public.fn_stage_label('bogus'), 'none'))),
  'Online training|Training|Released in field|none');

insert into public.agents (id, display_name, agent_code, status, license_status, created_at, manager_id) values ('b5000000-0000-4000-8000-000000000001', 'ZZ SYN BrandNew', 'ZZ-NEW', 'active', 'licensed', now(), 'b0000000-0000-4000-8000-0000000000a1');

insert into discard_i select pg_temp.chk('2 a newly created agent is placed in Online training by default, once, with a logged event',
  (select concat(s.stage, '/', s.source, '/', (select count(*) from public.agent_stage_events e where e.agent_id = s.agent_id and e.source = 'default')) from public.agent_stage s where s.agent_id = 'b5000000-0000-4000-8000-000000000001'),
  'online_training/default/1');

insert into public.agents (id, display_name, agent_code, status, license_status, created_at, manager_id) values ('b5000000-0000-4000-8000-000000000002', 'ZZ SYN NewGhost', 'GHOST_ZZ2', 'active', 'licensed', now(), 'b0000000-0000-4000-8000-0000000000a1');

insert into public.agents (id, display_name, agent_code, status, license_status, created_at, manager_id, canonical_agent_id) values ('b5000000-0000-4000-8000-000000000003', 'ZZ SYN NewTwin', 'ZZ-NT', 'active', 'licensed', now(), 'b0000000-0000-4000-8000-0000000000a1', 'b1000000-0000-4000-8000-0000000000a1');

insert into discard_i select pg_temp.chk('3 a newly created sync-only placeholder seat and a newly created merged duplicate are given no stage',
  (select count(*)::text from public.agent_stage where agent_id in ('b5000000-0000-4000-8000-000000000002', 'b5000000-0000-4000-8000-000000000003')),
  '0');

-- @@MIGRATION_RERUN@@

insert into discard_i select pg_temp.chk('4 the one-time mapping places only unambiguous history: training_online -> Online training; live or a first deal -> Released in field',
  (select string_agg(a.display_name || '=' || coalesce(s.stage, 'unset') || '/' || coalesce(s.source, '-'), ' ' order by a.display_name) from public.agents a left join public.agent_stage s on s.agent_id = a.id where a.id in ('b4000000-0000-4000-8000-000000000001','b4000000-0000-4000-8000-000000000002','b4000000-0000-4000-8000-000000000003')),
  'ZZ SYN MapFirstDeal=released_in_field/mapped ZZ SYN MapLive=released_in_field/mapped ZZ SYN MapTrainingOnline=online_training/mapped');

insert into discard_i select pg_temp.chk('5 …and it does NOT guess for in-field training, onboarding or no stage at all: those stay unset for staff',
  (select string_agg(a.display_name || '=' || coalesce(s.stage, 'unset'), ' ' order by a.display_name) from public.agents a left join public.agent_stage s on s.agent_id = a.id where a.id in ('b4000000-0000-4000-8000-000000000004','b4000000-0000-4000-8000-000000000005','b4000000-0000-4000-8000-000000000006')),
  'ZZ SYN MapInFieldTraining=unset ZZ SYN MapNoStage=unset ZZ SYN MapOnboarding=unset');

insert into discard_i select pg_temp.chk('6 re-running the migration changed nobody who already had a stage',
  (select count(*)::text from public.agent_stage s join real_stages r on r.agent_id = s.agent_id where (s.stage, s.source, s.set_at) is distinct from (r.stage, r.source, r.set_at)),
  '0');

insert into discard_i select pg_temp.act('st8', 'a0000000-0000-4000-8000-0000000000ad', $$public.set_agent_stage('b1000000-0000-4000-8000-0000000000a1', 'training', 'online_training', false)$$);

insert into discard_i select pg_temp.chk('7 admin sets a stage (from the default); it is stored and logged with who and what it replaced',
  (select concat(pg_temp.a('st8')->>'ok', '/', pg_temp.a('st8')->>'changed', '/', (select stage from public.agent_stage where agent_id = 'b1000000-0000-4000-8000-0000000000a1'), '/', (select count(*) from public.agent_stage_events where agent_id = 'b1000000-0000-4000-8000-0000000000a1' and to_stage = 'training' and from_stage = 'online_training' and acted_by is not null))),
  'true/true/training/1');

insert into discard_i select pg_temp.act('st9', 'a0000000-0000-4000-8000-0000000000ad', $$public.set_agent_stage('b1000000-0000-4000-8000-0000000000a1', 'released_in_field', 'training', false)$$);

insert into discard_i select pg_temp.act('st9b', 'a0000000-0000-4000-8000-0000000000ad', $$public.set_agent_stage('b1000000-0000-4000-8000-0000000000a1', 'training', 'released_in_field', false)$$);

insert into discard_i select pg_temp.chk('8 a backward correction is allowed and logged; both moves are kept in history',
  (select concat(pg_temp.a('st9b')->>'changed', '/', (select stage from public.agent_stage where agent_id = 'b1000000-0000-4000-8000-0000000000a1'), '/', (select count(*) from public.agent_stage_events where agent_id = 'b1000000-0000-4000-8000-0000000000a1'))),
  'true/training/4');

insert into discard_i select pg_temp.act('st10', 'a0000000-0000-4000-8000-0000000000ad', $$public.set_agent_stage('b1000000-0000-4000-8000-0000000000a1', 'released_in_field', 'online_training', false)$$);

insert into discard_i select pg_temp.chk('9 a stale screen (thinks Online training, is Training) gets a conflict carrying the truth and changes nothing',
  (select concat(pg_temp.a('st10')->>'ok', '/', pg_temp.a('st10')->>'conflict', '/', pg_temp.a('st10')->>'stage', '/', (select stage from public.agent_stage where agent_id = 'b1000000-0000-4000-8000-0000000000a1'))),
  'false/true/training/training');

insert into discard_i select pg_temp.act('st11', 'a0000000-0000-4000-8000-0000000000ad', $$public.set_agent_stage('b1000000-0000-4000-8000-0000000000a1', 'training', 'training', false)$$);

insert into discard_i select pg_temp.chk('10 setting the same stage again changes nothing and logs nothing',
  (select concat(pg_temp.a('st11')->>'changed', '/', (select count(*) from public.agent_stage_events where agent_id = 'b1000000-0000-4000-8000-0000000000a1'))),
  'false/4');

insert into discard_i select pg_temp.chk('11 an unknown stage is refused',
  pg_temp.err('a0000000-0000-4000-8000-0000000000ad', $$public.set_agent_stage('b1000000-0000-4000-8000-0000000000a1', 'bogus', null, false)$$),
  '22023');

insert into discard_i select pg_temp.chk('12 manager B cannot set manager A''s hire; a VA and a plain agent cannot set anyone',
  concat(pg_temp.err('a0000000-0000-4000-8000-0000000000b1', $$public.set_agent_stage('b1000000-0000-4000-8000-0000000000a1', 'training', null, false)$$), '/', pg_temp.err('a0000000-0000-4000-8000-0000000000c1', $$public.set_agent_stage('b1000000-0000-4000-8000-0000000000a1', 'training', null, false)$$), '/', pg_temp.err('a0000000-0000-4000-8000-0000000000d1', $$public.set_agent_stage('b0000000-0000-4000-8000-0000000000d1', 'training', null, false)$$)),
  '42501/42501/42501');

insert into discard_i select pg_temp.chk('13 manager A can set their own downline',
  pg_temp.err('a0000000-0000-4000-8000-0000000000a1', $$public.set_agent_stage('b1000000-0000-4000-8000-0000000000a2', 'training', null, false)$$),
  'allowed');

insert into discard_i select pg_temp.chk('14 a person outside the team (placeholder seat) cannot be given a stage',
  pg_temp.err('a0000000-0000-4000-8000-0000000000ad', $$public.set_agent_stage('b2000000-0000-4000-8000-000000000003', 'training', null, false)$$),
  'P0002');

insert into discard_i select pg_temp.act('st16', 'a0000000-0000-4000-8000-0000000000ad', $$public.set_agent_stage('b2000000-0000-4000-8000-000000000006', 'released_in_field', null, false)$$);

insert into discard_i select pg_temp.chk('15 setting a stage through a merged duplicate lands on the canonical person',
  (select concat((select count(*) from public.agent_stage where agent_id = 'b2000000-0000-4000-8000-000000000006'), '/', (select stage from public.agent_stage where agent_id = 'b1000000-0000-4000-8000-0000000000a1'))),
  '0/released_in_field');

insert into discard_i select pg_temp.chk('16 a stage change touches no other fact: onboarding stage and contracting marks are as they were',
  (select concat(coalesce(onboarding_stage::text, 'null'), '/', (select count(*) from public.contract_review_marks where agent_id = 'b1000000-0000-4000-8000-0000000000a1')) from public.agents where id = 'b1000000-0000-4000-8000-0000000000a1'),
  'null/0');

-- ── 2. weekday work commitments ───────────────────────────────────────────────────────────────────────────────

insert into discard_i select pg_temp.chk('17 a person with no commitment is ''schedule not set'' (null), which is not the same as zero days',
  (select concat(coalesce((e->>'schedule_set'), 'null'), '/', coalesce(e->>'weekdays', 'null')) from jsonb_array_elements(pg_temp.j('a0000000-0000-4000-8000-0000000000ad', 'public.team_people_facts()')->'people') e where e->>'agent_id' = 'b1000000-0000-4000-8000-0000000000a1'),
  'false/null');

insert into discard_i select pg_temp.act('w19', 'a0000000-0000-4000-8000-0000000000ad', $$public.set_work_commitment('b1000000-0000-4000-8000-0000000000a1', array[5,1,1,3]::smallint[], null, null, false)$$);

insert into discard_i select pg_temp.chk('18 Monday, Wednesday, Friday are stored sorted and without duplicates, effective today',
  (select concat(pg_temp.a('w19')->>'ok', '/', (select weekdays::text from public.agent_work_commitments where agent_id = 'b1000000-0000-4000-8000-0000000000a1' and effective_from = public.fn_phoenix_today()))),
  'true/{1,3,5}');

insert into discard_i select pg_temp.chk('19 the schedule in force today is that set, and the people read says so',
  (select concat(e->>'schedule_set', '/', e->>'weekdays') from jsonb_array_elements(pg_temp.j('a0000000-0000-4000-8000-0000000000ad', 'public.team_people_facts()')->'people') e where e->>'agent_id' = 'b1000000-0000-4000-8000-0000000000a1'),
  'true/[1, 3, 5]');

insert into discard_i select pg_temp.act('w21', 'a0000000-0000-4000-8000-0000000000ad', $$public.set_work_commitment('b1000000-0000-4000-8000-0000000000a2', array[]::smallint[], null, null, false)$$);

insert into discard_i select pg_temp.chk('20 an explicit empty list means ''no scheduled days'' and is NOT the same as unset',
  (select concat(e->>'schedule_set', '/', e->>'weekdays') from jsonb_array_elements(pg_temp.j('a0000000-0000-4000-8000-0000000000ad', 'public.team_people_facts()')->'people') e where e->>'agent_id' = 'b1000000-0000-4000-8000-0000000000a2'),
  'true/[]');

insert into discard_i select pg_temp.chk('21 Saturday, Sunday and 0 are refused; so is a null list',
  concat(pg_temp.err('a0000000-0000-4000-8000-0000000000ad', $$public.set_work_commitment('b1000000-0000-4000-8000-0000000000a1', array[6]::smallint[], null, null, false)$$), '/', pg_temp.err('a0000000-0000-4000-8000-0000000000ad', $$public.set_work_commitment('b1000000-0000-4000-8000-0000000000a1', array[0]::smallint[], null, null, false)$$), '/', pg_temp.err('a0000000-0000-4000-8000-0000000000ad', $$public.set_work_commitment('b1000000-0000-4000-8000-0000000000a1', null::smallint[], null, null, false)$$)),
  '22023/22023/22023');

insert into discard_i select pg_temp.chk('22 a commitment cannot start in the past: history is never rewritten',
  pg_temp.err('a0000000-0000-4000-8000-0000000000ad', $$public.set_work_commitment('b1000000-0000-4000-8000-0000000000a1', array[2]::smallint[], public.fn_phoenix_today() - 1, null, false)$$),
  '22023');

insert into discard_i select pg_temp.act('w24', 'a0000000-0000-4000-8000-0000000000ad', $$public.set_work_commitment('b1000000-0000-4000-8000-0000000000a1', array[2,4]::smallint[], public.fn_phoenix_today() + 7, null, false)$$);

insert into discard_i select pg_temp.chk('23 a future commitment is stored and does not change today''s schedule; it shows as the next schedule',
  (select concat(pg_temp.a('w24')->>'ok', '/', coalesce(public.fn_work_weekdays_on('b1000000-0000-4000-8000-0000000000a1', public.fn_phoenix_today())::text, 'null'), '/', coalesce(public.fn_work_weekdays_on('b1000000-0000-4000-8000-0000000000a1', public.fn_phoenix_today() + 7)::text, 'null'), '/', (select e->'next_schedule'->>'weekdays' from jsonb_array_elements(pg_temp.j('a0000000-0000-4000-8000-0000000000ad', 'public.team_people_facts()')->'people') e where e->>'agent_id' = 'b1000000-0000-4000-8000-0000000000a1'))),
  'true/{1,3,5}/{2,4}/[2, 4]');

insert into public.agent_work_commitments (agent_id, effective_from, weekdays) values ('b1000000-0000-4000-8000-0000000000b1', public.fn_phoenix_today() - 60, array[1,2]::smallint[]);

insert into discard_i select pg_temp.act('w25', 'a0000000-0000-4000-8000-0000000000ad', $$public.set_work_commitment('b1000000-0000-4000-8000-0000000000b1', array[3,4,5]::smallint[], null, null, false)$$);

insert into discard_i select pg_temp.chk('24 changing the schedule from today leaves the older commitment and what it said about past days exactly as it was',
  (select concat((select weekdays::text from public.agent_work_commitments where agent_id = 'b1000000-0000-4000-8000-0000000000b1' and effective_from = public.fn_phoenix_today() - 60), '/', public.fn_work_weekdays_on('b1000000-0000-4000-8000-0000000000b1', public.fn_phoenix_today() - 30)::text, '/', public.fn_work_weekdays_on('b1000000-0000-4000-8000-0000000000b1', public.fn_phoenix_today())::text)),
  '{1,2}/{1,2}/{3,4,5}');

insert into discard_i select pg_temp.act('w26', 'a0000000-0000-4000-8000-0000000000ad', $$public.set_work_commitment('b1000000-0000-4000-8000-0000000000a1', array[1]::smallint[], null, array[2]::smallint[], false)$$);

insert into discard_i select pg_temp.chk('25 a stale screen is refused with the real schedule, and nothing changes',
  (select concat(pg_temp.a('w26')->>'conflict', '/', pg_temp.a('w26')->>'weekdays', '/', (select weekdays::text from public.agent_work_commitments where agent_id = 'b1000000-0000-4000-8000-0000000000a1' and effective_from = public.fn_phoenix_today()))),
  'true/[1, 3, 5]/{1,3,5}');

insert into discard_i select pg_temp.chk('26 manager B, a VA and a plain agent cannot set a schedule for manager A''s hire',
  concat(pg_temp.err('a0000000-0000-4000-8000-0000000000b1', $$public.set_work_commitment('b1000000-0000-4000-8000-0000000000a1', array[1]::smallint[], null, null, false)$$), '/', pg_temp.err('a0000000-0000-4000-8000-0000000000c1', $$public.set_work_commitment('b1000000-0000-4000-8000-0000000000a1', array[1]::smallint[], null, null, false)$$), '/', pg_temp.err('a0000000-0000-4000-8000-0000000000d1', $$public.set_work_commitment('b1000000-0000-4000-8000-0000000000a1', array[1]::smallint[], null, null, false)$$)),
  '42501/42501/42501');

insert into discard_i select pg_temp.chk('27 every commitment is logged with what it replaced',
  (select concat(count(*), '/', count(*) filter (where from_weekdays is null), '/', count(*) filter (where from_weekdays = '{1,3,5}'::smallint[])) from public.agent_work_commitment_events where agent_id = 'b1000000-0000-4000-8000-0000000000a1'),
  '2/1/1');

-- ── 3. attendance ────────────────────────────────────────────────────────────────────────────────────────────

insert into public.agent_work_commitments (agent_id, effective_from, weekdays) values ('b1000000-0000-4000-8000-0000000000a1', public.fn_phoenix_today() - 120, array[1,3,5]::smallint[]) on conflict do nothing;

insert into public.agent_work_commitments (agent_id, effective_from, weekdays) values ('b1000000-0000-4000-8000-0000000000a2', public.fn_phoenix_today() - 120, array[2,4]::smallint[]) on conflict do nothing;

create temp table dmon as select pg_temp.last_dow(1) d; create temp table dtue as select pg_temp.last_dow(2) d; create temp table dsat as select pg_temp.last_dow(6) d; grant select on dmon, dtue, dsat to public;

create temp table r_mon as select pg_temp.j('a0000000-0000-4000-8000-0000000000ad', 'public.team_attendance_day((select d from dmon))') j;

insert into discard_i select pg_temp.chk('28 on a Monday, someone scheduled Mon/Wed/Fri is expected, someone scheduled Tue/Thu is ''not scheduled'', and someone with no schedule is ''schedule not set''',
  (select concat(pg_temp.person(j, 'b1000000-0000-4000-8000-0000000000a1')->>'expected', '/', pg_temp.person(j, 'b1000000-0000-4000-8000-0000000000a2')->>'expected', '/', pg_temp.person(j, 'b0000000-0000-4000-8000-0000000000b1')->>'expected') from r_mon),
  'yes/no/unknown');

insert into discard_i select pg_temp.chk('29 the weekend expects nobody who has a schedule',
  (select concat(pg_temp.person(j, 'b1000000-0000-4000-8000-0000000000a1')->>'expected', '/', pg_temp.person(j, 'b1000000-0000-4000-8000-0000000000a2')->>'expected') from (select pg_temp.j('a0000000-0000-4000-8000-0000000000ad', 'public.team_attendance_day((select d from dsat))') j) x),
  'no/no');

insert into discard_i select pg_temp.chk('30 a day read defaults to today in Phoenix and says so; a future day is refused',
  (select concat(pg_temp.tf(pg_temp.j('a0000000-0000-4000-8000-0000000000ad', 'public.team_attendance_day()')->>'date' = public.fn_phoenix_today()::text), '/', pg_temp.j('a0000000-0000-4000-8000-0000000000ad', 'public.team_attendance_day()')->>'is_today', '/', pg_temp.err('a0000000-0000-4000-8000-0000000000ad', 'public.team_attendance_day(public.fn_phoenix_today() + 1)'))),
  'yes/true/22023');

insert into discard_i select pg_temp.chk('31 someone whose start date is still ahead is on no day''s list yet',
  (select pg_temp.tf(pg_temp.person(j, 'b2000000-0000-4000-8000-000000000007') is null) from r_mon),
  'yes');

insert into discard_i select pg_temp.chk('32 nobody is marked yet, so every expected person reads Unmarked and the summary counts them',
  (select concat(pg_temp.person(j, 'b1000000-0000-4000-8000-0000000000a1')->>'status', '/', (j->'summary'->>'present'), '/', (j->'summary'->>'absent'), '/', (j->'summary'->>'excused'), '/', pg_temp.tf((j->'summary'->>'unmarked')::int >= 1), '/', pg_temp.tf((j->'summary'->>'expected')::int = (j->'summary'->>'unmarked')::int)) from r_mon),
  'unmarked/0/0/0/yes/yes');

insert into discard_i select pg_temp.act('m34', 'a0000000-0000-4000-8000-0000000000ad', $$public.set_workday_attendance('b1000000-0000-4000-8000-0000000000a1', (select d from dmon), 'present', null, null)$$);

insert into discard_i select pg_temp.chk('33 one tap marks Present; it keeps the stage and schedule as they were that moment and who marked it',
  (select concat(pg_temp.a('m34')->>'ok', '/', at.status::text, '/', at.stage_at_mark, '/', at.was_scheduled::text, '/', at.schedule_weekdays::text, '/', pg_temp.tf(at.marked_by is not null)) from public.agent_attendance at where at.agent_id = 'b1000000-0000-4000-8000-0000000000a1' and at.attendance_type = 'workday' and at.attendance_date = (select d from dmon)),
  'true/present/released_in_field/true/{1,3,5}/yes');

insert into discard_i select pg_temp.act('m35', 'a0000000-0000-4000-8000-0000000000ad', $$public.set_workday_attendance('b1000000-0000-4000-8000-0000000000a1', (select d from dmon), 'present', null, null)$$);

insert into discard_i select pg_temp.chk('34 pressing it again changes nothing, logs nothing and does not create a second row for the same person and day',
  (select concat(pg_temp.a('m35')->>'changed', '/', (select count(*) from public.agent_attendance where agent_id = 'b1000000-0000-4000-8000-0000000000a1' and attendance_date = (select d from dmon) and attendance_type = 'workday'), '/', (select count(*) from public.agent_attendance_events where agent_id = 'b1000000-0000-4000-8000-0000000000a1' and attendance_date = (select d from dmon)))),
  'false/1/1');

insert into discard_i select pg_temp.act('m36', 'a0000000-0000-4000-8000-0000000000ad', $$public.set_workday_attendance('b1000000-0000-4000-8000-0000000000a1', (select d from dmon), 'absent', 'present', 'called in')$$);

insert into discard_i select pg_temp.chk('35 a correction is allowed with the status it replaced recorded, plus an optional note',
  (select concat(pg_temp.a('m36')->>'ok', '/', (select at.status::text || ':' || coalesce(at.note, '') from public.agent_attendance at where at.agent_id = 'b1000000-0000-4000-8000-0000000000a1' and at.attendance_date = (select d from dmon) and at.attendance_type = 'workday'), '/', (select count(*) from public.agent_attendance_events where agent_id = 'b1000000-0000-4000-8000-0000000000a1' and attendance_date = (select d from dmon) and from_status = 'present' and to_status = 'absent'))),
  'true/absent:called in/1');

insert into discard_i select pg_temp.act('m37', 'a0000000-0000-4000-8000-0000000000ad', $$public.set_workday_attendance('b1000000-0000-4000-8000-0000000000a1', (select d from dmon), 'excused', 'present', null)$$);

insert into discard_i select pg_temp.chk('36 a stale screen (thinks Present, is Absent) gets a conflict with the real status and nothing changes',
  (select concat(pg_temp.a('m37')->>'ok', '/', pg_temp.a('m37')->>'conflict', '/', pg_temp.a('m37')->>'status', '/', (select status::text from public.agent_attendance where agent_id = 'b1000000-0000-4000-8000-0000000000a1' and attendance_date = (select d from dmon) and attendance_type = 'workday'))),
  'false/true/absent/absent');

insert into discard_i select pg_temp.act('m38', 'a0000000-0000-4000-8000-0000000000ad', $$public.set_workday_attendance('b1000000-0000-4000-8000-0000000000a1', (select d from dmon), 'unmarked', 'absent', null)$$);

insert into discard_i select pg_temp.chk('37 clearing returns to Unmarked (the row is removed) and is logged, so Undo is just marking again',
  (select concat(pg_temp.a('m38')->>'changed', '/', (select count(*) from public.agent_attendance where agent_id = 'b1000000-0000-4000-8000-0000000000a1' and attendance_date = (select d from dmon) and attendance_type = 'workday'), '/', (select count(*) from public.agent_attendance_events where agent_id = 'b1000000-0000-4000-8000-0000000000a1' and attendance_date = (select d from dmon) and to_status = 'unmarked'))),
  'true/0/1');

insert into discard_i select pg_temp.act('m39', 'a0000000-0000-4000-8000-0000000000ad', $$public.set_workday_attendance('b1000000-0000-4000-8000-0000000000a1', (select d from dmon), 'present', 'unmarked', null)$$);

insert into discard_i select pg_temp.act('m39b', 'a0000000-0000-4000-8000-0000000000ad', $$public.set_workday_attendance('b1000000-0000-4000-8000-0000000000a2', (select d from dmon), 'present', null, null)$$);

insert into discard_i select pg_temp.chk('38 someone NOT scheduled can still be marked Present (an extra day); they stay ''not scheduled'' and are not counted as unmarked or absent',
  (select concat(pg_temp.a('m39b')->>'ok', '/', pg_temp.person(j, 'b1000000-0000-4000-8000-0000000000a2')->>'expected', '/', pg_temp.person(j, 'b1000000-0000-4000-8000-0000000000a2')->>'status', '/', (select at.was_scheduled::text from public.agent_attendance at where at.agent_id = 'b1000000-0000-4000-8000-0000000000a2' and at.attendance_date = (select d from dmon) and at.attendance_type = 'workday')) from (select pg_temp.j('a0000000-0000-4000-8000-0000000000ad', 'public.team_attendance_day((select d from dmon))') j) x),
  'true/no/present/false');

insert into public.agent_work_commitments (agent_id, effective_from, weekdays) values ('b1000000-0000-4000-8000-0000000000a1', public.fn_phoenix_today() - 1, array[2]::smallint[]) on conflict do nothing;

insert into discard_i select pg_temp.chk('39 changing the schedule later does not rewrite a past mark: it still says what was true when it was taken',
  (select concat(at.was_scheduled::text, '/', at.schedule_weekdays::text) from public.agent_attendance at where at.agent_id = 'b1000000-0000-4000-8000-0000000000a1' and at.attendance_date = (select d from dmon) and at.attendance_type = 'workday'),
  'true/{1,3,5}');

insert into discard_i select pg_temp.chk('40 a mark for tomorrow is refused, as is a status that does not exist',
  concat(pg_temp.err('a0000000-0000-4000-8000-0000000000ad', $$public.set_workday_attendance('b1000000-0000-4000-8000-0000000000a1', public.fn_phoenix_today() + 1, 'present', null, null)$$), '/', pg_temp.err('a0000000-0000-4000-8000-0000000000ad', $$public.set_workday_attendance('b1000000-0000-4000-8000-0000000000a1', (select d from dmon), 'late', null, null)$$)),
  '22023/22023');

insert into discard_i select pg_temp.chk('41 manager B, a VA and a plain agent cannot mark manager A''s hire; manager A can',
  concat(pg_temp.err('a0000000-0000-4000-8000-0000000000b1', $$public.set_workday_attendance('b1000000-0000-4000-8000-0000000000a2', (select d from dtue), 'present', null, null)$$), '/', pg_temp.err('a0000000-0000-4000-8000-0000000000c1', $$public.set_workday_attendance('b1000000-0000-4000-8000-0000000000a2', (select d from dtue), 'present', null, null)$$), '/', pg_temp.err('a0000000-0000-4000-8000-0000000000d1', $$public.set_workday_attendance('b1000000-0000-4000-8000-0000000000a2', (select d from dtue), 'present', null, null)$$), '/', pg_temp.err('a0000000-0000-4000-8000-0000000000a1', $$public.set_workday_attendance('b1000000-0000-4000-8000-0000000000a2', (select d from dtue), 'present', null, null)$$)),
  '42501/42501/42501/allowed');

insert into discard_i select pg_temp.chk('42 manager A reads only their own team''s attendance; a VA reads everyone; a plain agent is refused (an error, not an empty list)',
  (select concat((select string_agg(e->>'display_name', ',' order by e->>'display_name') from jsonb_array_elements(pg_temp.j('a0000000-0000-4000-8000-0000000000a1', 'public.team_attendance_day()')->'people') e where e->>'display_name' like 'ZZ SYN%' and e->>'display_name' not like 'ZZ SYN Map%'), '|', (select count(*) from jsonb_array_elements(pg_temp.j('a0000000-0000-4000-8000-0000000000c1', 'public.team_attendance_day()')->'people') e where e->>'display_name' like 'ZZ SYN%' and e->>'display_name' not like 'ZZ SYN Map%'), '|', pg_temp.err('a0000000-0000-4000-8000-0000000000d1', 'public.team_attendance_day()'))),
  'ZZ SYN BrandNew,ZZ SYN HireA1,ZZ SYN HireA2,ZZ SYN MgrA|7|42501');

create temp table dwed as select pg_temp.last_dow(3) d; grant select on dwed to public;

insert into discard_i select pg_temp.act('b44a', 'a0000000-0000-4000-8000-0000000000ad', $$public.set_workday_attendance('b1000000-0000-4000-8000-0000000000a2', (select d from dwed), 'excused', null, null)$$);

create temp table pre_bulk as select count(*) n from public.agent_attendance_events;

insert into discard_i select pg_temp.act('b44', 'a0000000-0000-4000-8000-0000000000ad', $$public.set_workday_attendance_bulk((select d from dwed), array['b1000000-0000-4000-8000-0000000000a1','b1000000-0000-4000-8000-0000000000a2','b0000000-0000-4000-8000-0000000000a1','b0000000-0000-4000-8000-0000000000b1']::uuid[], 'present')$$);

insert into discard_i select pg_temp.chk('43 a bulk mark changes only people who are still unmarked, never overwrites someone already marked, and reports what it skipped',
  (select concat(pg_temp.a('b44')->>'applied', '/', pg_temp.a('b44')->>'skipped_already_marked', '/', pg_temp.a('b44')->>'denied', '/', (select status::text from public.agent_attendance where agent_id = 'b1000000-0000-4000-8000-0000000000a2' and attendance_date = (select d from dwed) and attendance_type = 'workday'))),
  '3/1/0/excused');

insert into discard_i select pg_temp.chk('44 a bulk mark by a manager skips people outside their team and says so',
  (select concat(j->>'applied', '/', j->>'denied') from (select pg_temp.j('a0000000-0000-4000-8000-0000000000a1', $$public.set_workday_attendance_bulk((select d from dtue), array['b1000000-0000-4000-8000-0000000000a1','b1000000-0000-4000-8000-0000000000b1']::uuid[], 'absent')$$) j) x),
  '1/1');

insert into discard_i select pg_temp.chk('45 bulk accepts only Present, Absent or Excused, needs people chosen, and is capped',
  concat(pg_temp.err('a0000000-0000-4000-8000-0000000000ad', $$public.set_workday_attendance_bulk((select d from dtue), array['b1000000-0000-4000-8000-0000000000a1']::uuid[], 'unmarked')$$), '/', pg_temp.err('a0000000-0000-4000-8000-0000000000ad', $$public.set_workday_attendance_bulk((select d from dtue), array[]::uuid[], 'present')$$), '/', pg_temp.err('a0000000-0000-4000-8000-0000000000ad', $$public.set_workday_attendance_bulk((select d from dtue), (select array_agg(gen_random_uuid()) from generate_series(1, 201)), 'present')$$), '/', pg_temp.err('a0000000-0000-4000-8000-0000000000c1', $$public.set_workday_attendance_bulk((select d from dtue), array['b1000000-0000-4000-8000-0000000000a1']::uuid[], 'present')$$)),
  '22023/22023/22023/allowed');

insert into discard_i select pg_temp.chk('46 …and a VA''s bulk mark changes nobody (everyone is denied)',
  (select concat(j->>'applied', '/', j->>'denied') from (select pg_temp.j('a0000000-0000-4000-8000-0000000000c1', $$public.set_workday_attendance_bulk((select d from dtue), array['b1000000-0000-4000-8000-0000000000b1']::uuid[], 'present')$$) j) x),
  '0/1');

-- ── 4. the audit trail and access ─────────────────────────────────────────────────────────────────────────────

insert into discard_i select pg_temp.chk('47 the three audit tables cannot be edited or erased, even by the table owner',
  concat(left(pg_temp.try($$update public.agent_attendance_events set note = 'x' where id = (select min(id) from public.agent_attendance_events)$$), 5), '/', left(pg_temp.try($$delete from public.agent_stage_events where id = (select min(id) from public.agent_stage_events)$$), 5), '/', left(pg_temp.try($$delete from public.agent_work_commitment_events where id = (select min(id) from public.agent_work_commitment_events)$$), 5)),
  '42501/42501/42501');

insert into discard_i select pg_temp.chk('48 no anonymous access to any entry point; the internal helpers are not callable by a signed-in user',
  concat(has_function_privilege('anon', 'public.team_attendance_day(date)', 'execute'), '/', has_function_privilege('anon', 'public.set_workday_attendance(uuid,date,text,text,text)', 'execute'), '/', has_function_privilege('anon', 'public.team_people_facts()', 'execute'), '/', has_function_privilege('authenticated', 'public.fn_workday_apply(uuid,date,text,text,text,uuid)', 'execute'), '/', has_function_privilege('authenticated', 'public.fn_team_population()', 'execute')),
  'f/f/f/f/f');

insert into discard_i select pg_temp.chk('49 the new tables cannot be read or written directly by a signed-in user',
  concat(has_table_privilege('authenticated', 'public.agent_stage', 'select'), '/', has_table_privilege('authenticated', 'public.agent_work_commitments', 'insert'), '/', has_table_privilege('authenticated', 'public.agent_attendance_events', 'insert')),
  'f/f/f');

insert into discard_i select pg_temp.chk('50 a manager sees audit rows for their own team only (realtime scope)',
  concat(pg_temp.j('a0000000-0000-4000-8000-0000000000b1', $$(select count(*) from public.agent_attendance_events where agent_id = 'b1000000-0000-4000-8000-0000000000a1')$$), '/', pg_temp.tf((pg_temp.j('a0000000-0000-4000-8000-0000000000a1', $$(select count(*) from public.agent_attendance_events where agent_id = 'b1000000-0000-4000-8000-0000000000a1')$$))::text::int > 0)),
  '0/yes');

insert into discard_i select pg_temp.chk('51 the people read gives each person''s sign-in and invitation state separately, and ''none'' when there is no invitation',
  (select concat(e->'access'->>'has_login', '/', e->'access'->>'invitation') from jsonb_array_elements(pg_temp.j('a0000000-0000-4000-8000-0000000000ad', 'public.team_people_facts()')->'people') e where e->>'agent_id' = 'b1000000-0000-4000-8000-0000000000a1'),
  'false/none');

insert into discard_i select pg_temp.chk('52 the people read is scoped: manager A sees only their team, a plain agent is refused',
  (select concat((select count(*) from jsonb_array_elements(pg_temp.j('a0000000-0000-4000-8000-0000000000a1', 'public.team_people_facts()')->'people') e where e->>'agent_id' in ('b1000000-0000-4000-8000-0000000000a1', 'b1000000-0000-4000-8000-0000000000a2', 'b0000000-0000-4000-8000-0000000000a1')), '|', (select count(*) from jsonb_array_elements(pg_temp.j('a0000000-0000-4000-8000-0000000000a1', 'public.team_people_facts()')->'people') e where e->>'agent_id' = 'b1000000-0000-4000-8000-0000000000b1'), '|', pg_temp.err('a0000000-0000-4000-8000-0000000000d1', 'public.team_people_facts()'))),
  '3|0|42501');

-- ── 5. a re-run never resets anything, and the read is not capped ──────────────────────────────────────────

create temp table before_rerun2 as select
  (select count(*) from public.agent_attendance where attendance_type = 'workday') att,
  (select string_agg(agent_id || attendance_date::text || status::text, '|' order by agent_id, attendance_date) from public.agent_attendance where attendance_type = 'workday') att_fp,
  (select string_agg(agent_id || effective_from::text || weekdays::text, '|' order by agent_id, effective_from) from public.agent_work_commitments) wc_fp,
  (select string_agg(agent_id || stage || source, '|' order by agent_id) from public.agent_stage) st_fp,
  (select count(*) from public.agent_attendance_events) ev;

-- @@MIGRATION_RERUN2@@

insert into discard_i select pg_temp.chk('53 after re-running the migration every attendance mark, work commitment and stage is exactly as it was',
  (select concat(
  pg_temp.tf((select att from before_rerun2) = (select count(*) from public.agent_attendance where attendance_type = 'workday')), '/',
  pg_temp.tf((select att_fp from before_rerun2) is not distinct from (select string_agg(agent_id || attendance_date::text || status::text, '|' order by agent_id, attendance_date) from public.agent_attendance where attendance_type = 'workday')), '/',
  pg_temp.tf((select wc_fp from before_rerun2) is not distinct from (select string_agg(agent_id || effective_from::text || weekdays::text, '|' order by agent_id, effective_from) from public.agent_work_commitments)), '/',
  pg_temp.tf((select st_fp from before_rerun2) is not distinct from (select string_agg(agent_id || stage || source, '|' order by agent_id) from public.agent_stage)), '/',
  pg_temp.tf((select ev from before_rerun2) = (select count(*) from public.agent_attendance_events)))),
  'yes/yes/yes/yes/yes');

insert into public.agents (id, display_name, agent_code, status, license_status, created_at) select ('b3000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, 'ZZ SYN Bulk ' || lpad(g::text, 4, '0'), 'ZZ-BK' || g, 'active', 'licensed', now() - interval '30 days' from generate_series(1, 1200) g;

create temp table t0 as select clock_timestamp() t; create temp table r_big as select pg_temp.j('a0000000-0000-4000-8000-0000000000ad', 'public.team_attendance_day()') j; create temp table r_big_facts as select pg_temp.j('a0000000-0000-4000-8000-0000000000ad', 'public.team_people_facts()') j;

insert into discard_i select pg_temp.chk('54 all 1,200 extra people come back in one attendance read and one people read, with counts that match the lists (no 1,000-row cap)',
  (select concat(pg_temp.tf((select count(*) from jsonb_array_elements(r_big.j->'people') e where e->>'display_name' like 'ZZ SYN Bulk%') = 1200), '/', pg_temp.tf((r_big.j->'summary'->>'total')::int = jsonb_array_length(r_big.j->'people')), '/', pg_temp.tf((select count(*) from jsonb_array_elements(r_big_facts.j->'people') e where e->>'agent_id' like 'b3000000%') = 1200), '/', pg_temp.tf((r_big_facts.j->'counts'->>'people')::int = jsonb_array_length(r_big_facts.j->'people'))) from r_big, r_big_facts),
  'yes/yes/yes/yes');

insert into discard_i select pg_temp.chk('55 both reads together take under 8 seconds',
  pg_temp.tf(clock_timestamp() - (select t from t0) < interval '8 seconds'),
  'yes');

select test, outcome, expected, case when pass then 'PASS' else 'FAIL' end verdict from results order by n;
rollback;
