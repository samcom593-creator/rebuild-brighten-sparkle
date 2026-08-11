#!/usr/bin/env node
/**
 * check:migration-versions — no two migration files may share a version.
 *
 * On 2026-08-11 the "Deploy Supabase" job failed with
 *
 *   ERROR: duplicate key value violates unique constraint "schema_migrations_pkey"
 *
 * Cause: two workers, working the same repo within the same hour, both minted
 * `20260811070000`:
 *
 *   20260811070000_client_error_visibility.sql
 *   20260811070000_deal_celebration_stop_broadcasting_client_names.sql
 *
 * supabase_migrations.schema_migrations is keyed on version alone, so it can
 * only ever record one of them. It recorded the second file's name against the
 * first file's slot, and every subsequent `supabase db push` tried to apply the
 * one it had no record of and collided on the primary key. The deploy pipeline
 * went red on a commit that had nothing to do with either migration.
 *
 * This is a multi-worker repo — several agents commit here concurrently — so
 * timestamp collisions are a recurring hazard, not a one-off. Two seconds at
 * commit time is cheaper than a red deploy nobody can attribute.
 *
 * NOTE this is a different failure from a migration that is merely unapplied.
 * It is specifically two FILES claiming one slot, which no amount of re-running
 * db push can resolve — one of them must be renamed.
 */
import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const dir = path.join(repoRoot, "supabase/migrations");

if (!fs.existsSync(dir)) {
  console.log("✓ check:migration-versions — no supabase/migrations directory.");
  process.exit(0);
}

const byVersion = new Map();
for (const name of fs.readdirSync(dir)) {
  if (!name.endsWith(".sql")) continue;
  const m = name.match(/^(\d{14})/);
  if (!m) {
    // Not fatal on its own, but the CLI orders by this prefix; a file without
    // one will not sort or record predictably.
    console.error(
      `✗ check:migration-versions — ${name} has no 14-digit version prefix. The Supabase CLI orders and records migrations by that prefix.`,
    );
    process.exit(1);
  }
  const list = byVersion.get(m[1]) ?? [];
  list.push(name);
  byVersion.set(m[1], list);
}

const collisions = [...byVersion.entries()].filter(([, files]) => files.length > 1);

if (collisions.length) {
  console.error(
    `\n✗ check:migration-versions — ${collisions.length} version(s) claimed by more than one file.\n`,
  );
  console.error(
    "schema_migrations is keyed on version alone, so only one of each set can ever",
  );
  console.error(
    "be recorded. `supabase db push` will then retry the other forever and fail with",
  );
  console.error(
    'duplicate key value violates unique constraint "schema_migrations_pkey".\n',
  );
  for (const [version, files] of collisions) {
    console.error(`  ${version}`);
    for (const f of files) console.error(`    ${f}`);
  }
  console.error(
    "\nRename all but one to a free timestamp. If the renamed migration is already");
  console.error(
    "applied, make sure its SQL is idempotent (create or replace / if not exists)");
  console.error("so the pipeline can re-run it harmlessly under the new version.\n");
  process.exit(1);
}

console.log(
  `✓ check:migration-versions — ${byVersion.size} migrations, 0 version collisions.`,
);
