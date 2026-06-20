import fs from "node:fs";
import path from "node:path";

// Persistence-mandate guard #2 — fake-success marketing-claim detector.
//
// Companion to check-landing-truth-floor.mjs. That guard catches `??` fallback
// patterns clamping landing_live_stats truth upward. This guard catches the
// older, simpler disease: hardcoded "$150M+ Premium Generated" / "166K+ Lead
// Volume" placeholders that came from a 2026-01-10 gpt-engineer seed
// (commit 114cfd56) and shipped to the public landing for 5 months with zero
// source. Brand-truth violation per Operating Contract non-negotiable #10
// (no fake success).
//
// Any `$NNNM+` / `$NNNK+` / `NNNK+` / `NNN,NNN+` numeric claim inside a
// landing surface must either:
//   (a) appear in ALLOW_LIST below with a one-line justification, or
//   (b) be sourced from a server RPC (landing_live_stats() et al).
// String literals matching the patterns get flagged otherwise.

const repoRoot = path.resolve(import.meta.dirname, "..");

const TRACKED_GLOBS = [
  "src/components/landing",
  "src/pages/Landing.tsx",
  "src/pages/Index.tsx",
];

// Numbers Sam has explicitly authorized on the public landing.
// Add new entries here with a one-line justification when truth grows.
const ALLOW_LIST = new Set([
  "$1M+",     // "writing $1M+ a year" — historical doc'd top producer comp
  "$300K+",   // Override income claim — historical doc'd manager comp
  "$100K+",  // "To reach $100K+ pace" — defensible 6-figures-by-year-1 claim
]);

// Marketing-claim patterns that look like fabricated lifetime/aggregate metrics.
// Conservatively scoped to formats that read as "BIG NUMBER + SUFFIX/PLUS".
// Negative lookbehind on bare patterns so $1M+ doesn't also match 1M+.
const SUSPECT_PATTERNS = [
  /\$\d+M\+/g,             // $150M+
  /\$\d+B\+/g,             // $1B+
  /\$\d{2,}K\+/g,          // $250K+ (allow $5K, $10K-$99K without +)
  /(?<![$\d])\d+M\+/g,      // 150M+ but not the M+ inside $150M+
  /(?<![$\d])\d{2,}K\+/g,  // 166K+ but not the K+ inside $250K+
  /(?<![$\d])\d{1,3},\d{3}\+/g, // 166,000+
];

const violations = [];

function walk(rel) {
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) return [];
  const stat = fs.statSync(abs);
  if (stat.isFile()) return [rel];
  const out = [];
  for (const entry of fs.readdirSync(abs)) {
    const sub = path.join(rel, entry);
    out.push(...walk(sub));
  }
  return out;
}

const FILES = TRACKED_GLOBS.flatMap(walk).filter((p) => /\.(tsx?|jsx?|mdx?)$/.test(p));

for (const rel of FILES) {
  const abs = path.join(repoRoot, rel);
  const src = fs.readFileSync(abs, "utf8");
  const lines = src.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Skip comment-only lines so the justification above remains writable.
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
    for (const pat of SUSPECT_PATTERNS) {
      pat.lastIndex = 0;
      const matches = line.match(pat);
      if (!matches) continue;
      for (const m of matches) {
        if (ALLOW_LIST.has(m)) continue;
        violations.push(
          `${rel}:${i + 1}: hardcoded marketing-claim "${m}" — source it from an RPC, or add to ALLOW_LIST in scripts/check-landing-marketing-claims.mjs with a one-line justification.`,
        );
      }
    }
  }
}

if (violations.length > 0) {
  console.error("check:landing-marketing-claims — landing surfaces ship unsourced marketing numbers:");
  for (const v of violations) console.error("  " + v);
  console.error("");
  console.error("Why this exists: 2026-06-20 found '$150M+ Premium Generated' and '166K+ Lead");
  console.error("Volume' running on the public CareerPathwaySection for 5 months with zero source");
  console.error("(seeded 2026-01-10 by gpt-engineer placeholder, never replaced). Brand-truth");
  console.error("violation per non-negotiable #10 (no fake success). This guard locks future");
  console.error("placeholders out of landing/* surfaces.");
  process.exit(1);
}

console.log(
  `check:landing-marketing-claims OK — ${FILES.length} surfaces scanned, 0 unsourced marketing claims.`,
);
