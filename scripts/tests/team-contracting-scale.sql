-- Scale proof for team_contracting_status(): 1,200 people and 4,800 checkoffs come back in ONE response, inside the
-- 8 s statement timeout that the `authenticated` role runs under. Ends in ROLLBACK; nothing persists.
-- Triggers are switched off ONLY for the bulk insert (session_replication_role = replica) so the test measures the read,
-- not the signup/notification triggers.
begin;
create temp table results(n serial, test text, outcome text, expected text, pass boolean);
grant all on results to public;
insert into auth.users (id) values ('a0000000-0000-4000-8000-0000000000a1');
insert into public.user_roles (user_id, role) values ('a0000000-0000-4000-8000-0000000000a1', 'manager') on conflict do nothing;
insert into public.agents (id, user_id, display_name, agent_code, status, license_status, created_at) values
  ('b0000000-0000-4000-8000-0000000000a1', 'a0000000-0000-4000-8000-0000000000a1', 'ZZ SYN MgrA', 'ZZ-MA', 'active', 'licensed', now() - interval '200 days');
update public.contracting_followup_config set clock_basis = 'hired' where singleton;
-- ── 9. scale: 1,200 more people and 4,800 checkoffs, single response, inside the 8 s role limit ──────────────
set local session_replication_role = replica;
insert into public.agents (id, display_name, agent_code, status, license_status, created_at, manager_id)
select gen_random_uuid(), 'ZZ SYN Bulk ' || g, 'ZZ-BK' || g, 'active', 'licensed', now() - interval '2 days', 'b0000000-0000-4000-8000-0000000000a1' from generate_series(1, 1200) g;
insert into public.agent_contract_checkoffs (agent_id, contract_key, checked_by)
select a.id, k.key, 'a0000000-0000-4000-8000-0000000000a1' from public.agents a cross join public.contract_checkoff_keys k where a.agent_code like 'ZZ-BK%';
set local session_replication_role = origin;
create temp table bigres(n int, took interval);
do $$
declare r jsonb; t0 timestamptz := clock_timestamp();
begin
  perform set_config('request.jwt.claims', json_build_object('sub','a0000000-0000-4000-8000-0000000000a1','role','authenticated')::text, true);
  execute 'set local role authenticated';
  perform set_config('statement_timeout', '8000', true);
  r := public.team_contracting_status();
  execute 'reset role';
  insert into bigres values ((select count(*)::int from jsonb_array_elements(r->'people') p where p->>'display_name' like 'ZZ SYN Bulk%'), clock_timestamp() - t0);
end $$;
insert into results(test, outcome, expected, pass)
select '32 pagination: all 1,200 bulk people returned in one response (no 1000-row cap)', (select n::text from bigres), '1200', null;
update results set pass = (outcome = expected) where n = (select max(n) from results);
insert into results(test, outcome, expected, pass)
select '33 bulk read finished inside the authenticated role timeout (took ' || (select took::text from bigres) || ')', (case when (select took from bigres) < interval '8 seconds' then 'ok' else 'too slow' end), 'ok', null;
update results set pass = (outcome = expected) where n = (select max(n) from results);

select test, outcome, expected, case when pass then 'PASS' else 'FAIL' end verdict from results order by n;
rollback;
