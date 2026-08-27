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
//   BASELINE=4, and unusually for a ratchet in this repo these four ARE real
//   bugs rather than unclassified sites. With types.ts regenerated from the live
//   catalog, "absent from types.ts" now means "absent from the database", so the
//   remaining four are writes to a relation that does not exist:
//
//     BulkStageActions.tsx:148        .insert() into agent_onboarding
//     AgentQuickEditDialog.tsx:653    .delete() from agent_onboarding
//     OnboardingTracker.tsx:104       .insert() into agent_onboarding
//     TeamHierarchyManager.tsx:420    .delete() from agent_onboarding
//
//   public.agent_onboarding exists in NO schema (only agent_onboarding_queue,
//   an unrelated email queue). BulkStageActions is the live one: it throws on
//   logError AFTER the stage UPDATE has already committed, so a manager's bulk
//   stage change reports failure having half-succeeded. The other three are
//   unchecked deletes that fail silently.
//
//   They are NOT fixed here because there is no stage-transition log table in
//   prod to repoint at, and inventing one is a product decision plus an RLS
//   surface -- and a table created in a hurry is how the agents blanket-write
//   policy happened. Measured and handed forward rather than guessed at.
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
const BASELINE = Number(process.env.RELATION_BASELINE ?? 4);

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
    const lit = arg.match(/^"([a-z_][a-z0-9_]*)"$|^'([a-z_][a-z0-9_]*)'$/);
    const line = src.slice(0, m.index).split("\n").length;
    if (!lit) {
      if (/^[`$]/.test(arg) || /^[A-Za-z_$]/.test(arg)) unprovable.push(`${rel}:${line}  .from(${arg.slice(0, 40)})`);
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
