#!/usr/bin/env node
import { stripComments } from "./lib/strip-comments.mjs";
/**
 * check-book-freshness-operand.mjs — MP-462 (2026-09-07)
 *
 * ONE RULE: if a file asks v_agentlink_book_freshness whether the PIPELINE is
 * alive, it must not answer from last_import alone.
 *
 * WHY THIS EXISTS. MP-431 put trg_fn_suppress_noop_update('imported_at') on
 * agentlink_book, so a rebuild that finds no content change writes nothing and
 * imported_at does not move. That is correct behaviour. It also means
 * last_import answers "when did a row last CHANGE", never "when did we last
 * successfully sync". MP-435 added last_successful_refresh as the honest
 * operand and wrote the warning into the view's own comment -- then left both
 * graders on the old column. On 2026-09-07 that rendered a destructive
 * "Book not imported in 2d" badge on the Leaderboard, and pushed 4
 * Priority:high alerts to Sam's phone between 09-05 and 09-06, while the book
 * had been rebuilt 45 minutes earlier and 125 of the previous 126 rebuilds had
 * succeeded. A comment in a migration is not a contract.
 *
 * WHAT IT DOES *NOT* DO. It does not ban last_import. Reading it to display
 * "when did content last change" is legitimate and the Leaderboard still does.
 * The violation is selecting last_import from this view WITHOUT also selecting
 * last_successful_refresh -- i.e. deriving a liveness verdict from an operand
 * that is structurally incapable of carrying one.
 *
 * NOT A COUNT FLOOR. MP-356/MP-357 proved a numeric baseline is fungible: a
 * real regression gets absorbed by an unrelated pay-down and the gate goes
 * green having measured nothing. This grades every site individually and has
 * no baseline to launder into.
 *
 * NOT PERMANENTLY RED. HEAD passes today (proven at ship time). It can only go
 * red on a NEW site that reintroduces the defect, so its green is earned and
 * its red is always actionable -- the failure mode apex-doctor's own Check #19
 * header warns about.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOTS = ["src", "supabase/functions", "scripts"];
const VIEW = "v_agentlink_book_freshness";
// Generated type declarations DECLARE the view's shape; they never derive a
// verdict from it, so they cannot commit this defect. Caught on this guard's
// first run: it flagged src/integrations/supabase/types.ts and would have
// shipped permanently red, which is the exact failure mode the header above
// says it avoids. (It did surface a real, separate fact -- types.ts declares
// last_import but not last_successful_refresh, so the generated types are
// behind the live view. That is catalog drift and belongs to
// check:supabase-relation-types, not here.)
const DECLARATION_ONLY = /(^|\/)src\/integrations\/supabase\/types\.ts$/;
// This guard names the view in its own source, so without this it counts
// ITSELF as a reader and `sites` can never reach 0 -- making the UNKNOWN branch
// unreachable BY CONSTRUCTION. Caught by M2, which is the only reason it is not
// shipping dead: the same shape as MP-407's inline leg (a regex IS a string
// literal) and MP-277's footnote bug. A guard is not a grader of production
// behaviour and must never satisfy its own predicate.
const SELF = /(^|\/)scripts\/check-book-freshness-operand\.mjs$/;
const REPO = process.cwd();

// \b would match inside v_agentlink_book_freshness_v2 on the trailing edge, so
// assert the next char cannot continue an identifier.
const mentions = (t) => new RegExp(`\\b${VIEW}(?![A-Za-z0-9_])`).test(t);

function walk(dir, out = []) {
  let entries;
  try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "node_modules" && e.name !== "dist") walk(p, out); }
    else if (/\.(ts|tsx|js|mjs|cjs)$/.test(p)) out.push(p);
  }
  return out;
}

// Strip comments before matching. MP-277: a scanner that reads raw source
// counts its own footnotes -- that bug has been recorded against this repo's
// guards more than once, including in this file's own header, which names
// last_import several times in prose.

const offenders = [];
let scanned = 0, sites = 0;

for (const root of ROOTS) {
  for (const file of walk(join(REPO, root))) {
    let raw;
    try { raw = readFileSync(file, "utf8"); } catch { continue; }
    const rel = relative(REPO, file);
    if (SELF.test(rel) || DECLARATION_ONLY.test(rel)) continue;
    // Word-boundary, not includes(): a renamed view (v_..._freshness_v2) is a
    // DIFFERENT relation and must not be silently counted as this one. M2's
    // first fixture renamed to a superstring and includes() matched it, so the
    // mutation looked landed and proved nothing.
    if (!mentions(raw)) continue;
    scanned++;
    const src = stripComments(raw);
    if (!mentions(src)) continue; // only mentioned in prose
    sites++;
    const usesImport = /\blast_import\b/.test(src);
    const usesHonest = /\blast_successful_refresh\b/.test(src);
    if (usesImport && !usesHonest) {
      const line = src.slice(0, src.indexOf("last_import")).split("\n").length;
      offenders.push({ file: relative(REPO, file), line });
    }
  }
}

console.log(`check-book-freshness-operand: ${scanned} file(s) mention ${VIEW}, ${sites} outside comments, ${offenders.length} violation(s)`);
if (sites === 0) {
  // ZERO sites is UNANSWERED, not green. If the view is renamed or the query
  // moves, this guard must say it stopped measuring rather than pass silently.
  console.error(`UNKNOWN: no file reads ${VIEW} at all. Either the view was renamed or this guard's roots (${ROOTS.join(", ")}) no longer cover the readers. This is not a pass.`);
  process.exit(2);
}
if (offenders.length) {
  for (const o of offenders) {
    console.error(`  ${o.file}:${o.line} reads last_import from ${VIEW} without last_successful_refresh.`);
  }
  console.error(`\nlast_import cannot answer "is the pipeline alive": zz_suppress_noop_update('imported_at') on agentlink_book means a successful rebuild with no content change does not move it. Select last_successful_refresh too and take greatest(...) of the two, as migration 20260904224500:390 already does.`);
  process.exit(1);
}
console.log("OK — every reader that grades book liveness folds in last_successful_refresh.");
