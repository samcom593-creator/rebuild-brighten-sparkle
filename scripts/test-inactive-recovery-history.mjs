/** Isolated PostgreSQL regression checks with synthetic rows; no network or production data.
 * PGLITE_MODULE=/path/to/@electric-sql/pglite/dist/index.js node scripts/test-inactive-recovery-history.mjs
 */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

if (!process.env.PGLITE_MODULE) throw new Error('Set PGLITE_MODULE to the existing isolated PostgreSQL test runtime.');
const { PGlite } = await import(pathToFileURL(process.env.PGLITE_MODULE).href);
const db = new PGlite();
const read = name => readFile(new URL(`../supabase/migrations/${name}`, import.meta.url), 'utf8');
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const query = (sql, args = []) => db.query(sql, args);
const rows = () => query('select * from public.inactive_agent_queue order by id');
const policies = () => query("select policyname,roles,cmd,qual,with_check from pg_policies where tablename='inactive_agent_queue' order by policyname");
const denyDuplicate = action => assert.rejects(action, error => { assert.equal(error.code, '23505', error.message); return true; });
let checks = 0;
const check = async (name, run) => { await run(); checks++; console.log(`PASS ${name}`); };

try {
  await db.exec(`
    create role authenticated;
    create schema auth;
    create table auth.users(id uuid primary key);
    create table public.agents(id uuid primary key);
    create type public.app_role as enum ('admin','manager','agent');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid',true),'')::uuid $$;
    create function public.has_role(p_user_id uuid,p_role public.app_role) returns boolean language sql stable as $$ select current_setting('test.role',true)=p_role::text $$;
  `);
  const source = await read('20260419193604_d39e83dc-f430-419a-8994-1e4a33e52fa6.sql');
  const start = source.indexOf('CREATE TABLE IF NOT EXISTS public.inactive_agent_queue (');
  const end = source.indexOf('-- 7. BACKFILL', start);
  assert(start >= 0 && end > start, 'Load the actual original recovery table, indexes and RLS policies.');
  await db.exec(source.slice(start, end));
  await db.exec('grant usage on schema public,auth to authenticated; grant select,insert,update,delete on public.inactive_agent_queue to authenticated;');
  await query('insert into public.agents(id) values($1),($2)', [id(1), id(2)]);
  await query('insert into auth.users(id) values($1)', [id(9)]);
  await query(`insert into public.inactive_agent_queue(id,agent_id,status,reason,recovery_notes,resolved_at,resolved_by)
    values($1,$3,'reactivated','no_recorded_activity','First recovery reviewed',now(),$4),
          ($2,$3,'open','no_recorded_activity','Second recovery in progress',null,null)`, [id(10), id(11), id(1), id(9)]);

  await check('negative control: legacy uniqueness blocks the second recovery', async () => {
    await denyDuplicate(() => query("update public.inactive_agent_queue set status='reactivated' where id=$1", [id(11)]));
  });
  const beforeRows = (await rows()).rows;
  const beforePolicies = (await policies()).rows;
  const beforePrivileges = (await query("select grantee,privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='inactive_agent_queue' order by grantee,privilege_type")).rows;
  const migration = await read('20261127045000_inactive_recovery_history.sql');
  assert(!/\b(?:delete\s+from|truncate|update\s+public\.|insert\s+into)/i.test(migration), 'The migration changes uniqueness without editing recovery rows.');
  await db.exec(migration);
  await db.exec(migration);
  await check('migration is idempotent and preserves rows, RLS and privileges', async () => {
    assert.deepEqual((await rows()).rows, beforeRows);
    assert.deepEqual((await policies()).rows, beforePolicies);
    assert.deepEqual((await query("select grantee,privilege_type from information_schema.role_table_grants where table_schema='public' and table_name='inactive_agent_queue' order by grantee,privilege_type")).rows, beforePrivileges);
  });
  await check('the existing manager workflow completes repeated recovery cycles without erasing history', async () => {
    await query("select set_config('test.uid',$1,false),set_config('test.role','manager',false)", [id(9)]);
    await db.exec('set role authenticated');
    await query("update public.inactive_agent_queue set status='reactivated',resolved_at=now(),resolved_by=$1,resolution='Manager confirmed resumed activity' where id=$2 and status='open'", [id(9), id(11)]);
    await query("insert into public.inactive_agent_queue(id,agent_id,status,reason,recovery_notes) values($1,$2,'open','no_recorded_activity','Third recovery in progress')", [id(12), id(1)]);
    await query("update public.inactive_agent_queue set status='reactivated',resolved_at=now(),resolved_by=$1 where id=$2 and status='open'", [id(9), id(12)]);
    assert.equal((await query("select count(*)::int as n from public.inactive_agent_queue where agent_id=$1 and status='reactivated'", [id(1)])).rows[0].n, 3);
    assert.equal((await query('select recovery_notes from public.inactive_agent_queue where id=$1', [id(10)])).rows[0].recovery_notes, 'First recovery reviewed');
    await db.exec('reset role');
  });
  await check('duplicate open inserts and reopening into an existing open case remain blocked', async () => {
    await query("insert into public.inactive_agent_queue(id,agent_id,status,reason) values($1,$2,'open','no_recorded_activity')", [id(13), id(1)]);
    await denyDuplicate(() => query("insert into public.inactive_agent_queue(agent_id,status,reason) values($1,'open','no_recorded_activity')", [id(1)]));
    await denyDuplicate(() => query("update public.inactive_agent_queue set status='open' where id=$1", [id(10)]));
    await query("insert into public.inactive_agent_queue(agent_id,status,reason) values($1,'open','no_recorded_activity')", [id(2)]);
    assert.equal((await query("select count(*)::int as n from public.inactive_agent_queue where status='open'")).rows[0].n, 2);
  });
  await check('ordinary agents still cannot read or mutate recovery cases', async () => {
    await query("select set_config('test.role','agent',false)");
    await db.exec('set role authenticated');
    assert.equal((await rows()).rows.length, 0);
    assert.equal((await query("update public.inactive_agent_queue set status='reactivated' returning id")).rows.length, 0);
    await db.exec('reset role');
  });
  console.log(`Recovery history: ${checks} isolated PostgreSQL checks passed.`);
} finally { await db.close(); }
