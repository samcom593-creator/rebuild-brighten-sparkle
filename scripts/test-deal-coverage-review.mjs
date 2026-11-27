/** Synthetic PostgreSQL fixture: actual old posting implementation + new review
 * migration, role checks, raw table bypass attempts and durable side effects.
 * No production data, credentials, notifications or network calls.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
if (!process.env.PGLITE_MODULE) throw new Error('Set PGLITE_MODULE to the existing isolated PostgreSQL runtime.');
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db = new PGlite();
const read = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
function definition(source, name) {
  const start = source.search(new RegExp(`create (?:or replace )?function public\\.${name}\\(`, 'i'));
  assert(start >= 0, `Missing real SQL definition ${name}`);
  const rest = source.slice(start), delimiter = rest.match(/\$[a-zA-Z_]*\$/)?.[0];
  assert(delimiter);
  const end = rest.indexOf(delimiter, rest.indexOf(delimiter) + delimiter.length);
  return rest.slice(0, end + delimiter.length + 1);
}
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const U = { agent: id(1), manager: id(2), other: id(3), admin: id(4), otherManager: id(5) };
const A = { agent: id(101), manager: id(102), other: id(103), admin: id(104), otherManager: id(105) };
const C = id(201), C2 = id(202);
const query = (sql, args = []) => db.query(sql, args);
const scalar = async (sql, args = []) => (await query(sql, args)).rows[0]?.v;
const reset = async () => { await db.exec('reset role'); await query("select set_config('test.uid','',false)"); };
async function as(who, role = 'authenticated') {
  await reset(); await query("select set_config('test.uid',$1,false)", [U[who] ?? '']);
  await db.exec(`set role ${role}`);
}
async function call(name, args = []) {
  return scalar(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) as v`, args);
}
const submit = (key, payload, agent = A.agent) => call('submit_apex_deal', [key, JSON.stringify(payload), agent]);
const decide = (review, choice = 'approved', reason = 'Verified existing coverage and confirmed legitimate additional coverage with the carrier.') =>
  call('decide_deal_coverage_review', [review.reviewId ?? review.id, choice, reason, review.reviewVersion ?? review.version]);
const queue = () => call('deal_coverage_review_queue');
const rows = table => scalar(`select count(*)::int as v from public.${table}`);
async function counts() { await reset(); return { deals: await rows('deals'), outbox: await rows('outbox_events'), permits: await rows('deal_coverage_post_permits') }; }
async function denied(run, code = '42501') {
  await assert.rejects(run, e => { assert.equal(e.code, code, e.message); return true; });
}
let checks = 0;
async function check(label, run) { await run(); checks++; console.log(`PASS ${label}`); }
let counter = 1000;
const key = () => id(++counter);
let today;
const payload = (patch = {}) => ({
  clientFirstName: 'Fixture', clientLastName: 'Insured', clientPhone: '2025550101', clientDob: '1990-01-02',
  carrierId: C, product: 'Synthetic term', policyNumber: `FIXTURE-${++counter}`, applicationDate: today,
  premiumMode: 'monthly', modalPremium: '100', annualizedPaidPremium: '1200', annualizedCommissionablePremium: '1200',
  faceAmount: '10000', policyStatus: 'Issued, Not Paid', beneficiaries: [], ...patch,
});
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema extensions;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
    create table auth.users(id uuid primary key,banned_until timestamptz,deleted_at timestamptz);
    create table public.user_roles(user_id uuid,role text);
    create table public.book_readers(user_id uuid primary key);
    create table public.agent_access_suspensions(user_id uuid,lifted_at timestamptz);
    create table public.agents(id uuid primary key,user_id uuid,manager_id uuid,canonical_agent_id uuid,created_at timestamptz default now(),status text default 'active',is_inactive boolean default false,is_deactivated boolean default false,nipr_number text,display_name text);
    create table public.carriers(id uuid primary key,name text,is_active boolean default true);
    create table public.deals(
      id uuid primary key default gen_random_uuid(),agent_id uuid,manager_id uuid,carrier_id uuid,
      client_first_name text,client_last_name text,client_phone text,client_dob date,product_sold text,
      policy_number text,monthly_premium numeric,annual_premium numeric,face_amount numeric,effective_date date,
      notes text,status text,source text,pipeline_stage text,posted_at timestamptz,idempotency_key uuid,
      submitted_by_user_id uuid,premium_mode text,modal_premium numeric,annualized_paid_premium numeric,
      annualized_commissionable_premium numeric,calculation_basis jsonb,application_date date,
      lead_source text,community_caption text,version integer default 1,correlation_id uuid,
      payment_method text,draft_day smallint,policy_status_standard text,writing_npn text,duplicate_of_deal_id uuid,
      submitted_at timestamptz,status_updated_at timestamptz,created_at timestamptz default now(),updated_at timestamptz default now()
    );
    create unique index deals_idempotency on public.deals(submitted_by_user_id,idempotency_key) where idempotency_key is not null;
    create unique index deals_policy_identity_unique on public.deals(carrier_id,lower(btrim(policy_number)),writing_npn)
      where carrier_id is not null and nullif(btrim(policy_number),'') is not null and writing_npn is not null and duplicate_of_deal_id is null;
    create table public.deal_drafts(id uuid primary key default gen_random_uuid(),owner_user_id uuid not null,idempotency_key uuid not null,current_section text not null default 'client',payload jsonb not null default '{}',status text not null default 'draft',deal_id uuid,created_at timestamptz default now(),updated_at timestamptz default now(),unique(owner_user_id,idempotency_key));
    create table public.deal_attachments(id uuid primary key default gen_random_uuid(),draft_id uuid,deal_id uuid,owner_user_id uuid,scan_status text);
    create table public.deal_beneficiaries(deal_id uuid,position smallint,first_name text,last_name text,relationship text,allocation_pct numeric);
    create table public.deal_status_history(deal_id uuid,from_status text,to_status text,reason text,actor_id uuid,actor_role text,correlation_id uuid,deal_version integer,unique(deal_id,deal_version));
    create table public.outbox_events(id uuid default gen_random_uuid(),aggregate_type text,aggregate_id uuid,event_type text,destination text,payload jsonb,idempotency_key text unique,correlation_id uuid);
    create table public.audit_log(id uuid default gen_random_uuid(),action text,actor_role text,actor_user_id uuid,before_data jsonb,after_data jsonb,entity_id text,entity_type text,request_id text);
    grant usage on schema auth,public to authenticated,anon,service_role;
    grant select on public.agents,public.carriers to authenticated;
    grant select,insert,update on public.deals,public.deal_drafts to authenticated;
    alter table public.deals enable row level security;
    create policy deals_own on public.deals for all to authenticated using (agent_id in(select id from public.agents where user_id=auth.uid())) with check(agent_id in(select id from public.agents where user_id=auth.uid()));
    alter table public.deal_drafts enable row level security;
    create policy drafts_own on public.deal_drafts for all to authenticated using(owner_user_id=auth.uid()) with check(owner_user_id=auth.uid());
  `);
  const foundation = await read('20260811220000_apex_unified_os_foundation.sql');
  for (const name of ['apex_has_any_role','apex_is_admin','apex_can_read_agent']) await db.exec(definition(foundation,name));
  const login = await read('20261112000200_pkg2_hire_lane_foundation.sql');
  for (const name of ['fn_user_login_blocked','fn_user_is_suspended']) await db.exec(definition(login,name));
  await db.exec(definition(await read('20261016051808_sec_view_lockdown.sql'),'api_is_full_reader'));
  await db.exec(definition(await read('20260811221000_apex_native_deal_workflow.sql'),'save_apex_deal_draft'));
  await db.exec(definition(await read('20260831260000_policy_number_sanitize.sql'),'fn_normalize_policy_number'));
  await db.exec(definition(await read('20261012160000_deal_policy_number_grace.sql'),'submit_apex_deal_ledger_impl'));
  const retry = await read('20260825232500_deals_idempotency.sql');
  await db.exec(definition(retry,'fn_deal_capture_writing_npn'));
  await db.exec('create trigger capture_npn before insert or update of agent_id,writing_npn on public.deals for each row execute function public.fn_deal_capture_writing_npn()');
  await db.exec(definition(retry,'submit_apex_deal'));
  for (const [who, user] of Object.entries(U)) {
    await query('insert into auth.users(id) values($1)',[user]);
    await query('insert into public.agents(id,user_id,manager_id,nipr_number,display_name) values($1,$2,$3,$4,$5)',
      [A[who],user,who==='agent'?A.manager:null,String(100000+Object.keys(U).indexOf(who)),`Synthetic ${who}`]);
    await query('insert into public.user_roles values($1,$2)',[user,who==='admin'?'admin':who.toLowerCase().includes('manager')?'manager':'agent']);
  }
  await query('insert into public.carriers(id,name) values($1,$2),($3,$4)',[C,'Fixture carrier',C2,'Other fixture carrier']);
  today = await scalar('select current_date::text as v');
  const existing = payload({policyNumber:'KNOWN-EXISTING'});
  await query(`insert into public.deals(id,agent_id,carrier_id,client_first_name,client_last_name,client_phone,client_dob,product_sold,policy_number,annual_premium,status,source,posted_at)
    values($1,$2,$3,$4,$5,$6,$7,'Synthetic term',$8,1200,'submitted','apex_native',now())`,
    [id(301),A.agent,C,existing.clientFirstName,existing.clientLastName,existing.clientPhone,existing.clientDob,existing.policyNumber]);
  await check('negative control: original submit permits the same insured under a new policy number',async()=>{
    await as('agent'); await db.exec('begin'); const p=payload(), k=key();
    await call('save_apex_deal_draft',[k,'review',JSON.stringify(p)]);
    assert((await submit(k,p)).dealId); await db.exec('rollback');
  });
  await reset(); await db.exec(await read('20261127050000_deal_coverage_review.sql'));
  await check('private implementation and tables cannot be used as API bypasses',async()=>{
    await as('agent');
    await denied(()=>call('submit_apex_deal_before_coverage_review',[key(),JSON.stringify(payload()),A.agent]));
    await denied(()=>call('submit_apex_deal_ledger_impl',[key(),JSON.stringify(payload()),A.agent]));
    await denied(()=>query('select * from public.deal_coverage_reviews'));
    await denied(()=>query('insert into public.deal_coverage_post_permits values(txid_current(),$1,$2,$3)',[U.agent,key(),A.agent]));
    await as('', 'anon'); await denied(()=>queue());
    await denied(()=>submit(key(),payload()));
  });
  let held,heldKey,heldPayload;
  await check('same carrier plus name and DOB holds the draft without deal or delivery writes',async()=>{
    const before=await counts(); await as('agent'); heldKey=key();heldPayload=payload();held=await submit(heldKey,heldPayload);
    assert.equal(held.status,'review_required'); assert.equal(held.matchCount,1); assert(!held.dealId);
    const retry=await submit(heldKey,heldPayload); assert.equal(retry.reviewId,held.reviewId); assert.equal(retry.reviewVersion,held.reviewVersion);
    const own=(await queue()).reviews.find(r=>r.id===held.reviewId);
    assert.equal(own.client_name,'Fixture Insured');assert.equal(own.can_decide,false);assert.equal(own.requires_admin,true);
    assert.deepEqual(await counts(),before);
  });
  await check('requester, unrelated manager and hierarchy-only manager cannot approve or read client book',async()=>{
    await as('agent');await denied(()=>decide(held));
    await as('otherManager');assert.equal((await queue()).reviews.length,0);await denied(()=>decide(held));
    await as('manager');const redacted=(await queue()).reviews[0];
    assert.equal(redacted.client_name,'Client details restricted');assert.equal(redacted.policy_number,null);
    assert.deepEqual(redacted.matched_policies,[]);assert.equal(redacted.can_decide,false);assert.equal(redacted.requires_admin,true);
    await denied(()=>decide(held));
  });
  await check('assigned manager with explicit full-book permission can decide, but approval does not post',async()=>{
    await reset();await query('insert into public.book_readers values($1)',[U.manager]);
    const before=await counts();await as('manager');const row=(await queue()).reviews[0];
    assert.equal(row.can_decide,true);assert.equal(row.requires_admin,false);
    const approved=await decide(held);assert.equal(approved.status,'approved');held.reviewVersion=approved.version;
    assert.deepEqual(await counts(),before);
  });
  await check('only requester may resume; approved exact draft posts once and retry remains idempotent',async()=>{
    await as('manager');await denied(()=>call('resume_deal_coverage_review',[held.reviewId,held.reviewVersion]));
    const before=await counts();await as('agent');
    const receipt=await call('resume_deal_coverage_review',[held.reviewId,held.reviewVersion]);assert(receipt.dealId);
    assert.equal((await submit(heldKey,heldPayload)).dealId,receipt.dealId);
    const exact=await submit(key(),heldPayload);assert.equal(exact.status,'already_recorded');assert.equal(exact.dealId,receipt.dealId);
    const after=await counts();assert.equal(after.deals,before.deals+1);assert.equal(after.outbox,before.outbox+1);assert.equal(after.permits,0);
  });
  await check('name alone and a different carrier do not create review holds',async()=>{
    await as('agent');assert((await submit(key(),payload({clientDob:'1985-02-03'}))).dealId);
    assert((await submit(key(),payload({carrierId:C2}))).dealId);
  });
  await check('same DOB and normalized phone catches changed name; missing number still holds',async()=>{
    await as('agent');
    const byPhone=await submit(key(),payload({clientFirstName:'Different',clientLastName:'Name',clientPhone:'+1 (202) 555-0101'}));
    assert.equal(byPhone.status,'review_required');
    assert((await queue()).reviews.find(r=>r.id===byPhone.reviewId).match_signals.includes('phone_dob'));
    assert.equal((await submit(key(),payload({policyNumber:''}))).status,'review_required');
  });
  await check('raw table inserts and draft promotions cannot bypass review or omit match identity',async()=>{
    await as('agent');
    const insert=(dob='1990-01-02',carrier=C,status='submitted')=>query(`insert into public.deals(agent_id,carrier_id,client_first_name,client_last_name,client_phone,client_dob,policy_number,status,source)
      values($1,$2,'Fixture','Insured','2025550101',$3,$4,$5,'apex_native')`,[A.agent,carrier,dob,`RAW-${++counter}`,status]);
    await denied(()=>insert(),'23514');await denied(()=>insert(null),'23514');await denied(()=>insert('1990-01-02',null),'23514');
    await reset();await query(`insert into public.deals(id,agent_id,carrier_id,client_first_name,client_last_name,client_phone,client_dob,policy_number,status,source)
      values($1,$2,$3,'Fixture','Insured','2025550101','1990-01-02','PREEXISTING-DRAFT','draft','agent_link')`,[id(401),A.agent,C]);
    await as('agent');await denied(()=>query("update public.deals set status='submitted',source='apex_native' where id=$1",[id(401)]),'23514');
  });
  await check('changed payload invalidates approval and stale versions cannot decide or post',async()=>{
    await as('agent');const k=key(),p=payload(),h=await submit(k,p);
    await as('admin');const approved=await decide(h);
    await as('agent');const changed=await submit(k,{...p,faceAmount:'20000'});
    assert.equal(changed.status,'review_required');assert(changed.reviewVersion>approved.version);
    await denied(()=>call('resume_deal_coverage_review',[h.reviewId,approved.version]),'40001');
    await as('admin');await denied(()=>decide(h),'40001');
  });
  await check('changed existing-policy evidence invalidates an otherwise unchanged approval',async()=>{
    await as('agent');const k=key(),p=payload(),h=await submit(k,p);
    await as('admin');await decide(h);
    await reset();await query("update public.deals set status='in_force' where id=$1",[id(301)]);
    await as('agent');assert.equal((await submit(k,p)).status,'review_required');
  });
  await check('rejection is durable and never treated as a posting receipt',async()=>{
    await as('agent');const k=key(),p=payload(),h=await submit(k,p);
    await as('admin');await decide(h,'rejected','Existing coverage is duplicated; do not submit another policy.');
    const before=await counts();await as('agent');assert.equal((await submit(k,p)).status,'review_rejected');assert.deepEqual(await counts(),before);
  });
  await check('deactivated, banned and suspended reviewers cannot approve even with reader grants',async()=>{
    await as('agent');const h=await submit(key(),payload());
    await reset();await query('update public.agents set is_deactivated=true where id=$1',[A.manager]);
    await as('manager');await denied(()=>decide(h));
    await reset();await query('update public.agents set is_deactivated=false where id=$1',[A.manager]);
    await query("update auth.users set banned_until=now()+interval '1 day' where id=$1",[U.manager]);
    await as('manager');await denied(()=>queue());await denied(()=>decide(h));
    await reset();await query('update auth.users set banned_until=null where id=$1',[U.manager]);
    await query('insert into public.agent_access_suspensions values($1,null)',[U.admin]);
    await as('admin');await denied(()=>decide(h));
    await reset();await query('delete from public.agent_access_suspensions where user_id=$1',[U.admin]);
  });
  await check('overlapping new requests converge on one post then a hold under the carrier-DOB transaction lock',async()=>{
    await as('agent');const p=payload({clientFirstName:'Concurrent',clientLastName:'Fixture',clientPhone:'2025550123',clientDob:'1977-03-04'});
    await db.exec('begin');const first=await submit(key(),p);assert(first.dealId);
    assert((await scalar("select count(*)::int as v from pg_locks where locktype='advisory' and granted"))>0);
    await db.exec('commit');
    const second=await submit(key(),{...p,policyNumber:'CONCURRENT-SECOND'});assert.equal(second.status,'review_required');
    assert.equal((await counts()).permits,0);
  });
  await check('trusted identity-less carrier ingestion remains available',async()=>{
    await reset();await query("select set_config('test.uid','',false)");
    await query("insert into public.deals(agent_id,carrier_id,client_first_name,client_last_name,client_phone,client_dob,policy_number,status,source) values($1,$2,'Fixture','Insured','2025550101','1990-01-02','TRUSTED-IMPORT','submitted','agent_link')",[A.agent,C]);
  });
  console.log(`PASS ${checks} coverage-review SQL scenarios`);
} catch (error) {
  console.error(error?.message ?? error);
  if (error?.code) console.error(`PostgreSQL code: ${error.code}`);
  process.exitCode=1;
} finally { await db.close(); }
