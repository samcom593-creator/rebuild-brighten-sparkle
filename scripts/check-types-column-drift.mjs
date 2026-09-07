#!/usr/bin/env node
// ---------------------------------------------------------------------------
// check-types-column-drift.mjs
//
// WHAT THIS GRADES
//   Every column src/integrations/supabase/types.ts declares on a relation must
//   be a column that relation actually has in prod.
//
// WHY IT EXISTS (2026-09-07, MP-463)
//   check-supabase-relation-types.mjs (MP-329) grades relation NAMES. A relation
//   can be present and correct while a column inside it is fiction, and nothing
//   in this repo could see that.
//
//   MP-430f dropped next_action_text from v_onboarding_sequence on 2026-09-04 as
//   a PII lockdown; types.ts kept declaring it. types.ts is hand-maintained (the
//   Supabase Management PAT 401s in both stores, so there is no regeneration
//   path), and a hand-edit drifts in both directions.
//
// THE TWO DIRECTIONS ARE NOT SYMMETRIC, AND ARE NOT GRADED THE SAME
//   Proven against live prod with the deployed publishable key:
//
//     select a column prod HAS   -> 401  42501 permission denied for view ...
//     select a PHANTOM column    -> 400  42703 column ... does not exist
//
//   42703 is raised at PARSE time, before the permission check, and it rejects
//   the WHOLE query -- not just that field. So:
//
//   PHANTOM (types.ts declares it, prod lacks it) -> FAILS THIS CHECK.
//       tsc calls the select green and PostgREST 400s the entire query. It is a
//       dead surface waiting for someone to autocomplete the field types.ts is
//       offering them.
//
//   MISSING (prod has it, types.ts lacks it) -> REPORTED, NEVER VOTES.
//       Conservative in the safe direction: the column is simply invisible to
//       the app, which costs an `as any` at the call site and breaks nothing.
//       Grading it would turn this red every time anyone adds a column to prod
//       before regenerating types.ts -- a guard that goes red on the calendar
//       rather than on a defect, which apex-doctor Check #19's header has warned
//       about since 2026-08-11 and which this repo has now closed six times.
//
// WHY A NAMED SET AND NOT A COUNT
//   PHANTOM_ALLOWED is a set of "relation.column" strings, not a number. A
//   count-only floor is fungible: MP-356 proved a real regression can sit red
//   and then be laundered green by an unrelated pay-down somewhere else. You
//   cannot silence a phantom here without naming it in a diff.
//
// UNPROVABLE IS ITS OWN OUTCOME
//   A relation in types.ts that the catalog does not carry is NOT graded in
//   either direction -- relation-grain existence is check-supabase-relation-
//   types.mjs's question, and answering it here in a second place is the drift
//   fn_alert_sms_fix_anchor() exists to prevent. Those are counted and printed
//   as `unprovable`, never laundered into pass or fail.
// ---------------------------------------------------------------------------
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const TYPES = "src/integrations/supabase/types.ts";
const CATALOG = "scripts/data/column-catalog.json";

// Phantom columns tolerated on purpose. Each entry must carry a reason in the
// commit that adds it. Empty is the correct steady state.
const PHANTOM_ALLOWED = new Set([]);

let catalog;
try {
  catalog = JSON.parse(readFileSync(resolve(root, CATALOG), "utf8")).columns;
} catch (e) {
  console.error(`✗ check:types-column-drift — cannot read ${CATALOG}: ${e.message}`);
  console.error(`  Run: bash scripts/refresh-column-catalog.sh`);
  process.exit(1);
}
if (!catalog || Object.keys(catalog).length < 400) {
  console.error(`✗ check:types-column-drift — ${CATALOG} carries ${Object.keys(catalog ?? {}).length} relations (expected >=400).`);
  console.error(`  A catalog that silently came back tiny would grade almost nothing while exiting 0.`);
  process.exit(1);
}

// --- parse types.ts -------------------------------------------------------
// Row blocks only. Insert/Update restate the same columns with different
// optionality, so grading them would triple every finding.
//
// A column line is EXACTLY 10 spaces + name + optional `?` + `:`. The colon may
// end the line: multi-line enum unions render as
//     attendance_status:
//       | Database["public"]["Enums"]["attendance_status"]
//       | null
// Requiring a space after the colon silently dropped all 38 of them and made
// this check report 47 missing columns where the honest number is 9. The
// continuation lines are indented deeper than 10, so anchoring the indent
// exactly is what keeps `| null` from being read as a column.
const src = readFileSync(resolve(root, TYPES), "utf8").split("\n");
const secRe = /^ {4}(Tables|Views|Functions|Enums|CompositeTypes): \{$/;
const bounds = [];
src.forEach((l, i) => { const m = secRe.exec(l); if (m) bounds.push([m[1], i]); });

const declared = new Map(); // relation -> Set(columns)
bounds.forEach(([name, start], idx) => {
  if (name !== "Tables" && name !== "Views") return;
  const end = idx + 1 < bounds.length ? bounds[idx + 1][1] : src.length;
  let rel = null, inRow = false;
  for (const l of src.slice(start + 1, end)) {
    const r = /^ {6}([A-Za-z_]\w*): \{$/.exec(l);
    if (r) { rel = r[1]; if (!declared.has(rel)) declared.set(rel, new Set()); inRow = false; continue; }
    if (rel && /^ {8}Row: \{$/.test(l)) { inRow = true; continue; }
    if (!inRow) continue;
    if (/^ {8}\}$/.test(l)) { inRow = false; continue; }
    const c = /^ {10}([A-Za-z_]\w*)\??:(?: |$)/.exec(l);
    if (c) declared.get(rel).add(c[1]);
  }
});

if (declared.size === 0) {
  console.error(`✗ check:types-column-drift — parsed 0 relations out of ${TYPES}.`);
  console.error(`  A parser that silently matches nothing passes every commit while proving none.`);
  process.exit(1);
}
const emptyRel = [...declared].filter(([, c]) => c.size === 0).map(([r]) => r);
if (emptyRel.length) {
  console.error(`✗ check:types-column-drift — ${emptyRel.length} relation(s) parsed with ZERO columns: ${emptyRel.slice(0, 5).join(", ")}`);
  console.error(`  That is a parser defect, not a clean repo. Refusing to report a verdict.`);
  process.exit(1);
}

// --- diff ------------------------------------------------------------------
const phantom = [], missing = [], unprovable = [];
for (const [rel, cols] of [...declared].sort()) {
  const live = catalog[rel];
  if (!live) { unprovable.push(rel); continue; }
  const liveSet = new Set(live);
  for (const c of [...cols].sort()) if (!liveSet.has(c)) phantom.push(`${rel}.${c}`);
  for (const c of live) if (!cols.has(c)) missing.push(`${rel}.${c}`);
}

const offending = phantom.filter((p) => !PHANTOM_ALLOWED.has(p));

console.log(`check:types-column-drift — ${declared.size} relations parsed, ${unprovable.length} unprovable (not in catalog; relation-grain is check:supabase-relation-types' question)`);
if (missing.length) {
  console.log(`  ${missing.length} column(s) prod has that types.ts lacks — reported, NOT graded (safe direction; costs an \`as any\`, breaks nothing):`);
  for (const m of missing) console.log(`    ~ ${m}`);
  console.log(`    Clear with: bash scripts/refresh-column-catalog.sh && regenerate types.ts`);
}
if (offending.length === 0) {
  console.log(`✓ check:types-column-drift — 0 phantom columns.`);
  process.exit(0);
}
console.error(`✗ check:types-column-drift — ${offending.length} phantom column(s): declared in ${TYPES}, ABSENT from prod.`);
console.error(`  PostgREST raises 42703 at parse time and rejects the ENTIRE query with HTTP 400 —`);
console.error(`  not just this field. Any select that names one is a dead surface tsc calls green.`);
for (const p of offending) console.error(`    ✗ ${p}`);
console.error(`  Fix: delete the column from the Row block in ${TYPES}, or re-add it to the relation in prod.`);
console.error(`  If the catalog is stale, refresh it FIRST: bash scripts/refresh-column-catalog.sh`);
process.exit(1);
