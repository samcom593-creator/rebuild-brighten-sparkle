// Execute the producer migrations in isolated PostgreSQL using synthetic records.
// Usage: node scripts/tests/producer-workspace.mjs /path/to/@electric-sql/pglite/dist/index.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : '@electric-sql/pglite');
const db = new PGlite();
const userA = '11111111-1111-4111-8111-111111111111';
const userB = '22222222-2222-4222-8222-222222222222';
const agentA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const aliasA = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const agentB = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1';
const clientA = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1';
const clientB = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc2';
const sharedClient = 'cccccccc-cccc-4ccc-8ccc-ccccccccccc3';
const providerA = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1';
const providerB = 'dddddddd-dddd-4ddd-8ddd-ddddddddddd2';
await db.exec(`
create role anon; create role authenticated; create schema auth;
create table auth.users(id uuid primary key);
insert into auth.users values ('${userA}'),('${userB}');
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('fixture.uid',true),'')::uuid$$;
create function public.apex_is_admin() returns boolean language sql as $$select coalesce(current_setting('fixture.role',true)='admin',false)$$;
create function public.fn_user_login_blocked(uuid) returns boolean language sql as $$select coalesce(current_setting('fixture.blocked',true)='yes',false)$$;
create function public.fn_user_is_suspended(uuid) returns boolean language sql as $$select coalesce(current_setting('fixture.suspended',true)='yes',false)$$;
create function public.fn_agent_is_suspended(uuid) returns boolean language sql as $$select coalesce(current_setting('fixture.agent_suspended',true)='yes',false)$$;
create function public.can_view_sold_calls() returns boolean language sql as $$select coalesce(current_setting('fixture.raw_access',true)='yes',false)$$;
-- Match the production enum so invalid text fallbacks fail during migration creation.
create type public.agent_status as enum ('active','inactive','pending','terminated');
create table public.agents(id uuid primary key,user_id uuid,canonical_agent_id uuid,status public.agent_status default 'active',is_deactivated boolean default false,is_inactive boolean default false);
insert into public.agents(id,user_id,canonical_agent_id) values ('${agentA}','${userA}',null),('${aliasA}',null,'${agentA}'),('${agentB}','${userB}',null);
create table public.team_goals(agent_id uuid,period_start date,period_end date,personal_ap_goal numeric,team_ap_goal numeric);
insert into public.team_goals values ('${agentA}',date_trunc('month',now() at time zone 'America/Phoenix')::date,(date_trunc('month',now() at time zone 'America/Phoenix') + interval '1 month - 1 day')::date,10000,999999);
-- The canonical view is an authoritative input contract, populated without customer data.
create table public.fixture_production(row_key text,agent_id uuid,annual_premium numeric,posted_date date,synced_at timestamptz default now());
create view public.v_production_canonical as select * from public.fixture_production;
insert into public.fixture_production(row_key,agent_id,annual_premium,posted_date) values
('own','${agentA}',1000,(now() at time zone 'America/Phoenix')::date),
('alias','${aliasA}',1500,(now() at time zone 'America/Phoenix')::date),
('other','${agentB}',9000,(now() at time zone 'America/Phoenix')::date);
insert into public.fixture_production(row_key,agent_id,annual_premium,posted_date)
select 'prior-'||g,'${agentA}',1200,(date_trunc('month',now() at time zone 'America/Phoenix') - interval '1 day')::date from generate_series(1,3) g;
create table public.carrier_book_policies(agent_id uuid,status_bucket text,annual_premium numeric,sold_on date,effective_on date,updated_at timestamptz,last_seen_on date);
create table public.agentlink_clients(id uuid primary key,agent_id uuid references public.agents(id),phone text);
insert into public.agentlink_clients values ('${clientA}','${agentA}','+1 (602) 555-0101'),('${clientB}','${agentB}','+1 (602) 555-0101');
create table public.readymode_dialer_calls(id uuid primary key default gen_random_uuid(),agent_id uuid,external_call_id text,call_started_at timestamptz,call_ended_at timestamptz,duration_seconds integer,disposition text,lead_phone10 text,recording_url text,imported_at timestamptz default now(),updated_at timestamptz default now());
insert into public.readymode_dialer_calls(id,agent_id,external_call_id,call_started_at,call_ended_at,duration_seconds,disposition,lead_phone10,recording_url) values
('${providerA}','${aliasA}','call-a',now()-interval '5 minutes',now(),300,'Completed Sale','6025550101','https://example.test/recording-a'),
('${providerB}','${agentB}','call-b',now()-interval '5 minutes',now(),300,'Completed Sale','6025550101','https://example.test/recording-b');
insert into public.readymode_dialer_calls(agent_id,external_call_id,call_started_at,call_ended_at,duration_seconds,disposition,lead_phone10)
select '${agentA}','sample-'||g,now()-interval '10 days',now()-interval '10 days'+interval '2 minutes',120,case when g<=3 then 'Completed Sale' else 'Not Available' end,'6025550199' from generate_series(1,30) g;
-- An accidental repeated source event must not inflate the activity plan.
insert into public.readymode_dialer_calls(agent_id,external_call_id,call_started_at,call_ended_at,duration_seconds,disposition,lead_phone10)
select agent_id,external_call_id,call_started_at,call_ended_at,duration_seconds,disposition,lead_phone10 from public.readymode_dialer_calls where external_call_id='sample-1';
create table public.readymode_call_transcripts(id uuid primary key default gen_random_uuid(),call_id uuid,raw_text text,transcribed_at timestamptz default now());
insert into public.readymode_call_transcripts(call_id,raw_text) values ('${providerA}','Sensitive provider transcript A'),('${providerB}','Sensitive provider transcript B');
create table public.call_transcripts(id uuid primary key default gen_random_uuid(),agent_id uuid,recorded_by uuid,transcript text,call_outcome text,status text,duration_seconds integer,created_at timestamptz default now());
alter table public.call_transcripts enable row level security;
create policy legacy_manager on public.call_transcripts for all to authenticated using (current_setting('fixture.role',true) in ('manager','admin')) with check (current_setting('fixture.role',true) in ('manager','admin'));
create policy legacy_recorder_read on public.call_transcripts for select to authenticated using (recorded_by=auth.uid());
create policy legacy_recorder_insert on public.call_transcripts for insert to authenticated with check (recorded_by=auth.uid());
grant select,insert,update,delete on public.call_transcripts to authenticated;
create table public.client_pipeline_activity(id uuid default gen_random_uuid(),client_id uuid,activity_type text,body text,metadata jsonb,created_by uuid);
`);
await db.exec(readFileSync(new URL('../../supabase/migrations/20261124120000_producer_workspace.sql', import.meta.url), 'utf8'));
await db.exec(readFileSync(new URL('../../supabase/migrations/20261124121000_producer_client_calls.sql', import.meta.url), 'utf8'));
await db.query("select set_config('fixture.uid',$1,false),set_config('fixture.role','agent',false)", [userA]);
for (const status of ['inactive','terminated']) {
  await db.query('update public.agents set status=$1 where id=$2', [status,agentA]);
  assert.equal((await db.query('select public.producer_can_access_agent($1) as allowed', [agentA])).rows[0].allowed, false, `${status} producers must remain denied`);
}
for (const status of ['pending',null,'active']) {
  await db.query('update public.agents set status=$1 where id=$2', [status,agentA]);
  assert.equal((await db.query('select public.producer_can_access_agent($1) as allowed', [agentA])).rows[0].allowed, true, `The enum cast must preserve access for existing ${status ?? 'null'} status semantics`);
}
await db.exec('set role authenticated');
const workspace = async (agent = agentA) => (await db.query('select public.producer_month_workspace($1) as result', [agent])).rows[0].result;
const history = async (client = clientA, category = null, cursor = null) => (await db.query('select public.producer_client_calls($1,$2,$3,$4) as result', [client, category, cursor?.at ?? null, cursor?.key ?? null])).rows[0].result;
const first = await workspace();
assert.equal(first.production_ap, 2500, 'Own canonical aliases count; another producer never does');
assert.equal(first.production_deals, 2);
assert.equal(first.target_ap, 20000, 'The personal floor must not use the manager team goal');
assert.equal(first.activity.sample_calls, 30, 'Repeated provider event counted only once');
assert.equal(first.activity.sample_sold_calls, 3);
assert.equal(first.activity.sample_policies, 3);
assert.equal(first.carrier.paid_ap, null);
assert.equal(first.carrier.in_force_month_ap, null);
assert.equal(first.days.length, 180);
await assert.rejects(() => workspace(agentB), /access denied/);
await assert.rejects(() => db.query('insert into public.producer_work_schedules(agent_id,effective_on,selling_days,created_by) values ($1,current_date,array[1],$2)', [agentA,userA]), /permission denied/);
await assert.rejects(() => db.query('select public.producer_set_work_schedule($1,$2::integer[])', [agentA,[]]), /Choose at least one/);
const chosen = (await db.query('select public.producer_set_work_schedule($1,$2::integer[]) as result', [agentA,[2,4,2]])).rows[0].result;
const scheduled = await workspace();
assert.equal(chosen.effective_on > first.today, true);
assert.deepEqual(chosen.selling_days, [2,4]);
assert.deepEqual(scheduled.days, first.days, 'Saving a future schedule never repairs a historical missed day');
assert.deepEqual(scheduled.next_schedule.selling_days, [2,4]);

const ownCalls = await history();
assert.equal(ownCalls.calls.length, 1, 'Same phone on another producer must not leak their call');
assert.equal(ownCalls.calls[0].source_id, providerA);
assert.equal(ownCalls.calls[0].transcript, null);
assert.equal(ownCalls.calls[0].audio_url, null);
assert.equal(ownCalls.calls[0].transcript_access, 'restricted');
await assert.rejects(() => history(clientB), /access denied/);
await assert.rejects(() => db.query('select public.producer_tag_client_call($1,$2,$3,$4)', [clientA,'readymode',providerB,'sale']), /does not belong/);
await db.query('select public.producer_tag_client_call($1,$2,$3,$4)', [clientA,'readymode',providerA,'presentation']);
assert.equal((await history(clientA,'presentation')).calls.length, 1);
assert.equal((await history(clientA,'sale')).calls.length, 0);
await db.exec("select set_config('fixture.raw_access','yes',false)");
assert.equal((await history()).calls[0].transcript, 'Sensitive provider transcript A');
await db.exec("select set_config('fixture.raw_access','no',false)");
const transcriptId = (await db.query('select public.producer_save_client_transcript($1,$2,$3,$4) as id', [clientA,'Synthetic follow-up transcript for this client.','follow_up','Follow-up booked'])).rows[0].id;
assert.equal((await history(clientA,'follow_up')).calls[0].transcript, 'Synthetic follow-up transcript for this client.');
assert.equal((await workspace()).activity.completed_today, first.activity.completed_today, 'Manual transcripts never earn provider activity');
assert.equal((await workspace()).production_ap, 2500, 'Manual transcripts never earn production');
await assert.rejects(() => db.query('select public.producer_save_client_transcript($1,$2,$3,$4)', [clientA,'short','sale',null]), /10 to 100/);

await db.exec('reset role');
await db.exec(`
insert into public.carrier_book_policies values
('${agentA}','active',2000,(now() at time zone 'America/Phoenix')::date,(now() at time zone 'America/Phoenix')::date,now(),current_date),
('${agentA}','active',1000,(now() at time zone 'America/Phoenix')::date-120,(now() at time zone 'America/Phoenix')::date-120,now(),current_date),
('${agentA}','active',700,(now() at time zone 'America/Phoenix')::date-120,(now() at time zone 'America/Phoenix')::date-120,now(),(now() at time zone 'America/Phoenix')::date-100),
('${agentA}','claim',9000,(now() at time zone 'America/Phoenix')::date,(now() at time zone 'America/Phoenix')::date-120,now(),current_date),
('${agentB}','active',50000,(now() at time zone 'America/Phoenix')::date,(now() at time zone 'America/Phoenix')::date-120,now(),current_date);
insert into public.readymode_dialer_calls(agent_id,external_call_id,call_started_at,disposition,lead_phone10)
select '${agentA}','page-'||g,now()-interval '1 day','Not Available','6025550101' from generate_series(1,30) g;
`);
await db.exec('set role authenticated');
const carrier = (await workspace()).carrier;
assert.equal(carrier.covered_policies, 4);
assert.equal(carrier.in_force_month_ap, 2000, 'Claim and other-producer policies must not inflate active production');
assert.equal(carrier.active_90d_policies, 1, 'Claims and policies last observed before their 90-day mark cannot count as active retention');
assert.equal(carrier.paid_ap, null, 'Active status never invents a payment receipt');
const page1 = await history();
assert.equal(page1.calls.length, 25);
assert.notEqual(page1.next_cursor, null);
const page2 = await history(clientA,null,page1.next_cursor);
assert.equal(page2.calls.length, 7);
assert.equal(page2.next_cursor, null);
assert.equal(new Set([...page1.calls,...page2.calls].map((call) => call.key)).size, 32, 'Equal timestamps page without dropping or repeating calls');
await assert.rejects(() => db.query('select public.producer_client_calls($1,null,now(),null)', [clientA]), /Incomplete page cursor/);
await db.exec('reset role');
await db.query('update public.team_goals set personal_ap_goal=40000 where agent_id=$1', [agentA]);
assert.equal((await workspace()).target_ap, 40000, 'A higher assigned personal target remains distinct from the team target');
await db.query('insert into public.agentlink_clients values ($1,$2,$3)', [sharedClient,agentA,'602-555-0101']);
assert.equal((await history(sharedClient)).ambiguous_phone, true);
assert.equal((await history(sharedClient)).calls.length, 0, 'A shared phone cannot attach another client’s linked call');
assert.equal((await history()).calls.length, 2, 'Shared-phone ambiguity also hides unlinked provider calls on the first client');
await db.query('insert into public.call_transcripts(agent_id,recorded_by,transcript,status) values ($1,$2,$3,$4)', [agentA,userA,'Legacy recruiting transcript','completed']);
await db.query("select set_config('fixture.uid',$1,false),set_config('fixture.role','manager',false)", [userB]);
await db.exec('set role authenticated');
await assert.rejects(() => workspace(agentA), /access denied/);
await assert.rejects(() => history(clientA), /access denied/);
const visible = (await db.query('select id,transcript from public.call_transcripts')).rows;
assert.equal(visible.some((row) => row.id === transcriptId), false, 'Legacy manager-wide policies cannot expose another producer’s client transcript');
assert.equal(visible.some((row) => row.transcript === 'Legacy recruiting transcript'), true, 'Legacy recruiting history remains compatible');
await db.exec("select set_config('fixture.role','admin',false)");
assert.equal((await workspace(agentA)).production_ap, 2500);
assert.equal((await history(clientA)).calls.some((row) => row.source_id === transcriptId), true);
await db.query("select set_config('fixture.uid',$1,false),set_config('fixture.role','agent',false),set_config('fixture.blocked','yes',false)", [userA]);
await assert.rejects(() => workspace(), /access denied/);
await db.exec("select set_config('fixture.blocked','no',false),set_config('fixture.suspended','yes',false)");
await assert.rejects(() => history(), /access denied/);
await db.exec("select set_config('fixture.suspended','no',false),set_config('fixture.agent_suspended','yes',false)");
await assert.rejects(() => workspace(), /access denied/);
await db.exec("select set_config('fixture.agent_suspended','no',false); reset role; set role anon");
await assert.rejects(() => workspace(), /permission denied/);
await db.close();
console.log('Producer PostgreSQL fixture passed: canonical personal metrics, measured deduplicated activity, future-only schedules, producer/admin scope, restricted raw content, categories, manual transcripts, shared phones, legacy compatibility, and suspended/anonymous denial.');
