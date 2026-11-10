/**
 * Type declarations for build-landing-css.mjs.
 *
 * WHY THIS EXISTS (2026-11-10, Website Integrity Bot)
 * vite.config.ts imports this .mjs helper (since 14824541, 2026-06-09), and
 * because the module had no declaration, `tsc -b` surfaced
 *   vite.config.ts(11,8): TS7016 — implicitly has an 'any' type
 * under the tsconfig.node project. That single error pushed the graph count to
 * 72 against the baseline 71 and held verify:core's check:tsc-error-count RED
 * on main (first failing run 42910310212, the onboarding-integrate merges).
 * This sidecar types the exports so the import is sound — a real fix, not a
 * baseline bump (raising BASELINE is forbidden; see check-tsc-error-count.mjs).
 *
 * Signatures mirror scripts/build-landing-css.mjs exactly. If that file's
 * exports change, update this declaration in the same commit.
 */
export const LANDING_CSS_CONFIG: string;
export const LANDING_CSS_INPUT: string;
export const LANDING_CSS_CEILING_GZ: number;
export const REPO_ROOT: string;

/** Human-readable byte size, e.g. "15.29 KB" or "842 B". */
export function fmtBytes(n: number): string;

/**
 * Emit landing.css to `outPath` via the tailwind CLI. Throws on CLI failure.
 * Returns the written path plus raw/gzip sizes and elapsed build time (ms).
 */
export function buildLandingCss(outPath: string): {
  outPath: string;
  raw: number;
  gz: number;
  elapsed: number;
};
