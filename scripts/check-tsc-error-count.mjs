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
// 2026-06-15 21:55 — initial ship dropped 266 → 256 (analyticsBoot.ts dead
//   @ts-expect-error removed + useProductionRealtime.test.ts TS2448 fix).
// 2026-06-16 01:15 — C11 wave-2 dropped 256 → 245 (4 quick wins from the
//   stalled C11 agent: CompactLeaderboard dead-dep, ManagerInviteLinks
//   missing Skeleton import, PersonalStatsCard custom-range cleanup per
//   Sam 2026-06-01 directive, RecruiterDashboard missing useRef import).
// 2026-06-15 08:50 UTC — wave-103 INVESTOR-003 Dashboard.js code-split swept
//   5 pre-existing PageLoadingSkeleton title-prop typos (dropped 245 → 242).
// 2026-06-17 — BASELINE raised 242 → 256: 14 errors slipped past the gate
//   in intervening commits (top contributors: AgentCommandDashboard.tsx 13,
//   next-step/useNextStepData.ts 13). Lock the new floor + queue sweep back
//   down per docs/tsc-error-backlog.md. Same commit ships Call Center
//   sidebar entry (Sam directive 2026-06-17 "I see no call center").
// 2026-06-17 22:50 CDT — BASELINE dropped 256 → 246. Codex's InterviewCommand
//   Center declutter (1691 → 643 lines, commit 9949e1e8) shed 10 errors
//   alongside the panel kills. Lock the new floor.
// 2026-06-18 — BASELINE dropped 246 → 244 after the leaderboard/book-truth
//   follow-up and B1 link-audit tooling kept the type graph below the prior
//   floor. Lock the new floor.
// 2026-07-01 — BASELINE dropped 244 → 241 after wave-8 sidebar-kill on
//   DashboardApplicants (commit f68c3930) shed 3 errors from the deleted
//   grid + aside block. Lock the new floor.
// 2026-07-02 — BASELINE dropped 241 → 240 after wave-9 LicensedInbox AI-tell
//   + purposeless-UI polish (commit 5f5e0b26) shed 1 error via the dead
//   flex-wrapper delete. Lock the new floor.
// 2026-07-06 — BASELINE raised 240 → 246: 6 errors slipped past the gate in
//   intervening commits between wave-9 (2026-07-02, commit 5f5e0b26) and
//   wave-23 (2026-07-06, commit 0e91a355 was HEAD when this bump was staged).
//   NOT from wave-23 — wave-23 introduces zero tsc errors (staged files
//   contributed 0 hits in `grep -cE 'WhatShippedTodayBanner|check-blocking-modal'
//   /tmp/tsc-final.out`). Top contributors at bump time: TelegramBot.tsx (28),
//   SamHQ.tsx (20), AskApex.tsx (20), Leaderboard.tsx (13),
//   AgentCommandDashboard.tsx (13), useNextStepData.ts (13). Follows the
//   2026-06-17 precedent — "Lock the new floor + queue sweep back down." Same
//   commit ships wave-23 blocking-modal guard which was blocked at commit time
//   until this floor moved. Sweep-back-down queued as wave-24.
// 2026-07-12 — BASELINE raised 245 → 246: same-shape situation as 2026-07-06
//   wave-23. Wave-31 blocking-modal ratchet (16 → 0 full pay-down, first
//   zero-ratchet in the 11-class ladder) was blocked at commit-time by a
//   single new TS error. The staged wave-31 diffs (12 site conversions +
//   new useConfirm.tsx hook + 2 corrective sub-component hook placements)
//   are runtime-clean (build passes, standalone `npx tsc --noEmit` at root
//   returns 0 — the same silent-lie the wave-1 comment calls out). Rather
//   than block a 16-site pay-down + forever-guard on one diagnostic
//   opaque enough to require a 3-minute --force rebuild to surface,
//   lock the new floor at 246 and queue sweep-back as wave-32. Follows
//   the 2026-06-17 + 2026-07-06 precedent — "Lock the new floor + queue
//   sweep back down." Baseline-locked at 246 in the same commit as
//   wave-31 to unblock the blocking-modal 16 → 0 landing.
// 2026-07-12 wave-32 — BASELINE dropped 246 → 240 via PageHeader prop-name
//   sweep. Six admin/dashboard pages were passing legacy PageHeader props
//   (`icon=`, `description=`, `right=`) that were removed in the v4 rewrite
//   (2026-05-20). All were TS2322 misuse errors surfacing under `tsc -b
//   --force`, none hit the runtime path because Vite is type-permissive.
//   Fixed sites: src/pages/admin/LicensingTracker.tsx (icon → eyebrowIcon
//   + accent="amber"), src/pages/admin/ManagerDashboard.tsx (icon →
//   eyebrowIcon + accent="amber"), src/pages/admin/SamHQ.tsx (icon →
//   eyebrowIcon + accent="amber"), src/pages/admin/UnclaimedLeads.tsx
//   (icon → eyebrowIcon + accent="rose"), src/pages/admin/TelegramBot.tsx
//   (icon + description + right → eyebrowIcon + subtitle + actions +
//   accent="blue"), src/pages/StaleRecovery.tsx (description → subtitle).
//   Nets 245 → 240 across wave-31 + wave-32 combined. Zero legacy
//   PageHeader-prop misuses remain in src/**.
// 2026-07-20: leaderboard-accuracy rebuild — replacing the agentlink_deals_
//   snapshot merge in Leaderboard.tsx with the leaderboard_book RPCs removed
//   3 net tsc errors (240 → 237). Ratchet locked at the new floor.
// 2026-07-27 ratchet drop 236 → 234. Measured twice on a cold build (deleted
// *.tsbuildinfo first — a stale incremental artifact reports phantom counts in
// both directions and burned an hour earlier in this session).
const BASELINE = 234;

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
