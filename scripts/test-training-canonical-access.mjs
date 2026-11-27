/** Isolated PostgreSQL fixture. Synthetic records only; no network or Supabase.
 * The migration, identity helpers, legacy policies and attempt cap are loaded
 * from repository SQL, so the fixture checks the actual authorization contract.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const modulePath = process.env.PGLITE_MODULE;
if (!modulePath) throw new Error('Set PGLITE_MODULE to the isolated optional PostgreSQL test runtime.');
const { PGlite } = await import(pathToFileURL(modulePath).href);
const db = new PGlite();
const read = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');
const [migration, identitySource, taskSource, helperSource, courseSource, managerSource, capSource, agentPolicies] = await Promise.all([
  'supabase/migrations/20261127044000_training_canonical_access.sql',
  'supabase/migrations/20260317032216_59c5ecff-1866-44f2-82b5-341082e6c03f.sql',
  'supabase/migrations/20261125120000_personal_task_canonical_self.sql',
  'supabase/migrations/20261112000200_pkg2_hire_lane_foundation.sql',
  'supabase/migrations/20260127004301_9b0cb092-0cc3-46b2-986b-862de037e93b.sql',
  'supabase/migrations/20260304033511_8d1abd2c-f443-4f21-8f2b-b2390b036711.sql',
  'supabase/migrations/20260824140000_quiz_retake_cap.sql',
  'scripts/fixtures/personal-task-agents-policies.sql',
].map(read));
function definition(source, name) {
  const start = source.search(new RegExp(`create (?:or replace )?function public\\.${name}\\(`, 'i'));
  assert(start >= 0, `Missing source definition ${name}`);
  const rest = source.slice(start), delimiter = rest.match(/\$[a-zA-Z_]*\$/)?.[0];
  assert(delimiter);
  const end = rest.indexOf(delimiter, rest.indexOf(delimiter) + delimiter.length);
  return rest.slice(0, end + delimiter.length + 1);
}
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const people = { merged: id(1), root: id(2), ordinary: id(3), manager: id(4), admin: id(5), ambiguous: id(6), chained: id(7), dangling: id(8), missing: id(9) };
const agents = { root: id(101), alias: id(102), ordinary: id(103), manager: id(104), member: id(105), stranger: id(106), ambiguousA: id(107), ambiguousB: id(108), chain: id(109), middle: id(110), dangling: id(111) };
const modules = { first: id(201), second: id(202), inactive: id(203) };
const query = async (sql, args = []) => db.query(sql, args);
const scalar = async (sql, args = []) => (await query(sql, args)).rows[0]?.v;
const root = () => db.exec('reset role');
async function user(userId, role = 'authenticated') {
  await root(); await query("select set_config('test.user_id', $1, false)", [userId ?? '']);
  await db.exec(`set role ${role}`);
}
const access = () => scalar('select public.training_progress_access() as v');
let checks = 0;
async function check(name, fn) { await fn(); checks++; console.log(`PASS ${name}`); }
async function deny(sql, args = [], code = '42501') {
  await assert.rejects(() => query(sql, args), error => { assert.equal(error.code, code, error.message); return true; });
}
const readProgress = agent => query('select * from public.onboarding_progress where agent_id=$1', [agent]);
async function legacyMetadata() {
  await root();
  return {
    currentAgent: await scalar("select pg_get_functiondef('public.current_agent_id()'::regprocedure) as v"),
    personalIdentity: await scalar("select pg_get_functiondef('public.personal_task_identity()'::regprocedure) as v"),
    policies: (await query("select policyname, roles, cmd, qual, with_check from pg_policies where schemaname='public' and tablename='onboarding_progress' and policyname not like '%canonical training progress' order by policyname")).rows,
    attemptCap: await scalar("select pg_get_functiondef('public.fn_enforce_quiz_attempt_cap()'::regprocedure) as v"),
  };
}
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls; create role supabase_admin bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user_id',true),'')::uuid $$;
    create table auth.users(id uuid primary key, banned_until timestamptz, deleted_at timestamptz);
    create type public.app_role as enum ('admin','manager','agent');
    create type public.agent_status as enum ('active','pending','inactive','terminated');
    create table public.user_roles(user_id uuid, role public.app_role);
    create function public.has_role(_user_id uuid, _role public.app_role) returns boolean
      language sql stable security definer set search_path to 'public' as $$ select exists(select 1 from user_roles where user_id=_user_id and role=_role) $$;
    create table public.agents(id uuid primary key, user_id uuid, canonical_agent_id uuid,
      status public.agent_status default 'active', is_inactive boolean default false, is_deactivated boolean default false,
      invited_by_manager_id uuid, manager_id uuid, created_at timestamptz default now());
    create table public.agent_access_suspensions(id uuid default gen_random_uuid(), user_id uuid, lifted_at timestamptz);
    grant usage on schema public, auth to authenticated, anon, service_role;
    grant select, insert, update, delete on public.agents to authenticated;
    grant select on public.user_roles to authenticated;
  `);
  for (const name of ['current_agent_id', 'current_manager_agent_id']) await db.exec(definition(identitySource, name));
  await db.exec(agentPolicies);
  for (const name of ['fn_user_is_suspended', 'fn_agent_is_suspended', 'fn_user_login_blocked']) {
    await db.exec(definition(helperSource, name));
    await db.exec(`revoke all on function public.${name}(uuid) from public, anon, authenticated; grant execute on function public.${name}(uuid) to service_role;`);
  }
  await db.exec(definition(taskSource, 'personal_task_identity'));
  await db.exec('revoke all on function public.personal_task_identity() from public, anon; grant execute on function public.personal_task_identity() to authenticated;');
  await db.exec(definition(taskSource, 'fn_guard_agent_task_identity_inputs'));
  await db.exec(`create trigger a_guard_agent_task_identity_inputs before insert or update of id,user_id,canonical_agent_id,status,is_inactive,is_deactivated on public.agents for each row execute function public.fn_guard_agent_task_identity_inputs();`);
  await db.exec(courseSource);
  await db.exec(managerSource);
  await db.exec('grant select, insert, update, delete on public.onboarding_progress to authenticated; grant select on public.onboarding_modules to authenticated;');
  for (const name of ['course_max_attempts', 'fn_enforce_quiz_attempt_cap']) await db.exec(definition(capSource, name));
  await db.exec('create trigger trg_onboarding_attempt_cap before insert or update on public.onboarding_progress for each row execute function public.fn_enforce_quiz_attempt_cap();');
  for (const [key, value] of Object.entries(people)) if (key !== 'missing') await query('insert into auth.users(id) values($1)', [value]);
  await query("insert into public.user_roles values($1,'manager'),($2,'admin')", [people.manager, people.admin]);
  for (const [key, value] of Object.entries(agents)) {
    const login = key === 'root' ? people.root : key === 'alias' ? people.merged : key === 'ordinary' ? people.ordinary : key === 'manager' ? people.manager
      : key.startsWith('ambiguous') ? people.ambiguous : key === 'chain' ? people.chained : key === 'dangling' ? people.dangling : null;
    const canonical = key === 'alias' || key === 'middle' ? agents.root : key === 'chain' ? agents.middle : key === 'dangling' ? id(999) : null;
    await query('insert into public.agents(id,user_id,canonical_agent_id,invited_by_manager_id) values($1,$2,$3,$4)', [value, login, canonical, key === 'member' ? agents.manager : null]);
  }
  await query("update public.agents set status='inactive',is_inactive=true,is_deactivated=true where id=$1", [agents.alias]);
  for (const [key, value] of Object.entries(modules)) await query('insert into public.onboarding_modules(id,order_index,title,video_url,is_active) values($1,$2,$3,$4,$5)', [value, key === 'first' ? 1 : 2, `Synthetic ${key}`, 'https://example.test/lesson', key !== 'inactive']);
  for (const agent of [agents.root, agents.ordinary, agents.member, agents.stranger]) await query('insert into public.onboarding_progress(agent_id,module_id,attempts,passed) values($1,$2,1,false)', [agent, modules.first]);

  await check('negative control: legacy policy hides the canonical course from a merged login', async () => {
    await user(people.merged);
    assert.equal(await scalar('select public.current_agent_id() as v'), agents.alias);
    assert.equal((await readProgress(agents.root)).rows.length, 0);
    await deny('insert into public.onboarding_progress(agent_id,module_id) values($1,$2)', [agents.root, modules.second]);
  });
  const before = await legacyMetadata();
  await db.exec(migration);
  await check('global identity, legacy staff/self policies and attempt cap are unchanged', async () => { assert.deepEqual(await legacyMetadata(), before); });
  await check('new RPCs have no public or anonymous execute privilege', async () => {
    await root();
    for (const name of ['training_canonical_self_id()', 'training_progress_access()']) {
      assert.equal(await scalar("select has_function_privilege('authenticated',$1,'execute') as v", [`public.${name}`]), true);
      assert.equal(await scalar("select has_function_privilege('anon',$1,'execute') as v", [`public.${name}`]), false);
      assert.equal(await scalar("select exists(select 1 from pg_proc p, lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where p.oid=$1::regprocedure and a.grantee=0 and a.privilege_type='EXECUTE') as v", [`public.${name}`]), false);
    }
    await user(null, 'anon'); await deny('select public.training_progress_access()');
  });
  await check('merged login reads and saves its canonical progress without reactivating its alias', async () => {
    await user(people.merged);
    assert.equal((await access()).agent_id, agents.root); assert.equal((await access()).alias_progress_count, 0);
    assert.equal((await readProgress(agents.root)).rows.length, 1);
    await query('insert into public.onboarding_progress(agent_id,module_id,attempts) values($1,$2,1)', [agents.root, modules.second]);
    await query('update public.onboarding_progress set score=75 where agent_id=$1 and module_id=$2', [agents.root, modules.second]);
    assert.equal(await scalar('select score as v from public.onboarding_progress where agent_id=$1 and module_id=$2', [agents.root, modules.second]), 75);
    assert.equal(await scalar('select is_deactivated as v from public.agents where id=$1', [agents.alias]), true);
  });
  await check('canonical self policy cannot read, insert or relabel progress into another person', async () => {
    await user(people.merged);
    assert.equal((await readProgress(agents.ordinary)).rows.length, 0);
    await deny('insert into public.onboarding_progress(agent_id,module_id) values($1,$2)', [agents.ordinary, modules.second]);
    await deny('update public.onboarding_progress set agent_id=$1 where agent_id=$2 and module_id=$3', [agents.ordinary, agents.root, modules.second]);
    assert.equal((await query('update public.onboarding_progress set score=99 where agent_id=$1 returning id', [agents.ordinary])).rows.length, 0);
  });
  await check('attempt cap still rejects a fifth attempt on canonical progress', async () => {
    await user(people.merged);
    await query('update public.onboarding_progress set attempts=4 where agent_id=$1 and module_id=$2', [agents.root, modules.second]);
    await deny('update public.onboarding_progress set attempts=5 where agent_id=$1 and module_id=$2', [agents.root, modules.second], 'P0001');
  });
  await check('history preflight reports only active-module alias evidence and moves no rows', async () => {
    await root();
    await query('insert into public.onboarding_progress(agent_id,module_id,attempts,passed,score) values($1,$2,2,true,80),($1,$3,1,false,30)', [agents.alias, modules.first, modules.inactive]);
    const saved = (await query('select * from public.onboarding_progress order by id')).rows;
    await user(people.merged);
    const history = await access();
    assert.equal(history.alias_progress_count, 1); assert.equal(history.user_id, people.merged); assert.equal(history.agent_id, agents.root);
    await root(); assert.deepEqual((await query('select * from public.onboarding_progress order by id')).rows, saved);
  });
  await check('ordinary and foreign logins cannot discover another family alias history', async () => {
    await user(people.ordinary);
    const ordinary = await access();
    assert.equal(ordinary.agent_id, agents.ordinary); assert.equal(ordinary.alias_progress_count, 0); assert.deepEqual(ordinary.agent_ids, [agents.ordinary]);
    assert.equal((await readProgress(agents.alias)).rows.length, 0);
    assert.equal((await readProgress(agents.root)).rows.length, 0);
    await query('update public.onboarding_progress set score=70 where agent_id=$1', [agents.ordinary]);
  });
  await check('existing manager team access remains scoped to the established direct team', async () => {
    await user(people.manager);
    assert.equal((await readProgress(agents.member)).rows.length, 1);
    await query('update public.onboarding_progress set score=88 where agent_id=$1', [agents.member]);
    await query('insert into public.onboarding_progress(agent_id,module_id) values($1,$2)', [agents.member, modules.second]);
    assert.equal((await readProgress(agents.stranger)).rows.length, 0);
    await deny('insert into public.onboarding_progress(agent_id,module_id) values($1,$2)', [agents.stranger, modules.second]);
    assert.equal((await access()).alias_progress_count, 0);
  });
  await check('admin without an agent retains existing staff access while personal helper returns null', async () => {
    await user(people.admin);
    assert.equal(await scalar('select public.training_canonical_self_id() as v'), null);
    assert.equal((await readProgress(agents.stranger)).rows.length, 1);
    await query('update public.onboarding_progress set score=91 where agent_id=$1', [agents.stranger]);
    await deny('select public.training_progress_access()');
  });
  await check('ambiguous, chained, dangling and missing login identities grant no canonical self access', async () => {
    for (const login of [people.ambiguous, people.chained, people.dangling, people.missing, null]) {
      await user(login); await deny('select public.training_progress_access()');
      assert.equal(await scalar('select public.training_canonical_self_id() as v'), null);
      assert.equal((await readProgress(agents.root)).rows.length, 0);
    }
  });
  await check('suspension on either family login denies canonical access without suppressing legacy policies', async () => {
    for (const login of [people.merged, people.root]) {
      await root(); await query('insert into public.agent_access_suspensions(user_id) values($1)', [login]);
      await user(people.merged); await deny('select public.training_progress_access()');
      assert.equal(await scalar('select public.training_canonical_self_id() as v'), null);
      assert.equal((await readProgress(agents.root)).rows.length, 0);
      await root(); await query('delete from public.agent_access_suspensions where user_id=$1', [login]);
    }
  });
  await check('banned/deleted caller and inactive/deactivated/terminated root fail personal eligibility', async () => {
    for (const column of ['banned_until', 'deleted_at']) {
      await root(); await query(`update auth.users set ${column}=now()+interval '1 day' where id=$1`, [people.merged]);
      await user(people.merged); await deny('select public.training_progress_access()');
      assert.equal(await scalar('select public.training_canonical_self_id() as v'), null);
      await root(); await query(`update auth.users set ${column}=null where id=$1`, [people.merged]);
    }
    for (const patch of ["status='inactive'", "status='terminated'", 'is_inactive=true', 'is_deactivated=true']) {
      await root(); await query(`update public.agents set ${patch} where id=$1`, [agents.root]);
      await user(people.merged); await deny('select public.training_progress_access()');
      assert.equal((await readProgress(agents.root)).rows.length, 0);
      await root(); await query("update public.agents set status='active',is_inactive=false,is_deactivated=false where id=$1", [agents.root]);
    }
  });
  await check('caller cannot forge canonical links used by training access', async () => {
    await user(people.merged);
    await deny('update public.agents set canonical_agent_id=$1 where id=$2', [agents.ordinary, agents.alias]);
    assert.equal((await access()).agent_id, agents.root);
  });
  await check('unexpected identity-source failure propagates instead of becoming empty history', async () => {
    await root();
    await db.exec(`create or replace function public.personal_task_identity() returns jsonb language plpgsql stable security definer set search_path to 'public' as $$ begin raise exception 'Synthetic source failure' using errcode='XX000'; end; $$;`);
    await user(people.merged); await deny('select public.training_canonical_self_id()', [], 'XX000');
    await deny('select public.training_progress_access()', [], 'XX000');
  });
  console.log(`Training canonical access: ${checks} isolated PostgreSQL checks passed.`);
} finally { await db.close(); }
