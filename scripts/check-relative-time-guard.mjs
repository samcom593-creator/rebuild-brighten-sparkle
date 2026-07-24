#!/usr/bin/env node
// check-relative-time-guard — wave-negtime-1 (hook added 2026-07-21, guard
// written 2026-07-24 under MP-264).
//
// WHY THIS EXISTS
//   f97f721d fixed DashboardCRM getTimeAgo, where `Date.now() - date.getTime()`
//   with no floor rendered "-18690m ago" in the CRM Last Activity column that
//   every manager sees — a producer's newest policy carried a future
//   posted/effective date. Same silent-render-wrong disease as the 465
//   InsuraCloud fake-success rows: the UI looked fine and was lying.
//
// WHY IT WAS MISSING
//   The .husky/pre-commit block referencing this file was committed on
//   2026-07-21 but the script itself never was — it appears in no commit in
//   git history. Every commit staging a src/ ts|tsx|js|jsx file since then hit
//   `Cannot find module` and could only land via --no-verify. Writing the
//   guard the hook already expects, rather than deleting the block, because
//   the bug class it names is real and currently unguarded.
//
// WHAT IT CATCHES
//   An unclamped elapsed-time delta: `Date.now() - <expr>` or
//   `<expr>.getTime() - <expr>.getTime()` that is not floored with
//   Math.max(0, …) and not made direction-agnostic with Math.abs(…).
//
// PAY-DOWN
//   Add a Math.max(0, …) clamp (or route the value through formatTimeAgo()
//   from @/lib/dateUtils, which clamps internally), or annotate a legitimate
//   comparison-only site with `relative-time-guard-allow:<reason>` on the same
//   line or the line directly above. Then lower BASELINE in this file in the
//   same commit.

import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const srcRoot = path.join(repoRoot, "src");

// dateUtils owns the sanctioned clamped formatters — it is the fix, not a site.
const SANCTIONED = path.resolve(srcRoot, "lib", "dateUtils.ts");

// Elapsed-time subtraction. Either `Date.now() - …` or `….getTime() - ….getTime()`.
const DELTA_RE = /(?:Date\.now\(\)\s*-|\.getTime\(\)\s*-\s*[^;]*\.getTime\(\))/;
// A clamped or direction-agnostic delta cannot render negative.
const CLAMP_RE = /Math\.max\(\s*0\s*,|Math\.abs\(/;
const ALLOW_RE = /relative-time-guard-allow:/;

// Comparison-only uses never reach a renderer: `if (Date.now() - t > X)`,
// `.filter(r => Date.now() - r.ts < WINDOW)`, timers, and perf measurements.
const COMPARISON_RE = /[<>]=?|\?\?|&&|\|\||\breturn\s+Date\.now\(\)\s*-[^;]*[<>]/;

// Shapes that cannot produce a negative *rendered duration* and so are not
// part of this bug class:
//   new Date(Date.now() - X)          constructs a past timestamp
//   return a.getTime() - b.getTime()  Array.sort comparator, never rendered
//   const cutoff = Date.now() - 7*DAY threshold constant from a literal
const CONSTRUCTS_PAST_RE = /new Date\(\s*Date\.now\(\)\s*-/;
const SORT_COMPARATOR_RE = /(?:return|=>)\s*\(?\s*[A-Za-z_$][\w.$[\]"']*\.getTime\(\)\s*-\s*[A-Za-z_$][\w.$[\]"']*\.getTime\(\)\s*\)?\s*[;,)]?\s*$/;
const LITERAL_THRESHOLD_RE = /Date\.now\(\)\s*-\s*[\d_]+\s*[*)\s;,]/;

// 2026-07-24 — FIRST REAL MEASUREMENT. The wave-negtime-1 hook note claimed
// "baselined @ 40 → 36", but the guard script was never committed, so that
// number was never produced by running anything. 45 is what the codebase
// actually contains once test fixtures, `new Date(Date.now() - X)`
// constructors, sort comparators, and literal thresholds are excluded.
// Locking the true floor rather than a number nobody measured. Pay down in
// waves: clamp with Math.max(0, …) or route through formatTimeAgo().
const BASELINE = 45;

if (!fs.existsSync(srcRoot)) {
  console.log("[check-relative-time-guard] no src/ dir — skipping");
  process.exit(0);
}

const files = [];
function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
      walk(full);
    } else if (/\.(tsx?|jsx?)$/.test(entry.name)) {
      files.push(full);
    }
  }
}
walk(srcRoot);

const violations = [];
for (const file of files) {
  if (path.resolve(file) === SANCTIONED) continue;
  // Test fixtures build synthetic past timestamps on purpose.
  if (/[\\/]tests?[\\/]/.test(file) || /\.(test|spec)\.[jt]sx?$/.test(file)) continue;
  const lines = fs.readFileSync(file, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!DELTA_RE.test(line)) continue;
    if (ALLOW_RE.test(line) || (i > 0 && ALLOW_RE.test(lines[i - 1]))) continue;
    if (COMPARISON_RE.test(line)) continue;
    if (CONSTRUCTS_PAST_RE.test(line)) continue;
    if (SORT_COMPARATOR_RE.test(line)) continue;
    if (LITERAL_THRESHOLD_RE.test(line)) continue;
    // Look up far enough to catch a function-level clamp feeding this line.
    const ctx = lines.slice(Math.max(0, i - 20), i + 1).join("\n");
    if (CLAMP_RE.test(ctx)) continue;
    violations.push(`${path.relative(repoRoot, file)}:${i + 1}  ${line.trim().slice(0, 80)}`);
  }
}

const count = violations.length;

if (count > BASELINE) {
  console.error(
    `✗ check:relative-time-guard — ${count} unclamped elapsed-time deltas exceeds baseline ${BASELINE} (Δ +${count - BASELINE})`,
  );
  console.error(
    "Clamp with Math.max(0, …), route through formatTimeAgo() from @/lib/dateUtils,\n" +
    "or annotate a comparison-only site with `relative-time-guard-allow:<reason>`.",
  );
  for (const v of violations) console.error(`  ${v}`);
  process.exit(1);
}

console.log(`✓ check:relative-time-guard — ${count} unclamped delta(s) (<= baseline ${BASELINE})`);
