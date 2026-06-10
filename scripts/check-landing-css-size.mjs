#!/usr/bin/env node
// wave-54a (2026-06-10): pre-commit guard against landing CSS bloat.
//
// Asserts that the Tailwind CSS emitted by tailwind.config.landing.cjs
// (narrow content paths = the 17 cold-landing-reachable files) stays under
// the 20 KB gzipped ceiling. Wave-53a measured the current emit at 15.29 KB
// gz with a 21.81 KB gz projected savings vs the full bundle — this guard
// gives a 5 KB buffer above current and fails the commit if any future
// change drags landing CSS back above 20 KB gz.
//
// Why this guard ships BEFORE wave-54b/c cutover, not after:
//   The cutover replaces the auto-emitted dist/assets/index-*.css with
//   public/landing.css (built via the narrow config). If the narrow config
//   silently broadens — a new content path, a new @layer utility used by
//   landing — landing.css balloons and the wave-54 perf gain evaporates.
//   Guarding the SOURCE (the Tailwind emit) before the cutover means the
//   moment landing.css is the production file, it's already protected.
//
// Trigger conditions (in .husky/pre-commit):
//   - tailwind.config.landing.cjs change (theme/plugins/content drift)
//   - src/index.css change (custom CSS layers, @keyframes, vars)
//   - any landing-reachable file change (new utility classes used)
//   - this script itself
//
// Cost when fired: ~600-900ms (Tailwind CLI on ~17 file content tree).

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const outDir = "/tmp/wib-landing-css";
const outCss = path.join(outDir, "check-landing.css");
const CEILING_GZ = 20 * 1024; // 20 KB hard ceiling (5 KB buffer over wave-53a 15.29 KB baseline)

mkdirSync(outDir, { recursive: true });

const cli = path.join(repoRoot, "node_modules", ".bin", "tailwindcss");
const cfg = path.join(repoRoot, "tailwind.config.landing.cjs");
const input = path.join(repoRoot, "src", "index.css");

if (!existsSync(cli)) {
  console.error("✗ tailwindcss CLI not found at", cli);
  console.error("  Run `npm install` first.");
  process.exit(1);
}
if (!existsSync(cfg)) {
  console.error("✗ tailwind.config.landing.cjs not found at", cfg);
  console.error("  Wave-53a should have shipped this. Did it get deleted?");
  process.exit(1);
}
if (!existsSync(input)) {
  console.error("✗ src/index.css not found at", input);
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

const raw = statSync(outCss).size;
const gz = gzipSync(readFileSync(outCss)).length;

const fmt = (n) =>
  n >= 1024 ? `${(n / 1024).toFixed(2)} KB` : `${n} B`;

console.log(
  `[check:landing-css-size] landing.css emit: raw ${fmt(raw)} / gz ${fmt(gz)} in ${elapsed}ms (ceiling ${fmt(CEILING_GZ)} gz)`,
);

if (gz > CEILING_GZ) {
  console.error("");
  console.error(
    `✗ FAIL: landing.css gzipped size ${fmt(gz)} exceeds ${fmt(CEILING_GZ)} ceiling.`,
  );
  console.error(
    `  This means the narrow landing Tailwind config is sweeping content it shouldn't,`,
  );
  console.error(
    `  or src/index.css picked up an admin-only @layer that landing doesn't need.`,
  );
  console.error("");
  console.error(`  Triage steps:`);
  console.error(
    `    1. Run \`node scripts/measure-landing-css.mjs\` to see the projected savings delta.`,
  );
  console.error(
    `    2. Diff tailwind.config.landing.cjs content paths against tailwind.config.ts.`,
  );
  console.error(
    `    3. Check src/index.css for new @layer rules that should be admin-only.`,
  );
  console.error(
    `    4. If a real landing component needs a heavier utility, raise this ceiling`,
  );
  console.error(
    `       deliberately AND update the wave-53a 21.81 KB gz savings projection.`,
  );
  process.exit(1);
}

console.log(`✓ landing.css under ${fmt(CEILING_GZ)} gz ceiling.`);
