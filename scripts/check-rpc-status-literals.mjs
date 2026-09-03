#!/usr/bin/env node
// Guards the half of the enum/CHECK-vocabulary class that check-enum-filter-literals.mjs
// cannot see: a value that arrives from an RPC and is compared in JavaScript.
//
// MP-409 (2026-09-03). ScopedProductionScoreboard.tsx decided which Discord deal feeds
// were broken with:
//     const blockedFeeds = (feed.data ?? []).filter((f) => f.status !== "ok");
// discord_deal_feed_health() returns discord_deal_ingestion_health.status, which carries
//     CHECK (status = ANY (ARRAY['healthy','credential_blocked','channel_unavailable','error']))
// so "ok" is a state this database cannot store, and EVERY feed was "blocked" by
// construction. Both live feeds were credential_blocked at ship time, so the board looked
// correct — the amber "this feed is not reading, deals are missing from your board" line
// would have gone permanently on at the moment a feed started reading, i.e. on the run
// that proved the fix worked. The sixth costume of the permanently-red guard, this time
// on the surface Sam reads production off.
//
// Why nothing caught it:
//   - The RPC's return column is text. Every wrong word is a valid text value, so tsc,
//     the generated Supabase types, and the RPC-arg guard all pass.
//   - check-enum-filter-literals.mjs only reaches inside supabase.from("t").eq("c", "lit").
//     A comparison written in JS on a returned row is invisible to it.
//   - The failure renders as a warning that is always on, which reads as a real warning.
//
// WHAT IS GRADED. For every supabase.rpc("<fn>") called in a file, every
// `<expr>.<col> === "<literal>"` (and !== / == / != , either operand order) where
// (<fn>, <col>) is in scripts/data/rpc-column-vocabulary.json.
//
// THE RULE, and why it leans the way it does. A set-returning function's accepted
// vocabulary is not simply its base column's: calendar_window() synthesises 'birthday'
// and 'milestone' as status values that exist in no table. So the catalog records
// CANDIDATES (relation columns of that name reachable from the function body) plus the
// function's own body literals, and a literal fails only when NO candidate vocabulary
// and no body literal accepts it. Provenance from a body regex is a guess; a guard built
// on a guess must be unable to accuse a word any plausible source would accept. It still
// catches a word no source will, which is the whole bug.
//
// Measured when this shipped: 24 unique comparison sites across 5 files. 17 are gradeable
// and all 17 pass; exactly one literal in the repo was impossible, the one above. (A first
// count said 28 — it counted CalendarPage's four `.kind` comparisons twice, once under
// calendar_window and once under calendar_window_counts, because both functions return a
// column of that name. A number that does not reconcile is a defect, not a rounding error.)
// The other 7: 4 on calendar_window.kind and 2 on get_cron_jobs_with_status.last_status are
// UNPROVABLE — no candidate for those columns carries an enum or a CHECK, so this guard has
// no standing to grade them. automation_run_log.status, behind last_status, holds 'success',
// 'error', 'ok' AND 'dispatched' live with no constraint at all: an open vocabulary, and the
// cron panel's failure to handle two of those four is a different finding, not this one.
// The 7th is in src/tests. Unprovable pairs are counted and printed on every run, never
// failed and never laundered into the pass.
//
// NOT graded, on purpose: switch/case, .includes([...]), and template strings. Each is a
// real shape; none of them appear in src today, and a guard that pretends to cover a
// shape it has never been tested against is worse than one that names the gap.
//
// Run: node scripts/check-rpc-status-literals.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const catalog = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/data/rpc-column-vocabulary.json"), "utf8"));
const enumCat = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/data/enum-catalog.json"), "utf8"));

// One snapshot of what Postgres accepts, shared with check-enum-filter-literals.mjs.
function vocabularyOf(candidate) {
  const check = enumCat.check_vocab?.[candidate];
  if (check?.members?.length) return check.members;
  const enumType = enumCat.column_enum?.[candidate];
  if (enumType && enumCat.enums?.[enumType]?.length) return enumCat.enums[enumType];
  return null;
}

// Comments are stripped, string bodies are NOT. A regex is a string literal and a
// literal inside a comment is not code: MP-277 counted its own footnotes, and MP-408
// matched a column name inside the comment that said the column was never written.
function stripComments(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") { out += " "; i++; }
    } else if (c === "/" && d === "*") {
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) { out += src[i] === "\n" ? "\n" : " "; i++; }
      out += "  "; i += 2;
    } else if (c === '"' || c === "'" || c === "`") {
      const quote = c; out += c; i++;
      while (i < n) {
        if (src[i] === "\\") { out += src[i] + (src[i + 1] ?? ""); i += 2; continue; }
        out += src[i];
        if (src[i] === quote) { i++; break; }
        i++;
      }
    } else { out += c; i++; }
  }
  return out;
}

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) { if (entry.name !== "node_modules") walk(p, acc); }
    else if (/\.tsx?$/.test(entry.name)) acc.push(p);
  }
  return acc;
}

const violations = [];
let graded = 0;
const unprovable = new Set();

for (const file of walk(path.join(ROOT, "src"))) {
  const rel = path.relative(ROOT, file);
  // src/tests asserts source text of the very files graded here; grading its fixtures
  // would make this guard argue with the tests that pin the fix in place.
  if (rel.startsWith("src/tests/")) continue;
  const raw = fs.readFileSync(file, "utf8");
  const src = stripComments(raw);

  const rpcs = [...src.matchAll(/\.rpc\(\s*"([a-zA-Z0-9_]+)"/g)].map((m) => m[1]);
  if (rpcs.length === 0) continue;

  // Every returned column reachable from this file, with the union of what its
  // candidates and its function body accept.
  const accepted = new Map();     // column -> Set(literal)
  const hasVocab = new Set();     // columns where at least one candidate is constrained
  for (const rpc of new Set(rpcs)) {
    for (const [key, entry] of Object.entries(catalog.columns)) {
      if (!key.startsWith(`${rpc}.`)) continue;
      const col = key.slice(rpc.length + 1);
      if (!accepted.has(col)) accepted.set(col, new Set());
      const set = accepted.get(col);
      for (const lit of entry.body_literals) set.add(lit);
      for (const cand of entry.candidates) {
        const members = vocabularyOf(cand);
        if (!members) continue;
        hasVocab.add(col);
        for (const m of members) set.add(m);
      }
      if (!hasVocab.has(col)) unprovable.add(key);
    }
  }
  if (accepted.size === 0) continue;

  const lines = src.split("\n");
  for (const [col, allowed] of accepted) {
    if (!hasVocab.has(col)) continue;
    const forward = new RegExp(`\\.${col}\\s*(?:===|!==|==|!=)\\s*"([^"\\\\]*)"`, "g");
    const reverse = new RegExp(`"([^"\\\\]*)"\\s*(?:===|!==|==|!=)\\s*[A-Za-z_$][\\w$]*\\.${col}\\b`, "g");
    lines.forEach((line, idx) => {
      for (const re of [forward, reverse]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(line)) !== null) {
          graded++;
          if (allowed.has(m[1])) continue;
          violations.push({
            file: rel, line: idx + 1, col, literal: m[1],
            // The union across every candidate source plus the literals the function
            // synthesises — deliberately wider than the one true source, so a word this
            // prints as "accepted" is not necessarily right here, only not impossible.
            allowed: [...allowed].filter((a) => /^[a-z0-9_]+$/.test(a)).sort(),
            rpcs: [...new Set(rpcs)].filter((r) => catalog.columns[`${r}.${col}`]),
          });
        }
      }
    });
  }
}

if (violations.length > 0) {
  console.error("RPC status-literal guard FAILED\n");
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    compares .${v.col} against "${v.literal}", which no source of that column accepts.`);
    console.error(`    returned by: ${v.rpcs.join(", ")}`);
    console.error(`    accepted by some source of this column: ${v.allowed.join(", ")}`);
    console.error("");
  }
  console.error("A word the database cannot store makes the comparison a constant, not a test.");
  console.error("Catalog: scripts/data/rpc-column-vocabulary.json (bash scripts/refresh-rpc-column-vocabulary.sh)");
  process.exit(1);
}

console.log(
  `RPC status-literal guard passed: ${graded} literal comparison(s) graded against live vocabularies, ` +
  `${unprovable.size} (function, column) pair(s) unprovable and deliberately ungraded.`
);
