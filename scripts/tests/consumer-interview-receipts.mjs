import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Real PostgreSQL execution in memory. Supply an existing PGlite installation;
// this test never installs packages or connects to a production database.
const { PGlite } = await import(process.env.PGLITE_MODULE_PATH || "@electric-sql/pglite");
const db = new PGlite();
const OWNER = "10000000-0000-0000-0000-000000000001";
const APP = "20000000-0000-0000-0000-000000000001";
const INTERVIEW = "30000000-0000-0000-0000-000000000001";
const LEAD = "40000000-0000-0000-0000-000000000001";
const CAMPAIGN = "ethos-consumer-20261124-v1";
let checks = 0;
async function check(name, fn) { await fn(); checks++; process.stdout.write(`PASS ${name}\n`); }
async function query(sql, params = []) { return (await db.query(sql, params)).rows; }
await db.exec(`
create role anon; create role authenticated; create role service_role;
create schema auth;
create table auth.users(id uuid primary key);
insert into auth.users values ('${OWNER}');
create function auth.uid() returns uuid language sql as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
create function auth.role() returns text language sql as $$ select current_setting('test.role',true) $$;
create function public.fn_recruit_sam_user_id() returns uuid language sql as $$ select '${OWNER}'::uuid $$;
create function public.calendar_is_scheduling_staff() returns boolean language sql as $$ select coalesce(current_setting('test.staff',true),'false')='true' $$;
create table public.client_leads(id uuid primary key,first_name text,email text,state text,dnc boolean,last_disposition text,raw jsonb,phone_digits text,phone_e164 text);
create table public.lead_contact_dnc(phone10 text primary key,recorded_source text);
create table public.email_unsubscribes(email text primary key);
create table public.email_suppressions(email text primary key);
create table suppression_fixture(lead_id uuid,suppression_reason text);
create view public.v_leads_suppression_all as select * from suppression_fixture;
create type public.application_status as enum('new','interview','onboarding','contracting','approved','producing','attended_no_show','no_pickup','rejected','lapsed');
create table public.applications(id uuid primary key,status public.application_status default 'new',closed_at timestamptz,
 last_contacted_at timestamptz,contacted_at timestamptz,human_first_contact_at timestamptz,human_last_contact_at timestamptz,
 last_contact_outcome text,last_contact_outcome_at timestamptz,last_contact_outcome_by uuid,last_contact_channel text,
 next_action text,next_action_due_at timestamptz,next_action_set_at timestamptz,next_action_set_by uuid,waiting_reason text,next_review_at timestamptz,updated_at timestamptz default now());
create table public.agents(id uuid primary key,user_id uuid,source_application_id uuid,is_deactivated boolean default false,canonical_agent_id uuid);
create table public.interview_events(id uuid primary key,application_id uuid references public.applications,agent_id uuid references public.agents,owner_user_id uuid,
 outcome text,outcome_at timestamptz,outcome_by uuid,notes text,followup_due_at timestamptz,contacted_at timestamptz,updated_at timestamptz default now());
create function public.fixture_touch() returns trigger language plpgsql as $$ begin new.updated_at:=clock_timestamp(); return new; end $$;
create trigger fixture_interview_touch before update on public.interview_events for each row execute function public.fixture_touch();
create trigger fixture_application_touch before update on public.applications for each row execute function public.fixture_touch();
create table public.application_contact_log(id uuid primary key default gen_random_uuid(),application_id uuid,channel text,outcome text,contact_outcome text,
 notes text,logged_by uuid,source_surface text,next_action text,next_action_due_at timestamptz,logged_at timestamptz default now());
create table public.next_step_progress(id uuid primary key default gen_random_uuid(),application_id uuid unique,current_stage_key text,prior_stage_key text,entered_at timestamptz,
 completed_at timestamptz,is_stalled boolean,stalled_at timestamptz,stall_reason text,sla_due_at timestamptz,manual_stage_key text,manual_stage_at timestamptz,manual_by uuid,
 metadata jsonb,owner_role text,owner_user_id uuid,status text,updated_at timestamptz default now());
create function public.fn_application_has_agent(p_id uuid) returns boolean language sql as $$ select exists(select 1 from public.agents where source_application_id=p_id and not is_deactivated) $$;
create function public.fn_log_human_contact(p_id uuid,p_channel text,p_outcome text,p_actor uuid,p_surface text,p_notes text) returns uuid language plpgsql as $$
declare result uuid; begin
 insert into public.application_contact_log(application_id,channel,outcome,logged_by,source_surface,notes) values(p_id,p_channel,p_outcome,p_actor,p_surface,p_notes) returning id into result;
 update public.applications set last_contacted_at=now(),contacted_at=coalesce(contacted_at,now()),human_first_contact_at=coalesce(human_first_contact_at,now()),human_last_contact_at=now(),
 status=case when p_outcome in ('hired','contracted') then 'contracting'::public.application_status when p_outcome='no_answer' then 'no_pickup'::public.application_status when p_outcome='completed' then 'interview'::public.application_status else status end where id=p_id;
 return result; end $$;
select set_config('test.role','service_role',false); select set_config('test.uid','${OWNER}',false);
insert into public.applications(id) values('${APP}');
insert into public.interview_events(id,application_id,owner_user_id) values('${INTERVIEW}','${APP}','${OWNER}');
insert into public.client_leads values('${LEAD}','Pat','pat@example.com','WI',false,null,'{"source_type":"pos","source_batch_id":"fixture-batch"}','4145550100','+14145550100');
`);
for (const name of ["20261124130000_ethos_consumer_campaign.sql", "20261124131000_interview_disposition_receipts.sql"]) {
  await db.exec(readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), "utf8"));
}
const candidates = () => query("select * from ethos_consumer_candidates($1,$2)", [CAMPAIGN,"fixture-batch"]);
await check("consumer is blocked when no verified owner state exists", async () => assert.equal((await candidates())[0].reason,"licensed_state_not_verified"));
await check("sending cannot be enabled without current state evidence",async()=>await assert.rejects(()=>query("select set_ethos_consumer_campaign_enabled($1,$2,true)",[CAMPAIGN,OWNER]),/current licensed state/));
await check("scope saves reject missing evidence and an owner spoof",async()=>{
  await assert.rejects(()=>query("select set_ethos_consumer_scope($1,$2,'WI',true,null,now()+interval '1 month',null)",[CAMPAIGN,OWNER]),/Current license evidence/);
  await db.exec("select set_config('test.role','authenticated',false); select set_config('test.uid','10000000-0000-0000-0000-000000000002',false);");
  await assert.rejects(()=>query("select set_ethos_consumer_scope($1,$2,'WI',true,'fixture-regulator',now()+interval '1 month',null)",[CAMPAIGN,OWNER]),/Only the campaign owner/);
  await db.exec(`select set_config('test.role','service_role',false); select set_config('test.uid','${OWNER}',false);`);
});
await query("select set_ethos_consumer_scope($1,$2,'WI',true,'fixture-regulator',now()+interval '1 month',null)",[CAMPAIGN,OWNER]);
await check("a license alone does not manufacture Ethos eligibility",async()=>assert.equal((await candidates())[0].reason,"ethos_state_eligibility_not_verified"));
await query("select set_ethos_consumer_scope($1,$2,'WI',true,'fixture-regulator',now()+interval '1 month','fixture-carrier')",[CAMPAIGN,OWNER]);
await check("verified evidence yields one reviewable eligible consumer",async()=>assert.equal((await candidates())[0].reason,"eligible"));
await db.exec(`
create table consumer_import_batches(id uuid primary key,source_kind text);
create table consumer_import_rows(batch_id uuid,lead_id uuid,status text);
insert into consumer_import_batches values('60000000-0000-0000-0000-000000000001','mortgage');
insert into client_leads values('40000000-0000-0000-0000-000000000002','Lee','lee@example.com','WI',false,null,'{"original_source":"legacy-import"}','4145550101','+14145550101');
insert into consumer_import_rows values('60000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002','matched');
`);
await check("matched imports use their receipt without rewriting old raw provenance",async()=>{
  const rows=await query("select * from ethos_consumer_candidates($1,$2)",[CAMPAIGN,"60000000-0000-0000-0000-000000000001"]);
  assert.equal(rows.length,1); assert.equal(rows[0].reason,"eligible");
  assert.deepEqual((await query("select raw from client_leads where email='lee@example.com'"))[0].raw,{original_source:"legacy-import"});
});
await check("phone suppression identity accepts NANP formats and refuses international suffixes",async()=>{
  for (const value of ["4145550100","+1 (414) 555-0100","011 1 414 555 0100","0014145550100"]) assert.equal((await query("select ethos_consumer_phone10($1) as p",[value]))[0].p,"4145550100");
  assert.equal((await query("select ethos_consumer_phone10('+44 414 555 0100') as p"))[0].p,null);
});
await check("a stop-contact record with the same email in another batch blocks this audience",async()=>{
  await db.exec("insert into client_leads(id,first_name,email,state,dnc,raw) values('40000000-0000-0000-0000-000000000003','Pat',' PAT@example.com ','WI',true,'{\"source_batch_id\":\"other-batch\"}')");
  assert.equal((await candidates())[0].reason,"do_not_contact");
  await db.exec("delete from client_leads where id='40000000-0000-0000-0000-000000000003'");
});
const recipient=(await candidates())[0];
const selections=JSON.stringify([{lead_id:recipient.lead_id,audience_token:recipient.audience_token}]);
await check("changed preview evidence cannot be queued",async()=>await assert.rejects(()=>query("select queue_ethos_consumer_deliveries($1,$2,$3::jsonb,$4::uuid)",[CAMPAIGN,"fixture-batch",JSON.stringify([{lead_id:LEAD,audience_token:"stale"}]),OWNER]),/Audience changed/));
const queued=(await query("select queue_ethos_consumer_deliveries($1,$2,$3::jsonb,$4::uuid) as r",[CAMPAIGN,"fixture-batch",selections,OWNER]))[0].r;
await check("queueing is idempotent and never sends",async()=>{
  assert.equal(queued.queued,1); assert.equal(queued.sent,0);
  const again=(await query("select queue_ethos_consumer_deliveries($1,$2,$3::jsonb,$4::uuid) as r",[CAMPAIGN,"fixture-batch",selections,OWNER]))[0].r;
  assert.equal(again.queued,0); assert.equal(again.already_present,1);
});
await check("disabled campaign refuses dispatch",async()=>await assert.rejects(()=>query("select * from claim_ethos_consumer_deliveries($1,$2::uuid[],5)",[CAMPAIGN,queued.delivery_ids]),/disabled/));
await query("select set_ethos_consumer_campaign_enabled($1,$2,true)",[CAMPAIGN,OWNER]);
await db.exec("insert into email_unsubscribes values('pat@example.com');");
await check("opt-out added after preview blocks at claim time",async()=>{
  assert.equal((await query("select * from claim_ethos_consumer_deliveries($1,$2::uuid[],5)",[CAMPAIGN,queued.delivery_ids])).length,0);
  assert.equal((await query("select status,reason from ethos_consumer_deliveries"))[0].status,"blocked");
});
await db.exec("delete from email_unsubscribes; update ethos_consumer_deliveries set status='queued',reason=null");
await check("a registry-only opt-out after preview blocks at claim without changing the lead",async()=>{
  await db.exec("insert into lead_contact_dnc values('4145550100','consumer_import:quarantined-row')");
  assert.equal((await query("select dnc from client_leads where id=$1",[LEAD]))[0].dnc,false);
  assert.equal((await query("select * from claim_ethos_consumer_deliveries($1,$2::uuid[],5)",[CAMPAIGN,queued.delivery_ids])).length,0);
  assert.equal((await query("select status,reason from ethos_consumer_deliveries"))[0].reason,"do_not_contact");
  await db.exec("delete from lead_contact_dnc; update ethos_consumer_deliveries set status='queued',reason=null");
});
const claimed=await query("select * from claim_ethos_consumer_deliveries($1,$2::uuid[],5)",[CAMPAIGN,queued.delivery_ids]);
await check("one claim prevents duplicate send attempts",async()=>{
  assert.equal(claimed.length,1);
  assert.equal((await query("select * from claim_ethos_consumer_deliveries($1,$2::uuid[],5)",[CAMPAIGN,queued.delivery_ids])).length,0);
});
await check("accepted needs a real matching provider receipt",async()=>{
  await assert.rejects(()=>query("select settle_ethos_consumer_delivery($1,$2,'provider_accepted',null,null)",[claimed[0].delivery_id,claimed[0].claim_id]),/invalid provider receipt/);
  await query("select settle_ethos_consumer_delivery($1,$2,'provider_accepted','provider-fixture',null)",[claimed[0].delivery_id,claimed[0].claim_id]);
  assert.equal((await query("select status from ethos_consumer_deliveries"))[0].status,"provider_accepted");
});

await check("direct Hired cannot bypass canonical agent creation",async()=>{
  await assert.rejects(()=>query("select cc_dispose_interview($1,'hired',null,null)",[INTERVIEW]),/canonical agent/);
  assert.equal((await query("select outcome from interview_events"))[0].outcome,null);
});
await check("callback without deadline writes nothing",async()=>{
  await assert.rejects(()=>query("select cc_dispose_interview($1,'callback',null,null)",[INTERVIEW]),/future callback/);
  assert.equal((await query("select count(*)::int as n from application_contact_log"))[0].n,0);
});
let version=(await query("select updated_at::text as v from interview_events"))[0].v;
const saved=(await query("select cc_record_interview_disposition($1,'callback','call tomorrow',now()+interval '1 day',$2) as r",[INTERVIEW,version]))[0].r;
await check("callback reaches the application worklist and has an undo receipt",async()=>{
  const app=(await query("select next_action,next_action_due_at,last_contact_outcome from applications"))[0];
  assert.equal(app.next_action,"Call back"); assert.ok(app.next_action_due_at); assert.equal(app.last_contact_outcome,"callback"); assert.equal(saved.can_undo,true);
});
await check("stale disposition cannot overwrite the current outcome",async()=>await assert.rejects(()=>query("select cc_record_interview_disposition($1,'no_answer',null,null,$2)",[INTERVIEW,version]),/Interview changed/));
await check("undo restores both records and preserves original evidence in its receipt",async()=>{
  await query("select cc_undo_interview_disposition($1)",[saved.receipt_id]);
  assert.equal((await query("select outcome,followup_due_at from interview_events"))[0].outcome,null);
  const app=(await query("select next_action_due_at,last_contact_outcome,human_last_contact_at from applications"))[0];
  assert.equal(app.next_action_due_at,null); assert.equal(app.last_contact_outcome,null); assert.equal(app.human_last_contact_at,null);
  assert.equal((await query("select count(*)::int as n from application_contact_log"))[0].n,0);
  const audit=(await query("select contact_log_receipt,undone_at from interview_disposition_receipts where id=$1",[saved.receipt_id]))[0];
  assert.ok(audit.contact_log_receipt.id); assert.ok(audit.undone_at);
});
version=(await query("select updated_at::text as v from interview_events"))[0].v;
const changed=(await query("select cc_record_interview_disposition($1,'no_answer',null,null,$2) as r",[INTERVIEW,version]))[0].r;
await db.exec("update applications set next_action='Newer staff plan'");
await check("undo refuses newer recruiting activity without partial changes",async()=>{
  await assert.rejects(()=>query("select cc_undo_interview_disposition($1)",[changed.receipt_id]),/Recruiting activity changed/);
  assert.equal((await query("select outcome from interview_events"))[0].outcome,"no_answer");
  assert.equal((await query("select next_action from applications"))[0].next_action,"Newer staff plan");
});
await db.exec(`insert into agents values('50000000-0000-0000-0000-000000000001','${OWNER}','${APP}',false,null); update applications set status='onboarding';`);
await query("select cc_dispose_interview($1,'hired',null,null)",[INTERVIEW]);
await check("canonical hire preserves onboarding and cannot undo the created account",async()=>{
  assert.equal((await query("select status from applications"))[0].status,"onboarding");
  const receipt=(await query("select id,can_undo from interview_disposition_receipts order by sequence desc limit 1"))[0];
  assert.equal(receipt.can_undo,false); await assert.rejects(()=>query("select cc_undo_interview_disposition($1)",[receipt.id]),/cannot be undone/);
});
await db.exec("select set_config('test.role','authenticated',false); select set_config('test.uid','',false); update interview_events set owner_user_id=null;");
await check("null owner does not bypass the authorization guard",async()=>await assert.rejects(()=>query("select cc_dispose_interview($1,'no_answer',null,null)",[INTERVIEW]),/not authorized/));
await db.close();
process.stdout.write(`${checks} PostgreSQL receipt checks passed. No network or production writes.\n`);
