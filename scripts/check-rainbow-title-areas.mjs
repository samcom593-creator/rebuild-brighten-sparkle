#!/usr/bin/env node
// Caps the v22 §10 banned rainbow text-clip title pattern across the 22 wave-60/
// 61/62/63/64-tracked component trees. Owned by Website Integrity Bot.
// Built wave-69 (2026-06-10) — 14th pre-commit gate.
//
// What this gate locks:
//   v22 §10 banned the rainbow text-clip title aesthetic — the
//   `bg-gradient-to-r from-X via-Y to-Z bg-clip-text text-transparent` 4-stop
//   gradient painted onto headline text, which reads as 2010-era SaaS landing
//   page chrome. AgentLink/Linear/Cursor/Vercel ship solid headlines on a
//   single brand color (text-primary / text-foreground / text-accent), no
//   text-clip technique anywhere. wave-62 (commit a0d8fcdc) killed the
//   rainbow titles in AgentPortal but the technique still ships in 5
//   src/pages locations as the degraded solid-bg-clip form
//   (`bg-white dark:bg-slate-900 bg-clip-text text-transparent`) — a codemod-
//   cleaned dark-mode workaround that retains the banned bg-clip-text aesthetic.
//   Without this gate, the next new headline drift back to rainbow gradients
//   has nothing watching.
//
// What gets counted (the banned signal):
//   Any line carrying BOTH `bg-clip-text` AND `text-transparent` — that pair
//   is the rainbow-title technique regardless of which bg-gradient/bg-color
//   feeds it (rainbow `from-X via-Y to-Z`, solid `bg-white`, brand `bg-primary`,
//   anything). The pair only renders text in the bg color clipped through the
//   text shape; without `text-transparent` the bg-clip-text is a no-op, and
//   without `bg-clip-text` the text-transparent makes text invisible.
//
// Why this matters:
//   Same persistence-mandate failure mode wave-46/47 had to catch 4 months
//   after wave-22 (lucide vendor-icons subset re-creeping back); same drift
//   wave-63 had to catch ~185 instances post-wave-2 bg-gradient codemod;
//   same drift wave-66 had to catch post-13c6338b v25-rainbow-shadow codemod.
//   Without this gate, the wave-62 rainbow-title kill silently decays as every
//   new headline reaches for the shadcn-default `bg-clip-text text-transparent`
//   gradient-title aesthetic and nothing watches. This gate makes it impossible
//   to silently re-introduce the banned pattern outside the locked floors.
//
// Mechanic (mirrors check-shadow-areas.mjs + check-focus-ring-areas.mjs):
//   For each configured area: walk its tree, count lines matching both signals,
//   subtract lines carrying an explicit allow marker, fail if total > baseline.
//   ALL areas must pass; first failure exits 1.
//
// Baselines: measured floors at HEAD b7408593, locked wave-69 (2026-06-10).
//   src/pages:                 5  (AgentNumbersLogin h1 + LeadsLanding Link+span
//                                  + Numbers h1 + RecruiterDashboard h1 — all
//                                  using bg-white dark:bg-slate-900 bg-clip-text
//                                  text-transparent — degraded form of the
//                                  wave-62 banned rainbow title pattern; lock at
//                                  floor 5, future surgical kills ratchet down)
//   src/components/dashboard:  0  (WhatShippedTodayBanner.tsx self-narration of
//                                  class names — text content, NOT rendered CSS;
//                                  all narration lines carry rainbow-title-allow
//                                  markers added wave-69; baseline 0 enforces
//                                  that every future narration mentioning the
//                                  pattern must be explicitly marked)
//   20 other trees:            0  (v22/v24/v25/wave-62 codemod-cleaned, locked
//                                  at 0)
//
// Adding a legitimate gradient title (hero CTA brand-decor, marketing banner):
// tag the line with the marker
//
//     rainbow-title-allow:<short-kebab-reason>
//
// in a trailing comment OR an inline JSX comment OR a stand-alone line directly
// above. Same mental model as wave-60's bg-gradient-card-allow, wave-65's
// shadow-glow-allow, wave-67's motion-budget-allow, wave-68's focus-ring-allow.
//
// Raising a baseline: only when 3+ new legitimate hits land in one PR for that
// area. Otherwise tag them and leave the baseline alone.

import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

// Post-wave-69 baselines = exact measured floors at lock time (HEAD b7408593).
// 5 src/pages hits are the wave-62 codemod-cleaned degraded form using solid
// bg-white instead of a rainbow gradient — still the banned bg-clip-text +
// text-transparent technique. 3 dashboard hits are banner narration of class
// names in text content (allow-marked).
const AREAS = [
  // Active surfaces with locked floor (wave-69 — future surgical kills ratchet down)
  { dir: "src/pages", baseline: 5 },
  // Banner self-narration is allow-marked individually (rainbow-title-allow)
  { dir: "src/components/dashboard", baseline: 0 },
  // v22/v24/v25/wave-62 codemod-cleaned trees (sweep verified at exactly 0)
  { dir: "src/components/ui", baseline: 0 },
  { dir: "src/components/landing", baseline: 0 },
  { dir: "src/components/awards", baseline: 0 },
  { dir: "src/components/agent", baseline: 0 },
  { dir: "src/components/callcenter", baseline: 0 },
  { dir: "src/components/layout", baseline: 0 },
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

const BG_CLIP_RX = /\bbg-clip-text\b/;
const TEXT_TRANSPARENT_RX = /\btext-transparent\b/;
const ALLOW_RX = /rainbow-title-allow/;

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
      // Banned signal: BOTH bg-clip-text AND text-transparent on same line
      const isBanned = BG_CLIP_RX.test(line) && TEXT_TRANSPARENT_RX.test(line);
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
      `✓ check:rainbow-title-areas — ${result.dir} ${result.count}/${result.baseline} banned rainbow-title instances (allow-marked: ${result.allowed})`,
    );
    continue;
  }
  anyFailed = true;
  console.error(
    `\n✗ check:rainbow-title-areas — ${result.dir} ${result.count} banned rainbow-title instances exceeds baseline ${result.baseline} (Δ +${result.count - result.baseline})\n`,
  );
  for (const hit of result.hits) {
    console.error(`  ${hit.file}:${hit.line}  ${hit.snippet}`);
  }
  console.error(
    `\n  v22 §10 banned the rainbow text-clip title pattern (bg-clip-text + text-transparent).`,
  );
  console.error(
    `  Either kill the bg-clip-text/text-transparent pair OR tag with rainbow-title-allow:<reason>.`,
  );
  break;
}

if (anyFailed) process.exit(1);
console.log("\nrainbow-title gate: all areas at or under baseline.");
