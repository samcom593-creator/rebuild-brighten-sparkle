import fs from "node:fs";
import path from "node:path";

// wave-26 (2026-07-07) — @ts-ignore / @ts-expect-error / @ts-nocheck guard.
//
// Class-of-fix Round 9. Companion to wave-19 (console-in-prod), wave-21
// (empty-catch-swallow), wave-22 (debugger), wave-24 (empty-catch full
// pay-down 60→0), wave-25 (raw-SQL-in-JSX). Same shape: lock-at-zero
// ratchet with a mandatory opt-out marker + reason.
//
// The failure pattern: a dev hits a type error, drops `// @ts-ignore`
// or `// @ts-expect-error` on the offending line, and moves on. The type
// system is now blind to that line forever. When the underlying types
// change (a Supabase row shape drifts, a hook return type narrows, an
// edge-fn payload gains a field), the suppression stays green while
// prod actually broke. This is the same class of leak as the 465
// fake-success InsuraCloud sync rows (memory:
// project_apex_2026_05_18_insuracloud_auth_dead) and the 198 zombie
// AgentLink rows (memory: project_apex_2026_05_20_agentlink_fake_success):
// the loud alarm was silenced, so nobody noticed the fire.
//
// The fix: any `@ts-ignore` / `@ts-expect-error` / `@ts-nocheck` in
// src/**/*.{tsx,ts,jsx,js} must ship with a `ts-ignore-allow:<reason>`
// marker on the same line or the line directly above. The reason is a
// forcing function — it makes the suppression auditable and gives the
// next maintainer enough context to decide whether the suppression is
// still needed once the underlying types change.
//
// Detection: matches directive-shape only, at start-of-line comment
//   (`\s*//\s*@ts-…\b`) or opening block-comment
//   (`\s*/\*\s*@ts-…\b`). Rejects mentions in string literals,
//   documentation comments narrating the pattern (like this file), and
//   JSON labels in shipped-history data (see EXCLUDE_FILES).
//
// Sites pre-annotated at wave-26 launch:
//   - src/hooks/useIsTouchDevice.ts             (legacy-ie-edge navigator shim)
//   - src/components/landing/HeroSection.tsx    (fetchpriority HTML attr,
//                                                React types lag)
//
// Cost when fired: ~50-100ms (linear in ~520 files, single-pass line scan).

const repoRoot = path.resolve(import.meta.dirname, "..");

const TRACKED_DIRS = ["src"];

const EXCLUDE_FILES = new Set([
  // WhatShippedTodayBanner narrates historical fixes; a shipped-log label
  // that mentions "@ts-ignore" verbatim would false-positive without an
  // opt-out marker, and putting a marker there would be misleading (the
  // label is data, not code).
  "src/components/dashboard/WhatShippedTodayBanner.tsx",
]);

const EXCLUDE_PATTERNS = [
  /\.test\.(tsx?|jsx?)$/,
  /\.spec\.(tsx?|jsx?)$/,
  /__tests__\//,
];

const OPT_OUT_MARKER = /ts-ignore-allow:([^\s*/]+)/;

// Directive shapes we flag:
//   // @ts-ignore
//   // @ts-expect-error
//   // @ts-nocheck
//   /* @ts-ignore */
//   /* @ts-expect-error */
//   /* @ts-nocheck */
// Anchored at start-of-line + optional whitespace so we only catch
// actual TypeScript directives, not documentation prose that happens to
// mention the token.
const DIRECTIVE_RE =
  /^\s*(?:\/\/|\/\*)\s*@ts-(ignore|expect-error|nocheck)\b/;

const TEXT_EXTS = new Set([".tsx", ".ts", ".jsx", ".js"]);

function walk(rel) {
  const abs = path.join(repoRoot, rel);
  if (!fs.existsSync(abs)) return [];
  const stat = fs.statSync(abs);
  if (stat.isFile()) return TEXT_EXTS.has(path.extname(rel)) ? [rel] : [];
  const out = [];
  for (const entry of fs.readdirSync(abs)) {
    if (entry.startsWith(".")) continue;
    out.push(...walk(path.join(rel, entry)));
  }
  return out;
}

function isExcluded(rel) {
  if (EXCLUDE_FILES.has(rel)) return true;
  return EXCLUDE_PATTERNS.some((re) => re.test(rel));
}

function checkFile(rel) {
  const abs = path.join(repoRoot, rel);
  const text = fs.readFileSync(abs, "utf8");
  const lines = text.split("\n");
  const violations = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(DIRECTIVE_RE);
    if (!m) continue;

    // Opt-out marker on same line or line directly above.
    if (OPT_OUT_MARKER.test(line)) continue;
    if (i > 0 && OPT_OUT_MARKER.test(lines[i - 1])) continue;

    violations.push({
      line: i + 1,
      kind: `@ts-${m[1]}`,
      text: line.trim(),
    });
  }

  return violations;
}

let totalFiles = 0;
let totalViolations = 0;
const allViolations = [];

for (const dir of TRACKED_DIRS) {
  for (const rel of walk(dir)) {
    if (isExcluded(rel)) continue;
    totalFiles++;
    const v = checkFile(rel);
    if (v.length > 0) {
      totalViolations += v.length;
      allViolations.push({ rel, v });
    }
  }
}

if (totalViolations > 0) {
  console.error(
    `[check:ts-ignore] FAIL — ${totalViolations} unmarked TypeScript suppression(s) in ${allViolations.length} file(s):`,
  );
  for (const { rel, v } of allViolations) {
    for (const { line, kind, text } of v) {
      console.error(`  ${rel}:${line} [${kind}] ${text}`);
    }
  }
  console.error("");
  console.error("Fix by either:");
  console.error(
    "  1. Fix the underlying type (widen an interface, refine a discriminated",
  );
  console.error(
    "     union, cast at a boundary). Prefer this — a suppression is a leak.",
  );
  console.error(
    "  2. Add an opt-out marker `ts-ignore-allow:<short-reason>` on the",
  );
  console.error(
    "     offending line or the line directly above. Reason is REQUIRED so",
  );
  console.error(
    "     the next maintainer knows why the type system is being told to look",
  );
  console.error("     away.");
  console.error("");
  console.error(
    "Silencing the type system is the same class of leak that produced the",
  );
  console.error(
    "465 fake-success InsuraCloud sync rows and the 198 zombie AgentLink rows.",
  );
  console.error("No fake success.");
  process.exit(1);
}

console.log(
  `[check:ts-ignore] OK — ${totalFiles} files scanned, 0 unmarked TypeScript suppressions.`,
);
