#!/usr/bin/env node
// wave-54a (2026-06-10): pre-commit guard against landing CSS bloat.
// wave-54b (2026-06-10): refactored to consume scripts/build-landing-css.mjs
//                         shared lib so the guard and the Vite build emit
//                         use identical (config path, input path, CLI flags).
//
// Asserts that the Tailwind CSS emitted by tailwind.config.landing.cjs
// (narrow content paths = the 17 cold-landing-reachable files) stays under
// the 20 KB gzipped ceiling. Wave-53a measured the current emit at 15.29 KB
// gz with a 21.81 KB gz projected savings vs the full bundle — this guard
// gives a 5 KB buffer above current and fails the commit if any future
// change drags landing CSS back above 20 KB gz.
//
// Why this guard ships BEFORE wave-54c cutover, not after:
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
//   - this script itself, scripts/build-landing-css.mjs (the shared lib)
//
// Cost when fired: ~600-900ms (Tailwind CLI on ~17 file content tree).

import path from "node:path";
import {
  buildLandingCss,
  fmtBytes,
  LANDING_CSS_CEILING_GZ,
} from "./build-landing-css.mjs";

const outDir = "/tmp/wib-landing-css";
const outCss = path.join(outDir, "check-landing.css");

let result;
try {
  result = buildLandingCss(outCss);
} catch (err) {
  console.error(`✗ ${err.message}`);
  process.exit(1);
}

const { raw, gz, elapsed } = result;

console.log(
  `[check:landing-css-size] landing.css emit: raw ${fmtBytes(raw)} / gz ${fmtBytes(gz)} in ${elapsed}ms (ceiling ${fmtBytes(LANDING_CSS_CEILING_GZ)} gz)`,
);

if (gz > LANDING_CSS_CEILING_GZ) {
  console.error("");
  console.error(
    `✗ FAIL: landing.css gzipped size ${fmtBytes(gz)} exceeds ${fmtBytes(LANDING_CSS_CEILING_GZ)} ceiling.`,
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

console.log(`✓ landing.css under ${fmtBytes(LANDING_CSS_CEILING_GZ)} gz ceiling.`);
