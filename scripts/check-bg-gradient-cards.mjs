#!/usr/bin/env node
// Caps bg-gradient-to-* usage in src/components/dashboard/ at the
// post-wave-59 baseline. New multi-stop "muddy info-card fade" gradients
// silently re-shipping would undo wave-59's AgentLink-crisp flat-fill
// discipline. Owned by Website Integrity Bot.
//
// Why this matters (wave-59, commit 136afa81):
//   28 surgical bg-gradient kills across 18 dashboard components. The
//   banned pattern is purposeless multi-stop gradients on Card / GlassCard
//   outer wrappers (v22 §10) — they read as muddy visual noise that masks
//   the AgentLink-grade crispness Apex is chasing. Without a hard ratchet,
//   the next dev adding a new dashboard component will reach for
//   `bg-gradient-to-br from-X via-Y to-Z` (Tailwind defaults trained that
//   habit) and the cleanup decays month-over-month. This file makes the
//   cleanup forever.
//
// Mechanic (proven from check-landing-css-size):
//   Walk src/components/dashboard/**.{tsx,ts}, count lines containing
//   `bg-gradient-to-`. Subtract lines that carry an explicit allow marker.
//   Fail if the count exceeds BASELINE.
//
// Adding a new legitimate gradient (medal, avatar, hero strip, CTA, alert
// state, ambient decor, etc.): tag the line with the marker
//
//     bg-gradient-card-allow:<short-kebab-reason>
//
// in a trailing comment OR an inline JSX comment OR a stand-alone line
// directly above. The reason is for the next reader — make it specific.
//
// Raising the baseline: only when 3+ new legitimate gradients land in one
// PR. Otherwise tag them with the allow marker and leave BASELINE.

import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const targetDir = path.join(repoRoot, "src/components/dashboard");

// Post-wave-63 ratchet. Wave-59 (136afa81) killed 28 muddy gradients leaving
// 73. Wave-2 codemod dae5773d (561 visual-noise instances killed across 161
// files) + wave-2 GlassCard flatten 3768d5c5 dropped dashboard to 1 unmarked
// instance + 4 allow-marked (medals/avatars/CTAs/hero). Wave-63 ratchets the
// floor down from 73 → 1 to lock those gains — without this the gate allows
// ~72 muddy gradients to silently re-creep into the dashboard tree.
// Bump ONLY when intentionally landing additional brand-justified gradients.
const BASELINE = 1;

const GRADIENT_RX = /bg-gradient-to-/;
const ALLOW_RX = /bg-gradient-card-allow/;

function walk(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, acc);
    else if (/\.(tsx?|jsx?)$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

const files = walk(targetDir);
const hits = [];
let allowed = 0;

for (const file of files) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!GRADIENT_RX.test(line)) continue;
    // Allow marker may live on the same line OR the line immediately above
    // (so JSX className blocks split across lines can opt in cleanly).
    const prev = i > 0 ? lines[i - 1] : "";
    if (ALLOW_RX.test(line) || ALLOW_RX.test(prev)) {
      allowed += 1;
      continue;
    }
    hits.push({ file: path.relative(repoRoot, file), line: i + 1, snippet: line.trim().slice(0, 140) });
  }
}

const count = hits.length;

if (count <= BASELINE) {
  console.log(
    `✓ check:bg-gradient-cards — ${count}/${BASELINE} dashboard bg-gradient instances (allow-marked: ${allowed})`,
  );
  process.exit(0);
}

console.error(`\n✗ check:bg-gradient-cards — ${count} dashboard bg-gradient instances exceeds wave-59 baseline ${BASELINE} (Δ +${count - BASELINE})\n`);
console.error("The v22 §10 banned-pattern is purposeless multi-stop gradients on Card outer wrappers.");
console.error("Either:");
console.error("  (a) Replace with flat fill: bg-X/[0.06] border-X (wave-59 pattern), OR");
console.error("  (b) Tag the line with `bg-gradient-card-allow:<reason>` if this is a medal/avatar/hero/CTA/alert/decor.");
console.error("\nNewest hits (showing first 12):");
const overflow = hits.slice(-12);
for (const h of overflow) {
  console.error(`  ${h.file}:${h.line}`);
  console.error(`    ${h.snippet}`);
}
console.error("\nIf 3+ truly justified gradients are landing in this PR, bump BASELINE in scripts/check-bg-gradient-cards.mjs.");
console.error("Do not just remove the check — argue with Website Integrity Bot.");
process.exit(1);
