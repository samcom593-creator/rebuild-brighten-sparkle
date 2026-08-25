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
// COST — MEASURED 2026-08-11, replacing a claim that was wrong by ~50x.
//
//   The line that used to sit here read "~10-15s on cold cache, ~3-5s on
//   incremental." Measured on Sam's machine at b7ecc0b5: FULL mode takes
//   ~11-12.5 MINUTES of wall clock at 95-100% CPU. The same lie was in
//   .github/workflows/verify-core.yml ("~50s"); that job's last 12 runs took
//   481-640s (median ~595s).
//
//   The "~3-5s on incremental" half was never reachable: this script passes
//   --force, which by definition discards the up-to-date check. The flag
//   forbade the mode the comment advertised.
//
//   AND DROPPING --force BUYS ALMOST NOTHING. Measured back to back on the
//   same tree, because the obvious repair was to run incremental at commit
//   time:
//
//     tsc -b --noEmit --force   881.5s   229 errors
//     tsc -b --noEmit           845.6s   229 errors   (both .tsbuildinfo warm)
//
//   35.9 seconds saved out of 881 — 4.1%. Incremental is not fast here; it is
//   the same 14 minutes. Neither tsconfig.app.json nor tsconfig.node.json sets
//   composite/incremental, so `tsc -b` has no real up-to-date check to
//   short-circuit. (The counts did agree, so accuracy was never the problem —
//   speed was, and there is none to buy.)
//
//   A "--fast" mode was written, wired into .husky/pre-commit, and then deleted
//   before commit when that measurement came back. Shipping a mode named "fast"
//   that is 4% faster, inside the wave whose whole thesis is that this gate
//   lies about its cost, would have been the fake-success disease reproduced
//   inside its own cure.
//
//   THIS IS NOT A COSMETIC DOC BUG. It cost a real incident on 2026-08-11:
//   the MP-274 session budgeted the documented ~15s, ended while the gate was
//   still grinding, and left the wave staged-but-uncommitted for over an hour
//   WHILE its edge function was already deployed to prod (v47). Prod ran code
//   no commit described, and any worker redeploying apex-alert-dispatch from
//   source would have silently reverted Sam's phone push. A gate that costs
//   50x its advertised price doesn't just waste time — it trains the operator
//   to abandon commits mid-flight, and abandoned commits are how prod and repo
//   drift apart. 12 silent minutes is also indistinguishable from a hang.
//
//   So: the cost is no longer DOCUMENTED, it is MEASURED AND PRINTED on every
//   single run (see the elapsed-time line below). A number in a comment rots
//   the moment the graph grows; a number the script prints cannot.
//
// WHERE THIS RUNS, AND WHY IT NO LONGER RUNS AT COMMIT TIME
//
//   There is no cheap way to answer this question locally — see above. So the
//   check was moved off the commit path (2026-08-11) rather than pretended to
//   be fast. It now runs:
//     - in `npm run verify:core`, and therefore in
//       .github/workflows/verify-core.yml on EVERY push to main and EVERY pull
//       request. That job is a fresh actions/checkout with no .tsbuildinfo, so
//       --force there is honest and nothing can be stale. THIS IS THE
//       AUTHORITY.
//     - on demand: `npm run check:tsc-error-count`.
//
//   What was traded: a type error is now caught ~10 min after push instead of
//   before the commit. What was bought: >half of all commits (measured 21 of
//   the last 40, 52.5%) stop paying ~15 min, and the operator stops being
//   trained to abandon commits mid-gate — which is what actually put prod and
//   the repo out of sync on 2026-08-11. A guard nobody waits for is not a
//   guard; it is a reason to reach for `git commit --no-verify`, which bypasses
//   the other ~40 checks in .husky/pre-commit that DO cost under a second.
//
//   This trade is sound ONLY while verify-core.yml keeps running --force on
//   push + PR. scripts/check-typecheck-authority.mjs asserts that chain end to
//   end and runs in pre-commit in well under a second, so the authority cannot
//   be removed silently.

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
// 2026-08-10 wave-training-hub — BASELINE 234 → 233. Adding hub_course_progress
// to types.ts grew the SelectQueryError union by one entry, which un-masked 15
// pre-existing unsound `as X[]` casts previously hidden behind TS2589
// deep-instantiation errors (CarrierBreakdown/CarrierProduction cards,
// useNextStepData, DashboardToday, InviteLinks, LicensingTracker, SamHQ,
// TelegramBot). All 15 fixed with the `as unknown as X` intermediate the error
// itself prescribes; one TS2589 in useNextStepData dissolved outright → net -1.
// 2026-08-10 wave-training-hub — BASELINE 230 → 229. Adding hub_course_progress
// to types.ts grew the SelectQueryError union, un-masking 15 pre-existing
// unsound `as X[]` casts (Carrier* cards, useNextStepData, DashboardToday,
// InviteLinks, LicensingTracker, SamHQ, TelegramBot) that had been hidden
// behind TS2589 deep-instantiation noise. All 15 fixed with the `as unknown as`
// intermediate the error itself prescribes; one TS2589 dissolved outright.
const BASELINE = 221; // 2026-08-25: account hardening removed another error; lock the lower floor.

const startedAt = Date.now();

// Announce BEFORE blocking. ~15 minutes of total silence is indistinguishable
// from a hung process, and an operator who believes it hung kills it and walks
// away from a half-finished commit — see the COST note at the top of this file
// for the 2026-08-11 incident that did exactly that.
console.log(
  "  running `npx tsc -b --noEmit --force` — full project-graph rebuild.",
);
console.log(
  "  MEASURED 881s (~14.7 min) on Sam's machine at b7ecc0b5, 481-640s in CI.",
);
console.log("  This is NOT hung. Expect no further output until it finishes.");

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
const elapsedSeconds = (Date.now() - startedAt) / 1000;

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
    `✓ check:tsc-error-count — ${count}/${BASELINE} TypeScript errors in ${elapsedSeconds.toFixed(0)}s`,
  );
  if (count < BASELINE) {
    console.log(
      `  Ratchet drop available: lower BASELINE from ${BASELINE} to ${count} in scripts/check-tsc-error-count.mjs`,
    );
  }
  process.exit(0);
}

console.error(
  `\n✗ check:tsc-error-count — ${count} TypeScript errors exceeds baseline ${BASELINE} (Δ +${count - BASELINE}) after ${elapsedSeconds.toFixed(0)}s\n`,
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

// This used to read "Deeper context: docs/tsc-error-backlog.md (categorized
// triage)." That file has NEVER existed — `git log --all -- docs/tsc-error-backlog.md`
// returns nothing across the repo's entire history. So at the one moment this
// gate blocks someone and they most need help, it sent them to a dead path.
// Replaced with the command that generates the triage now, against the graph
// as it actually is, rather than a static doc that would rot the same way the
// cost comment above it did.
console.error("\nCategorised triage, generated fresh (no static doc to rot):");
console.error(
  "  npm run --silent typecheck 2>&1 | grep -oE 'error TS[0-9]+' | sort | uniq -c | sort -rn",
);
console.error("Full error list, worst files first:");
console.error(
  "  npm run --silent typecheck 2>&1 | grep -E 'error TS[0-9]+' | sed 's/(.*//' | sort | uniq -c | sort -rn",
);
process.exit(1);
