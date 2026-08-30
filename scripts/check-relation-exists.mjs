#!/usr/bin/env node
// Guards the class of bug MP-330 fixed by hand and MP-345 found again one
// directory over: a `.from("x")` naming a relation that does not exist.
//
// MP-330 (2026-08-27) found BulkStageActions inserting a stage-history row into
// public.agent_onboarding, a table dropped from this database, and throwing on
// the failure AFTER the stage change had already committed -- so a manager saw
// "Failed to update some agents" on work that succeeded. It swept `src/` and its
// commit message says "Four sites referenced the dropped table".
//
// There was a fifth: supabase/functions/notify-course-complete/index.ts:299, in a
// directory that sweep never entered. It failed the other way round -- it
// destructured nothing, and supabase-js RESOLVES with {error} rather than
// throwing, so the write failed silently while the handler returned
// {success:true} and a 200.
//
// WHY NOTHING ELSE CATCHES THIS:
//   - tsc only type-checks `src/` against types.ts. Edge functions are Deno.
//   - PostgREST resolves the relation at request time; a missing one is a
//     runtime 404/PGRST205, never a build error.
//   - Both failure shapes are invisible: one is a lie in a toast, one is silence.
//
// WHAT THIS CHECKS: every string-literal `.from("x")` in src/ and
// supabase/functions/ must name a relation in scripts/data/relation-catalog.json,
// generated from the live catalog by scripts/refresh-relation-catalog.sh.
// apex-doctor Check #30 re-queries the live catalog weekly and grades drift, so
// the snapshot cannot quietly rot into the 465 fake-success rows in a JSON file.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { stripComments, walk } from "./lib/scan-utils.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CATALOG = path.join(repoRoot, "scripts", "data", "relation-catalog.json");

// KNOWN-DEAD, deliberately not fixed. An entry that stops matching is an ERROR,
// not a pass: a baseline describing absent code has stopped measuring, and would
// hold the count flat while the repo silently regressed elsewhere. This list can
// only ever shrink.
const BASELINE = [
  {
    file: "supabase/functions/post-plaque-to-instagram/index.ts",
    relation: "plaque_ig_post_queue",
    why:
      "No migration in this repo's history ever created it, and it exists in no schema, so this " +
      "function has never once completed -- `if (qErr) throw qErr` makes it 500 at its last step. " +
      "NOT fixed by creating the table: that arms an Instagram auto-post queue for Sam's agents, " +
      "which is outbound posting on his behalf and his call alone. Nothing invokes this function " +
      "(no caller in src/, no cron job), so it is dormant and it fails loudly rather than quietly. " +
      "The leak-detection watchdog in migration 20260428003000 already gates its own read of this " +
      "table behind an information_schema existence check, so it has never been able to fire either.",
  },
];

function fail(msg) {
  console.error(`✗ check:relation-exists — ${msg}`);
  process.exit(1);
}

if (!fs.existsSync(CATALOG)) {
  fail(`missing ${path.relative(repoRoot, CATALOG)}. Run: bash scripts/refresh-relation-catalog.sh`);
}
let catalog;
try {
  catalog = JSON.parse(fs.readFileSync(CATALOG, "utf8"));
} catch (e) {
  fail(`could not parse the relation catalog: ${e.message}`);
}
const RELATIONS = new Set(catalog.relations ?? []);
// A 0-of-0 tick is the failure mode that looks most like success.
if (RELATIONS.size < 200) {
  fail(`relation catalog holds ${RELATIONS.size} entries (expected >=200); refusing to grade against it`);
}

// `.from("x")` with no .schema() call resolves to public. This guard assumes that
// and would silently mis-grade a non-public chain, so it refuses to run if any
// appears rather than guessing.
// The trailing cast is deliberate: `.from("error_logs" as any)` is the dominant
// shape in this repo (301 sites), and `as any` is precisely what stopped tsc
// objecting to the dropped tables in MP-329/MP-330. Treating a cast literal as
// "unprovable" would put the guard's blind spot exactly where the disease lives.
const FROM = /(\.\s*from)\s*\(\s*(["'`])([A-Za-z0-9_]+)\2(?:\s+as\s+[A-Za-z_$][\w$.<>|\s]*?)?\s*\)/g;
const SCHEMA_CALL = /\.\s*schema\s*\(/;

// src/ is NOT scanned here on purpose. check-supabase-relation-types.mjs (MP-329)
// already grades every src/ `.from()` against types.ts, and two guards answering
// one question from two different oracles is how they drift apart — the disease
// MP-323 and MP-288 both shipped fixes for. This guard owns the directory that
// one cannot see: supabase/functions/, which tsc never type-checks and where the
// fifth dead `agent_onboarding` writer survived MP-330's src/-only sweep.
const SCAN_ROOTS = [path.join("supabase", "functions")];
const violations = [];
const unprovable = [];
const seenBaseline = new Set();
let chains = 0;

for (const file of SCAN_ROOTS.flatMap((r) => walk(path.join(repoRoot, r)))) {
  const rel = path.relative(repoRoot, file).split(path.sep).join("/");
  const text = stripComments(fs.readFileSync(file, "utf8"));
  if (SCHEMA_CALL.test(text)) {
    fail(
      `${rel} calls .schema(); this guard resolves every .from() against the public schema and ` +
        `would mis-grade that file. Teach it qualified resolution before shipping the .schema() call.`,
    );
  }
  // Scanned over the WHOLE file, not line by line: `supabase.storage` and its
  // `.from("bucket")` are routinely on separate lines, and a same-line lookbehind
  // reported three real storage buckets as missing tables on this guard's first run.
  const lineAt = (off) => text.slice(0, off).split("\n").length;

  // A non-literal target (.from(TABLE) / .from(`x_${y}`)) cannot be resolved
  // statically. Reported as unprovable - never folded into the pass count.
  // Array.from / Uint8Array.from / storage.from are not database chains. Counting
  // them made the first run report 533 unprovable sites when the real number is
  // 3 — an inflated operand is a misleading operand even when it gates nothing.
  const NOT_A_DB_RECEIVER = /^(Array|Uint8Array|Int8Array|Float32Array|storage)$/;
  for (const m of text.matchAll(/([A-Za-z_$][\w$]*)?\s*\.\s*from\s*\(([^)]*)\)/g)) {
    const arg = m[2].trim();
    if (!arg || /^(["'`])[A-Za-z0-9_]+\1(\s+as\s+[A-Za-z_$][\w$.<>|\s]*?)?$/.test(arg)) continue;
    if (m[1] && NOT_A_DB_RECEIVER.test(m[1])) continue;
    if (/\.\s*storage\s*$/.test(text.slice(0, m.index))) continue;
    unprovable.push(`${rel}:${lineAt(m.index)}  .from(${arg.replace(/\s+/g, " ").slice(0, 40)})`);
  }

  for (const m of text.matchAll(FROM)) {
    const name = m[3];
    // supabase.storage.from("bucket") names a storage bucket, not a relation.
    if (/\.\s*storage\s*$/.test(text.slice(0, m.index))) continue;
    chains += 1;
    if (RELATIONS.has(`public.${name}`)) continue;
    const based = BASELINE.find((b) => b.file === rel && b.relation === name);
    if (based) {
      seenBaseline.add(b_key(based));
      continue;
    }
    violations.push({ site: `${rel}:${lineAt(m.index)}`, name });
  }
}

function b_key(b) {
  return `${b.file}::${b.relation}`;
}

// Anti-rot: a baseline entry that no longer matches any site has stopped
// measuring anything, so it is a failure, not a quiet pass.
const stale = BASELINE.filter((b) => !seenBaseline.has(b_key(b)));
if (stale.length) {
  console.error("✗ check:relation-exists — baseline entries that no longer match any call site:");
  for (const b of stale) console.error(`    ${b.file}  .from("${b.relation}")`);
  console.error("  The code moved. Delete the entry if the site is gone; repoint it if it moved.");
  process.exit(1);
}

if (violations.length) {
  console.error(`✗ check:relation-exists — ${violations.length} call site(s) name a relation that does not exist:`);
  for (const v of violations) {
    console.error(`    ${v.site}  .from("${v.name}")  → no public.${v.name} in the live catalog`);
  }
  console.error(
    "\n  PostgREST resolves this at runtime, so it is a 404 the caller may never see.\n" +
      "  If the relation was renamed, repoint the chain. If it was dropped, delete the dead\n" +
      "  write — and check whether anything downstream of it was being skipped.\n" +
      "  If the catalog is stale, run: bash scripts/refresh-relation-catalog.sh",
  );
  process.exit(1);
}

console.log(
  `✓ check:relation-exists — ${chains} literal .from() chains against ${RELATIONS.size} live relations, ` +
    `${BASELINE.length} known-dead, ${unprovable.length} unprovable (non-literal target), 0 new.`,
);
if (BASELINE.length) {
  console.log(`\n  ${BASELINE.length} known-dead relation write(s) carried in the baseline, not fixed:`);
  for (const b of BASELINE) {
    console.log(`    ${b.file}  .from("${b.relation}")`);
    console.log(`      ${b.why}`);
  }
}
process.exit(0);
