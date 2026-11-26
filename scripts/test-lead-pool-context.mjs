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
const previewCostMigration = await readFile(new URL('../supabase/migrations/20261125110000_lead_pool_preview_cost.sql', import.meta.url), 'utf8');
const advancedCostMigration = await readFile(new URL('../supabase/migrations/20261126040000_lead_pool_context_preview.sql', import.meta.url), 'utf8');
const snapshotReviveMigration = await readFile(new URL('../supabase/migrations/20261126033000_lead_pool_snapshot_revive.sql', import.meta.url), 'utf8');
const sourcePhoneIndexSql = 'create index if not exists mat_lead_pool_source_phone10 on public.mat_lead_pool using btree (source, phone10);';
assert.equal(snapshotReviveMigration.split(sourcePhoneIndexSql).length - 1, 1, 'Expected the current production source/phone index definition');
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
  // Preserve the current production index without executing snapshot cron setup.
  await db.exec(sourcePhoneIndexSql);
  await db.exec(previewCostMigration);
  const originalAllocator = await scalar("select pg_get_functiondef('public.lead_pool_assign(text,jsonb,integer,uuid,text,text)'::regprocedure) as n");
  await db.exec(advancedCostMigration);
  const compactAllocator = await scalar("select pg_get_functiondef('public.lead_pool_assign(text,jsonb,integer,uuid,text,text)'::regprocedure) as n");
  const newSelection = advancedCostMigration.match(/new_selection text := \$new\$([\s\S]*?)\$new\$/)[1];
  assert.equal(compactAllocator.replace(newSelection,'select * from public.sellable_pool(p_source, p_filters) m'),originalAllocator,'Only the allocator candidate-selection fragment changed');
  await db.exec(advancedCostMigration);
  assert.equal(await scalar("select pg_get_functiondef('public.lead_pool_assign(text,jsonb,integer,uuid,text,text)'::regprocedure) as n"),compactAllocator,'Reapplying the migration is safe');
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

  // Exact old/new response parity, including rows where one copy of a phone is
  // held through its replaced number but another copy remains eligible. Dedupe
  // must happen after eligibility, and overlapping exclusions stay independent.
  const parityBundle = await scalar("insert into lead_bundles(name) values('Synthetic parity pack') returning id as n");
  await db.query("insert into lead_bundle_items(bundle_id,phone10) values($1,'2025551203')", [parityBundle]);
  const touchedItem = await scalar("insert into lead_bundle_items(bundle_id,phone10,status,status_at,status_by,callback_at,next_action,removed_at) values($1,'2025551204','callback','2021-01-01',$2,'2021-01-03','Synthetic next action',now()) returning id as n", [parityBundle, agent]);
  await db.query("insert into lead_bundle_events(bundle_id,item_id,actor,action,at) values($1,$2,$3,'dial_tap','2022-01-01')", [parityBundle,touchedItem,other]);
  await db.exec(`
    insert into lead_contact_dnc values('2025551299','synthetic replaced phone',now());
    insert into lead_resale_ledger values('2025551203');
    insert into mat_lead_pool(rid,source,phone10,first_name,state,age,tier,flags,lead_age_days,under_9mo,dnc) values
      ('parity-held-copy','rewrite','2025551201','Held copy','TX',50,'S','{"true_dnc":false,"replaced_phone10":"2025551299"}',1,false,false),
      ('parity-ready-b','rewrite','2025551201','Ready B','TX',50,'B','{"true_dnc":false}',100,false,false),
      ('parity-ready-a','rewrite','2025551201','Ready A','TX',50,'A','{"true_dnc":false}',90,true,false),
      ('parity-explicit-false','rewrite','2025551202','Explicit false','CA',60,'A','{"true_dnc":false,"current_client":true}',80,false,true),
      ('parity-overlap','rewrite','2025551203','Overlap','TX',55,'B','{"true_dnc":false}',70,false,false),
      ('parity-cross-source','dialer','2025551203','Cross-source hold','TX',55,'B','{"true_dnc":true,"current_client":true,"import_review_required":true}',70,false,true),
      ('parity-touched','rewrite','2025551204','Work context','TX',45,'B','{"true_dnc":false,"last_caller":"Source caller","last_outcome":"never_called","times_called":2,"last_touched_at":"2020-01-01T00:00:00Z"}',5,false,false),
      ('parity-unknown-tier','rewrite','2025551205','Unknown tier',null,null,'Z','{"true_dnc":false}',null,false,false);
  `);
  const parityFilters = [
    {}, null, { exclude_dnc:true,exclude_resold:true,sort:'tier' }, { exclude_dnc:false,exclude_resold:false,sort:'age' },
    { tiers:[] }, { states:[] }, { tiers:['A','B'] }, { tiers:['Z'] }, { states:['TX'],min_age:45,max_age:55 },
    { states:['NY'] }, { min_age:80,max_age:40 }, { max_lead_age_days:90 }, { min_age:50 }, { max_age:50 },
    ...['ready','true_dnc','current_client','review','assigned','resold'].map(hold=>({hold})),
    { caller:'Caller Two' }, { caller:'Source caller' }, { caller:'%' }, { outcomes:['callback'] },
    { states:['TX'],caller:'Caller Two',min_attempts:3,max_attempts:3 },
    { touched_after:'2022-01-01',touched_before:'2022-01-01' }, { callback_before:'2021-01-03' },
    { require_flags:['current_client'] }, { policy_standing:'current_client' }, { source_type:'absent' },
  ];
  for (const name of ['lead_pool_filter_matches','lead_pool_candidates','lead_pool_counts']) await db.exec(definition(migration,name));
  const originalResponses = [];
  for (const filters of parityFilters) originalResponses.push(await invoke('lead_pool_counts',['rewrite',filters]));
  await db.exec(previewCostMigration);
  for (let index=0;index<parityFilters.length;index++) {
    const actual = await invoke('lead_pool_counts',['rewrite',parityFilters[index]]);
    assert.deepEqual(actual,originalResponses[index],`Exact preview parity for ${JSON.stringify(parityFilters[index])}`);
    assert(actual.sample.every(row=>!('replaced_phone10' in row.flags)), 'Raw replaced phones never reach the preview');
  }
  assert.equal(originalResponses[0].total,3); assert.equal(originalResponses[0].matching,5);
  assert.equal(originalResponses[0].dnc_excluded,2); assert.equal(originalResponses[0].client_excluded,2);
  assert.equal(originalResponses[0].review_excluded,1); assert.equal(originalResponses[0].resold_excluded,1);
  assert.equal(originalResponses[0].in_bundle_excluded,1); assert.equal(originalResponses[0].under_9mo,1);
  assert.deepEqual(originalResponses[0].by_tier,{A:1,B:1,Z:1});
  const contextSample=originalResponses[0].sample.find(row=>row.first_name==='Work context');
  assert.equal(contextSample.flags.last_caller,'Caller Two'); assert.equal(contextSample.flags.times_called,3);
  assert.equal(contextSample.flags.last_outcome,'callback'); assert.equal(contextSample.flags.next_action,'Synthetic next action');

  await db.exec(advancedCostMigration);
  for (let index=0;index<parityFilters.length;index++) {
    assert.deepEqual(await invoke('lead_pool_counts',['rewrite',parityFilters[index]]),originalResponses[index],
      `Compact preview parity for ${JSON.stringify(parityFilters[index])}`);
  }

  // Context precedence and every advanced predicate are checked against the
  // released full-context evaluator, including its null and Phoenix boundaries.
  await db.exec(`
    insert into mat_lead_pool(rid,source,phone10,first_name,state,age,tier,flags,lead_age_days,under_9mo,dnc) values
      ('advanced-source','dialer','2025551301','Source fields','AZ',55,'A','{"last_caller":"Source caller","last_outcome":"Bank Objection","last_touched_at":"2024-01-02T06:59:59Z","callback_at":"2024-01-03T06:59:59Z","times_called":2,"source_file":"Synthetic Batch %","source_type":"pos","campaigns":["Veterans","AZ"],"vantage":true,"mortgage":true}',10,false,false),
      ('advanced-work','dialer','2025551302','Newer work','AZ',56,'B','{"last_caller":"Source caller","last_outcome":"never_called","last_touched_at":"2020-01-01T00:00:00Z","callback_at":"2020-01-03T00:00:00Z","times_called":1,"campaign":"Veterans","policy_standing":"supplier_reported"}',20,true,false),
      ('advanced-tap','dialer','2025551303','Newer tap','TX',57,'S','{"last_caller":"Source caller","last_outcome":"never_called","last_touched_at":"2020-01-01T00:00:00Z","times_called":0}',30,false,false),
      ('advanced-equal','dialer','2025551304','Equal touch','TX',58,'pos','{"last_caller":"Equal source","last_outcome":"Social Objection","last_touched_at":"2023-01-01T07:00:00Z","times_called":3,"callback_at":"2023-01-02T07:00:00Z"}',40,false,false),
      ('advanced-invalid','dialer','2025551305','Invalid dates','FL',59,'F','{"last_caller":"Unchanged source","last_outcome":"new","last_touched_at":"invalid","callback_at":"not-a-date","times_called":4}',50,false,false),
      ('advanced-null-tap','dialer','2025551306','No tap actor','FL',60,'C','{"last_caller":"Must be cleared","last_outcome":"no answer","last_touched_at":"2020-01-01","times_called":0}',60,false,false),
      ('advanced-null-work','dialer','2025551307','No work caller','CA',61,'D','{"last_caller":"Must be cleared","last_outcome":"never_called","last_touched_at":"2020-01-01","callback_at":"2020-01-03","times_called":0}',70,false,false),
      ('advanced-legacy-flag','dialer','2025551308','Generic work flags','CA',62,'A','{"last_caller":"true","last_outcome":"true","last_touched_at":"true","callback_at":"true","next_action":"true","times_called":0,"custom_flag":true,"policy_standing":"true"}',80,false,false),
      ('advanced-empty','dialer','2025551309','Missing context',null,null,'Z','{}',90,false,false);
  `);
  for (const [phone,status,at,by,callback,lastAgent] of [
    ['2025551302','callback','2023-01-01T07:00:00Z',agent,'2023-01-03T06:59:59Z','Fallback work'],
    ['2025551303','new','2022-01-01T07:00:00Z',agent,null,null],
    ['2025551304','bad_number','2023-01-01T07:00:00Z',agent,null,null],
    ['2025551307','no_answer','2023-01-01T07:00:00Z',null,null,null],
  ]) {
    await db.query('insert into lead_bundle_items(bundle_id,phone10,status,status_at,status_by,callback_at,last_agent,removed_at) values($1,$2,$3,$4,$5,$6,$7,now())',
      [parityBundle,phone,status,at,by,callback,lastAgent]);
  }
  for (const [phone,at,actor] of [
    ['2025551302','2022-01-01T07:00:00Z',other],
    ['2025551303','2023-01-01T07:00:00Z',other],
    ['2025551304','2023-01-01T07:00:00Z',other],
    ['2025551306','2024-01-01T07:00:00Z',null],
  ]) {
    let historyItem=await scalar('select (select id from lead_bundle_items where phone10=$1 limit 1) as n',[phone]);
    if(!historyItem) historyItem=await scalar('insert into lead_bundle_items(bundle_id,phone10,removed_at) values($1,$2,now()) returning id as n',[parityBundle,phone]);
    await db.query("insert into lead_bundle_events(bundle_id,item_id,actor,action,at) values($1,$2,$3,'dial_tap',$4)",[parityBundle,historyItem,actor,at]);
  }
  const advancedFilters=[
    {caller:'Source'}, {caller:'Caller One'}, {caller:'Caller Two'}, {caller:'Equal source'}, {caller:'Must be cleared'},
    {caller:'Unchanged'}, {caller:'%'}, {caller:'true'}, {caller:''},
    {outcomes:['bank_objection']}, {outcomes:['callback']}, {outcomes:['unknown']}, {outcomes:['never_called']}, {outcomes:[]},
    {min_attempts:0,max_attempts:0}, {min_attempts:1,max_attempts:2}, {min_attempts:4},
    {touched_after:'2024-01-01',touched_before:'2024-01-01'}, {touched_after:'2024-01-02'}, {touched_before:'2023-01-01'},
    {callback_before:'2023-01-02'}, {callback_before:'2023-01-01'}, {callback_before:'2024-01-02'},
    {campaigns:['Veterans']}, {campaigns:[]}, {campaigns:['Missing']}, {vantage_only:true},
    {source_file:'Batch %'}, {source_type:'pos'}, {policy_standing:'supplier_reported'},
    {require_flags:['mortgage']}, {require_flags:['custom_flag']}, {require_flags:['policy_standing']},
    ...['true_dnc','dnc','current_client','import_review_required','already_sold','in_bundle','blocked'].map(key=>({require_flags:[key]})),
    ...['last_caller','last_outcome','last_touched_at','callback_at','next_action','times_called','source_attempts'].map(key=>({require_flags:[key]})),
    {hold:'invalid'}, {caller:'Caller One',outcomes:['callback'],min_attempts:2,max_attempts:2,callback_before:'2023-01-02',states:['AZ']},
  ];
  await db.exec(previewCostMigration);
  const advancedResponses=[];
  for (const filters of advancedFilters) advancedResponses.push(await invoke('lead_pool_counts',['dialer',filters]));
  await db.exec(advancedCostMigration);
  for (let index=0;index<advancedFilters.length;index++) {
    assert.deepEqual(await invoke('lead_pool_counts',['dialer',advancedFilters[index]]),advancedResponses[index],
      `Exact advanced preview parity for ${JSON.stringify(advancedFilters[index])}`);
  }
  assert.equal(advancedResponses[4].total,0,'Newer context with no caller clears the older caller');
  assert.equal(advancedResponses[3].total,1,'Equal work/tap timestamps retain the source caller');
  assert.equal(advancedResponses[12].sample.find(row=>row.first_name==='Missing context').flags.last_outcome,'never_called');

  const allocationReceipt=async(definitionText,filters)=>{
    await db.exec('begin');
    try {
      await db.exec(definitionText);
      const result=await invoke('lead_pool_assign',['rewrite',filters,2,agent,'Synthetic parity allocation','Synthetic note']);
      const bundle=(await db.query("select to_jsonb(b)-'id'-'created_at' as r from lead_bundles b where id=$1",[result.bundle_id])).rows[0].r;
      const items=(await db.query("select to_jsonb(i)-'id'-'bundle_id'-'added_at' as r from lead_bundle_items i where bundle_id=$1 order by phone10",[result.bundle_id])).rows.map(row=>row.r);
      const grants=(await db.query("select to_jsonb(g)-'id'-'bundle_id'-'granted_at' as r from lead_bundle_grants g where bundle_id=$1",[result.bundle_id])).rows.map(row=>row.r);
      const events=(await db.query("select to_jsonb(e)-'id'-'bundle_id'-'at' as r from lead_bundle_events e where bundle_id=$1",[result.bundle_id])).rows.map(row=>row.r);
      return {itemsCount:result.items,agent:result.agent,bundle,items,grants,events};
    } finally { await db.exec('rollback'); }
  };
  let allocationCases=0;
  for (const sort of ['tier','oldest','chargeback']) for (const filter of [{},{caller:'Caller Two'},{outcomes:['callback']}]) {
    const filters={...filter,sort};
    assert.deepEqual(await allocationReceipt(compactAllocator,filters),await allocationReceipt(originalAllocator,filters),
      `Actual allocation, grant, and event parity for ${JSON.stringify(filters)}`);
    allocationCases++;
  }
  // Refuse to patch a changed allocator body rather than silently changing an
  // unrelated version. Roll back the intentionally altered isolated function.
  await db.exec('begin');
  await db.exec(originalAllocator.replace('select * from public.sellable_pool(p_source, p_filters) m','select *  from public.sellable_pool(p_source, p_filters) m'));
  await assert.rejects(db.exec(advancedCostMigration),/Unexpected lead_pool_assign definition/);
  await db.exec('rollback');
  assert.equal(await scalar("select pg_get_functiondef('public.lead_pool_assign(text,jsonb,integer,uuid,text,text)'::regprocedure) as n"),compactAllocator);

  for (const role of ['anon','authenticated']) {
    assert.equal(await scalar("select has_table_privilege($1,'public.v_lead_pool_candidate_base','SELECT')::int as n",[role]),0);
    for (const signature of ['public.lead_pool_candidates_for_phones(text,jsonb,text[])','public.lead_pool_static_filter_matches(text,integer,text,integer,jsonb)','public.lead_pool_preview_candidates(text,jsonb)']) {
      assert.equal(await scalar("select has_function_privilege($1,$2,'EXECUTE')::int as n",[role,signature]),0);
    }
  }
  await db.exec('set role authenticated');
  await assert.rejects(invoke('lead_pool_candidates', ['marketing', {}]), /permission denied/);
  await assert.rejects(invoke('lead_pool_candidates_for_phones', ['marketing', {}, ['2025551201']]), /permission denied/);
  await assert.rejects(db.query('select * from public.v_lead_pool_candidate_base limit 1'), /permission denied/);
  await assert.rejects(invoke('sellable_pool', ['marketing', {}]), /permission denied/);
  await assert.rejects(invoke('lead_pool_preview_candidates', ['marketing', {}]), /permission denied/);
  await db.exec('reset role');
  await user(agent);
  await assert.rejects(invoke('lead_pool_counts', ['marketing', {}]), /Only lead administrators/);
  console.log(`PASS: complete migrations; ${parityFilters.length+advancedFilters.length} exact old/new preview responses; ${allocationCases} actual allocation/receipt comparisons; independent/overlapping holds; immutable DNC; guarded assignment/transfer; callback history; export/pipeline safety; private helper ACLs; scope; snapshot statistics.`);

  // Optional measured scale check; synthetic-only and excluded from normal CI.
  // Timings are comparative local PostgreSQL/WASM evidence, not live latency.
  if (process.env.LEAD_POOL_BENCH_ROWS) {
    const rows=Number(process.env.LEAD_POOL_BENCH_ROWS);
    assert(Number.isSafeInteger(rows)&&rows>=1000&&rows<=250000,'Bounded synthetic row count');
    await user(admin);
    await db.query(`insert into mat_lead_pool(rid,source,phone10,first_name,state,age,tier,flags,lead_age_days,under_9mo,dnc)
      select 'bench-'||g,'winback',(3030000000::bigint+g)::text,'Synthetic '||g,
        (array['TX','FL','CA','NY','WA','PA','GA','OH','IL','AZ'])[g%10+1],30+g%50,
        (array['S','pos','A','B','F','C','D'])[g%7+1],
        '{"true_dnc":false,"last_caller":"Synthetic caller","last_outcome":"never_called","times_called":0,"last_touched_at":"2020-01-01T00:00:00Z"}'::jsonb,
        g,g%4=0,false from generate_series(1,$1::integer) g`,[rows]);
    await db.exec('create index if not exists mat_bench_source_tier on mat_lead_pool(source,tier); create index if not exists mat_bench_source_state on mat_lead_pool(source,state); create index if not exists bench_resale_phone on lead_resale_ledger(phone10); analyze');
    const defaults={exclude_dnc:true,exclude_resold:true,sort:'tier'};
    await db.exec(previewCostMigration);
    let started=performance.now();
    const original=await invoke('lead_pool_counts',['winback',defaults]);
    console.log(JSON.stringify({benchmark:'released-default',synthetic_rows:rows,ms:Math.round(performance.now()-started)}));
    started=performance.now();
    const originalCaller=await invoke('lead_pool_counts',['winback',{...defaults,caller:'Synthetic caller'}]);
    console.log(JSON.stringify({benchmark:'released-broad-caller',synthetic_rows:rows,ms:Math.round(performance.now()-started)}));
    const timedAllocation=async(label,definitionText)=>{
      await db.exec('begin');
      const allocationStarted=performance.now();
      try {
        await db.exec(definitionText);
        const result=await invoke('lead_pool_assign',['winback',{...defaults,caller:'Synthetic caller'},100,agent,'Synthetic scale allocation',null]);
        assert.equal(result.items,100);
        console.log(JSON.stringify({benchmark:label,synthetic_rows:rows,assigned:result.items,ms:Math.round(performance.now()-allocationStarted)}));
      } catch(error) {
        if(label!=='released-allocation'||error.code!=='57014') throw error;
        console.log(JSON.stringify({benchmark:label,synthetic_rows:rows,statement_timeout:true,ms:Math.round(performance.now()-allocationStarted)}));
      } finally { await db.exec('rollback'); }
    };
    await timedAllocation('released-allocation',originalAllocator);
    await db.exec(advancedCostMigration);
    const benchmarks=[
      ['optimized-default',defaults],
      ['optimized-common',{...defaults,states:['TX'],tiers:['A','B'],min_age:40,max_age:60}],
      ['optimized-no-match',{...defaults,states:['ZZ']}],
      ['optimized-advanced-narrowed',{...defaults,states:['TX'],caller:'Synthetic caller'}],
      ['optimized-broad-caller',{...defaults,caller:'Synthetic caller'}],
      ['optimized-broad-no-match',{...defaults,caller:'No such caller'}],
    ];
    for (const [label,filters] of benchmarks) {
      started=performance.now(); const result=await invoke('lead_pool_counts',['winback',filters]);
      if(label==='optimized-default') assert.deepEqual(result,original);
      if(label==='optimized-broad-caller') assert.deepEqual(result,originalCaller);
      if(label==='optimized-no-match'||label==='optimized-broad-no-match') { assert.equal(result.total,0); assert.deepEqual(result.sample,[]); }
      if(label==='optimized-advanced-narrowed') assert.equal(result.total,Math.floor(rows/10));
      if(label==='optimized-common') {
        let expected=0;
        for(let g=1;g<=rows;g++) if(g%10===0&&[2,3].includes(g%7)&&g%50>=10&&g%50<=30) expected++;
        assert.equal(result.total,expected);
      }
      console.log(JSON.stringify({benchmark:label,synthetic_rows:rows,matching_rows:result.total,ms:Math.round(performance.now()-started)}));
    }
    await timedAllocation('optimized-allocation',compactAllocator);
    // Nontrivial live history must not turn 25 sample enrichments back into a
    // full-history aggregation. Removed items still contribute work/tap context.
    const historicalPhones=Math.min(20000,rows);
    await db.query(`insert into lead_bundle_items(bundle_id,phone10,status,status_at,status_by,callback_at,next_action,removed_at)
      select $1,(3030000000::bigint+g)::text,'callback','2023-01-01',$2,'2024-01-03','Synthetic scaled follow-up',now()
      from generate_series(1,$3::integer) g`,[parityBundle,agent,historicalPhones]);
    await db.query(`insert into lead_bundle_events(bundle_id,item_id,actor,action,at)
      select i.bundle_id,i.id,$1,'dial_tap','2024-01-01'::timestamptz+n*interval '1 hour'
      from lead_bundle_items i cross join generate_series(1,3) n
      where i.phone10>='3030000001' and i.phone10<=($2::bigint+3030000000)::text`,[other,historicalPhones]);
    await db.exec('analyze lead_bundle_items; analyze lead_bundle_events');
    started=performance.now();
    const historyResult=await invoke('lead_pool_counts',['winback',defaults]);
    assert.equal(historyResult.total,rows);
    assert(historyResult.sample.every(row=>row.flags.last_caller==='Caller Two'&&row.flags.times_called===3&&row.flags.next_action==='Synthetic scaled follow-up'));
    console.log(JSON.stringify({benchmark:'optimized-default-with-history',synthetic_rows:rows,historical_phones:historicalPhones,dial_tap_events:historicalPhones*3,ms:Math.round(performance.now()-started)}));
    for(const [label,filters,expected] of [
      ['optimized-caller-with-history',{caller:'Caller Two'},historicalPhones],
      ['optimized-outcome-with-history',{outcomes:['callback']},historicalPhones],
      ['optimized-attempts-with-history',{min_attempts:3,max_attempts:3},historicalPhones],
      ['optimized-touched-with-history',{touched_after:'2023-01-01'},historicalPhones],
      ['optimized-callback-with-history',{callback_before:'2024-01-03'},historicalPhones],
    ]) {
      started=performance.now(); const result=await invoke('lead_pool_counts',['winback',{...defaults,...filters}]);
      assert.equal(result.total,expected);
      console.log(JSON.stringify({benchmark:label,synthetic_rows:rows,historical_phones:historicalPhones,dial_tap_events:historicalPhones*3,matching_rows:result.total,ms:Math.round(performance.now()-started)}));
    }

  }
} finally { await db.close(); }
