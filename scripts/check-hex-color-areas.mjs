#!/usr/bin/env node
// Locks the Brand-Bible 6-color palette across 22 tracked component trees by
// scanning Tailwind arbitrary-bracket hex syntax `[#XXXXXX]` and failing when
// the count of non-palette hexes exceeds each area's baseline.
// Owned by Website Integrity Bot.
//
// Why this matters (wave-78):
//   The Brand Bible (ch 6 + 9 + 19) names exactly 6 hex colors:
//     #0A0A0A bg | #C9A961 accent | #8A7340 deep
//     #FFFFFF text | #9A9A9A mid | #B83A2E alert
//   Every other hex that lands in a className via `bg-[#XXXXXX]` /
//   `text-[#XXXXXX]` / `border-[#XXXXXX]` / `from-[#XXXXXX]` etc. is silent
//   palette drift. The audit-driven drift discovered in wave-9 (a11y contrast
//   pass) showed legacy non-palette hexes #22d3a5 #030712 #1e293b #94a3b8
//   #f1f5f9 #64748b #8395ab embedded in 200+ spots. Every Lovable/AI-completion
//   regression silently re-introduces them because nothing in CI sees them as
//   wrong. This gate makes them visible at commit time, before push.
//
// Mechanic (mirrors wave-65/67/68/69 check-*-areas.mjs):
//   For each configured area: walk its tree, count `[#XXXXXX]` Tailwind
//   arbitrary-bracket instances, subtract palette matches + allow-marked
//   lines, fail if total > BASELINE. ALL areas must pass; first failure
//   exits 1.
//
// File exclusion: src/components/dashboard/WhatShippedTodayBanner.tsx contains
// long narrative `label`/`detail` string fields that quote historical hex
// literals from past ships (immutable docs). It is the only such file in the
// tree and is skipped wholesale. If a second narrative-prose component
// surfaces, add its path to EXCLUDED_FILES.
//
// Adding a new legitimate non-palette hex (third-party SVG, branded partner
// color, deliberate exception): tag the line with the marker
//
//     palette-allow:<short-kebab-reason>
//
// in a trailing comment OR an inline JSX comment OR a stand-alone line
// directly above. Examples:
//
//     bg-[#0066cc] // palette-allow:facebook-brand-button
//     border-[#1da1f2] // palette-allow:twitter-x-share-card
//
// Raising a baseline: only when 3+ new legitimate non-palette hexes land in
// one PR for that area. Otherwise tag them with the allow marker and leave
// the baseline alone. Lowering a baseline: do it aggressively as palette
// drift is cleaned (ratchet pattern).

import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

// Brand-Bible palette (ch 6 + 9 + 19). These 6 hexes are always allowed.
// Case-insensitive match.
const PALETTE = new Set([
  "#0a0a0a", // bg
  "#c9a961", // accent
  "#8a7340", // deep
  "#ffffff", // text
  "#9a9a9a", // mid
  "#b83a2e", // alert
]);

// Files exempted because their content is narrative documentation that
// quotes historical hex literals as prose, not as live styling.
const EXCLUDED_FILES = new Set([
  "src/components/dashboard/WhatShippedTodayBanner.tsx",
]);

// Baselines captured 2026-06-12. 17 of 22 areas at 0 = forever-locked. The
// other 5 carry legacy drift that wave-78+ will ratchet down as palette
// cleanups land.
const AREAS = [
  // High-traffic surfaces
  { dir: "src/pages", baseline: 0 },
  { dir: "src/components/landing", baseline: 123 },
  { dir: "src/components/dashboard", baseline: 0 },
  { dir: "src/components/layout", baseline: 0 },
  { dir: "src/components/ui", baseline: 0 },
  // Forever-locked at 0 (v24/v25 codemod-cleaned sibling trees)
  { dir: "src/components/recruiter", baseline: 0 },
  { dir: "src/components/admin", baseline: 0 },
  { dir: "src/components/agent", baseline: 0 },
  { dir: "src/components/awards", baseline: 0 },
  { dir: "src/components/callcenter", baseline: 0 },
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

const HEX_RX = /\[#([0-9a-fA-F]{6})\]/g;
const ALLOW_RX = /palette-allow/;

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
  let paletteMatches = 0;
  for (const file of files) {
    const rel = path.relative(repoRoot, file);
    if (EXCLUDED_FILES.has(rel)) continue;
    const lines = fs.readFileSync(file, "utf8").split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const prev = i > 0 ? lines[i - 1] : "";
      // Reset RegExp state per line
      HEX_RX.lastIndex = 0;
      let m;
      while ((m = HEX_RX.exec(line)) !== null) {
        const hex = `#${m[1].toLowerCase()}`;
        if (PALETTE.has(hex)) {
          paletteMatches += 1;
          continue;
        }
        if (ALLOW_RX.test(line) || ALLOW_RX.test(prev)) {
          allowed += 1;
          continue;
        }
        hits.push({
          file: rel,
          line: i + 1,
          hex,
          snippet: line.trim().slice(0, 140),
        });
      }
    }
  }
  return { dir, baseline, count: hits.length, allowed, paletteMatches, hits };
}

let anyFailed = false;
for (const area of AREAS) {
  const result = scanArea(area);
  if (result.count <= result.baseline) {
    console.log(
      `✓ check:hex-color-areas — ${result.dir} ${result.count}/${result.baseline} non-palette hex instances (palette: ${result.paletteMatches}, allow-marked: ${result.allowed})`,
    );
    continue;
  }
  anyFailed = true;
  console.error(
    `\n✗ check:hex-color-areas — ${result.dir} ${result.count} non-palette hex instances exceeds baseline ${result.baseline} (Δ +${result.count - result.baseline})\n`,
  );
  console.error("The Brand Bible (ch 6 + 9 + 19) locks the palette to 6 hex colors:");
  console.error("  #0A0A0A bg | #C9A961 accent | #8A7340 deep");
  console.error("  #FFFFFF text | #9A9A9A mid  | #B83A2E alert");
  console.error("Everything else is silent drift.");
  console.error("Either:");
  console.error("  (a) Replace with the closest palette hex or a brand token (bg-apex-*/text-apex-*), OR");
  console.error("  (b) Tag the line with `palette-allow:<reason>` if this is a 3rd-party brand color (FB blue, X teal) or deliberate exception.");
  console.error("\nNewest hits (showing first 12):");
  const overflow = result.hits.slice(-12);
  for (const h of overflow) {
    console.error(`  ${h.file}:${h.line}  ${h.hex}`);
    console.error(`    ${h.snippet}`);
  }
  console.error(
    `\nIf 3+ truly justified non-palette hexes are landing in this PR, bump the ${result.dir} baseline in scripts/check-hex-color-areas.mjs.`,
  );
  console.error("Do not just remove the check — argue with Website Integrity Bot.");
}

process.exit(anyFailed ? 1 : 0);
