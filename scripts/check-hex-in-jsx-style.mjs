#!/usr/bin/env node
// Locks the Brand-Bible 6-color palette in JSX inline `style={{ ... }}` object
// literals and JSX string attributes (`stroke="#..."`, `fill="#..."`,
// `color="#..."`, etc.). Companion to check-hex-color-areas.mjs which covers
// the Tailwind arbitrary-bracket `[#XXXXXX]` form. Together they close the
// two hex-color surfaces a Lovable/AI regression can re-introduce.
// Owned by Website Integrity Bot.
//
// Why this matters (wave-27):
//   check-hex-color-areas.mjs catches `bg-[#XXXXXX]` / `text-[#XXXXXX]` in
//   className strings, but drift also enters through inline JSX style props:
//     <div style={{ background: "#22d3a5" }} />        // silent drift
//     <svg><circle fill="#030712" /></svg>              // silent drift
//   Baseline sweep (2026-07-08) found 7 non-palette hex literals in
//   src/components/landing (ApexLeadsSection + InstagramGrowthSection). All
//   other trees are clean at 0.
//
// Palette (Brand Bible ch 6 + 9 + 19):
//   #0A0A0A bg | #C9A961 accent | #8A7340 deep
//   #FFFFFF text | #9A9A9A mid  | #B83A2E alert
//
// Mechanic (mirrors check-hex-color-areas.mjs):
//   For each configured area: walk its tree, count hex literals inside
//   JSX inline style objects and string-attribute values, subtract palette
//   matches + allow-marked lines, fail if total > BASELINE.
//
// Scan patterns:
//   (a) `style={{` -> multi-line-safe scan until matching `}}` -> any `#XXXXXX`
//   (b) JSX string attributes named in HEX_ATTR set: `stroke="#XXXXXX"` etc.
//   (c) Palette hexes always pass. `palette-allow:<reason>` marker exempts
//       a line (same as check-hex-color-areas.mjs).
//
// Opt-out marker: `palette-allow:<short-kebab-reason>` on same line OR any of
// the 5 lines directly above (wider than check-hex-color-areas.mjs because
// multi-line JSX style objects put the hex several lines below the tag).
//
// Excluded files: same as check-hex-color-areas.mjs (narrative docs).

import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");

const PALETTE = new Set([
  "#0a0a0a",
  "#c9a961",
  "#8a7340",
  "#ffffff",
  "#9a9a9a",
  "#b83a2e",
]);

const EXCLUDED_FILES = new Set([
  "src/components/dashboard/WhatShippedTodayBanner.tsx",
]);

// JSX string attributes that legitimately take a color. Matched as
// `<attr>="#XXXXXX"` in a JSX opening tag context.
const HEX_ATTR_NAMES = [
  "stroke",
  "fill",
  "color",
  "background",
  "backgroundColor",
  "borderColor",
  "outlineColor",
];

// Baseline captured 2026-07-08 during the wave-27 initial sweep. Landing
// carries 7 legacy non-palette hexes (ApexLeadsSection + InstagramGrowth);
// every other tree is at 0 and locks forever.
const AREAS = [
  { dir: "src/pages", baseline: 0 },
  { dir: "src/components/landing", baseline: 7 },
  { dir: "src/components/dashboard", baseline: 0 },
  { dir: "src/components/layout", baseline: 0 },
  { dir: "src/components/ui", baseline: 0 },
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

const HEX_RX = /#([0-9a-fA-F]{6})\b/g;
const ALLOW_RX = /palette-allow/;

const HEX_ATTR_RX = new RegExp(
  `\\b(?:${HEX_ATTR_NAMES.join("|")})\\s*=\\s*"#([0-9a-fA-F]{6})"`,
  "g",
);

// Match `style={{` and return start indices to seed the object-literal scan.
const STYLE_OPEN_RX = /style\s*=\s*\{\{/g;

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

// Given a source string and the index of the `{{` inside `style={{`, walk
// forward with a brace depth counter until depth returns to 0 (matching the
// closing `}}`). Returns [start, end) — inclusive of the opening `{{`,
// exclusive of the closing `}}`. Falls back to end-of-file on runaway.
function findStyleObjectRange(src, openIdx) {
  // openIdx points at the first `{`; we know `{{` starts here.
  let depth = 0;
  let inStr = null; // "'" | '"' | "`"
  let i = openIdx;
  for (; i < src.length; i++) {
    const ch = src[i];
    const prev = i > 0 ? src[i - 1] : "";
    if (inStr) {
      if (ch === inStr && prev !== "\\") inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inStr = ch;
      continue;
    }
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return [openIdx, i + 1];
    }
  }
  return [openIdx, src.length];
}

function offsetToLine(src, offset) {
  let line = 1;
  for (let i = 0; i < offset && i < src.length; i++) if (src[i] === "\n") line += 1;
  return line;
}

function getLine(src, lineNum) {
  const lines = src.split("\n");
  return lines[lineNum - 1] || "";
}

function getLookbackWindow(src, lineNum, span = 5) {
  const lines = src.split("\n");
  const start = Math.max(0, lineNum - 1 - span);
  return lines.slice(start, lineNum - 1);
}

function scanFileHexHits(src) {
  const hits = []; // { offset, hex }

  // (a) Every `style={{ ... }}` object literal.
  STYLE_OPEN_RX.lastIndex = 0;
  let m;
  while ((m = STYLE_OPEN_RX.exec(src)) !== null) {
    const openIdx = m.index + m[0].length - 2; // point at `{{`
    const [start, end] = findStyleObjectRange(src, openIdx);
    const slice = src.slice(start, end);
    HEX_RX.lastIndex = 0;
    let h;
    while ((h = HEX_RX.exec(slice)) !== null) {
      hits.push({ offset: start + h.index, hex: `#${h[1].toLowerCase()}` });
    }
    STYLE_OPEN_RX.lastIndex = end;
  }

  // (b) JSX string attributes on the HEX_ATTR whitelist.
  HEX_ATTR_RX.lastIndex = 0;
  while ((m = HEX_ATTR_RX.exec(src)) !== null) {
    hits.push({ offset: m.index, hex: `#${m[1].toLowerCase()}` });
  }

  return hits;
}

function scanArea({ dir, baseline }) {
  const absDir = path.join(repoRoot, dir);
  const files = walk(absDir);
  const drift = [];
  let allowed = 0;
  let paletteMatches = 0;
  for (const file of files) {
    const rel = path.relative(repoRoot, file);
    if (EXCLUDED_FILES.has(rel)) continue;
    const src = fs.readFileSync(file, "utf8");
    const hits = scanFileHexHits(src);
    for (const hit of hits) {
      const lineNum = offsetToLine(src, hit.offset);
      const line = getLine(src, lineNum);
      const lookback = getLookbackWindow(src, lineNum, 5);
      if (PALETTE.has(hit.hex)) {
        paletteMatches += 1;
        continue;
      }
      if (ALLOW_RX.test(line) || lookback.some((l) => ALLOW_RX.test(l))) {
        allowed += 1;
        continue;
      }
      drift.push({
        file: rel,
        line: lineNum,
        hex: hit.hex,
        snippet: line.trim().slice(0, 140),
      });
    }
  }
  return { dir, baseline, count: drift.length, allowed, paletteMatches, drift };
}

let anyFailed = false;
for (const area of AREAS) {
  const result = scanArea(area);
  if (result.count <= result.baseline) {
    console.log(
      `✓ check:hex-in-jsx-style — ${result.dir} ${result.count}/${result.baseline} non-palette hex instances (palette: ${result.paletteMatches}, allow-marked: ${result.allowed})`,
    );
    continue;
  }
  anyFailed = true;
  console.error(
    `\n✗ check:hex-in-jsx-style — ${result.dir} ${result.count} non-palette hex instances exceeds baseline ${result.baseline} (Δ +${result.count - result.baseline})\n`,
  );
  console.error("The Brand Bible (ch 6 + 9 + 19) locks the palette to 6 hex colors:");
  console.error("  #0A0A0A bg | #C9A961 accent | #8A7340 deep");
  console.error("  #FFFFFF text | #9A9A9A mid  | #B83A2E alert");
  console.error("Hex literals leaked into JSX inline style objects or string attributes.");
  console.error("Either:");
  console.error("  (a) Replace with the closest palette hex or an apex-* Tailwind class, OR");
  console.error("  (b) Tag the line with `palette-allow:<reason>` for 3rd-party brand hues (IG pink, FB blue, X teal).");
  console.error("\nNewest hits (showing first 12):");
  const overflow = result.drift.slice(-12);
  for (const h of overflow) {
    console.error(`  ${h.file}:${h.line}  ${h.hex}`);
    console.error(`    ${h.snippet}`);
  }
  console.error(
    `\nIf 3+ truly justified non-palette hexes are landing in this PR, bump the ${result.dir} baseline in scripts/check-hex-in-jsx-style.mjs.`,
  );
  console.error("Otherwise fix them or add palette-allow markers — do not just remove the check.");
}

process.exit(anyFailed ? 1 : 0);
