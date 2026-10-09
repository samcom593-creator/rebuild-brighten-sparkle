-- Behavioural proof for migration 20261009190000 (retire the old contracting delivery pipeline).
-- One transaction that ends in ROLLBACK. A synthetic contracting intake is inserted and the test shows that NOTHING is
-- queued for it, that existing history is untouched, that a re-run changes nothing, and that the status view cannot read
-- true by being empty. The runner substitutes the real migration at the two markers (and a deliberately broken copy for the
-- mutation proofs), so the file that ships is the file that is proven.
-- Run:  python3 scripts/tests/run-legacy-contracting-retired.py     Expected: every row PASS.
begin;

create temp table results(n serial, test text, outcome text, expected text, pass boolean);
grant all on results to public;
grant usage on sequence results_n_seq to public;
create temp table discard_i(x int);
create or replace function pg_temp.chk(t text, o text, e text) returns int language sql as $$
  insert into results(test, outcome, expected, pass) values (t, o, e, o is not distinct from e); select 1
$$;

-- history as it stands before anything in this test runs
create temp table hist as select
  (select count(*) from public.contracting_intakes) intakes,
  (select count(*) from public.contracting_intake_deliveries) deliveries,
  (select count(*) from public.outbox_events where aggregate_type = 'contracting_intake') outbox,
  (select count(*) from public.outbox_events) outbox_all;

-- @@MIGRATION_UNDER_TEST@@

-- a synthetic intake, the same shape a hire made through the hire link would create: it arrives without an NPN and gains one,
-- which is exactly the event the 'NPN added' trigger used to react to
insert into public.contracting_intakes (id, first_name, last_name, email, phone_e164, npn, status, idempotency_key, source, license_status)
values ('c0ffee00-0000-4000-8000-000000000001', 'ZZ', 'SYN Retired', 'zz.retired.syn@example.invalid', '+15555550123', null, 'accepted', 'zz-retired-syn-1', 'magic_hire_link', 'unlicensed');
update public.contracting_intakes set npn = '5550012', license_status = 'licensed' where id = 'c0ffee00-0000-4000-8000-000000000001';

insert into discard_i select pg_temp.chk('1 a new intake creates no private-channel, spreadsheet or email leg',
  (select count(*)::text from public.contracting_intake_deliveries where intake_id = 'c0ffee00-0000-4000-8000-000000000001'), '0');
insert into discard_i select pg_temp.chk('2 …and queues no Slack or any other outbox event, on insert or when an NPN is added',
  (select count(*)::text from public.outbox_events where aggregate_id = 'c0ffee00-0000-4000-8000-000000000001'), '0');
insert into discard_i select pg_temp.chk('3 the register holds exactly the four things that were switched off, with their prior state and a way back',
  (select concat(count(*), '/', count(*) filter (where prior_state is not null and revert_hint <> ''), '/', string_agg(distinct prior_state, ',')) from public.contracting_legacy_retirements), '4/4/active,enabled');
insert into discard_i select pg_temp.chk('4 each item reads as switched off from the catalog itself, not from the register''s word',
  (select string_agg(item || '=' || actual_state, ' ' order by item) from public.v_contracting_legacy_retirement),
  'contracting_intakes.trg_ensure_contracting_legs=disabled contracting_intakes.trg_queue_contracting_slack=disabled contracting_intakes.trg_queue_contracting_slack_npn_added=disabled cron.aflac-checkoff-reminder=inactive');
insert into discard_i select pg_temp.chk('5 the summary says retired',
  (select concat(retired_ok::text, '/', registered, '/', still_off, '/', expected_items) from public.v_contracting_legacy_retired), 'true/4/4/4');
insert into discard_i select pg_temp.chk('6 what was deliberately left running is still running (profile enrichment and the route guards)',
  (select string_agg(tgname || '=' || case tgenabled when 'D' then 'off' else 'on' end, ' ' order by tgname) from pg_trigger
    where not tgisinternal and tgname in ('contracting_intakes_enrich_profile', 'trg_contracting_delivery_route_guard', 'trg_contracting_outbox_route_guard')),
  'contracting_intakes_enrich_profile=on trg_contracting_delivery_route_guard=on trg_contracting_outbox_route_guard=on');
insert into discard_i select pg_temp.chk('7 nothing already written was touched: intakes (plus the one synthetic), deliveries and outbox rows are as they were',
  (select concat((select count(*) from public.contracting_intakes) - (select intakes from hist), '/', (select count(*) from public.contracting_intake_deliveries) - (select deliveries from hist), '/',
                 (select count(*) from public.outbox_events where aggregate_type = 'contracting_intake') - (select outbox from hist), '/', (select count(*) from public.outbox_events) - (select outbox_all from hist))), '1/0/0/0');
insert into discard_i select pg_temp.chk('8 the status views are service-role only; the register is admin-readable only',
  (select concat(has_table_privilege('authenticated', 'public.v_contracting_legacy_retired', 'select'), '/', has_table_privilege('anon', 'public.v_contracting_legacy_retirement', 'select'), '/',
                 has_table_privilege('authenticated', 'public.contracting_legacy_retirements', 'insert'))), 'f/f/f');

create temp table before_rerun as select string_agg(item || prior_state || retired_at::text || revert_hint, '|' order by item) fp, count(*) n from public.contracting_legacy_retirements;
-- @@MIGRATION_RERUN@@
insert into discard_i select pg_temp.chk('9 re-running the migration changes nothing in the register (prior state and time are kept)',
  (select concat((select n from before_rerun) = count(*), '/', (select fp from before_rerun) is not distinct from string_agg(item || prior_state || retired_at::text || revert_hint, '|' order by item)) from public.contracting_legacy_retirements), 't/t');
insert into public.contracting_intakes (id, first_name, last_name, email, phone_e164, npn, status, idempotency_key, source, license_status)
values ('c0ffee00-0000-4000-8000-000000000002', 'ZZ', 'SYN Retired Two', 'zz.retired.syn2@example.invalid', '+15555550124', '5550013', 'accepted', 'zz-retired-syn-2', 'add_agent', 'licensed');
insert into discard_i select pg_temp.chk('10 …and after the re-run a second synthetic intake still queues nothing',
  (select concat((select count(*) from public.contracting_intake_deliveries where intake_id = 'c0ffee00-0000-4000-8000-000000000002'), '/', (select count(*) from public.outbox_events where aggregate_id = 'c0ffee00-0000-4000-8000-000000000002'))), '0/0');

-- the status cannot pass by being empty or by one item coming back
alter table public.contracting_intakes enable trigger trg_queue_contracting_slack;
insert into discard_i select pg_temp.chk('11 if one switched-off trigger is switched back on, the summary reads false and names the count',
  (select concat(retired_ok::text, '/', still_off) from public.v_contracting_legacy_retired), 'false/3');
alter table public.contracting_intakes disable trigger trg_queue_contracting_slack;
delete from public.contracting_legacy_retirements where item = 'cron.aflac-checkoff-reminder';
insert into discard_i select pg_temp.chk('12 if the register is emptied or short, the summary reads false instead of passing for lack of anything to check',
  (select concat(retired_ok::text, '/', registered) from public.v_contracting_legacy_retired), 'false/3');
delete from public.contracting_legacy_retirements;
insert into discard_i select pg_temp.chk('13 …including when it is completely empty (one row, false, not a blank result)',
  (select concat(count(*), '/', bool_and(retired_ok)::text) from public.v_contracting_legacy_retired), '1/false');

select test, outcome, expected, case when pass then 'PASS' else 'FAIL' end verdict from results order by n;
rollback;
