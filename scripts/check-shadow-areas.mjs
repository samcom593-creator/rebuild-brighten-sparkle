#!/usr/bin/env node
// Caps v22 §10.7 banned-pattern shadows across the 22 wave-60/61/62/63/64-tracked
// component trees. Owned by Website Integrity Bot. Built wave-65 (2026-06-10).
//
// Wave-66 ratchet-down (2026-06-10, 16:55Z): interactive Claude shipped
// 13c6338b "v25-rainbow-shadow: 104 visual fixes across 45 files" AFTER wave-65
// locked floors at HEAD e69cefd5. That commit's #3 hunting target was "Heavy
// shadows on dashboard surfaces (34 hits): shadow-{lg,xl,2xl} → shadow-sm".
// Measured post-codemod floors at HEAD 05a87c02:
//   src/pages:               18 → 16 (Δ -2)
//   src/components/dashboard: 16 → 2  (Δ -14)  ← biggest gain
// All other 20 areas unchanged at their wave-65 floors. Without this ratchet
// the gate would silently allow 16 muddy chunky shadows to re-creep back —
// same persistence-mandate failure mode wave-63 had to catch post-wave-2
// codemod (185 bg-gradients re-creeping back) and wave-46/47 had to catch
// post-wave-22 (lucide subset re-creeping back). Ratchet locks the gain
// forever; the same drift class can never silently undo a codemod again.
//
// What gets counted (the v22 §10.7 banned signal — and only that):
//   1. Arbitrary glow shadows  `shadow-[...]`  — almost always the
//      `shadow-[0_8px_30px_color/0.X]` pattern the GlassCard.tsx header banned
//      verbatim per v22 §10.7. Default-tier shadcn `shadow-lg` on dialog/sheet/
//      sonner is NOT counted (it's just the popover-elevation token).
//   2. Chunky-tier utility + colored second layer
//        `shadow-(lg|xl|2xl) ... shadow-COLOR/N`  (e.g. `shadow-lg shadow-primary/20`,
//      `shadow-xl shadow-amber-500/30`). The two-class pairing IS the "chunky
//      2-layer shadow on non-Card box" v22 §10.7 banned by name. Single
//      `shadow-lg` without a colored second layer is allowed (it just hits the
//      neutral apex elevation token).
//
// Why this matters (wave-65):
//   Wave-58 (Card.tsx → --apex-shadow-1) reset the Card primitive's own shadow,
//   but custom inline shadow strings on non-Card boxes still re-introduce the
//   chunky colored-glow aesthetic the v22 cleanup buried. Wave-64 already
//   broadcast the bg-gradient ratchet across 22 trees; the same drift class
//   exists for shadows — every new component reaches for the Tailwind-default
//   `shadow-lg shadow-primary/20` halo and the AgentLink-crisp discipline
//   decays in every corner no gate watches. Same persistence-mandate failure
//   that ate the lucide vendor-icons subset for 4 months (wave-22 → wave-46/47)
//   and ate the wave-2 bg-gradient cleanup (dae5773d → wave-63 ratchet-down).
//
// Mechanic (mirrors check-bg-gradient-areas.mjs):
//   For each configured area: walk its tree, count lines matching either
//   banned-shadow signal, subtract lines carrying an explicit allow marker,
//   fail if total > baseline. ALL areas must pass; first failure exits 1.
//
// Baselines: post-wave-64 measured floors. 15 of 22 trees are already at 0
// (the v24/v25 codemod swept them clean). The other 7 carry brand-justified
// glow surfaces (dashboard production glow, landing brand glow, awards/
// trophies, page-header elevation). Each baseline LOCKS that floor — new
// chunky-shadow drift fails the commit; legitimate additions either reduce
// elsewhere OR carry the explicit allow marker.
//
// Adding a legitimate glow (brand-decor, trophy, hero CTA, modal elevation):
// tag the line with the marker
//
//     shadow-glow-allow:<short-kebab-reason>
//
// in a trailing comment OR an inline JSX comment OR a stand-alone line directly
// above. Same mental model as wave-60's bg-gradient-card-allow.
//
// Raising a baseline: only when 3+ new legitimate glows land in one PR for
// that area. Otherwise tag them and leave the baseline alone.

import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

// Post-wave-66 baselines = exact measured floors at lock time (HEAD 05a87c02).
// Locks v22 §10.7 banned-pattern at the current floor across all 22 trees.
// Wave-66 ratchet locked the post-13c6338b v25-rainbow-shadow codemod gain
// (pages 18→16, dashboard 16→2). All other 20 floors unchanged.
const AREAS = [
  // Active page + dashboard surfaces (carry brand glow, ratchet at floor)
  { dir: "src/pages", baseline: 16 },
  { dir: "src/components/dashboard", baseline: 2 },
  { dir: "src/components/landing", baseline: 6 },
  { dir: "src/components/awards", baseline: 3 },
  { dir: "src/components/agent", baseline: 2 },
  { dir: "src/components/callcenter", baseline: 2 },
  { dir: "src/components/layout", baseline: 2 },
  { dir: "src/components/ui", baseline: 4 },
  // v24/v25 codemod-cleaned trees (sweep verified at exactly 0)
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
  { dir: "src/components/pipeline", baseline: 0 },
  { dir: "src/components/plaque", baseline: 0 },
  { dir: "src/components/profile", baseline: 0 },
  { dir: "src/components/system-health", baseline: 0 },
];

const ARBITRARY_RX = /shadow-\[/;
const CHUNKY_COLORED_RX = /shadow-(?:lg|xl|2xl)[^"'`]*shadow-[a-z]+(?:-\d+)?\/\d+/;
const ALLOW_RX = /shadow-glow-allow/;

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
      const isBanned = ARBITRARY_RX.test(line) || CHUNKY_COLORED_RX.test(line);
      if (!isBanned) continue;
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
      `✓ check:shadow-areas — ${result.dir} ${result.count}/${result.baseline} banned-shadow instances (allow-marked: ${result.allowed})`,
    );
    continue;
  }
  anyFailed = true;
  console.error(
    `\n✗ check:shadow-areas — ${result.dir} ${result.count} banned-shadow instances exceeds baseline ${result.baseline} (Δ +${result.count - result.baseline})\n`,
  );
  console.error("The v22 §10.7 banned-pattern is:");
  console.error("  (1) arbitrary glow shadows  `shadow-[0_8px_30px_color/X]`");
  console.error("  (2) chunky+colored 2-layer  `shadow-lg shadow-primary/20`");
  console.error("Default-tier `shadow-lg` alone (popover elevation) is fine.");
  console.error("\nEither:");
  console.error("  (a) Replace with --apex-shadow-1 token or drop the colored layer, OR");
  console.error("  (b) Tag the line with `shadow-glow-allow:<reason>` if this is");
  console.error("      a hero/CTA/alert/trophy/brand-decor/modal-elevation.");
  console.error("\nNewest hits (showing first 12):");
  const overflow = result.hits.slice(-12);
  for (const h of overflow) {
    console.error(`  ${h.file}:${h.line}`);
    console.error(`    ${h.snippet}`);
  }
  console.error(
    `\nIf 3+ truly justified glows are landing in this PR, bump the ${result.dir} baseline in scripts/check-shadow-areas.mjs.`,
  );
  console.error("Do not just remove the check — argue with Website Integrity Bot.");
}

process.exit(anyFailed ? 1 : 0);
