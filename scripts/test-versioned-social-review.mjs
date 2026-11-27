/** Isolated PostgreSQL regression checks with synthetic rows; no network or production data.
 * PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node scripts/test-versioned-social-review.mjs
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
if (!process.env.PGLITE_MODULE) throw new Error('Set PGLITE_MODULE to the existing isolated PostgreSQL test runtime.');
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db = new PGlite();
const read = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const definition = (source, name) => {
  const start = source.search(new RegExp(`create (?:or replace )?function public\\.${name}\\(`, 'i'));
  assert(start >= 0, `Missing actual definition: ${name}`);
  const rest = source.slice(start), delimiter = rest.match(/\$[a-zA-Z_]*\$/)?.[0];
  assert(delimiter);
  const end = rest.indexOf(delimiter, rest.indexOf(delimiter) + delimiter.length);
  return rest.slice(0, end + delimiter.length + 1);
};
const owner = '71826bba-5577-4810-a226-1f6f2ad5288a';
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const people = { owner, team: id(2), invited: id(3), outsider: id(4), admin: id(5) };
const query = (sql, args = []) => db.query(sql, args);
const value = async (sql, args = []) => (await query(sql, args)).rows[0]?.v;
const call = (name, args = []) => value(`select public.${name}(${args.map((_, i) => `$${i + 1}`).join(',')}) as v`, args);
const reset = () => db.exec('reset role');
async function asUser(who, role = 'authenticated', live = true) {
  await reset();
  const user = people[who] ?? '';
  await query("select set_config('test.uid',$1,false),set_config('test.role',$2,false),set_config('test.jwt',$3,false)", [user, role, JSON.stringify({ email: `${who}@example.invalid`, session_id: live ? id(100) : id(999) })]);
  await db.exec(`set role ${role}`);
}
async function deny(sql, args = [], code = '42501') {
  await assert.rejects(() => query(sql, args), error => { assert.equal(error.code, code, error.message); return true; });
}
const hash = n => value('select content_hash as v from public.social_bot_drafts where id=$1', [n]);
const version = n => value('select updated_at::text as v from public.content_queue where content_id=$1', [n]);
let checks = 0;
const check = async (name, run) => { await run(); checks++; console.log(`PASS ${name}`); };
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema storage;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select nullif(current_setting('test.role',true),'') $$;
    create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('test.jwt',true),''),'{}')::jsonb $$;
    create table auth.sessions(id uuid primary key); insert into auth.sessions values('${id(100)}');
    create type public.app_role as enum ('admin','manager','agent');
    create table public.user_roles(user_id uuid, role public.app_role);
    create function public.has_role(_user_id uuid,_role public.app_role) returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from user_roles where user_id=_user_id and role=_role) $$;
    create function public.apex_is_admin() returns boolean language sql stable as $$ select public.has_role(auth.uid(),'admin'::public.app_role) $$;
    create table public.call_access_grants(user_id uuid primary key);
    create table storage.objects(id uuid, bucket_id text);
    create table storage.buckets(id text primary key, name text, public boolean);
    create table public.social_bot_drafts(
      id bigint primary key, title text, hook text, body text, caption text, hashtags text, cta text,
      file_path text, platform text, account text, status text not null default 'awaiting_approval',
      approved_at timestamptz, approved_by text, shipped_at timestamptz, shipped_url text,
      notes text, updated_at timestamptz default now()
    );
    alter table public.social_bot_drafts enable row level security;
    grant usage on schema auth,public to authenticated,anon,service_role;
    grant select,insert,update,delete on public.social_bot_drafts to authenticated,service_role;
  `);
  await db.exec(definition(await read('20261111214500_private_surface_guard.sql'), 'is_sam'));
  await db.exec(definition(await read('20261108230000_call_access_grants.sql'), 'can_view_sold_calls'));
  await db.exec(`create policy social_bot_drafts_sam_only on public.social_bot_drafts for all to authenticated using(public.is_sam()) with check(public.is_sam());`);
  await db.exec(definition(await read('20261006150000_launch_board_workflow.sql'), 'content_publish_url_ok'));
  const ownerBase = await read('20261112210000_social_center_owner_only.sql');
  await db.exec(ownerBase.slice(ownerBase.indexOf('-- The content a post')));
  await db.exec(definition(await read('20261028040000_social_command_center_wave0.sql'), 'social_draft_set_status'));
  await db.exec('revoke all on function public.social_draft_set_status(bigint,text,text) from public,anon; grant execute on function public.social_draft_set_status(bigint,text,text) to authenticated,service_role;');
  await db.exec(await read('20260909222435_content_queue_phone_mirror.sql'));
  await db.exec(await read('20260909223842_content_queue_media_playback.sql'));
  await db.exec(await read('20260909233852_content_access_allowlist.sql'));
  await db.exec(definition(await read('20261111204500_private_surfaces_sam_only.sql'), 'content_can_access'));
  await query('insert into public.call_access_grants values($1)', [people.team]);
  await query("insert into public.user_roles values($1,'admin')", [people.admin]);
  await query("insert into public.content_access(email) values('invited@example.invalid')");
  await db.exec(`insert into public.social_bot_drafts(id,title,body,platform,account,notes,status) values
    (1,'Visible review','Complete version','tiktok','actual-account','private internal note','awaiting_approval'),
    (2,'Private archive','Archived body','tiktok','actual-account','private internal note','archived'),
    (3,'Pending owner draft','Pending body','tiktok','actual-account',null,'pending'),
    (4,'Film review','Film body','youtube','actual-account',null,'awaiting_film'),
    (5,'No-row fixture','Body','tiktok','actual-account',null,'awaiting_approval');
    insert into public.content_queue(content_id,hook,caption,status,privacy_risk) values
    ('clip-1','Original hook','Complete caption','NEEDS_REVIEW',null),
    ('flagged','Review flag','Caption','NEEDS_REVIEW','FLAG: privacy'),
    ('archived','Old clip','Caption','ARCHIVED',null),
    ('no-row','No-row fixture','Caption','NEEDS_REVIEW',null);
  `);
  await check('negative control: legacy direct and hashless approvals both succeed', async () => {
    await asUser('owner'); await query("update public.social_bot_drafts set status='approved' where id=1");
    await reset(); await query("update public.social_bot_drafts set status='awaiting_approval' where id=1");
    await asUser('team'); assert.equal((await call('social_draft_set_status', [1, 'approved', null])).status, 'approved');
    await reset(); await query("update public.social_bot_drafts set status='awaiting_approval',approved_at=null,approved_by=null where id=1");
  });
  const policies = await query("select tablename,policyname,roles,cmd,qual,with_check from pg_policies where tablename in ('social_bot_drafts','content_queue') order by tablename,policyname");
  const grants = await query("select grantee,table_name,privilege_type,column_name from information_schema.column_privileges where table_schema='public' and table_name in ('social_bot_drafts','content_queue') order by grantee,table_name,column_name,privilege_type");
  const migration = await read('20261127043000_versioned_social_review.sql');
  assert(!/\b(?:net\.|http_post|pg_notify|cron\.|dblink)/i.test(migration));
  await db.exec(migration); await db.exec(migration);
  await check('migration is idempotent and preserves table visibility and column privileges', async () => {
    assert.deepEqual((await query("select tablename,policyname,roles,cmd,qual,with_check from pg_policies where tablename in ('social_bot_drafts','content_queue') order by tablename,policyname")).rows, policies.rows);
    assert.deepEqual((await query("select grantee,table_name,privilege_type,column_name from information_schema.column_privileges where table_schema='public' and table_name in ('social_bot_drafts','content_queue') order by grantee,table_name,column_name,privilege_type")).rows, grants.rows);
  });
  await check('new RPCs deny PUBLIC and anon; trigger functions are invoker', async () => {
    for (const sig of ['social_draft_review(bigint)','social_draft_review_set_status(bigint,text,text)','content_queue_review_set_status(text,timestamp with time zone,text)']) {
      assert.equal(await value("select has_function_privilege('anon',$1,'execute') as v", ['public.' + sig]), false);
      assert.equal(await value("select has_function_privilege('authenticated',$1,'execute') as v", ['public.' + sig]), true);
      assert.equal(await value("select exists(select 1 from pg_proc p,lateral aclexplode(p.proacl) a where p.oid=$1::regprocedure and a.grantee=0 and privilege_type='EXECUTE') as v", ['public.' + sig]), false);
    }
    for (const sig of ['trg_social_draft_approval_binding()','content_queue_guard_update()']) assert.equal(await value('select prosecdef as v from pg_proc where oid=$1::regprocedure', ['public.' + sig]), false);
  });
  await check('ungranted and revoked-owner callers cannot read or approve', async () => {
    await asUser('outsider'); await deny('select public.social_draft_review(1)');
    await deny("select public.social_draft_review_set_status(1,'hash','approved')");
    await deny("select public.content_queue_review_set_status('clip-1',now(),'APPROVED')");
    await asUser('owner','authenticated',false); await deny('select public.social_draft_review(1)');
    await asUser('outsider','anon'); await deny('select public.social_draft_review(1)');
  });
  await check('team sees complete active content only; owner retains private draft access', async () => {
    await asUser('team'); const review = await call('social_draft_review',[1]);
    assert.equal(review.body,'Complete version'); assert.equal(review.account,'actual-account'); assert(!('notes' in review));
    assert.equal(await call('social_draft_review',[2]),null); assert.equal(await call('social_draft_review',[3]),null);
    assert.equal(await value('select count(*)::int as v from public.social_bot_drafts'),0);
    await asUser('owner'); assert.equal((await call('social_draft_review',[2])).status,'archived');
    await asUser('admin'); assert.equal((await call('social_draft_review',[1])).id,1);
  });
  await check('team approval binds to the viewed hash and rejects stale/null/repeated writes', async () => {
    await asUser('team'); const review = await call('social_draft_review',[1]);
    assert.equal(await call('social_draft_review_set_status',[1,null,'approved']),'changed');
    await reset(); await query("update public.social_bot_drafts set body='New version' where id=1");
    await asUser('team'); assert.equal(await call('social_draft_review_set_status',[1,review.content_hash,'approved']),'changed');
    const fresh = await call('social_draft_review',[1]); assert.equal(await call('social_draft_review_set_status',[1,fresh.content_hash,'approved']),'approved');
    assert.equal(await call('social_draft_review_set_status',[1,fresh.content_hash,'approved']),'already_handled');
    assert.equal((await call('social_draft_review',[1])).approved_content_hash,fresh.content_hash);
    assert.equal(await call('social_draft_review_set_status',[2,fresh.content_hash,'approved']),'not_found');
    await deny("select public.social_draft_review_set_status(1,'x','shipped')",[],'22023');
  });
  await check('direct and old-RPC approval bypasses fail, including fabricated receipt fields', async () => {
    await asUser('owner');
    await deny("update public.social_bot_drafts set status='approved' where id=3");
    await deny("insert into public.social_bot_drafts(id,status,title) values(100,'approved','No review')");
    await deny("update public.social_bot_drafts set approved_content_hash=content_hash where id=3");
    await deny("update public.social_bot_drafts set status='shipped',shipped_at=now() where id=1");
    await deny("update public.social_bot_drafts set status='shipped',shipped_at=now(),shipped_url='https://instagram.com/p/fixture' where id=3");
    await asUser('team'); await deny("select public.social_draft_set_status(4,'approved',null)",[],'22023');
  });
  await check('owner canonical RPC keeps its role/status restrictions and version binding', async () => {
    await asUser('team'); await deny("select public.approve_social_draft(4,'x')");
    await asUser('owner'); assert.equal(await call('approve_social_draft',[4,await hash(4)]),'already_handled');
    await reset(); await query("update public.social_bot_drafts set status='awaiting_approval' where id=4");
    await asUser('owner'); const seen = await hash(4); assert.equal(await call('approve_social_draft',[4,seen]),'approved');
    await query("update public.social_bot_drafts set caption='Edited after approval' where id=4");
    const changed = await call('social_draft_review',[4]); assert.equal(changed.status,'awaiting_approval'); assert.equal(changed.approved_content_hash,null);
  });
  await check('trusted publishing still requires a real URL-shaped receipt and time', async () => {
    await asUser('outsider','service_role');
    await deny("update public.social_bot_drafts set status='shipped' where id=1",[],'22023');
    await query("update public.social_bot_drafts set status='shipped',shipped_at=now(),shipped_url='https://instagram.com/p/synthetic-fixture' where id=1");
    assert.equal(await value('select status as v from public.social_bot_drafts where id=1'),'shipped');
  });
  await check('owner receipt entry remains available only for the unchanged approved version', async () => {
    await asUser('owner');
    assert.equal(await call('approve_social_draft',[4,await hash(4)]),'approved');
    await deny("update public.social_bot_drafts set body='Unreviewed change',status='shipped',shipped_at=now(),shipped_url='https://instagram.com/p/fixture' where id=4");
    await query("update public.social_bot_drafts set status='shipped',shipped_at=now(),shipped_url='https://instagram.com/p/owner-fixture' where id=4");
    assert.equal(await value('select status as v from public.social_bot_drafts where id=4'),'shipped');
  });
  await check('queue invitation is independent of team grants and is revocable', async () => {
    await asUser('team'); await deny("select public.content_queue_review_set_status('clip-1',now(),'APPROVED')");
    await asUser('admin'); await deny("select public.content_queue_review_set_status('clip-1',now(),'APPROVED')");
    await asUser('invited'); assert.equal(await value('select count(*)::int as v from public.content_queue'),4);
    await deny('select public.social_draft_review(4)');
    await reset(); await query("update public.content_access set revoked_at=now() where email='invited@example.invalid'");
    await asUser('invited'); await deny("select public.content_queue_review_set_status('clip-1',now(),'APPROVED')");
    await reset(); await query("update public.content_access set revoked_at=null where email='invited@example.invalid'");
  });
  await check('queue approval checks viewed version, risk flags, actor, valid status and conflicts', async () => {
    await asUser('invited'); const stale = await version('clip-1');
    await query("update public.content_queue set caption='New caption' where content_id='clip-1'");
    assert.equal(await call('content_queue_review_set_status',['clip-1',stale,'APPROVED']),'changed');
    await deny("update public.content_queue set status='APPROVED' where content_id='clip-1'");
    const seen = await version('clip-1'); assert.equal(await call('content_queue_review_set_status',['clip-1',seen,'APPROVED']),'APPROVED');
    assert.equal(await value("select approved_by as v from public.content_queue where content_id='clip-1'"),people.invited);
    assert.equal(await call('content_queue_review_set_status',['clip-1',await version('clip-1'),'APPROVED']),'already_handled');
    await deny('select public.content_queue_review_set_status($1,$2,$3)',['flagged',await version('flagged'),'APPROVED'],'22023');
    assert.equal(await call('content_queue_review_set_status',['archived',await version('archived'),'APPROVED']),'already_handled');
    assert.equal(await call('content_queue_review_set_status',['missing',seen,'APPROVED']),'not_found');
    await query("update public.content_queue set hook='Edit after approval' where content_id='clip-1'");
    assert.equal(await value("select status as v from public.content_queue where content_id='clip-1'"),'NEEDS_REVIEW');
    assert.equal(await value("select approved_by as v from public.content_queue where content_id='clip-1'"),null);
  });
  await check('suppressed writes return no-row conflicts instead of false success', async () => {
    await reset();
    await db.exec(`create function public.fixture_skip_social() returns trigger language plpgsql as $$ begin if new.id=5 then return null; end if; return new; end $$;
      create trigger z_fixture_skip_social before update on public.social_bot_drafts for each row execute function public.fixture_skip_social();
      create function public.fixture_skip_queue() returns trigger language plpgsql as $$ begin if new.content_id='no-row' then return null; end if; return new; end $$;
      create trigger z_fixture_skip_queue before update on public.content_queue for each row execute function public.fixture_skip_queue();`);
    await asUser('owner'); assert.equal(await call('approve_social_draft',[5,await hash(5)]),'not_found');
    const seen = await hash(5); await asUser('team'); assert.equal(await call('social_draft_review_set_status',[5,seen,'approved']),'not_found');
    await asUser('invited'); assert.equal(await call('content_queue_review_set_status',['no-row',await version('no-row'),'APPROVED']),'not_found');
  });
  console.log(`PASS ${checks} versioned social review PostgreSQL groups; synthetic rows only.`);
} catch (error) { console.error(`FAIL ${error.message}${error.code ? ` (${error.code})` : ""}`); process.exitCode = 1; } finally { await db.close(); }
