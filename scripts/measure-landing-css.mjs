#!/usr/bin/env node
// wave-53a (2026-06-09): MEASURE-ONLY landing CSS extraction.
//
// Runs the standalone Tailwind CLI against tailwind.config.landing.cjs (which
// narrows `content` to the 17 cold-landing files from
// scripts/check-vendor-icons-landing-census.mjs) and reports the resulting
// CSS size — raw + gzipped — against the current cold-landing bundle in
// dist/assets/index-*.css.
//
// Why MEASURE-ONLY: wave-52 recon projected the extraction at -25 to -30KB
// gz cold transfer + LCP -200 to -400ms. The current bundle is 250.7KB raw /
// 38.0KB gz. Before committing 60-90 min to the full extraction (wave-54),
// we need a hard number on what the landing-only CSS actually emits. If it's
// 30KB gz, projection is wrong — kill the wave. If it's 8-12KB gz, proceed
// at high confidence.
//
// Side effects: writes /tmp/wib-landing-css/landing.css. Does NOT touch
// public/, dist/, or any production build path. Safe to run on any commit.
//
// Usage: node scripts/measure-landing-css.mjs
//        Reports to stdout + writes a one-line summary to
//        /tmp/wib-landing-css/SUMMARY.txt for the bot's ledger entry.

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const outDir = "/tmp/wib-landing-css";
const outCss = path.join(outDir, "landing.css");
const summaryPath = path.join(outDir, "SUMMARY.txt");

mkdirSync(outDir, { recursive: true });

// ---------- 1: run tailwind CLI with the landing config ----------
const cli = path.join(repoRoot, "node_modules", ".bin", "tailwindcss");
const cfg = path.join(repoRoot, "tailwind.config.landing.cjs");
const input = path.join(repoRoot, "src", "index.css");

if (!existsSync(cli)) {
  console.error("✗ tailwindcss CLI not found at", cli);
  process.exit(1);
}
if (!existsSync(cfg)) {
  console.error("✗ tailwind.config.landing.cjs not found at", cfg);
  process.exit(1);
}

const t0 = Date.now();
try {
  execFileSync(cli, ["-c", cfg, "-i", input, "-o", outCss, "--minify"], {
    cwd: repoRoot,
    stdio: ["ignore", "ignore", "pipe"],
  });
} catch (err) {
  console.error("✗ tailwindcss CLI failed:");
  console.error(err.stderr?.toString() || err.message);
  process.exit(1);
}
const elapsed = Date.now() - t0;

// ---------- 2: size landing.css ----------
const landingRaw = statSync(outCss).size;
const landingGz = gzipSync(readFileSync(outCss)).length;

// ---------- 3: locate current bundled CSS ----------
const distAssets = path.join(repoRoot, "dist", "assets");
let bundleRaw = 0;
let bundleGz = 0;
let bundleFile = "(no dist/ — run `npm run build` first)";
if (existsSync(distAssets)) {
  const cssFiles = readdirSync(distAssets).filter(
    (f) => f.startsWith("index-") && f.endsWith(".css"),
  );
  if (cssFiles.length > 0) {
    bundleFile = cssFiles[0];
    const p = path.join(distAssets, bundleFile);
    bundleRaw = statSync(p).size;
    bundleGz = gzipSync(readFileSync(p)).length;
  }
}

// ---------- 4: report ----------
const fmt = (n) =>
  n >= 1024 ? `${(n / 1024).toFixed(2)}KB` : `${n}B`;
const pct = (a, b) =>
  b > 0 ? `${(((b - a) / b) * 100).toFixed(1)}%` : "n/a";

const lines = [
  `landing.css (wave-53a measurement, ${elapsed}ms emit):`,
  `  raw:  ${fmt(landingRaw).padStart(8)}  (${landingRaw} bytes)`,
  `  gz:   ${fmt(landingGz).padStart(8)}  (${landingGz} bytes)`,
  ``,
  `current cold-landing bundle (${bundleFile}):`,
  `  raw:  ${fmt(bundleRaw).padStart(8)}  (${bundleRaw} bytes)`,
  `  gz:   ${fmt(bundleGz).padStart(8)}  (${bundleGz} bytes)`,
  ``,
  `projected savings if wave-54 swaps landing CSS path:`,
  `  raw:  ${fmt(bundleRaw - landingRaw)} (-${pct(landingRaw, bundleRaw)})`,
  `  gz:   ${fmt(bundleGz - landingGz)} (-${pct(landingGz, bundleGz)})`,
];
for (const l of lines) console.log(l);

// One-line summary for the ledger
const summary = `landing.css raw=${landingRaw} gz=${landingGz} vs bundle raw=${bundleRaw} gz=${bundleGz} -> gz-savings=${bundleGz - landingGz} (-${pct(landingGz, bundleGz)})`;
writeFileSync(summaryPath, summary + "\n");

// Verdict gate: wave-54 should proceed only if gz savings >= 15KB AND landing
// gz is <= 22KB (well under wave-52's projected 20KB pre-commit guard ceiling).
const savingsGz = bundleGz - landingGz;
let verdict;
if (savingsGz >= 15 * 1024 && landingGz <= 22 * 1024) {
  verdict =
    `✓ wave-54 GREEN — gz savings ${fmt(savingsGz)} >= 15KB and landing gz ${fmt(landingGz)} <= 22KB ceiling.`;
} else if (savingsGz >= 5 * 1024) {
  verdict =
    `⚠ wave-54 YELLOW — gz savings ${fmt(savingsGz)} between 5-15KB; weigh against 60-90 min cost.`;
} else {
  verdict =
    `✗ wave-54 RED — gz savings ${fmt(savingsGz)} < 5KB. Extraction is not worth the architecture cost.`;
}
console.log("");
console.log(verdict);
