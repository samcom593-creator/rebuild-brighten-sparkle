// Execute the real migration against isolated PostgreSQL (PGlite), using synthetic consumers only.
// Usage: node scripts/tests/consumer-source-import.mjs /path/to/@electric-sql/pglite/dist/index.js
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(process.argv[2] ? pathToFileURL(process.argv[2]).href : '@electric-sql/pglite');
const db = new PGlite();
await db.exec(`
create role anon; create role authenticated; create schema auth;
create table auth.users(id uuid primary key);
insert into auth.users values ('11111111-1111-4111-8111-111111111111');
create function auth.uid() returns uuid language sql as $$select nullif(current_setting('fixture.uid',true),'')::uuid$$;
create function public.can_view_sold_calls() returns boolean language sql as $$select current_setting('fixture.allowed',true) = 'yes'$$;
select set_config('fixture.uid','11111111-1111-4111-8111-111111111111',false);
select set_config('fixture.allowed','yes',false);
create table public.client_leads (
id uuid primary key default gen_random_uuid(),external_id text,source_file text not null,source_files text[],
first_name text,last_name text,phone_digits text,phone_e164 text,phone_alt text,email text,state text,street_address text,dob date,
policy_number text,policy_carrier text,policy_product text,policy_date date,has_existing_policy boolean,
original_agent text,original_agent_code text,loan_amount numeric,loan_type text,lender_name text,lead_date date,
lead_type text,lead_pack text,notes text,dnc boolean,status text,last_disposition text,raw jsonb,updated_at timestamptz,
assigned_agent_id uuid,policy_monthly_premium numeric,policy_annual_premium numeric
);
create table public.lead_contact_dnc(phone10 text primary key,recorded_source text not null,recorded_at timestamptz default now());
create table public.lead_bundles(id uuid primary key, archived_at timestamptz);
create table public.lead_bundle_items(id uuid primary key,lead_id uuid,bundle_id uuid,removed_at timestamptz,source_kind text);
create table public.lead_bundle_grants(bundle_id uuid,user_id uuid,revoked_at timestamptz);
`);
await db.exec(readFileSync(new URL('../../supabase/migrations/20261124140000_consumer_source_import.sql', import.meta.url),'utf8'));
const base = {source_row:1,first_name:'Taylor',last_name:'Example',phone_digits:'6152345678',email:'taylor@example.test',state:'TN',dob:'1980-01-01',policy_number:'DEMO-1',policy_carrier:'Example Carrier',policy_product:'Whole life',policy_date:'2020-01-01',issues:[],dnc:false,raw:{policy_status_claim:'Active (inforce)',supplier_amount:65}};
const send=async(rows,source='fixture-source')=>(await db.query('select public.consumer_lead_import($1,$2,$3,$4::jsonb) as receipt',[source,'Synthetic policy file','pos',JSON.stringify(rows)])).rows[0].receipt;
const first=await send([base]);assert.equal(first.imported,1);assert.equal(first.review,0);
const replay=await send([base]);assert.equal(replay.batch_id,first.batch_id);assert.equal(replay.replayed,true);
assert.equal((await db.query('select count(*)::int as n from public.client_leads')).rows[0].n,1);
const sourceRepeat=await send([{...base,source_row:2}], 'fixture-source');assert.equal(sourceRepeat.duplicate,1);
const policy2=await send([{...base,policy_number:'DEMO-2'}],'fixture-second-policy');assert.equal(policy2.matched,1);
assert.equal((await db.query('select count(*)::int as n from public.consumer_policy_observations')).rows[0].n,2);
const lead=(await db.query('select * from public.client_leads')).rows[0];
assert.equal(lead.policy_number,'DEMO-1');assert.equal(lead.policy_monthly_premium,null);assert.equal(lead.policy_annual_premium,null);
assert.equal(lead.raw.policy_status_verified_at,null);
const collision=await send([{...base,first_name:'Different'}],'fixture-collision');assert.equal(collision.review,1);assert.equal(collision.imported,0);
const stateRow={...base,phone_digits:'6152345679',email:'state@example.test',policy_number:'DEMO-STATE'};
const missingState=await send([{...stateRow,state:null,issues:['state_needs_review']}],'fixture-state');assert.equal(missingState.review,1);
const corrected=await send([stateRow],'fixture-state');assert.equal(corrected.imported,1);
assert.equal((await db.query("select count(*)::int n from public.consumer_import_rows where source_key='fixture-state' and status='review' and resolved_by_row_id is not null")).rows[0].n,1);
const optout=await send([{...base,state:null,dnc:false,notes:'Do not call again'}],'fixture-stop');assert.equal(optout.suppressed,1);assert.equal(optout.review,1);
assert.equal((await db.query('select count(*)::int n from public.lead_contact_dnc')).rows[0].n,1);
const keepStop=await send([{...base,notes:'No answer',dnc:false}],'fixture-later');assert.equal(keepStop.suppressed,1);
assert.equal((await db.query('select dnc from public.client_leads where id=$1',[lead.id])).rows[0].dnc,true);
const alternateRow={...base,first_name:'Morgan',phone_digits:'6152345681',phone_alt:'6152345682',email:null,policy_number:'DEMO-ALT',notes:'Do not contact'};
assert.equal((await send([alternateRow],'fixture-alt')).suppressed,1);
const alternateAgain=await send([{...alternateRow,phone_digits:'6152345682',phone_alt:null,notes:null}],'fixture-alt-primary');
assert.equal(alternateAgain.matched,1);assert.equal(alternateAgain.suppressed,1);assert.equal(alternateAgain.imported,0);
const other={...base,first_name:'Other',phone_digits:'6152345683',email:'other@example.test',policy_number:'DEMO-OTHER'};
assert.equal((await send([other],'fixture-other')).imported,1);
assert.equal((await send([{...base,policy_number:'DEMO-OTHER'}],'fixture-conflicting-policy')).review,1);
const missingName={...base,first_name:'Casey',last_name:'',phone_digits:'6152345684',email:'casey@example.test',policy_number:'DEMO-NAME',issues:['incomplete_name']};
assert.equal((await send([missingName],'fixture-name')).review,1);
assert.equal((await send([{...missingName,last_name:'Example',issues:[]}],'fixture-name')).imported,1);
assert.equal((await db.query("select count(*)::int n from public.consumer_import_rows where source_key='fixture-name' and status='review' and resolved_by_row_id is not null")).rows[0].n,1);
await send([{...missingName,source_row:3,last_name:'Example',state:null,issues:['state_needs_review']}],'fixture-name');
assert.equal((await send([{...missingName,source_row:3,last_name:'Example',issues:[]}],'fixture-name')).duplicate,1);
assert.equal((await db.query("select count(*)::int n from public.consumer_import_rows where source_key='fixture-name' and status='review' and resolved_by_row_id is null")).rows[0].n,0);
const review=(await db.query('select public.consumer_import_review() as rows')).rows[0].rows;
const conflicting=review.find(row=>row.source_key==='fixture-conflicting-policy');
assert.equal(conflicting.source_name,'Synthetic policy file');assert.equal(conflicting.source_row,1);
assert.equal(conflicting.payload.first_name,'Taylor');assert.equal(review.some(row=>row.source_key==='fixture-name'),false);
const history=(await db.query('select public.consumer_import_history(1) as rows')).rows[0].rows;
assert.equal(history.length,1);assert.equal(history[0].source_name,'Synthetic policy file');
await db.exec("select set_config('fixture.allowed','no',false)");
await assert.rejects(()=>send([{...base,phone_digits:'6152345680'}],'fixture-forbidden'),/require lead management access/);
await assert.rejects(()=>db.query('select public.consumer_import_review()'),/require lead management access/);
await assert.rejects(()=>db.query('select public.consumer_import_history()'),/require lead management access/);
await db.exec("select set_config('fixture.allowed','yes',false); select set_config('fixture.uid','',false)");
await assert.rejects(()=>send([base],'fixture-no-auth'),/require lead management access/);
await assert.rejects(()=>db.query('select public.consumer_import_review()'),/require lead management access/);
await db.close();
console.log('Consumer intake PostgreSQL fixture passed: source retry, duplicate rows, shared-contact review, policy history, corrected reviews, source-labelled review queue, history, durable stop-contact, and authorization.');
