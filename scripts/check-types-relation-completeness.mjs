#!/usr/bin/env node
// ---------------------------------------------------------------------------
// check-types-relation-completeness.mjs — MP-465 (2026-09-07)
//
// WHAT THIS GRADES
//   src/integrations/supabase/types.ts and scripts/data/relation-catalog.json
//   are two projections of ONE database. This asserts they agree at relation
//   grain, in BOTH directions, for schema `public`.
//
// WHY IT EXISTS
//   check-supabase-relation-types.mjs (MP-329) grades every `.from()` in src/
//   against types.ts. Its own header records the condition it depends on and
//   cannot enforce:
//
//     "Relation-grain completeness of types.ts is still graded by nothing."
//
//   While types.ts is behind prod, "absent from types.ts" quietly stops meaning
//   "absent from the database". In that state MP-329's failure message is a
//   FALSE ACCUSATION -- it reports that prod lacks a table prod actually has --
//   and the cheapest way out of a false accusation is `as any`, which is the
//   exact cast MP-329 recorded as "why nothing objected" the first time.
//
//   This is not hypothetical drift. MP-464 regenerated types.ts on 2026-09-07
//   after it fell 48 relations behind. Within hours of that regeneration a new
//   view (v_hierarchy_unreachable) existed in prod and in neither artifact. The
//   gap re-opens on its own; only a guard closes it repeatedly.
//
// WHY BOTH DIRECTIONS FAIL, WITH DIFFERENT DIAGNOSES
//   missing (catalog has it, types.ts does not)
//       types.ts is behind. MP-329 will block valid code naming that relation.
//   phantom (types.ts has it, catalog does not)
//       types.ts claims a relation prod may not have. tsc then HAPPILY compiles
//       a `.from()` that 404s at runtime -- the failure moves from build time to
//       Sam's browser, which is the worse trade.
//
//   Both are reported separately because the remedy differs, and BOTH remedies
//   are printed as "refresh both, then re-judge": these snapshots are taken at
//   different times, so a mismatch can equally mean one is merely staler than
//   the other. Telling the reader to regenerate only one artifact is how you
//   ping-pong between two red states.
//
// WHY THE ANSWER COMES FROM A SNAPSHOT AND NOT FROM prod
//   CI has no database. Freshness of the snapshot is NOT this check's job and
//   this check must never pretend to know it -- apex-doctor Check #39 re-queries
//   the live catalog weekly and grades snapshot-vs-prod drift. Splitting it that
//   way is the MP-276 pattern: the repo guard grades what the repo ships, the
//   doctor grades what prod holds.
//
// ZERO-EXTRACTION IS A FAILURE, NOT A PASS
//   Both operands are parsed out of text. If types.ts is reformatted or the
//   catalog shape changes, a naive parser extracts nothing, computes "0 missing"
//   and exits 0 forever -- a guard reporting on its own silence. MP-297 shipped
//   the same floor for the asset graph after a 1-of-6 extraction printed "full".
//   Under FLOOR both sides fail loudly as UNKNOWN instead.
// ---------------------------------------------------------------------------
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const repoRoot = process.cwd();
const TYPES = join(repoRoot, "src/integrations/supabase/types.ts");
const CATALOG = join(repoRoot, "scripts/data/relation-catalog.json");

// Neither artifact has been near this small in its life; public alone is ~700.
// A number under this means the parse broke, not that the database emptied.
const FLOOR = 100;

function fail(msg) { console.error(`FAIL: ${msg}`); process.exit(1); }

if (!existsSync(TYPES)) fail(`missing ${TYPES}`);
if (!existsSync(CATALOG)) {
  fail(`missing scripts/data/relation-catalog.json — this check cannot grade completeness ` +
       `without it. That is UNKNOWN, not clean. Run: bash scripts/refresh-relation-catalog.sh`);
}

// Same extraction MP-329 uses: entries are `      <name>: {` at exactly six
// spaces inside the public Tables/Views blocks.
function declaredRelations() {
  const s = readFileSync(TYPES, "utf8");
  const grab = (startKey, endKey) => {
    const i = s.indexOf(startKey);
    if (i < 0) return [];
    const j = s.indexOf(endKey, i);
    const seg = s.slice(i, j < 0 ? undefined : j);
    return [...seg.matchAll(/^ {6}([a-z_][a-z0-9_]*): \{/gm)].map((m) => m[1]);
  };
  return {
    tables: grab("    Tables: {", "    Views: {"),
    views: grab("    Views: {", "    Functions: {"),
  };
}

const { tables, views } = declaredRelations();
const declared = new Set([...tables, ...views]);

let cat;
try { cat = JSON.parse(readFileSync(CATALOG, "utf8")); }
catch (e) { fail(`relation-catalog.json is unparseable (${e.message}) — UNKNOWN, not clean`); }

const catalogPublic = (cat.relations ?? [])
  .filter((r) => r.startsWith("public."))
  .map((r) => r.slice("public.".length));

if (declared.size < FLOOR) {
  fail(`extracted only ${declared.size} relations from types.ts (floor ${FLOOR}). ` +
       `The parser found almost nothing, so "0 missing" would be a statement about ` +
       `this check's own silence. Anchors are '    Tables: {' / '    Views: {' / ` +
       `'    Functions: {' with entries at six spaces — one of those moved.`);
}
if (catalogPublic.length < FLOOR) {
  fail(`relation-catalog.json lists only ${catalogPublic.length} public relations ` +
       `(floor ${FLOOR}). Refusing to grade against a catalog that small.`);
}

const catalogSet = new Set(catalogPublic);
const missing = catalogPublic.filter((n) => !declared.has(n)).sort();
const phantom = [...declared].filter((n) => !catalogSet.has(n)).sort();

console.log("types.ts vs relation-catalog.json (schema public, relation grain)");
console.log(`  types.ts declares : ${tables.length} tables + ${views.length} views = ${declared.size}`);
console.log(`  catalog declares  : ${catalogPublic.length}`);
console.log(`  missing from types.ts : ${missing.length}`);
console.log(`  phantom in types.ts   : ${phantom.length}`);

if (missing.length) {
  console.log("\n  MISSING — prod has these, types.ts does not. check-supabase-relation-types");
  console.log("  will report valid code as naming a nonexistent relation:");
  for (const n of missing.slice(0, 25)) console.log(`    ${n}`);
  if (missing.length > 25) console.log(`    ... and ${missing.length - 25} more`);
}
if (phantom.length) {
  console.log("\n  PHANTOM — types.ts declares these, the catalog does not. tsc will compile");
  console.log("  a .from() on them and the 404 lands in the browser instead of the build:");
  for (const n of phantom.slice(0, 25)) console.log(`    ${n}`);
  if (phantom.length > 25) console.log(`    ... and ${phantom.length - 25} more`);
}

if (missing.length || phantom.length) {
  console.error(
    `\nFAIL: ${missing.length} missing + ${phantom.length} phantom.\n` +
    `These two artifacts are snapshots taken at different times, so refresh BOTH\n` +
    `before judging which one is wrong:\n` +
    `  1. bash scripts/refresh-relation-catalog.sh\n` +
    `  2. regenerate src/integrations/supabase/types.ts from the live database\n` +
    `     (a Claude session with the authenticated Supabase connector does this;\n` +
    `      see scripts/refresh-supabase-types.sh)\n` +
    `  3. re-run this check\n` +
    `If a difference survives step 3, it is real and the database is the tiebreaker.`
  );
  process.exit(1);
}

console.log("\nOK — both projections agree at relation grain.");
