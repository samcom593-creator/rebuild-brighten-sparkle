#!/usr/bin/env node
// Caps v22 §10 motion-fast budget violations across the 22 wave-60/61/62/63/
// 64/65/66-tracked component trees. Owned by Website Integrity Bot.
// Built wave-67 (2026-06-10).
//
// What gets counted (the v22 §10 motion-fast budget signal — and only that):
//   1. ARBITRARY_GT_FAST: `duration-[Xms]` where X > 200ms. v22 §10 motion-fast
//      budget = 120ms (per src/styles/apex-tokens.css --motion-fast: 120ms).
//      The wave-58 win baked `duration-[120ms]` onto Button.tsx focus-visible
//      transition to match the budget. Anything above the --motion-base
//      ceiling (200ms) is the v22 banned "slow lazy fade" feel that drags
//      every interaction past the AgentLink-crisp threshold.
//   2. CHUNKY_DURATION: Tailwind defaults `duration-(300|500|700|1000)`. The
//      Tailwind ladder above 200 (300, 500, 700, 1000) is what every drift-y
//      `hover:transition-all duration-300` instinct reaches for and what the
//      v22 motion budget bans outright. duration-75/100/150/200 all fall
//      INSIDE the budget (≤ 200ms) and are not counted.
//
// Why this matters (wave-67):
//   The v22 §10 motion budget exists because animations beyond 200ms register
//   as sluggishness on every interaction — hover, focus, tab, sheet open, card
//   reveal. AgentLink/Cursor/Linear all sit at 120-180ms because that's the
//   perceptual ceiling for "instant response". Sam's site has dozens of
//   `transition-all duration-300` instincts because that's Tailwind's first
//   suggested ladder beyond `duration-100`. No gate watches motion. Same
//   persistence-mandate failure mode wave-46/47 had to catch 4 months after
//   wave-22 (lucide vendor-icons subset drift) and wave-63 had to catch
//   post-wave-2 codemod (185 bg-gradients re-creeping back) — but for motion.
//   Locking floors now prevents the next 6 months of duration-300 drift.
//
// Mechanic (mirrors check-shadow-areas.mjs):
//   For each configured area: walk its tree, count lines matching either
//   over-budget signal, subtract lines carrying an explicit allow marker,
//   fail if total > baseline. ALL areas must pass; first failure exits 1.
//
// Baselines: post-wave-66 measured floors at HEAD 85ec4826. Some trees carry
// brand-justified motion (CourseProgress ring stroke draw, Apply progress-bar
// fill, pipeline progress fills) and locking floors preserves them. Most are
// hover/transition-all `duration-300` legacy reaches that should grind down
// per wave-62 surgical discipline over time.
//
// Adding a legitimate over-budget motion (animation duration, progress-bar
// stroke draw, brand-decor pulse): tag the line with the marker
//
//     motion-budget-allow:<short-kebab-reason>
//
// in a trailing comment OR an inline JSX comment OR a stand-alone line
// directly above. Same mental model as shadow-glow-allow / bg-gradient-card-
// allow / bg-gradient-area-allow.
//
// Raising a baseline: only when 3+ new legitimate over-budget motions land in
// one PR for that area. Otherwise tag them and leave the baseline alone.

import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

// Post-wave-67 baselines = exact measured floors at lock time (HEAD 85ec4826).
// Locks v22 §10 motion-fast budget (>200ms) at the current floor across all
// 22 trees. Floors are baselines; grind them down via surgical sweeps.
const AREAS = [
  // Active page + dashboard surfaces (carry brand-justified motion at floor)
  { dir: "src/pages", baseline: 11 },
  { dir: "src/components/dashboard", baseline: 6 },
  { dir: "src/components/landing", baseline: 13 },
  { dir: "src/components/awards", baseline: 2 },
  { dir: "src/components/agent", baseline: 0 },
  { dir: "src/components/callcenter", baseline: 5 },
  { dir: "src/components/layout", baseline: 0 },
  { dir: "src/components/ui", baseline: 3 },
  // v24/v25 codemod-cleaned trees (most at 0 — lock there)
  { dir: "src/components/recruiter", baseline: 0 },
  { dir: "src/components/admin", baseline: 0 },
  { dir: "src/components/celebrations", baseline: 0 },
  { dir: "src/components/command", baseline: 0 },
  { dir: "src/components/contentwheel", baseline: 0 },
  { dir: "src/components/course", baseline: 0 },
  { dir: "src/components/crm", baseline: 0 },
  { dir: "src/components/deals", baseline: 0 },
  { dir: "src/components/finances", baseline: 0 },
  { dir: "src/components/next-step", baseline: 0 },
  { dir: "src/components/pipeline", baseline: 1 },
  { dir: "src/components/plaque", baseline: 0 },
  { dir: "src/components/profile", baseline: 0 },
  { dir: "src/components/system-health", baseline: 0 },
];

const ARBITRARY_RX = /duration-\[(\d+)ms\]/;
const CHUNKY_RX = /\bduration-(300|500|700|1000|1500|2000)\b/;
const ALLOW_RX = /motion-budget-allow/;

function isOverBudget(line) {
  const arb = line.match(ARBITRARY_RX);
  if (arb && Number(arb[1]) > 200) return true;
  if (CHUNKY_RX.test(line)) return true;
  return false;
}

function walk(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.(tsx?|jsx?)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

function scanArea({ dir, baseline }) {
  const absDir = path.join(repoRoot, dir);
  const files = walk(absDir);
  const hits = [];
  let allowed = 0;
  for (const file of files) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!isOverBudget(line)) continue;
      const prev = i > 0 ? lines[i - 1] : "";
      if (ALLOW_RX.test(line) || ALLOW_RX.test(prev)) {
        allowed += 1;
        continue;
      }
      hits.push({
        file: path.relative(repoRoot, file),
        line: i + 1,
        snippet: line.trim().slice(0, 140),
      });
    }
  }
  return { dir, baseline, count: hits.length, allowed, hits };
}

let anyFailed = false;
for (const area of AREAS) {
  const result = scanArea(area);
  if (result.count <= result.baseline) {
    console.log(
      `✓ check:motion-areas — ${result.dir} ${result.count}/${result.baseline} over-budget motions (allow-marked: ${result.allowed})`,
    );
    continue;
  }
  anyFailed = true;
  console.error(
    `\n✗ check:motion-areas — ${result.dir} ${result.count} over-budget motions exceeds baseline ${result.baseline} (Δ +${result.count - result.baseline})\n`,
  );
  console.error("The v22 §10 motion-fast budget banned-pattern is:");
  console.error("  (1) arbitrary > 200ms       `duration-[300ms]`, `duration-[500ms]`");
  console.error("  (2) chunky Tailwind default `duration-300`, `duration-500`, etc.");
  console.error("v22 motion-fast budget = 120ms; --motion-base ceiling = 200ms.");
  console.error("\nEither:");
  console.error("  (a) Drop to `duration-150` or `duration-200` (or `duration-[120ms]`), OR");
  console.error("  (b) Tag the line with `motion-budget-allow:<reason>` if this is");
  console.error("      a progress-bar fill, animation, or brand-decor stroke draw.");
  console.error("\nNewest hits (showing first 12):");
  const overflow = result.hits.slice(-12);
  for (const h of overflow) {
    console.error(`  ${h.file}:${h.line}`);
    console.error(`    ${h.snippet}`);
  }
  console.error(
    `\nIf 3+ truly justified motions are landing in this PR, bump the ${result.dir} baseline in scripts/check-motion-areas.mjs.`,
  );
  console.error("Do not just remove the check — argue with Website Integrity Bot.");
}

process.exit(anyFailed ? 1 : 0);
