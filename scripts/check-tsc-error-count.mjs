#!/usr/bin/env node
// C11 wave-1 (2026-06-14): TypeScript-error-count ratchet.
//
// Why this exists:
//   The root tsconfig.json has `files: []` and only project-references, which
//   means `npx tsc --noEmit` at the root exits 0 WITHOUT TYPE-CHECKING ANY
//   FILE. Every "tsc 0 errors" success report in recent shipping has been a
//   silent lie at the type-check layer. The real check requires
//   `tsc -b --noEmit --force`, which surfaced 266 errors at lock time.
//
//   Vite is type-permissive, so `npm run build` still passes — but a real
//   bug hidden in those 266 errors could ship undetected. This gate makes
//   the type-check layer truthful again without blocking Sam's daily
//   shipping cadence (no all-at-once 266-error-fix gate).
//
// Mechanic (same shape as wave-60+ ratchets — one mental model):
//   Run `tsc -b --noEmit --force` over the project-reference graph. Count
//   lines matching `error TS\d+`. Fail iff count > BASELINE.
//
//   Future commits CAN'T raise the count. They CAN lower it (and should —
//   see docs/tsc-error-backlog.md for the categorized triage). When the
//   count drops, lower BASELINE in this file to lock the new floor.
//
// Reducing BASELINE:
//   After a fix wave, re-run `npm run typecheck:count` to see the new
//   count, then update BASELINE to that number in this file. Same commit
//   as the fixes.
//
// Raising BASELINE: forbidden. If the count goes up, fix the new errors
//   before commit. This is the whole point of the gate.
//
// Cost when fired: ~10-15s on cold cache, ~3-5s on incremental.
//   Pre-commit runs only when a tsconfig*.json or *.ts/*.tsx file changes
//   (filtered in .husky/pre-commit), so unrelated commits skip it.

import { execSync } from "node:child_process";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

// C11 wave-1 lock baseline (2026-06-14, HEAD pre-C11):
//   `npx tsc -b --noEmit --force` surfaced 266 errors across src/ + tests/
//   + vite.config.ts. Top files: TelegramBot.tsx (28), SamHQ.tsx (20),
//   AskApex.tsx (20), AgentCommandDashboard.tsx (16), useNextStepData.ts
//   (13). Top codes: TS2769 (74 — overload mismatch on Supabase generics),
//   TS2352 (46 — bad type assertions), TS2339 (43 — property doesn't
//   exist), TS2589 (29 — excessive Supabase generic depth).
//
// Lower this number when fixes land. NEVER raise it.
// 2026-06-15 21:55 — initial ship dropped 266 → 256 (10 fixes:
// src/lib/analyticsBoot.ts removed dead @ts-expect-error directives +
// src/tests/hooks/useProductionRealtime.test.ts TS2448 use-before-decl).
const BASELINE = 256;

let stdout = "";
let stderr = "";
try {
  // tsc -b returns non-zero on errors but we still get its stdout/stderr.
  // We want to read the output regardless of exit code.
  stdout = execSync("npx tsc -b --noEmit --force", {
    cwd: repoRoot,
    stdio: ["ignore", "pipe", "pipe"],
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
  });
} catch (err) {
  // Expected path when errors exist.
  stdout = err.stdout?.toString() ?? "";
  stderr = err.stderr?.toString() ?? "";
}

const combined = `${stdout}\n${stderr}`;
const errorLines = combined.split("\n").filter((l) => /error TS\d+/.test(l));
const count = errorLines.length;

// Diagnostic: top 5 files contributing to the count, so a CI failure
// surfaces the worst offenders without dumping all 266 lines.
const byFile = new Map();
for (const line of errorLines) {
  const m = line.match(/^([^(]+)\(/);
  if (!m) continue;
  const file = m[1];
  byFile.set(file, (byFile.get(file) ?? 0) + 1);
}
const topFiles = [...byFile.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);

if (count <= BASELINE) {
  console.log(
    `✓ check:tsc-error-count — ${count}/${BASELINE} TypeScript errors (tsc -b --noEmit --force)`,
  );
  if (count < BASELINE) {
    console.log(
      `  Ratchet drop available: lower BASELINE from ${BASELINE} to ${count} in scripts/check-tsc-error-count.mjs`,
    );
  }
  process.exit(0);
}

console.error(
  `\n✗ check:tsc-error-count — ${count} TypeScript errors exceeds baseline ${BASELINE} (Δ +${count - BASELINE})\n`,
);
console.error("Run `npm run typecheck` to see the full error list.");
console.error("Top 5 contributing files:");
for (const [file, n] of topFiles) {
  console.error(`  ${file}: ${n}`);
}
console.error(
  "\nThe root tsconfig.json has `files: []` and only project-references,",
);
console.error(
  "so `npx tsc --noEmit` exits 0 silently. This gate uses `tsc -b` to",
);
console.error("actually check src/ + tests/. Fix the new errors before commit.");
console.error(
  "\nDeeper context: docs/tsc-error-backlog.md (categorized triage).",
);
process.exit(1);
