/** Synthetic PostgreSQL authorization/regression checks; no network or Supabase.
 * Run with PGLITE_MODULE pointing to an external @electric-sql/pglite/dist/index.js.
 * Loads the actual migration and source-proven legacy helpers/policies.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const modulePath = process.env.PGLITE_MODULE;
if (!modulePath) throw new Error('Set PGLITE_MODULE to the isolated optional PostgreSQL test runtime.');
const { PGlite } = await import(pathToFileURL(modulePath).href);
const db = new PGlite();
const read = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');
const migration = await read('supabase/migrations/20261125120000_personal_task_canonical_self.sql');
const legacy = await read('supabase/migrations/20260824070000_roster_honours_deactivation.sql');
const helpers = await read('supabase/migrations/20261112000200_pkg2_hire_lane_foundation.sql');
const duplicates = await read('supabase/migrations/20260807073000_wave_agent_identity_dupes.sql');
const identitySource = await read('supabase/migrations/20260317032216_59c5ecff-1866-44f2-82b5-341082e6c03f.sql');
const tasksSource = await read('supabase/migrations/20260413224727_061f4cd2-97ac-4253-bcd7-eadb2eafd7fb.sql');
const policyFixture = await read('scripts/fixtures/personal-task-agents-policies.sql');
function definition(source, name) {
  const start = source.search(new RegExp(`create (?:or replace )?function public\\.${name}\\(`, 'i'));
  assert(start >= 0, `Missing source definition ${name}`);
  const rest = source.slice(start);
  const delimiter = rest.match(/\$[a-zA-Z_]*\$/)?.[0];
  assert(delimiter);
  const end = rest.indexOf(delimiter, rest.indexOf(delimiter) + delimiter.length);
  return rest.slice(0, end + delimiter.length + 1);
}
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const people = { user: id(1), other: id(2), manager: id(3), admin: id(4), suspended: id(5), missing: id(6), ambiguous: id(7), chained: id(8), giant: id(9) };
const agents = { root: id(101), alias: id(102), other: id(103), manager: id(104), managerAlias: id(105), member: id(106), stranger: id(107), admin: id(108), ambiguousA: id(109), ambiguousB: id(110), chainAlias: id(111), chainMiddle: id(112), giant: id(113) };
const tasks = { root: id(201), alias: id(202), other: id(203) };
const query = async (sql, args = []) => db.query(sql, args);
const scalar = async (sql, args = []) => (await query(sql, args)).rows[0]?.v;
const call = async (name, args = []) => scalar(`select public.${name}(${args.map((_, i) => '$' + (i + 1)).join(',')}) as v`, args);
const root = async () => db.exec('reset role');
async function user(userId, role = 'authenticated') {
  await root();
  await query("select set_config('test.user_id', $1, false)", [userId ?? '']);
  await db.exec(`set role ${role}`);
}
let checks = 0;
async function check(name, fn) { await fn(); checks++; console.log(`PASS ${name}`); }
async function deny(sql, args = [], code = '42501', message) {
  await assert.rejects(() => query(sql, args), e => {
    assert.equal(e.code, code, `${e.message} expected SQLSTATE ${code}`);
    if (message) assert.match(e.message, message);
    return true;
  });
}
const metadata = async () => {
  await root();
  return {
    identity: await scalar("select pg_get_functiondef('public.current_agent_id()'::regprocedure) as v"),
    taskPolicies: (await query("select policyname, permissive, roles, cmd, qual, with_check from pg_policies where schemaname='public' and tablename='agent_tasks' order by policyname")).rows,
    oldAcl: await scalar("select proacl::text as v from pg_proc where oid='public.set_agent_active(uuid[],boolean)'::regprocedure"),
  };
};
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls; create role supabase_admin bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user_id', true), '')::uuid $$;
    create table auth.users(id uuid primary key, banned_until timestamptz, deleted_at timestamptz);
    create type public.app_role as enum ('admin','manager','agent');
    create type public.agent_status as enum ('active','pending','inactive','terminated');
    create table public.user_roles(user_id uuid, role public.app_role);
    create function public.has_role(_user_id uuid, _role public.app_role) returns boolean
      language sql stable security definer set search_path to 'public' as $$ select exists(select 1 from user_roles where user_id=_user_id and role=_role) $$;
    create table public.agents(
      id uuid primary key default gen_random_uuid(), user_id uuid, canonical_agent_id uuid,
      status public.agent_status default 'active', is_inactive boolean default false, is_deactivated boolean default false,
      invited_by_manager_id uuid, manager_id uuid, display_name text, updated_at timestamptz default now(), created_at timestamptz default now(),
      al_user_id text, insuracloud_user_id text, onboarding_stage text, ref_slug text, license_status text
    );
    create table public.agent_access_suspensions(id uuid default gen_random_uuid(), user_id uuid, lifted_at timestamptz);
    grant usage on schema public, auth to authenticated, anon, service_role;
    grant select, insert, update, delete on public.agents to authenticated;
    grant all on public.agents to service_role;
    grant select on public.user_roles to authenticated;
  `);
  await db.exec(definition(identitySource, 'current_agent_id'));
  await db.exec(definition(identitySource, 'current_manager_agent_id'));
  await db.exec(policyFixture);
  for (const name of ['fn_user_is_suspended', 'fn_agent_is_suspended', 'fn_user_login_blocked']) {
    await db.exec(definition(helpers, name));
    await db.exec(`revoke all on function public.${name}(uuid) from public, anon, authenticated; grant execute on function public.${name}(uuid) to service_role;`);
  }
  await db.exec(definition(duplicates, 'fn_block_new_agent_identity_dup'));
  await db.exec(`create trigger trg_block_new_agent_identity_dup before insert or update of al_user_id, insuracloud_user_id, canonical_agent_id on public.agents for each row execute function public.fn_block_new_agent_identity_dup();`);
  await db.exec(definition(legacy, 'set_agent_active'));
  await db.exec('grant execute on function public.set_agent_active(uuid[], boolean) to authenticated;');
  const tableStart = tasksSource.indexOf('CREATE TABLE IF NOT EXISTS public.agent_tasks');
  await db.exec(tasksSource.slice(tableStart, tasksSource.indexOf('-- Plaque Awards', tableStart)));
  const policyStart = tasksSource.indexOf('-- RLS for agent_tasks');
  await db.exec(tasksSource.slice(policyStart, tasksSource.indexOf('-- RLS for plaque_awards', policyStart)));
  await db.exec('grant select, insert, update, delete on public.agent_tasks to authenticated; grant all on public.agent_tasks to service_role;');
  for (const [key, userId] of Object.entries(people)) if (key !== 'missing') await query('insert into auth.users(id) values($1)', [userId]);
  await query("insert into public.user_roles values($1,'manager'),($2,'admin')", [people.manager, people.admin]);
  for (const [key, agentId] of Object.entries(agents)) {
    let userId = null, canonical = null, invited = null;
    if (key === 'root') userId = people.other;
    if (key === 'alias') { userId = people.user; canonical = agents.root; }
    if (key === 'other') userId = people.suspended;
    if (key === 'manager') userId = people.manager;
    if (key === 'managerAlias') { canonical = agents.manager; invited = agents.manager; }
    if (key === 'member') invited = agents.manager;
    if (key === 'admin') userId = people.admin;
    if (key === 'ambiguousA' || key === 'ambiguousB') userId = people.ambiguous;
    if (key === 'chainAlias') { userId = people.chained; canonical = agents.chainMiddle; }
    if (key === 'chainMiddle') canonical = agents.root;
    if (key === 'giant') userId = people.giant;
    await query('insert into public.agents(id,user_id,canonical_agent_id,invited_by_manager_id,display_name) values($1,$2,$3,$4,$5)', [agentId, userId, canonical, invited, `Synthetic ${key}`]);
  }
  await query("update public.agents set status='inactive', is_inactive=true,is_deactivated=true where id=$1", [agents.alias]);
  await query("insert into public.agent_tasks(id,agent_id,title,description,agent_notes,created_at) values($1,$2,'Canonical task',null,'private notes','2026-11-24'),($3,$4,'Historical task',null,'private notes','2026-11-25'),($5,$6,'Another person',null,'private notes','2026-11-23')", [tasks.root, agents.root, tasks.alias, agents.alias, tasks.other, agents.other]);

  await check('negative control: legacy policy and duplicate trigger allow self canonical-pointer replacement', async () => {
    await user(people.user);
    await query('update public.agents set canonical_agent_id=$1 where id=$2', [agents.other, agents.alias]);
    assert.equal(await scalar('select canonical_agent_id as v from public.agents where id=$1', [agents.alias]), agents.other);
    await root();
    await query('update public.agents set canonical_agent_id=$1 where id=$2', [agents.root, agents.alias]);
  });
  await check('negative control: legacy self update can reactivate an inactive login', async () => {
    await user(people.user);
    await query("update public.agents set status='active',is_inactive=false,is_deactivated=false where id=$1", [agents.alias]);
    assert.equal(await scalar('select is_deactivated as v from public.agents where id=$1', [agents.alias]), false);
    await root();
    await query("update public.agents set status='inactive',is_inactive=true,is_deactivated=true where id=$1", [agents.alias]);
  });
  await check('negative control: legacy bulk writer lets a manager reactivate self and another team', async () => {
    await root();
    await query("update public.agents set status='inactive',is_inactive=true,is_deactivated=true where id=any($1::uuid[])", [[agents.manager, agents.stranger]]);
    await user(people.manager);
    assert.equal(await call('set_agent_active', [[agents.manager, agents.stranger], true]), 2);
  });
  const before = await metadata();
  await db.exec(migration);

  await check('legacy global identity, task policies, and bulk RPC ACL remain unchanged', async () => {
    assert.deepEqual(await metadata(), before);
  });
  await check('new task RPC ACL is authenticated only; identity trigger is invoker and not callable', async () => {
    await root();
    for (const sig of ['personal_task_identity()', 'personal_task_list(uuid)', 'personal_task_set_completed(uuid,uuid,boolean)', 'personal_task_create(uuid,text,text,date,text)']) {
      assert.equal(await scalar('select has_function_privilege(\'authenticated\',$1,\'execute\') as v', ['public.' + sig]), true);
      assert.equal(await scalar('select has_function_privilege(\'anon\',$1,\'execute\') as v', ['public.' + sig]), false);
      assert.equal(await scalar("select exists(select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=$1::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE') as v", ['public.' + sig]), false);
    }
    assert.equal(await scalar("select prosecdef as v from pg_proc where oid='public.fn_guard_agent_task_identity_inputs()'::regprocedure"), false);
    assert.equal(await scalar("select has_function_privilege('authenticated','public.fn_guard_agent_task_identity_inputs()','execute') as v"), false);
  });
  await check('canonical identity resolves an inactive historical alias without reactivating it', async () => {
    await user(people.user);
    assert.deepEqual(await call('personal_task_identity'), { user_id: people.user, agent_id: agents.root, agent_ids: [agents.root, agents.alias, agents.chainMiddle].sort() });
    assert.equal(await scalar('select is_deactivated as v from public.agents where id=$1', [agents.alias]), true);
    assert.equal(await call('current_agent_id'), agents.alias);
  });
  await check('list includes original canonical and alias task owners but no private columns', async () => {
    await user(people.user);
    const value = await call('personal_task_list', [agents.root]);
    assert.deepEqual(value.tasks.map(t => t.id), [tasks.alias, tasks.root]);
    assert.equal(value.tasks[0].agent_id, agents.alias);
    assert(!JSON.stringify(value).includes('agent_notes'));
    assert(!JSON.stringify(value).includes('assigned_by'));
    assert(!JSON.stringify(value).includes('private notes'));
  });
  await check('personal task create stamps the canonical owner and actual login', async () => {
    await user(people.user);
    const task = await call('personal_task_create', [agents.root, ' \t Follow up \n', '  Notes\r\n', '2026-11-26', 'high']);
    assert.equal(task.agent_id, agents.root); assert.equal(task.title, 'Follow up'); assert.equal(task.description, 'Notes');
    assert.equal(task.priority, 'high'); assert.equal(task.task_type, 'general'); assert.equal(task.status, 'pending');
    assert.equal(task.completed_at, null); assert(!('assigned_by' in task));
    await root();
    assert.equal(await scalar('select assigned_by as v from public.agent_tasks where id=$1', [task.id]), people.user);
  });
  await check('historical completion and reopen preserve owner and other task fields', async () => {
    await root(); const old = (await query('select * from public.agent_tasks where id=$1', [tasks.alias])).rows[0];
    await user(people.user);
    const receipt = await call('personal_task_set_completed', [agents.root, tasks.alias, true]);
    assert.deepEqual(receipt.task, { id: tasks.alias, agent_id: agents.alias, status: 'completed' });
    await root(); let changed = (await query('select * from public.agent_tasks where id=$1', [tasks.alias])).rows[0];
    assert(changed.completed_at); assert.deepEqual({ ...changed, completed_at: old.completed_at, status: old.status }, old);
    await user(people.user);
    await call('personal_task_set_completed', [agents.root, tasks.alias, false]);
    await root(); changed = (await query('select * from public.agent_tasks where id=$1', [tasks.alias])).rows[0];
    assert.deepEqual(changed, old);
  });
  await check('wrong owner, foreign task, and missing task fail before any write', async () => {
    await user(people.user);
    await deny('select public.personal_task_list($1)', [agents.other]);
    await deny('select public.personal_task_list(null)');
    await deny("select public.personal_task_create($1,'Spoof',null,null,'normal')", [agents.other]);
    await deny('select public.personal_task_set_completed($1,$2,true)', [agents.root, tasks.other]);
    await deny('select public.personal_task_set_completed($1,$2,true)', [agents.root, id(999)]);
  });
  await check('admin task RPC remains personal despite broad existing admin table access', async () => {
    await user(people.admin);
    await deny('select public.personal_task_list($1)', [agents.root]);
    await deny('select public.personal_task_set_completed($1,$2,true)', [agents.admin, tasks.root]);
    const value = await call('personal_task_list', [agents.admin]); assert.deepEqual(value.tasks, []);
  });
  await check('anon and absent login cannot call task APIs', async () => {
    await user(null, 'anon'); await deny('select public.personal_task_identity()');
    await user(null); await deny('select public.personal_task_identity()');
    await user(people.missing); await deny('select public.personal_task_identity()');
  });
  await check('an agent pointing at a missing auth user does not confer identity', async () => {
    await root(); await query('insert into public.agents(id,user_id,canonical_agent_id) values($1,$2,$3)', [id(501), people.missing, agents.root]);
    await user(people.missing); await deny('select public.personal_task_identity()');
    await root(); await query('delete from public.agents where id=$1', [id(501)]);
  });
  await check('ambiguous and chained mappings fail closed', async () => {
    await user(people.ambiguous); await deny('select public.personal_task_identity()');
    await user(people.chained); await deny('select public.personal_task_identity()');
  });
  await check('dangling canonical mapping fails closed', async () => {
    await root(); await query('update public.agents set canonical_agent_id=$1 where id=$2', [id(999), agents.alias]);
    await user(people.user); await deny('select public.personal_task_identity()');
    await root(); await query('update public.agents set canonical_agent_id=$1 where id=$2', [agents.root, agents.alias]);
  });
  await check('deleted and banned logins are denied but expired bans do not block', async () => {
    for (const column of ['deleted_at','banned_until']) {
      await root(); await query(`update auth.users set ${column}=now()+interval '1 day' where id=$1`, [people.user]);
      await user(people.user); await deny('select public.personal_task_identity()');
      await root(); await query(`update auth.users set ${column}=null where id=$1`, [people.user]);
    }
    await query("update auth.users set banned_until=now()-interval '1 day' where id=$1", [people.user]);
    await user(people.user); assert.equal((await call('personal_task_identity')).agent_id, agents.root);
    await root(); await query('update auth.users set banned_until=null where id=$1', [people.user]);
  });
  await check('suspension of either family login blocks the person', async () => {
    for (const login of [people.user, people.other]) {
      await root(); await query('insert into public.agent_access_suspensions(user_id) values($1)', [login]);
      await user(people.user); await deny('select public.personal_task_identity()');
      await root(); await query('update public.agent_access_suspensions set lifted_at=now() where user_id=$1', [login]);
      await user(people.user); assert.equal((await call('personal_task_identity')).agent_id, agents.root);
    }
  });
  await check('inactive, terminated, null status and either canonical deactivation flag deny access', async () => {
    for (const set of ["status='inactive'", "status='terminated'", 'status=null', 'is_inactive=true', 'is_deactivated=true']) {
      await root(); await query(`update public.agents set ${set} where id=$1`, [agents.root]);
      await user(people.user); await deny('select public.personal_task_identity()');
      await root(); await query("update public.agents set status='active',is_inactive=false,is_deactivated=false where id=$1", [agents.root]);
    }
  });
  await check('pending canonical identity, null inactive flags and self pointers are supported', async () => {
    await root(); await query("update public.agents set status='pending',is_inactive=null,is_deactivated=null,canonical_agent_id=id where id=$1", [agents.root]);
    await user(people.user); assert.equal((await call('personal_task_identity')).agent_id, agents.root);
    await root(); await query("update public.agents set status='active',is_inactive=false,is_deactivated=false,canonical_agent_id=null where id=$1", [agents.root]);
  });
  await check('oversized families fail closed', async () => {
    await root();
    await query("insert into public.agents(id,canonical_agent_id) select ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,$1 from generate_series(1,200) n", [agents.giant]);
    await user(people.giant); await deny('select public.personal_task_identity()');
  });
  await check('self writes cannot change id, user binding, family pointer or eligibility', async () => {
    await user(people.user);
    for (const [field, value] of [['id', id(999)], ['user_id', people.suspended], ['canonical_agent_id', agents.other], ['status', 'active'], ['is_inactive', false], ['is_deactivated', false]]) {
      await deny(`update public.agents set ${field}=$1 where id=$2`, [value, agents.alias], '42501', /Agent (identity|activation)/);
    }
  });
  await check('ordinary self profile edits remain permitted', async () => {
    await user(people.user);
    await query("update public.agents set display_name='Updated profile',license_status='licensed',ref_slug='synthetic-profile' where id=$1", [agents.alias]);
    assert.equal(await scalar('select display_name as v from public.agents where id=$1', [agents.alias]), 'Updated profile');
  });
  await check('manager cannot inject a new login or family link through insert', async () => {
    await user(people.manager);
    await deny('insert into public.agents(id,user_id) values($1,$2)', [id(601), people.manager]);
    await deny('insert into public.agents(id,canonical_agent_id) values($1,$2)', [id(601), agents.root]);
  });
  await check('same-identity manager upsert and existing direct-team status edits remain permitted', async () => {
    await user(people.manager);
    await query("insert into public.agents(id,user_id,canonical_agent_id,display_name) values($1,$2,null,'Manager profile') on conflict(id) do update set display_name=excluded.display_name", [agents.manager, people.manager]);
    await query("update public.agents set status='inactive',is_inactive=true,is_deactivated=true where id=$1", [agents.member]);
    assert.equal(await scalar('select is_deactivated as v from public.agents where id=$1', [agents.member]), true);
  });
  await check('manager cannot directly reactivate a canonical alias of self', async () => {
    await root(); await query("update public.agents set status='inactive',is_inactive=true,is_deactivated=true where id=$1", [agents.managerAlias]);
    await user(people.manager);
    await deny("update public.agents set status='active',is_inactive=false,is_deactivated=false where id=$1", [agents.managerAlias]);
  });
  await check('legacy bulk RPC denies self, own-family and outside-team targets', async () => {
    await user(people.manager);
    for (const target of [agents.manager, agents.managerAlias, agents.stranger]) await deny('select public.set_agent_active($1,true)', [[target]]);
    await user(people.user); await deny('select public.set_agent_active($1,true)', [[agents.member]]);
    // Empty batches do not bypass the legacy role gate.
    for (const ids of [null, [], [id(990001)]]) await deny('select public.set_agent_active($1,true)', [ids]);
  });
  await check('legacy bulk RPC rejects mixed targets atomically and permits the direct team', async () => {
    await root(); await query("update public.agents set status='inactive',is_inactive=true,is_deactivated=true where id=$1", [agents.member]);
    await user(people.manager); await deny('select public.set_agent_active($1,true)', [[agents.member, agents.stranger]]);
    assert.equal(await scalar('select is_deactivated as v from public.agents where id=$1', [agents.member]), true);
    assert.equal(await call('set_agent_active', [[agents.member], true]), 1);
    assert.equal(await scalar('select is_deactivated as v from public.agents where id=$1', [agents.member]), false);
    // No matching rows return zero for an authorized manager, including null
    // arrays, empty arrays, nonexistent ids and a null requested state.
    for (const ids of [null, [], [id(990001)]]) {
      for (const active of [true, false, null]) assert.equal(await call('set_agent_active', [ids, active]), 0);
    }
    // Preserve the existing SQL boolean semantics; NULL is not coerced to false.
    assert.equal(await call('set_agent_active', [[agents.member], null]), 1);
    assert.deepEqual((await query('select status::text as status,is_inactive,is_deactivated from public.agents where id=$1', [agents.member])).rows[0],
      { status: 'inactive', is_inactive: null, is_deactivated: null });
    assert.equal(await call('set_agent_active', [[agents.member], true]), 1);
    // The no-target return is after role authorization but before manager-root
    // resolution. A malformed manager identity cannot change an actual target.
    await root(); await query("insert into public.user_roles values($1,'manager')", [people.ambiguous]);
    await user(people.ambiguous);
    for (const ids of [null, [], [id(990001)]]) assert.equal(await call('set_agent_active', [ids, true]), 0);
    await deny('select public.set_agent_active($1,true)', [[agents.member]]);
    await root(); await query("delete from public.user_roles where user_id=$1 and role='manager'", [people.ambiguous]);
  });
  await check('admin and service identity operations remain supported', async () => {
    await user(people.admin);
    await query('update public.agents set canonical_agent_id=$1 where id=$2', [agents.root, agents.stranger]);
    assert.equal(await call('set_agent_active', [[agents.stranger], false]), 1);
    await user(null, 'service_role');
    await query('update public.agents set canonical_agent_id=null where id=$1', [agents.stranger]);
    await query("update public.agents set status='active',is_inactive=false,is_deactivated=false where id=$1", [agents.stranger]);
    await query('insert into public.agents(id,user_id,canonical_agent_id) values($1,$2,$3)', [id(602), people.suspended, agents.other]);
  });
  await check('create and completion validate their SQL boundary independently of the client', async () => {
    await user(people.user);
    for (const title of [null, ' \t\r\n\f\v ', 'x'.repeat(201)]) await deny('select public.personal_task_create($1,$2,null,null,\'normal\')', [agents.root, title], '22023');
    await deny("select public.personal_task_create($1,'Task',$2,null,'normal')", [agents.root, 'x'.repeat(2001)], '22023');
    for (const priority of [null, 'critical']) await deny("select public.personal_task_create($1,'Task',null,null,$2)", [agents.root, priority], '22023');
    for (const date of ['infinity', '-infinity', '10000-01-01', '0001-01-01 BC']) await deny("select public.personal_task_create($1,'Task',null,$2::date,'normal')", [agents.root, date], '22023');
    await deny('select public.personal_task_set_completed($1,null,true)', [agents.root], '22023');
    await deny('select public.personal_task_set_completed($1,$2,null)', [agents.root, tasks.root], '22023');
    for (const priority of ['low','normal','high','urgent']) assert.equal((await call('personal_task_create', [agents.root, 'Task', null, null, priority])).priority, priority);
  });
  await check('identity is rechecked on every read, create and update after suspension', async () => {
    await user(people.user); assert.equal((await call('personal_task_identity')).agent_id, agents.root);
    await root(); await query('insert into public.agent_access_suspensions(user_id) values($1)', [people.user]);
    await user(people.user);
    await deny('select public.personal_task_list($1)', [agents.root]);
    await deny("select public.personal_task_create($1,'Task',null,null,'normal')", [agents.root]);
    await deny('select public.personal_task_set_completed($1,$2,true)', [agents.root, tasks.root]);
    await root(); await query('update public.agent_access_suspensions set lifted_at=now() where user_id=$1', [people.user]);
  });
  await check('list remains deterministically bounded to the newest 200 personal records', async () => {
    await root(); await query("insert into public.agent_tasks(id,agent_id,title,created_at) select ('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,$1,'Synthetic task '||n,timestamptz '2026-11-25 12:00:00Z' from generate_series(1,220) n", [agents.alias]);
    await user(people.user); const value = await call('personal_task_list', [agents.root]);
    assert.equal(value.tasks.length, 200); assert.equal(new Set(value.tasks.map(t => t.id)).size, 200);
    const expected = (await query('select id from public.agent_tasks where agent_id=any($1::uuid[]) order by created_at desc,id desc limit 200', [[agents.root, agents.alias]])).rows.map(t => t.id);
    // Existing task RLS intentionally exposes only the legacy login row. Compare
    // the canonical-family selection under the fixture owner separately.
    assert(expected.length > 0);
    await root(); const all = (await query('select id from public.agent_tasks where agent_id=any($1::uuid[]) order by created_at desc,id desc limit 200', [[agents.root, agents.alias]])).rows.map(t => t.id);
    assert.deepEqual(value.tasks.map(t => t.id), all);
  });
  console.log(`Personal task canonical checks: ${checks} groups passed. All data was synthetic and isolated.`);
} finally { await db.close(); }
