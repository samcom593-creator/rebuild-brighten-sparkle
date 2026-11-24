/** Isolated PostgreSQL behavior checks; never connects to Supabase.
 * Run: PGLITE_MODULE=/absolute/path/to/@electric-sql/pglite/dist/index.js node scripts/test-lead-pool-context.mjs
 * Install the optional test runtime outside this repository. All records below are synthetic.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const modulePath = process.env.PGLITE_MODULE;
if (!modulePath) throw new Error('Set PGLITE_MODULE to the optional isolated PGlite test runtime.');
const { PGlite } = await import(pathToFileURL(modulePath).href);
const db = new PGlite();
const migration = await readFile(new URL('../supabase/migrations/20261124110000_lead_context_and_filters.sql', import.meta.url), 'utf8');
const pipelineMigration = await readFile(new URL('../supabase/migrations/20261124111000_lead_pipeline_identity_guard.sql', import.meta.url), 'utf8');
const previous = await readFile(new URL('../supabase/migrations/20261124020000_lead_manager_readymode_all.sql', import.meta.url), 'utf8');
const admin = '00000000-0000-0000-0000-000000000001';
const agent = '00000000-0000-0000-0000-000000000002';
const other = '00000000-0000-0000-0000-000000000003';
function definition(source, name) {
  const start = source.search(new RegExp(`create (?:or replace )?function public\\.${name}\\(`, 'i'));
  assert(start >= 0, `Missing actual migration function ${name}`);
  const rest = source.slice(start);
  const delimiter = rest.match(/\$(?:function)?\$/)?.[0];
  assert(delimiter);
  const end = rest.indexOf(delimiter, rest.indexOf(delimiter) + delimiter.length);
  return rest.slice(0, end + delimiter.length + 1);
}
const invoke = async (name, args = []) => (await db.query(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as result`, args)).rows[0].result;
const myLeads = async () => (await db.query('select * from public.my_lead_bundles()')).rows;
const scalar = async (sql, args = []) => (await db.query(sql, args)).rows[0].n;
const user = async (id) => { await db.query("select set_config('test.user_id',$1,false)", [id]); };
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user_id',true),'')::uuid $$;
    create function public.can_view_sold_calls() returns boolean language sql stable as $$ select coalesce(auth.uid()='${admin}'::uuid,false) $$;
    create function public.fn_agent_is_roster_excluded(uuid) returns boolean language sql as $$ select false $$;
    create function public.lead_hold_set(uuid,boolean,text) returns jsonb language sql as $$ select '{}'::jsonb $$;
    create function public.lead_calling_window(text,text) returns table(callable boolean,opens_at timestamptz) language sql as $$ select false,now()+interval '1 hour' $$;
    create table public.agents(id uuid primary key default gen_random_uuid(),user_id uuid,display_name text,canonical_agent_id uuid,created_at timestamptz default now(),status text default 'active',is_deactivated boolean default false,is_inactive boolean default false);
    create table public.client_leads(id uuid primary key default gen_random_uuid(),source_file text,raw jsonb,phone_digits text,phone_e164 text,dnc boolean default false,last_disposition text,policy_carrier text,policy_product text,policy_monthly_premium numeric,policy_face_amount numeric);
    create table public.agentlink_clients(phone text,do_not_call boolean);
    create table public.book_flips(carrier text,policy_number text,client_key text,flip_status text);
    create table public.v_book_flip_worklist(carrier text,policy_number text,client_key text,phone text,do_not_call boolean,flip_status text);
    create table public.lead_bundles(id uuid primary key default gen_random_uuid(),name text,format text,criteria jsonb,note text,created_by uuid,created_at timestamptz default now(),archived_at timestamptz);
    create table public.lead_bundle_items(id uuid primary key default gen_random_uuid(),bundle_id uuid references public.lead_bundles(id),lead_id uuid,source_kind text,phone10 text,first_name text,last_name text,email text,state text,age int,quality_tier text,quality_reason text,status text default 'new',attrs jsonb,attempts int,last_dialed_at timestamptz,last_disposition text,last_agent text,status_note text,status_at timestamptz,status_by uuid,callback_at timestamptz,next_action text,removed_at timestamptz,added_at timestamptz default now());
    create unique index live_phone on public.lead_bundle_items(phone10) where removed_at is null;
    create table public.lead_bundle_events(id bigserial,bundle_id uuid,item_id uuid,user_id uuid,actor uuid,action text,detail jsonb,at timestamptz default now());
    create table public.lead_bundle_grants(id uuid primary key default gen_random_uuid(),bundle_id uuid,user_id uuid,granted_by uuid,note text,revoked_at timestamptz,granted_at timestamptz default now());
    create table public.lead_resale_ledger(phone10 text);
    create table public.lead_item_recordings(id uuid primary key default gen_random_uuid(),phone10 text,item_id uuid,summary jsonb,created_at timestamptz default now());
    create table public.readymode_dialer_calls(id uuid primary key default gen_random_uuid(),lead_phone10 text,disposition text,call_started_at timestamptz,agent_raw text,recording_path text,recording_url text);
    create table public.readymode_call_insights(call_id uuid,summary text);
    create table public.mat_lead_pool(rid text primary key,source text,lead_id uuid,phone10 text,first_name text,last_name text,email text,state text,age int,tier text,tags text,flags jsonb,lead_age_days int,under_9mo boolean,dnc boolean default false);
    create index mat_phone on public.mat_lead_pool(phone10);
    create table public.lead_pool_snapshot_meta(id boolean primary key,refreshed_at timestamptz);
    insert into public.lead_pool_snapshot_meta values(true,now());
    create table public.lead_pool_stats(id boolean primary key,tiles jsonb,facets jsonb,computed_at timestamptz,last_error text);
    insert into public.lead_pool_stats(id) values(true);
  `);
  await db.exec(`
    alter table client_leads add column street_address text,add column city text,add column zip text,add column dob date;
    alter table agentlink_clients add column id uuid default gen_random_uuid() primary key,add column agent_id uuid,add column first_name text,add column last_name text,add column email text,add column street_address text,add column city text,add column state text,add column zip_code text,add column date_of_birth date,add column communication_notes text,add column pipeline_stage text,add column external_source text,add column created_at timestamptz default now(),add column updated_at timestamptz default now();
    create table readymode_leads(rm_lead_id bigint,phone10 text,first_name text,last_name text,address text,city text,zip text);
    create table client_pipeline_activity(client_id uuid,activity_type text,body text,created_by uuid);
    create function get_agent_id(uuid) returns uuid language sql as $$ select id from agents where user_id=$1 limit 1 $$;
  `);
  await db.exec(`
    alter table client_leads add column state text,add column original_agent text,add column next_touch_by timestamptz;
    alter table readymode_leads add column email text,add column state text,add column age int,add column campaign text,add column batch_name text,add column times_called int,add column first_seen_at timestamptz;
    alter table readymode_call_insights add column spouse_coverage boolean;
    create table v_sellable_client_leads(lead_id uuid,phone10 text,first_name text,last_name text,email text,state text,age int,grade text,wants_mortgage boolean,is_veteran boolean,is_homeowner boolean,is_policyholder boolean,dnc boolean,lead_age_days int,dial_count int,last_dialed_at timestamptz,last_disposition text);
    create table v_readymode_lead_quality(phone10 text,first_name text,last_name text,email text,quality_tier text,quality_reason text,last_agent text,last_disposition text,last_dialed_at timestamptz,attempts int,days_since_dialed int);
    create table v_dialer_client_suppression(phone10 text,verdict text);
    create table mat_lead_phone_fix(source text,from_phone10 text,to_phone10 text,name_key text);
    create table us_area_codes(area_code text,state text);
    create table deals(client_phone text,client_first_name text,client_last_name text,client_dob date,status text,policy_status_standard text,product_sold text,agent_id uuid,carrier_id uuid,posted_at timestamptz,effective_date date);
    create table carriers(id uuid,name text);
    create table readymode_booking_packets(client_phone text,client_first_name text,client_last_name text,client_state text,client_dob date,ssn_encrypted text,ssn_last4 text,bank_account_encrypted text,bank_name text,payment_method_type text,status text,call_at timestamptz,call_id uuid);
    create function is_vantage_agent(uuid) returns boolean language sql as $$ select false $$;
  `);
  for (const name of ['fn_lead_unworked_items', 'fn_lead_unworked_items_from']) await db.exec(definition(previous, name));
  // Execute both complete new migrations, including all pool view definitions,
  // trigger declarations, privileges and indexes, against isolated typed fixtures.
  await db.exec(migration);
  await db.exec(pipelineMigration);
  await db.query('insert into public.agents(user_id,display_name) values($1,$2),($3,$4)', [agent, 'Caller One', other, 'Caller Two']);
  await user(admin);
  const phones = Array.from({ length: 8 }, (_, i) => `20255511${String(i + 1).padStart(2, '0')}`);
  const defaults = { true_dnc: false, current_client: false, source_type: 'pos', source_file: 'synthetic POS', policy_ownership_claim: 'supplier_reported', policy_standing: 'unverified', last_outcome: 'never_called', times_called: 0 };
  for (let i = 0; i < phones.length; i++) {
    const flags = { ...defaults };
    if (i === 1) { delete flags.true_dnc; flags.dnc = true; flags.current_client = true; }
    if (i === 3) flags.import_review_required = true;
    if (i === 4) Object.assign(flags, { last_caller: 'Caller One', last_outcome: 'Bank Objection', last_touched_at: '2020-11-23T18:00:00Z', times_called: 3, callback_at: '2020-11-24T18:00:00Z', next_action: 'Discuss payment options' });
    await db.query('insert into mat_lead_pool(rid,source,phone10,first_name,state,age,tier,flags,lead_age_days,under_9mo,dnc) values($1,\'marketing\',$2,\'Synthetic\',\'TX\',50,\'A\',$3,300,false,$4)', [`m${i}`, phones[i], flags, i === 1]);
  }
  await db.query("insert into mat_lead_pool select 'dialer-cross','dialer',lead_id,phone10,first_name,last_name,email,state,age,tier,tags,'{\"current_client\":true,\"true_dnc\":false}'::jsonb,lead_age_days,under_9mo,false from mat_lead_pool where phone10=$1", [phones[5]]);
  await db.query('insert into readymode_dialer_calls(lead_phone10,disposition) values($1,\'Do Not Call\')', [phones[2]]);
  await db.query('insert into lead_resale_ledger values($1)', [phones[6]]);
  const heldBundle = await scalar("insert into lead_bundles(name) values('Synthetic existing pack') returning id as n");
  await db.query('insert into lead_bundle_items(bundle_id,phone10) values($1,$2)', [heldBundle, phones[7]]);
  let counts = await invoke('lead_pool_counts', ['marketing', {}]);
  assert.equal(counts.total, 2); assert.equal(counts.matching, 8);
  assert.equal(counts.dnc_excluded, 1); assert.equal(counts.client_excluded, 2); assert.equal(counts.review_excluded, 1);
  assert.equal(counts.in_bundle_excluded, 1); assert.equal(counts.resold_excluded, 1);
  assert(counts.sample.every((r) => !r.flags.blocked && r.phone_masked.startsWith('***')));
  counts = await invoke('lead_pool_counts', ['marketing', { hold: 'current_client', exclude_dnc: false }]);
  assert.equal(counts.total, 0); assert.equal(counts.dnc_excluded, 0); assert.equal(counts.sample.length, 2);
  assert(counts.sample.every((r) => r.flags.current_client && !r.flags.true_dnc));
  const filters = { caller: 'caller one', outcomes: ['bank_objection'], min_attempts: 3, max_attempts: 3, touched_after: '2020-11-23', touched_before: '2020-11-23', callback_before: '2020-11-24', source_type: 'pos', source_file: 'synthetic', policy_standing: 'unverified', states: ['TX'], min_age: 45, max_age: 60 };
  counts = await invoke('lead_pool_counts', ['marketing', filters]);
  assert.equal(counts.total, 1);
  assert.equal((await invoke('lead_pool_counts', ['marketing', { ...filters, touched_before: '2020-11-22' }])).total, 0);
  assert.equal((await invoke('lead_pool_counts', ['marketing', { ...filters, caller: '%' }])).total, 0, 'Caller text is literal, not SQL wildcard');
  for (const patch of [{ max_attempts: 2 }, { min_attempts: 4 }, { callback_before: '2020-11-23' }, { states: ['CA'] }, { source_type: 'mortgage' }, { policy_standing: 'current_client' }]) assert.equal((await invoke('lead_pool_counts', ['marketing', { ...filters, ...patch }])).total, 0);
  const assigned = await invoke('lead_pool_assign', ['marketing', filters, 100, agent, null, null]);
  assert.equal(assigned.items, counts.total);
  let item = (await db.query('select * from lead_bundle_items where bundle_id=$1', [assigned.bundle_id])).rows[0];
  assert.equal(item.phone10, phones[4]); assert.equal(item.attempts, 3); assert.equal(item.last_agent, 'Caller One'); assert.equal(item.next_action, 'Discuss payment options');
  assert.equal((await invoke('lead_pool_counts', ['marketing', filters])).total, 0);
  const before = await scalar('select count(*)::int as n from lead_bundles');
  await assert.rejects(invoke('lead_pool_assign', ['marketing', { hold: 'true_dnc', exclude_dnc: false }, 100, agent, null, null]), /No assignable leads/);
  assert.equal(await scalar('select count(*)::int as n from lead_bundles'), before, 'No empty pack after held-only allocation');
  await db.query('insert into lead_bundle_events(bundle_id,item_id,actor,action,detail,at) values($1,$2,$3,\'dial_tap\',\'{"note":"Synthetic historical touch"}\',\'2020-11-24T20:00:00Z\')', [assigned.bundle_id, item.id, agent]);
  await db.query('insert into lead_item_recordings(phone10,item_id,summary) values($1,$2,\'{"briefSummary":"Synthetic call summary"}\')', [item.phone10, item.id]);
  const moved = await invoke('lead_move_unworked', [agent, other, 10, false]);
  assert.equal(moved.moved, 1);
  const exported = await invoke('lead_bundle_export_detail', [moved.bundle_id]);
  assert.equal(exported[0].policy_ownership_claim, 'supplier_reported'); assert.equal(exported[0].policy_standing, 'unverified');
  assert.equal(exported[0].last_summary, 'Synthetic call summary'); assert.equal(exported[0].recording_count, 1);
  assert.match(exported[0].work_history, /Synthetic historical touch/);
  assert.equal(exported[0].next_action, 'Discuss payment options');
  item = (await db.query('select * from lead_bundle_items where bundle_id=$1', [moved.bundle_id])).rows[0];
  assert.equal(item.attrs.origin_item_id != null, true); assert.equal(item.callback_at.toISOString(), '2020-11-24T18:00:00.000Z');
  await user(agent);
  assert.equal((await myLeads()).length, 0, 'Old holder loses access after transfer');
  await assert.rejects(invoke('lead_bundle_export_detail', [moved.bundle_id]), /Only lead administrators/);
  await assert.rejects(invoke('lead_bundle_followup_set', [item.id, '2020-11-25T18:00:00Z', 'Unauthorized']), /not assigned to you/);
  await user(other);
  assert.equal((await myLeads())[0].callable_now, false, 'Existing calling-hours result is retained');
  await invoke('lead_bundle_followup_set', [item.id, '2020-11-25T18:00:00Z', 'Synthetic follow-up']);
  await user(admin);
  counts = await invoke('lead_pool_counts', ['marketing', { hold: 'assigned', outcomes: ['callback'], caller: 'Caller Two', min_attempts: 4, callback_before: '2020-11-25' }]);
  assert.equal(counts.sample.length, 1); assert.equal(counts.sample[0].flags.times_called, 4);
  await db.query("update lead_bundle_items set status='do_not_call' where id=$1", [item.id]);
  await db.query("update lead_bundle_items set status='new' where id=$1", [item.id]);
  assert.equal(await scalar('select count(*)::int as n from lead_contact_dnc where phone10=$1', [phones[4]]), 1, 'Later status changes never erase DNC');
  await assert.rejects(invoke('lead_move_unworked', [other, agent, 10, false]), /held from distribution/);
  await user(other);
  assert.equal((await myLeads())[0].attrs.true_dnc, true, 'DNC remains visible with a concrete hold reason');
  assert.equal((await myLeads())[0].callable_now, false, 'DNC cannot be dialed');
  await assert.rejects(invoke('lead_bundle_followup_set', [item.id, null, 'Do not schedule']), /held/);
  await user(admin);
  assert.match((await invoke('lead_bundle_export_detail', [moved.bundle_id]))[0].hold_reasons, /Do not call/);
  // Exact source ID wins over the first row sharing a phone. A conflicting
  // household identity cannot silently receive somebody else's client record.
  await db.query("insert into client_leads(phone_digits,street_address,dob) values($1,'Wrong household address','1940-01-01')", [phones[0]]);
  const correctSource = await scalar("insert into client_leads(phone_digits,street_address,dob) values($1,'Exact source address','1970-02-03') returning id as n", [phones[0]]);
  await db.query("update mat_lead_pool set lead_id=$1,first_name='Synthetic',last_name='Identity' where phone10=$2", [correctSource, phones[0]]);
  const pipelinePack = await invoke('lead_pool_assign', ['marketing', {}, 1, agent, null, null]);
  const pipelineItem = await scalar('select id as n from lead_bundle_items where bundle_id=$1', [pipelinePack.bundle_id]);
  await user(agent);
  const pipeline = await invoke('my_lead_to_pipeline', [pipelineItem]);
  assert.equal(pipeline.created, true);
  const client = (await db.query('select street_address,date_of_birth,pipeline_stage from agentlink_clients where id=$1', [pipeline.client_id])).rows[0];
  assert.equal(client.street_address, 'Exact source address');
  assert.equal(client.date_of_birth.toISOString().slice(0,10), '1970-02-03');
  assert.equal(client.pipeline_stage, 'NEW_INITIAL');
  assert.deepEqual(await invoke('my_lead_to_pipeline', [pipelineItem]), { client_id: pipeline.client_id, created: false });
  await db.query("update lead_bundle_items set last_name='Different Household Identity' where id=$1", [pipelineItem]);
  await assert.rejects(invoke('my_lead_to_pipeline', [pipelineItem]), /ambiguous client identity/);
  await db.query("update lead_bundle_items set last_name='Identity' where id=$1", [pipelineItem]);
  await db.query('update agentlink_clients set do_not_call=true where id=$1', [pipeline.client_id]);
  await assert.rejects(invoke('my_lead_to_pipeline', [pipelineItem]), /held from contact/);
  await user(admin);
  await invoke('fn_lead_pool_stats_refresh');
  const tiles = (await db.query('select tiles from lead_pool_stats')).rows[0].tiles;
  assert.equal(tiles.marketing.total, (await invoke('lead_pool_counts', ['marketing', {}])).total);
  await db.query("update lead_bundle_items set phone10='2025551199' where id=$1", [item.id]);
  assert.equal(await scalar("select count(*)::int as n from lead_contact_dnc where phone10='2025551199'"),1,'A phone correction preserves DNC and does not abort the snapshot repair path');
  await db.exec('set role authenticated');
  await assert.rejects(invoke('lead_pool_candidates', ['marketing', {}]), /permission denied/);
  await assert.rejects(invoke('sellable_pool', ['marketing', {}]), /permission denied/);
  await db.exec('reset role');
  await user(agent);
  await assert.rejects(invoke('lead_pool_counts', ['marketing', {}]), /Only lead administrators/);
  console.log('PASS: complete migrations and real PostgreSQL filter parity, independent holds, immutable DNC, guarded assignment/transfer, callback history, safe rich export, pipeline identity safety, scope and snapshot statistics.');
} finally { await db.close(); }
