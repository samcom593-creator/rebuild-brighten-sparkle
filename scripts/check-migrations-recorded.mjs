#!/usr/bin/env node
/**
 * check-migrations-recorded (pre-push) — refuse to push migrations while an EARLIER migration on the
 * branch is applied live but missing from supabase_migrations.schema_migrations.
 *
 * Why: CI's Deploy Supabase runs `supabase db push --include-all`, which applies every migration file
 * not recorded in schema_migrations, in version order, before failing on the first error. On
 * 2026-11-11 a migration hand-applied by one session and never recorded sat on main; the next push
 * that touched supabase/migrations (from a different session) made CI re-apply it over the live
 * state. It silently reverted a security lockdown and reopened 12 private-surface holes, and only
 * the NEXT file's "policy already exists" error stopped the run. The pusher had done nothing wrong.
 *
 * Rule: if the commits being pushed touch supabase/migrations, every migration version already on
 * origin/main must be recorded live. Versions added by this push are exempt (CI is meant to apply
 * those). Pushes that don't touch migrations skip the network entirely.
 *
 * Fails CLOSED when it cannot ask the database (the damage case is silent and severe). Override for a
 * deliberate push: ALLOW_UNVERIFIED_MIGRATION_PUSH=1 git push ...
 * Test hook: MIGRATIONS_RECORDED_FIXTURE=<json array of recorded versions> skips the network.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
const versionsOf = (names) =>
  new Set(names.split("\n").map((p) => (p.match(/supabase\/migrations\/(\d{14})_[^/]*\.sql$/) || [])[1]).filter(Boolean));

let base;
try {
  base = git("merge-base", "HEAD", "origin/main");
} catch {
  console.log("[pre-push] migrations-recorded: no origin/main merge-base; skipped");
  process.exit(0);
}
const pushed = versionsOf(git("diff", "--name-only", "--diff-filter=AMR", `${base}..HEAD`, "--", "supabase/migrations"));
if (pushed.size === 0) process.exit(0); // nothing migration-shaped in this push: no network, no delay

const onBranch = versionsOf(git("ls-tree", "-r", "--name-only", base, "--", "supabase/migrations"));

async function recordedVersions() {
  if (process.env.MIGRATIONS_RECORDED_FIXTURE) return new Set(JSON.parse(process.env.MIGRATIONS_RECORDED_FIXTURE));
  const dir = join(homedir(), ".config", "apex-creds");
  const url = readFileSync(join(dir, "bot-sql.url"), "utf8").trim();
  const tok = readFileSync(join(dir, "bot-sql.token"), "utf8").trim();
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: "select coalesce(json_agg(version), '[]'::json) as v from supabase_migrations.schema_migrations" }),
    signal: AbortSignal.timeout(20000),
  });
  const body = await res.json();
  const v = body?.rows?.[0]?.v;
  if (!body?.ok || !Array.isArray(v)) throw new Error(`bot-sql answered without a version list (${JSON.stringify(body).slice(0, 160)})`);
  return new Set(v.map(String));
}

let recorded;
try {
  recorded = await recordedVersions();
} catch (e) {
  if (process.env.ALLOW_UNVERIFIED_MIGRATION_PUSH === "1") {
    console.log(`[pre-push] migrations-recorded: could not check (${e.message}); override set, pushing anyway`);
    process.exit(0);
  }
  console.error(`[pre-push] BLOCKED: this push carries migrations and I could not confirm the earlier ones are recorded live (${e.message}).`);
  console.error("[pre-push] Retry, or push deliberately with ALLOW_UNVERIFIED_MIGRATION_PUSH=1 if you know every earlier migration is recorded.");
  process.exit(1);
}

const unrecorded = [...onBranch].filter((v) => !recorded.has(v) && !pushed.has(v)).sort();
if (unrecorded.length) {
  console.error(`[pre-push] BLOCKED: ${unrecorded.length} migration(s) already on main are NOT recorded in schema_migrations:`);
  const files = git("ls-tree", "-r", "--name-only", base, "--", "supabase/migrations").split("\n");
  for (const v of unrecorded.slice(0, 15)) console.error(`  ${files.find((p) => p.includes(`/${v}_`)) || v}`);
  console.error("[pre-push] CI's db push would re-apply them over live state before applying yours (2026-11-11 this reopened 12 security holes).");
  console.error("[pre-push] The owner of each file should confirm it is live and record it (insert into supabase_migrations.schema_migrations (version, name) ...),");
  console.error("[pre-push] or make it idempotent. Then push again.");
  process.exit(1);
}
console.log(`[pre-push] migrations-recorded: ${onBranch.size} earlier migrations all recorded; ${pushed.size} in this push left for CI`);
