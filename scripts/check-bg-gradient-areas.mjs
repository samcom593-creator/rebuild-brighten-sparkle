#!/usr/bin/env node
// Caps bg-gradient-to-* usage in src/pages/ + src/components/landing/ at the
// 2026-06-10 baselines. Extends wave-60's check-bg-gradient-cards.mjs (which
// ratchets src/components/dashboard/) to two more high-traffic surface trees.
// Owned by Website Integrity Bot.
//
// Why this matters (wave-61):
//   Wave-59 (commit 136afa81) killed 28 muddy multi-stop gradients across 18
//   dashboard components per v22 §10 banned-pattern. Wave-60 (commit f410b7dc)
//   ratcheted the dashboard floor at 73 so the cleanup can't silently decay.
//   But 122 files repo-wide still carry 284 bg-gradient instances. The next
//   highest-traffic non-dashboard surfaces are src/pages/ (106) and
//   src/components/landing/ (18). Without ratchets here too, every new page
//   reaches for Tailwind-default `bg-gradient-to-br from-X via-Y to-Z` and the
//   AgentLink-crisp flat-fill discipline decays in the corners we haven't
//   ratcheted yet.
//
// Mechanic (mirrors check-bg-gradient-cards.mjs):
//   For each configured area: walk its tree, count lines containing
//   `bg-gradient-to-`, subtract lines carrying an explicit allow marker,
//   fail if total > BASELINE. ALL areas must pass; first failure exits 1.
//
// Adding a new legitimate gradient (hero strip, CTA, alert state, branded
// decor): tag the line with the marker
//
//     bg-gradient-card-allow:<short-kebab-reason>
//
// in a trailing comment OR an inline JSX comment OR a stand-alone line
// directly above. Same marker as wave-60 by design — one mental model.
//
// Raising a baseline: only when 3+ new legitimate gradients land in one PR
// for that area. Otherwise tag them with the allow marker and leave the
// baseline alone.

import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

// Post-wave-62 ratchets. Wave-61 locked src/pages at 106 + src/components/landing
// at 18. Wave-62 killed 6 surgical gradients in src/pages (4 in AgentPortal:
// StatCard colorClasses template + text-clip rainbow title + 3-stop muddy card
// + absolute decor overlay; 2 in NotificationHub: hardcoded 2-stop stat cards),
// dropping src/pages to 100 and ratcheting that lower floor. Also added
// src/components/recruiter (baseline 0) — the folder is currently clean, lock
// it so any future bg-gradient on a recruiter component is rejected.
// Each baseline is the count of unmarked bg-gradient-to-* instances at lock time.
const AREAS = [
  { dir: "src/pages", baseline: 100 },
  { dir: "src/components/landing", baseline: 18 },
  { dir: "src/components/recruiter", baseline: 0 },
];

const GRADIENT_RX = /bg-gradient-to-/;
const ALLOW_RX = /bg-gradient-card-allow/;

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
      if (!GRADIENT_RX.test(line)) continue;
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
      `✓ check:bg-gradient-areas — ${result.dir} ${result.count}/${result.baseline} bg-gradient instances (allow-marked: ${result.allowed})`,
    );
    continue;
  }
  anyFailed = true;
  console.error(
    `\n✗ check:bg-gradient-areas — ${result.dir} ${result.count} bg-gradient instances exceeds baseline ${result.baseline} (Δ +${result.count - result.baseline})\n`,
  );
  console.error("The v22 §10 banned-pattern is purposeless multi-stop gradients on Card-style outer wrappers.");
  console.error("Either:");
  console.error("  (a) Replace with flat fill: bg-X/[0.06] border-X (wave-59 pattern), OR");
  console.error("  (b) Tag the line with `bg-gradient-card-allow:<reason>` if this is a hero/CTA/alert/branded-decor.");
  console.error("\nNewest hits (showing first 12):");
  const overflow = result.hits.slice(-12);
  for (const h of overflow) {
    console.error(`  ${h.file}:${h.line}`);
    console.error(`    ${h.snippet}`);
  }
  console.error(
    `\nIf 3+ truly justified gradients are landing in this PR, bump the ${result.dir} baseline in scripts/check-bg-gradient-areas.mjs.`,
  );
  console.error("Do not just remove the check — argue with Website Integrity Bot.");
}

process.exit(anyFailed ? 1 : 0);
