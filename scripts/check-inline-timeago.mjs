#!/usr/bin/env node
// Negative-time ratchet (2026-07-21).
//
// Flags hand-rolled relative "X ago" formatters that are NOT clamped against
// future-dated inputs — the exact class that rendered "-18690m ago" in the CRM
// Last Activity column (production/effective dates can be in the future, and an
// unguarded `Date.now() - date` delta then goes negative).
//
// Canonical formatter: formatTimeAgo() in src/lib/dateUtils.ts. Any other
// `${…} ago` template in src/** is a violation UNLESS the delta feeding it is
// clamped with `Math.max(0, …)` within 6 lines above, or the line carries a
// `timeago-allow:<reason>` marker. dateUtils.ts is the one sanctioned home.
//
// Baseline-count ratchet (same shape as check-empty-catch / check-tsc-error-
// count): the count can only go DOWN. Pay-down = route the formatter through
// formatTimeAgo() or clamp its delta, then lower BASELINE in the same commit.
//
// Baseline history:
//   2026-07-21 initial lock after wave-1 pay-down. CRM + AgentProfileDrawer +
//     7 dashboard/agentlink/pipeline formatters clamped. Remainder = bot-
//     stranded files (LicensedInbox/TransferRequests/Announcements/Finances)
//     + SmbBridgeCard + ticker data-values, to be paid down as they free up.

import fs from "node:fs";
import path from "node:path";
import { splitUncommittable, noticeBanner } from "./lib/committable.mjs";

const BASELINE = 5; // 2026-07-21: SmbBridgeCard + 2 landing tickers (bot-stranded) + RecoveryQueue + Setup — all past-dated data values. Pay down as they free up.

const repoRoot = path.resolve(import.meta.dirname, "..");
const srcRoot = path.join(repoRoot, "src");
const SANCTIONED = path.resolve(srcRoot, "lib", "dateUtils.ts");

if (!fs.existsSync(srcRoot)) {
  console.log("[check-inline-timeago] no src/ dir — skipping");
  process.exit(0);
}

// A relative-time template: `${expr}` immediately followed by an optional unit
// and the word "ago" inside a template literal.
const AGO_RE = /\$\{[^}]*\}\s*(?:m|h|d|mo|min|mins|minutes|hours|hrs|days)?\s+ago`/;
// A delta clamped with Math.max(0, …) can't go negative; Math.abs(…) is a
// deliberate past/future formatter ("in 3d" / "3d ago"). Both are safe.
const CLAMP_RE = /Math\.max\(\s*0\s*,|Math\.abs\(/;
const ALLOW_RE = /timeago-allow:/;

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
  const lines = fs.readFileSync(file, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (!AGO_RE.test(lines[i])) continue;
    if (ALLOW_RE.test(lines[i]) || (i > 0 && ALLOW_RE.test(lines[i - 1]))) continue;
    // Look far enough up to catch a function-level `const delta = Math.max(0,…)`
    // that feeds a template several lines below.
    const ctx = lines.slice(Math.max(0, i - 20), i + 1).join("\n");
    if (CLAMP_RE.test(ctx)) continue;
    violations.push(`${path.relative(repoRoot, file)}:${i + 1}  ${lines[i].trim().slice(0, 80)}`);
  }
}

// MP-457. Same rule as check-supabase-relation-types, from the same helper:
// this walks the whole working tree, and a file that is untracked AND unstaged
// belongs to another worker's in-flight wave, not to this commit. Baselines are
// counts, and a count that includes work nobody is committing is a count that
// blocks every other worker. Notices are printed, never dropped.
const [graded, notices] = splitUncommittable(violations, (v) => v.split(":")[0]);
const count = graded.length;
if (count > BASELINE) {
  console.error(
    `✗ check:inline-timeago — ${count} unguarded relative-time formatters exceeds baseline ${BASELINE} (Δ +${count - BASELINE})`,
  );
  console.error("Route it through formatTimeAgo() from @/lib/dateUtils, or clamp the delta with Math.max(0, …).");
  for (const v of graded) console.error("  " + v);
  process.exit(1);
}
console.log(`✓ check:inline-timeago — ${count} unguarded formatter(s) (== baseline ${BASELINE})`);
if (notices.length) {
  console.log(noticeBanner(notices.length));
  for (const v of notices) console.log("    " + v);
}
if (process.env.TIMEAGO_LIST) for (const v of graded) console.log("  " + v);
process.exit(0);
