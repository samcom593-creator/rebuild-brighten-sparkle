-- Behavioural proof for search_people (migration 20261009210000). ROLLBACK at the end; synthetic people only.
-- Run:  python3 scripts/tests/run-search-people.py     Expected: every row PASS.
begin;
create temp table results(n serial, test text, outcome text, expected text, pass boolean);
grant all on results to public; grant usage on sequence results_n_seq to public;
create temp table discard_i(x int);
create or replace function pg_temp.chk(t text, o text, e text) returns int language sql as $$
  insert into results(test, outcome, expected, pass) values (t, o, e, o is not distinct from e); select 1 $$;
create or replace function pg_temp.j(uid uuid, expr text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  begin execute 'select to_jsonb(' || expr || ')' into r; exception when others then r := jsonb_build_object('_err', sqlstate); end;
  execute 'reset role'; return r;
end $$;
create or replace function pg_temp.names(j jsonb, k text) returns text language sql as $$
  select coalesce(string_agg(e->>'name', ',' order by e->>'name'), '') from jsonb_array_elements(j->k) e where e->>'name' like 'ZZ SYN%' $$;

insert into auth.users (id) values ('a0000000-0000-4000-8000-0000000000ad'), ('a0000000-0000-4000-8000-0000000000a1'), ('a0000000-0000-4000-8000-0000000000b1'), ('a0000000-0000-4000-8000-0000000000d1'), ('a0000000-0000-4000-8000-0000000000e1');
insert into public.user_roles (user_id, role) values ('a0000000-0000-4000-8000-0000000000ad', 'admin'), ('a0000000-0000-4000-8000-0000000000a1', 'manager'), ('a0000000-0000-4000-8000-0000000000b1', 'manager'), ('a0000000-0000-4000-8000-0000000000d1', 'agent') on conflict do nothing;
insert into public.agents (id, user_id, display_name, agent_code, status, license_status, created_at, manager_id) values
  ('b0000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-0000000000a1', 'ZZ SYN MgrA', 'ZZ-MA', 'active', 'licensed', now() - interval '200 days', null),
  ('b0000000-0000-4000-8000-0000000000b1', 'a0000000-0000-4000-8000-0000000000b1', 'ZZ SYN MgrB', 'ZZ-MB', 'active', 'licensed', now() - interval '200 days', null),
  ('b0000000-0000-4000-8000-0000000000e1', 'a0000000-0000-4000-8000-0000000000e1', 'ZZ SYN Alonzo Johnson', 'ZZ-AJ', 'active', 'licensed', now() - interval '20 days', 'b0000000-0000-4000-8000-0000000000a1');
insert into public.profiles (user_id, email, full_name, phone) values ('a0000000-0000-4000-8000-0000000000e1', 'zz.alonzo@example.invalid', 'ZZ SYN Alonzo Johnson', '(602) 555-0199') on conflict (user_id) do update set email = excluded.email, full_name = excluded.full_name, phone = excluded.phone;
insert into public.agents (id, display_name, agent_code, status, license_status, created_at, manager_id) values
  ('b1000000-0000-4000-8000-0000000000b1', 'ZZ SYN Bea Johnson', 'ZZ-BJ', 'active', 'licensed', now() - interval '6 days', 'b0000000-0000-4000-8000-0000000000b1'),
  ('b1000000-0000-4000-8000-0000000000b2', 'ZZ SYN Carl 100% Percent', 'ZZ-CP', 'inactive', 'licensed', now() - interval '6 days', 'b0000000-0000-4000-8000-0000000000b1'),
  ('b2000000-0000-4000-8000-000000000003', 'ZZ SYN Ghost Johnson', 'GHOST_ZZ', 'active', 'licensed', now(), 'b0000000-0000-4000-8000-0000000000a1');
insert into public.applications (id, first_name, last_name, email, phone, hiring_manager_user_id) values
  ('c0000000-0000-4000-8000-000000000001', 'ZZ SYN Dana', 'Johnson', 'zz.dana@example.invalid', '6025550123', 'a0000000-0000-4000-8000-0000000000b1');

insert into discard_i select pg_temp.chk('1 admin: any piece of a name in any order finds the person',
  concat(pg_temp.names(pg_temp.j('a0000000-0000-4000-8000-0000000000ad', $$public.search_people('johnson alonzo')$$), 'agents'), '|', pg_temp.names(pg_temp.j('a0000000-0000-4000-8000-0000000000ad', $$public.search_people('alon john')$$), 'agents')),
  'ZZ SYN Alonzo Johnson|ZZ SYN Alonzo Johnson');
insert into discard_i select pg_temp.chk('2 a shared last name lists every match, prefix matches first, and the sync-only placeholder never',
  (select string_agg(e->>'name', ',') from jsonb_array_elements(pg_temp.j('a0000000-0000-4000-8000-0000000000ad', $$public.search_people('johnson')$$)->'agents') e where e->>'name' like 'ZZ SYN%'),
  'ZZ SYN Alonzo Johnson,ZZ SYN Bea Johnson');
insert into discard_i select pg_temp.chk('3 email, phone digits and agent code all find the person',
  concat(pg_temp.names(pg_temp.j('a0000000-0000-4000-8000-0000000000ad', $$public.search_people('zz.alonzo@')$$), 'agents'), '|', pg_temp.names(pg_temp.j('a0000000-0000-4000-8000-0000000000ad', $$public.search_people('6025550199')$$), 'agents'), '|', pg_temp.names(pg_temp.j('a0000000-0000-4000-8000-0000000000ad', $$public.search_people('ZZ-AJ')$$), 'agents')),
  'ZZ SYN Alonzo Johnson|ZZ SYN Alonzo Johnson|ZZ SYN Alonzo Johnson');
insert into discard_i select pg_temp.chk('4 LIKE metacharacters are text, not wildcards: 100% finds Carl, a lone % finds nobody',
  concat(pg_temp.names(pg_temp.j('a0000000-0000-4000-8000-0000000000ad', $$public.search_people('100%')$$), 'agents'), '|', (pg_temp.j('a0000000-0000-4000-8000-0000000000ad', $$public.search_people('%%')$$)->'agents')::text),
  'ZZ SYN Carl 100% Percent|[]');
insert into discard_i select pg_temp.chk('5 applicants are found by any piece too, in their own list, with status',
  (select concat(e->>'name', '/', (e->>'status') is not null) from jsonb_array_elements(pg_temp.j('a0000000-0000-4000-8000-0000000000ad', $$public.search_people('dana john')$$)->'applicants') e where e->>'name' like 'ZZ SYN%'),
  'ZZ SYN Dana Johnson/t');
insert into discard_i select pg_temp.chk('6 manager A finds only their own downline; the applicant belongs to manager B',
  concat(pg_temp.names(pg_temp.j('a0000000-0000-4000-8000-0000000000a1', $$public.search_people('johnson')$$), 'agents'), '|', pg_temp.names(pg_temp.j('a0000000-0000-4000-8000-0000000000a1', $$public.search_people('johnson')$$), 'applicants')),
  'ZZ SYN Alonzo Johnson|');
insert into discard_i select pg_temp.chk('7 manager B finds their hire and their applicant, not manager A''s',
  concat(pg_temp.names(pg_temp.j('a0000000-0000-4000-8000-0000000000b1', $$public.search_people('johnson')$$), 'agents'), '|', pg_temp.names(pg_temp.j('a0000000-0000-4000-8000-0000000000b1', $$public.search_people('johnson')$$), 'applicants')),
  'ZZ SYN Bea Johnson|ZZ SYN Dana Johnson');
insert into discard_i select pg_temp.chk('8 a plain agent gets an empty result (never an error that looks like a crash, never other people)',
  (pg_temp.j('a0000000-0000-4000-8000-0000000000d1', $$public.search_people('johnson')$$))::text, '{"ok": true, "agents": [], "applicants": []}');
insert into discard_i select pg_temp.chk('9 one character is too short; anon cannot execute',
  concat((pg_temp.j('a0000000-0000-4000-8000-0000000000ad', $$public.search_people('j')$$)->'agents')::text, '/', has_function_privilege('anon', 'public.search_people(text,integer)', 'execute')), '[]/f');
insert into discard_i select pg_temp.chk('10 the limit is honoured and capped',
  (select concat(jsonb_array_length(pg_temp.j('a0000000-0000-4000-8000-0000000000ad', $$public.search_people('johnson', 1)$$)->'agents'), '/', jsonb_array_length(pg_temp.j('a0000000-0000-4000-8000-0000000000ad', $$public.search_people('zz syn', 500)$$)->'agents') <= 25)), '1/t');
select test, outcome, expected, case when pass then 'PASS' else 'FAIL' end verdict from results order by n;
rollback;
