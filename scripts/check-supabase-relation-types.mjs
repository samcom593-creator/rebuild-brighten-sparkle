#!/usr/bin/env node
// ---------------------------------------------------------------------------
// check-supabase-relation-types.mjs
//
// WHAT THIS GRADES
//   Every `.from("<relation>")` in src/ must name a relation that
//   src/integrations/supabase/types.ts actually declares (Tables or Views).
//
// WHY IT EXISTS (2026-08-27, MP-329)
//   types.ts had drifted to 161 tables / 5 views while prod held 369 / 279.
//   Code repointed at a new view (v_agents_full) compiled to
//   SelectQueryError<...>, and EVERY property read off that result became its
//   own TS2339 — one stale relation produced 52 errors in DashboardCRM alone.
//
//   tsc does catch this. But the tsc gate costs ~881s, its baseline was already
//   red, and a red gate is a gate people step over -- apex-doctor Check #19's
//   header has said so since 2026-08-11. This check answers the same question
//   in well under a second and NAMES THE RELATION, so the failure is actionable
//   at pre-commit instead of 15 minutes later in CI.
//
// WHAT THE BASELINE IS
//   BASELINE=0. With types.ts regenerated from the live catalog, "absent from
//   types.ts" means "absent from the database", so ANY hit is a query against a
//   relation prod does not have. There is no tolerated backlog left to hide a
//   new one in.
//
//   It was 4 when this check shipped (MP-329) -- all four writes to
//   public.agent_onboarding, a table dropped from the database. MP-330 removed
//   them, so the ratchet now starts clean:
//
//     BulkStageActions.tsx      .insert()  -- was the LIVE one. It threw on the
//         failed log write AFTER the stage UPDATE had already committed, so a
//         manager's bulk stage change reported "Failed to update some agents"
//         having succeeded, skipped the "evaluated" portal-login and
//         live-field notifications, and left the grid unrefreshed.
//     OnboardingTracker.tsx     .insert()  -- unchecked, so no visible effect.
//     TeamHierarchyManager.tsx  .delete()  -- cascade against a table with no
//     AgentQuickEditDialog.tsx  .delete()     rows to orphan. Dead, not broken.
//
//   Removing them lost no logging: none had happened since the table was
//   dropped. Where a stage log SHOULD live stays an open product question.
//   Both plausible destinations were MEASURED and both were refused:
//   `next_step_events` has a different stage vocabulary (note in_field_training
//   vs infield_training) and feeds a live engine that messages candidates, so a
//   careless repoint would fire real outbound; `audit_log` is not client-
//   writable at all -- every leaf partition has RLS enabled with zero policies,
//   so anon AND authenticated inserts are denied despite the parent's
//   permissive `with_check true`. Repointing there would have swapped one
//   always-failing write for another.
//
// WHAT THE BASELINE IS NOT
//   It is not a general work queue and must not be resized by grep. Re-measure
//   each site against the live catalog first. Sizing a wave off a raw count is
//   the operand error that turned a NULL-timestamp count into a $2,336,292.84
//   leak nobody was owed.
//
// UNPROVABLE IS ITS OWN OUTCOME
//   `.from(someVar)` and `.from(`tpl${x}`)` cannot be resolved statically. They
//   are reported as `unprovable` and are NEVER laundered into pass or fail.
// ---------------------------------------------------------------------------
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const repoRoot = process.cwd();
const TYPES = "src/integrations/supabase/types.ts";
const BASELINE = Number(process.env.RELATION_BASELINE ?? 0);

// Non-supabase `.from(` receivers that must never be graded.
const NOT_SUPABASE = new Set([
  "Array", "Object", "String", "Number", "Buffer", "Set", "Map", "Date", "BigInt",
  // supabase.storage.from("bucket") is a STORAGE BUCKET, not a relation. Grading
  // it would report every avatar upload as a missing table -- a false positive
  // that would have made this guard permanently red on correct code.
  "storage",
]);

// Strip comments WITHOUT blanking string bodies. A previous wave's stripper
// blanked strings too, which would have turned every call site into
// "table name is a variable" and silently proved nothing.
function stripComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i], d = src[i + 1];
    if (c === "/" && d === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && d === "*") { i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
    if (c === '"' || c === "'" || c === "`") {
      const q = c; out += c; i++;
      while (i < n) {
        if (src[i] === "\\") { out += src[i] + (src[i + 1] ?? ""); i += 2; continue; }
        out += src[i];
        if (src[i] === q) { i++; break; }
        i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

function relationsFromTypes() {
  const s = readFileSync(join(repoRoot, TYPES), "utf8");
  const grab = (startKey, endKey) => {
    const i = s.indexOf(startKey);
    if (i < 0) return [];
    const j = s.indexOf(endKey, i);
    const seg = s.slice(i, j < 0 ? undefined : j);
    return [...seg.matchAll(/^ {6}([a-z_][a-z0-9_]*): \{/gm)].map((m) => m[1]);
  };
  const tables = grab("    Tables: {", "    Views: {");
  const views = grab("    Views: {", "    Functions: {");
  return { tables: new Set(tables), views: new Set(views) };
}

function walk(dir, acc = []) {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, acc);
    else if (/\.tsx?$/.test(e)) acc.push(p);
  }
  return acc;
}

const { tables, views } = relationsFromTypes();
const known = new Set([...tables, ...views]);

const missing = [];
const unprovable = [];
let checked = 0;

for (const file of walk(join(repoRoot, "src"))) {
  const rel = relative(repoRoot, file);
  if (rel === TYPES) continue;
  const src = stripComments(readFileSync(file, "utf8"));
  const re = /(?:([A-Za-z_$][\w$]*)\s*)?\.from\(\s*([^)]*?)\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    const receiver = m[1] ?? "";
    if (NOT_SUPABASE.has(receiver)) continue;
    const arg = m[2];
    // MP-345: the trailing cast is REQUIRED here. `.from("error_logs" as any)` is
    // the dominant shape in this repo — 288 sites across 93 files — and the old
    // anchored literal did not match it, while the unprovable branch below only
    // caught args starting with a backtick or identifier. A cast literal matched
    // NEITHER, so it was dropped silently: not graded, not counted, not reported.
    // `as any` is exactly the cast MP-329 recorded as "why nothing objected".
    const lit = arg.match(/^"([a-z_][a-z0-9_]*)"(?:\s+as\s+[\w$.<>|\s]+)?$|^'([a-z_][a-z0-9_]*)'(?:\s+as\s+[\w$.<>|\s]+)?$/);
    const line = src.slice(0, m.index).split("\n").length;
    if (!lit) {
      // Anything that is not a resolvable literal is UNPROVABLE. It used to fall
      // through this branch and vanish when it matched neither test.
      unprovable.push(`${rel}:${line}  .from(${arg.replace(/\s+/g, " ").slice(0, 40)})`);
      continue;
    }
    const name = lit[1] ?? lit[2];
    checked++;
    if (!known.has(name)) missing.push(`${rel}:${line}  .from("${name}") — not in types.ts`);
  }
}

console.log(`supabase relation types: ${tables.size} tables + ${views.size} views declared`);
console.log(`  literal .from() sites resolved : ${checked}`);
console.log(`  unprovable (variable/template) : ${unprovable.length}  (never pass, never fail)`);
console.log(`  relations absent from types.ts : ${missing.length}  (baseline ${BASELINE})`);
if (missing.length) {
  console.log("");
  for (const s of missing.slice(0, 40)) console.log(`    ${s}`);
  if (missing.length > 40) console.log(`    ... and ${missing.length - 40} more`);
}
if (missing.length > BASELINE) {
  console.error(`\nFAIL: ${missing.length} > baseline ${BASELINE}.`);
  console.error("Regenerate src/integrations/supabase/types.ts from the live database.");
  process.exit(1);
}
if (missing.length < BASELINE) {
  console.log(`\nRatchet: ${missing.length} < baseline ${BASELINE} — lower RELATION_BASELINE to ${missing.length}.`);
}
console.log("\nOK");
