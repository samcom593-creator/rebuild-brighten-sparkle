#!/usr/bin/env node
// wave-54b (2026-06-10): shared landing CSS build library.
//
// Single source of truth for emitting landing.css from
// tailwind.config.landing.cjs + src/index.css. Consumed by:
//   - scripts/check-landing-css-size.mjs (pre-commit gz ceiling guard, wave-54a)
//   - vite.config.ts landingCssBuildPlugin() (build-time emit to public/, wave-54b)
//   - scripts/measure-landing-css.mjs (one-shot measurement, wave-53a)
//
// Why ONE shared function: both the guard and the build emit MUST agree on
// (config path, input path, output flags). If they drift, the guard validates
// one thing but the build ships another — exactly the wave-25-class drift the
// pre-commit gate exists to prevent. Keeping a single buildLandingCss() call
// site means future config changes (raise the ceiling, add a content path,
// swap to JIT mode) update both surfaces in lockstep.
//
// This file is a LIBRARY — it exports functions, it does not run anything on
// import. The Vite plugin and the pre-commit script each invoke buildLandingCss()
// with their own destination paths.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { gzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");

export const LANDING_CSS_CONFIG = path.join(repoRoot, "tailwind.config.landing.cjs");
export const LANDING_CSS_INPUT = path.join(repoRoot, "src", "index.css");
export const LANDING_CSS_CEILING_GZ = 20 * 1024; // 20 KB hard ceiling (5 KB buffer over wave-53a 15.29 KB baseline)
export const REPO_ROOT = repoRoot;

export function fmtBytes(n) {
  return n >= 1024 ? `${(n / 1024).toFixed(2)} KB` : `${n} B`;
}

// Emit landing.css to outPath. Throws on CLI failure. Returns { raw, gz, elapsed }.
export function buildLandingCss(outPath) {
  const cli = path.join(repoRoot, "node_modules", ".bin", "tailwindcss");

  if (!existsSync(cli)) {
    throw new Error(`tailwindcss CLI not found at ${cli} — run \`npm install\` first.`);
  }
  if (!existsSync(LANDING_CSS_CONFIG)) {
    throw new Error(
      `tailwind.config.landing.cjs missing at ${LANDING_CSS_CONFIG} — wave-53a should have shipped this.`,
    );
  }
  if (!existsSync(LANDING_CSS_INPUT)) {
    throw new Error(`src/index.css missing at ${LANDING_CSS_INPUT}`);
  }

  mkdirSync(path.dirname(outPath), { recursive: true });

  const t0 = Date.now();
  try {
    execFileSync(
      cli,
      ["-c", LANDING_CSS_CONFIG, "-i", LANDING_CSS_INPUT, "-o", outPath, "--minify"],
      { cwd: repoRoot, stdio: ["ignore", "ignore", "pipe"] },
    );
  } catch (err) {
    const stderr = err.stderr?.toString() || err.message;
    throw new Error(`tailwindcss CLI failed:\n${stderr}`);
  }
  const elapsed = Date.now() - t0;

  const raw = statSync(outPath).size;
  const gz = gzipSync(readFileSync(outPath)).length;

  return { outPath, raw, gz, elapsed };
}
