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
// MP-410 (2026-09-03) CORRECTS THIS FILE'S OWN ACCOUNTING. The paragraph here used to say
// 24 sites were found, 17 graded, and "the other 7: 4 on calendar_window.kind and 2 on
// get_cron_jobs_with_status.last_status are UNPROVABLE ... counted and printed on every run".
// Every part of that was false, and the guard's output could not have shown it:
//   - The catalog's `cand` CTE INNER JOINed candidate relations, so a (function, column)
//     pair existed only when some PUBLIC relation supplied a column of that name. A function
//     that synthesises its output (calendar_window.kind) or reads another schema
//     (get_cron_jobs_with_status reads cron.job) produced NO row at all.
//   - With no row, `key.startsWith(rpc + ".")` matched nothing, the column never entered
//     `accepted`, and those 6 sites were never seen. They were not ungraded-and-counted;
//     they were invisible, and absent from `unprovable` too.
//   - The 2 sites genuinely skipped for want of a vocabulary were RecruitingLinks.tsx
//     .account_mode, which the header did not mention and the output did not print.
//   - The summary also mixed units: `graded` counts comparison SITES, `unprovable` counts
//     catalog PAIRS, and one sentence presented the second as the remainder of the first.
// The catalog now records every returned column of every qualifying function (candidates may
// be empty), and this guard PUBLISHES its denominator: sites graded, sites seen but ungraded
// (named), and how many called RPCs it structurally cannot reach. A pass that does not say
// what it did not look at reads as "checked" — which is the same disease as the bug above.
//
// automation_run_log.status, behind last_status, holds 'success', 'error', 'ok' AND
// 'dispatched' live with no constraint at all: an open vocabulary this guard has no standing
// to grade. It is now printed as seen-but-ungraded rather than silently dropped.
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

// `typeof x.status === "string"` is a TYPE test, not a vocabulary comparison. The regex
// below matches `.status === "string"` inside it, so any graded column used in a typeof
// check would be a false violation. A lookbehind cannot express this — the identifier sits
// between `typeof` and the dot (`typeof meta.person_name`) — so the line prefix is examined.
// Latent when found: Apply.tsx:770 uses single quotes, which this pattern never matched.
// It surfaced only because MP-410 started PRINTING the sites the guard sees.
const TYPEOF_PREFIX = /typeof\s+[A-Za-z_$][\w$]*(?:\??\.[A-Za-z_$][\w$]*)*$/;
function isTypeofTest(line, idx) {
  return TYPEOF_PREFIX.test(line.slice(0, idx));
}

const violations = [];
let graded = 0;
const unprovable = new Set();
// COVERAGE. A pass that does not state what it could not look at reads as "checked".
// MP-409's own header claimed 4 sites on calendar_window.kind and 2 on
// get_cron_jobs_with_status.last_status were counted UNPROVABLE. They were not: neither
// pair existed in the catalog, so `key.startsWith(rpc + ".")` matched nothing, the column
// never entered `accepted`, and those sites were invisible rather than ungraded. The two
// sites actually skipped for want of a vocabulary were RecruitingLinks.tsx .account_mode,
// which appeared nowhere. See MP-410.
const skippedSites = [];        // seen, in catalog, no constrained candidate
const rpcsSeen = new Set();

for (const file of walk(path.join(ROOT, "src"))) {
  const rel = path.relative(ROOT, file);
  // src/tests asserts source text of the very files graded here; grading its fixtures
  // would make this guard argue with the tests that pin the fix in place.
  if (rel.startsWith("src/tests/")) continue;
  const raw = fs.readFileSync(file, "utf8");
  const src = stripComments(raw);

  const rpcs = [...src.matchAll(/\.rpc\(\s*"([a-zA-Z0-9_]+)"/g)].map((m) => m[1]);
  if (rpcs.length === 0) continue;
  for (const r of rpcs) rpcsSeen.add(r);

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
    if (!hasVocab.has(col)) {
      const probe = new RegExp(`\\.${col}\\s*(?:===|!==|==|!=)\\s*"([^"\\\\]*)"`, "g");
      lines.forEach((line, idx) => {
        probe.lastIndex = 0;
        let m;
        while ((m = probe.exec(line)) !== null) {
          if (isTypeofTest(line, m.index)) continue;
          skippedSites.push(`${rel}:${idx + 1} .${col} === "${m[1]}"`);
        }
      });
      continue;
    }
    // `typeof x.status === "string"` is a type test, not a vocabulary comparison. The
    // inherited regex matched it, so any graded column used in a typeof check would have
    // been a false violation. Latent when found (Apply.tsx:770 uses single quotes, which
    // this pattern never matched) — surfaced only because MP-410 started PRINTING the
    // sites this guard sees, which is the argument for printing them.
    const forward = new RegExp(`\\.${col}\\s*(?:===|!==|==|!=)\\s*"([^"\\\\]*)"`, "g");
    const reverse = new RegExp(`"([^"\\\\]*)"\\s*(?:===|!==|==|!=)\\s*[A-Za-z_$][\\w$]*\\.${col}\\b`, "g");
    lines.forEach((line, idx) => {
      for (const re of [forward, reverse]) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(line)) !== null) {
          if (isTypeofTest(line, m.index)) continue;
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

// Coverage is PUBLISHED, never graded. Grading it would pin this guard yellow over a
// product decision (how many RPCs return jsonb), which is the permanently-red guard
// apex-doctor Check #19's header warns about. A catalog GAP is different: it means a
// function this guard is designed to cover is silently outside it, so it is named loudly
// here and owned by apex-doctor Check #58, which re-queries pg_proc for the same drift.
const catalogFns = new Set(Object.keys(catalog.columns).map((k) => k.slice(0, k.indexOf("."))));
const uncoverable = catalog.uncoverable ?? {};
const outside = [...rpcsSeen].filter((r) => !catalogFns.has(r)).sort();
const structural = outside.filter((r) => r in uncoverable);
const gaps = outside.filter((r) => !(r in uncoverable));

console.log(
  `RPC status-literal guard passed: ${graded} comparison site(s) graded against live vocabularies.`
);
console.log(
  `  seen but ungraded: ${skippedSites.length} site(s) whose column has no constrained source ` +
  `(${unprovable.size} such (function, column) pair(s) in the catalog).`
);
for (const site of skippedSites) console.log(`    ${site}`);
console.log(
  `  not looked at: ${structural.length} of ${rpcsSeen.size} RPC(s) called in src/ return jsonb or a ` +
  `scalar, so they expose no named column to compare and this guard cannot reach them.`
);
if (gaps.length > 0) {
  console.error(
    `\nRPC status-literal guard FAILED: ${gaps.length} RPC(s) return named columns but are ` +
    `absent from the catalog, so their comparison sites are invisible rather than ungraded:`
  );
  for (const g of gaps) console.error(`    ${g}`);
  console.error("\nRegenerate: bash scripts/refresh-rpc-column-vocabulary.sh");
  process.exit(1);
}
