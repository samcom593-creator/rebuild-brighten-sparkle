/** Isolated PostgreSQL checks for generated referral link origins.
 * Run with PGLITE_MODULE pointing to an external @electric-sql/pglite/dist/index.js.
 * Uses the actual legacy function bodies and new migration; all rows are synthetic.
 * Never connects to Supabase or writes a live identity/referral record.
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
const modulePath = process.env.PGLITE_MODULE;
if (!modulePath) throw new Error('Set PGLITE_MODULE to the isolated optional PostgreSQL test runtime.');
const { PGlite } = await import(pathToFileURL(modulePath).href);
const db = new PGlite();
const read = name => readFile(new URL(`../${name}`, import.meta.url), 'utf8');
const migration = await read('supabase/migrations/20261125140000_galaxy_referral_link_origin.sql');
const recruitingSource = await read('supabase/migrations/20260826023000_free_leads_qualification.sql');
const referralSource = await read('supabase/migrations/20261112000270_pkg2_referral_gate_live_production.sql');
const targets = [
  { name: 'my_recruiting_link', source: recruitingSource, old: "'https://apex-financial.org/apply?ref='", current: "'https://galaxyfinancial.org/apply?ref='" },
  { name: 'my_referral_status', source: referralSource, old: "'https://apex-financial.org/r/'", current: "'https://galaxyfinancial.org/r/'" },
];
function definition(source, name) {
  const start = source.search(new RegExp(`create (?:or replace )?function public\\.${name}\\(`, 'i'));
  assert(start >= 0, `Missing original function ${name}`);
  const rest = source.slice(start);
  const delimiter = rest.match(/\$[a-zA-Z_]*\$/)?.[0];
  assert(delimiter);
  const end = rest.indexOf(delimiter, rest.indexOf(delimiter) + delimiter.length);
  return rest.slice(0, end + delimiter.length + 1);
}
const query = (sql, args = []) => db.query(sql, args);
const scalar = async (sql, args = []) => (await query(sql, args)).rows[0]?.v;
const uid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const setUser = userId => query("select set_config('test.user_id',$1,false)", [userId ?? '']);
const call = async name => scalar(`select public.${name}() as v`);
const snapshot = async () => (await query(`select p.proname,pg_get_functiondef(p.oid) as definition,p.oid::text,
  p.proacl::text,p.proowner::text,p.prosecdef,p.provolatile,p.proconfig,p.prorettype::text,p.proargtypes::text
  from pg_proc p where p.oid in ('public.my_recruiting_link()'::regprocedure,'public.my_referral_status()'::regprocedure)
  order by p.proname`)).rows;
let checks = 0;
async function check(name, fn) { await fn(); checks++; console.log(`PASS ${name}`); }
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.user_id',true),'')::uuid $$;
    create table public.agents(id uuid primary key,user_id uuid,ref_slug text,status text default 'active',is_deactivated boolean default false,
      is_inactive boolean default false,created_at timestamptz default now(),canonical_agent_id uuid,display_name text,roster_excluded boolean default false);
    create table public.profiles(id uuid primary key,full_name text);
    create table public.system_settings(key text primary key,value text);
    create table public.mat_production_unified(agent_id uuid,annual_premium numeric);
    create table public.referrals(referrer_agent_id uuid);
    create function public.fn_agent_is_roster_excluded(uuid) returns boolean language sql stable as $$
      select coalesce((select roster_excluded from public.agents where id=$1),false) $$;
    grant usage on schema public,auth to authenticated,anon,service_role;
  `);
  for (const target of targets) {
    target.definition = definition(target.source, target.name);
    assert.equal(target.definition.split(target.old).length - 1, 1, 'Expected exact old quoted URL literal');
    assert.equal(target.definition.includes(target.current), false);
    await db.exec(target.definition);
    const statements = target.source.match(new RegExp(`(?:revoke|grant)[^;]+function public\\.${target.name}\\(\\)[^;]+;`, 'gi'));
    assert.equal(statements.length, 2, 'Load both actual original function privilege statements');
    await db.exec(statements.join('\n'));
  }
  await db.exec(`
    insert into public.agents(id,user_id,ref_slug,status,is_deactivated,is_inactive,created_at,canonical_agent_id,display_name,roster_excluded) values
      ('${uid(101)}','${uid(1)}','synthetic-root','active',false,false,'2020-01-01',null,'Synthetic root',false),
      ('${uid(102)}','${uid(1)}','newer-row','active',false,false,'2021-01-01','${uid(101)}','Newer row',false),
      ('${uid(103)}','${uid(2)}','inactive-agent','inactive',false,false,'2020-01-01',null,'Inactive agent',false),
      ('${uid(104)}','${uid(3)}','deactivated-agent','active',true,false,'2020-01-01',null,'Deactivated agent',false),
      ('${uid(105)}','${uid(4)}','flagged-inactive','active',false,true,'2020-01-01',null,'Flagged inactive',false),
      ('${uid(106)}','${uid(5)}','   ','active',false,false,'2020-01-01',null,'Blank slug',false),
      ('${uid(107)}','${uid(6)}','excluded-agent','active',false,false,'2020-01-01',null,'Excluded agent',true),
      ('${uid(108)}','${uid(7)}','historical-alias','inactive',true,true,'2020-01-01','${uid(101)}','Historical alias',false),
      ('${uid(109)}','${uid(8)}',null,'active',false,false,'2020-01-01',null,'Missing slug',false);
    insert into public.profiles values('${uid(1)}','Synthetic profile name');
    insert into public.mat_production_unified values('${uid(101)}',15000),('${uid(102)}',6000),('${uid(108)}',3000),('${uid(103)}',500);
    insert into public.referrals values('${uid(101)}'),('${uid(101)}'),('${uid(108)}');
  `);
  const cases = [
    { user: uid(1), threshold: null }, { user: uid(1), threshold: '25000' },
    ...[2,3,4,5,6,7,8,9].map(n => ({ user: uid(n), threshold: null })), { user: null, threshold: null },
  ];
  const responses = async () => {
    const results = [];
    for (const scenario of cases) {
      await setUser(scenario.user);
      await db.exec("delete from public.system_settings where key='referral_unlock_threshold'");
      if (scenario.threshold !== null) await query("insert into public.system_settings values('referral_unlock_threshold',$1)", [scenario.threshold]);
      results.push({ recruiting: await call('my_recruiting_link'), referral: await call('my_referral_status') });
    }
    return results;
  };
  const originalMetadata = await snapshot();
  const originalResponses = await responses();
  await check('source contracts retain both existing paths and referral slug concatenation', async () => {
    assert.match(targets[0].definition, /'https:\/\/apex-financial\.org\/apply\?ref='\s*\|\|\s*a\.ref_slug/);
    assert.match(targets[1].definition, /'https:\/\/apex-financial\.org\/r\/'\s*\|\|\s*\(select ref_slug from me\)/);
    assert.equal(originalResponses[0].recruiting.link, 'https://apex-financial.org/apply?ref=synthetic-root');
    assert.equal(originalResponses[0].referral.link, 'https://apex-financial.org/r/synthetic-root');
    assert.equal(originalResponses[0].referral.production_total, 24000);
    assert.equal(originalResponses[0].referral.unlocked, true);
    assert.equal(originalResponses[1].referral.unlocked, false);
    assert.equal(originalResponses[1].referral.remaining, 1000);
    for (let index = 2; index < originalResponses.length; index++) assert.equal(originalResponses[index].recruiting.active, false);
  });
  await db.exec(migration);
  const canonicalMetadata = await snapshot();
  const canonicalResponses = await responses();
  await check('only the two URL literals change; signature, owner, ACL, search path and function settings are identical', async () => {
    assert.equal(canonicalMetadata.length, 2);
    for (let index=0;index<originalMetadata.length;index++) {
      const before = originalMetadata[index];
      const target = targets.find(item => item.name === before.proname);
      assert.deepEqual(canonicalMetadata[index], { ...before, definition: before.definition.replace(target.old,target.current) });
    }
  });
  await check('all eleven caller/gate responses differ only in link origin', async () => {
    assert.deepEqual(canonicalResponses, originalResponses.map(row => ({
      recruiting: row.recruiting.link ? { ...row.recruiting, link: row.recruiting.link.replace('https://apex-financial.org/','https://galaxyfinancial.org/') } : row.recruiting,
      referral: row.referral.link ? { ...row.referral, link: row.referral.link.replace('https://apex-financial.org/','https://galaxyfinancial.org/') } : row.referral,
    })));
    const recruiting = new URL(canonicalResponses[0].recruiting.link);
    assert.equal(recruiting.origin,'https://galaxyfinancial.org');
    assert.equal(recruiting.pathname,'/apply');
    assert.equal(recruiting.searchParams.get('ref'),'synthetic-root');
    const referral = new URL(canonicalResponses[0].referral.link);
    assert.equal(referral.origin,'https://galaxyfinancial.org');
    assert.equal(referral.pathname,'/r/synthetic-root');
    assert.equal(referral.search,'');
  });
  await check('already canonical definitions are accepted without any change', async () => {
    await db.exec(migration);
    assert.deepEqual(await snapshot(),canonicalMetadata);
  });
  await check('a mixed legacy/canonical pair is repaired without disturbing the canonical function', async () => {
    await db.exec(targets[0].definition);
    await db.exec(migration);
    assert.deepEqual(await snapshot(),canonicalMetadata);
  });
  await check('unexpected, duplicate, and mixed URL literals abort both-function migration atomically', async () => {
    const target = targets[1];
    const variants = [
      target.definition.replace(target.old,"'https://unexpected.invalid/r/'"),
      target.definition.replace('  with me as (',`  -- ${target.old}\n  with me as (`),
      target.definition.replace(target.old,target.current).replace('  with me as (',`  -- ${target.current}\n  with me as (`),
      target.definition.replace('  with me as (',`  -- ${target.current}\n  with me as (`),
    ];
    for (const unexpected of variants) {
      await db.exec(targets[0].definition);
      await db.exec(unexpected);
      const before = await snapshot();
      await assert.rejects(db.exec(migration), /Unexpected URL literal/);
      await db.exec('rollback');
      assert.deepEqual(await snapshot(),before,'The earlier recruiting edit rolls back when referral validation fails');
    }
    await db.exec(target.definition);
    await db.exec(migration);
    assert.deepEqual(await snapshot(),canonicalMetadata);
  });
  await check('original authorization remains effective after repair', async () => {
    for (const target of targets) {
      assert.equal(await scalar("select has_function_privilege('anon',$1,'EXECUTE') as v",[`public.${target.name}()`]),false);
      assert.equal(await scalar("select has_function_privilege('authenticated',$1,'EXECUTE') as v",[`public.${target.name}()`]),true);
    }
    await setUser(uid(1)); await db.exec('set role authenticated');
    assert.equal((await call('my_recruiting_link')).link,'https://galaxyfinancial.org/apply?ref=synthetic-root');
    assert.equal((await call('my_referral_status')).link,'https://galaxyfinancial.org/r/synthetic-root');
    await db.exec('set role anon');
    await assert.rejects(call('my_recruiting_link'),error=>error.code==='42501');
    await assert.rejects(call('my_referral_status'),error=>error.code==='42501');
    await db.exec('reset role');
  });
  console.log(`Referral origin checks: ${checks} groups passed, 11 full before/after responses, and 4 atomic guard failures. All data was synthetic and isolated.`);
} finally { await db.close(); }
