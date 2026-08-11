#!/usr/bin/env node
// wave-tsc-gate-cost (2026-08-11): assert the repo still HAS an authoritative
// type-check, after this wave made the local one fast-but-fallible.
//
// WHY THIS EXISTS
//
//   The root tsconfig.json has `files: []` and only project-references, so
//   `npx tsc --noEmit` exits 0 in ~28s having checked ZERO files. The only
//   real type-check in this repo is check:tsc-error-count's
//   `tsc -b --noEmit --force`.
//
//   Measured 2026-08-11 at b7ecc0b5, that full rebuild costs ~11-12.5 MINUTES
//   while the script's own header advertised "~10-15s" and the CI workflow's
//   advertised "~50s" against a measured 481-640s. A gate priced at 1/50th of
//   its real cost trains the operator to abandon commits mid-flight: MP-274
//   did exactly that, leaving a wave staged-but-uncommitted for an hour while
//   its edge function was already live in prod.
//
//   Dropping --force does not make it cheap either: 845.6s incremental vs
//   881.5s forced, same 229 errors — 4.1% saved. Neither tsconfig sets
//   composite/incremental, so there is no up-to-date check to short-circuit.
//
//   So the check was removed from .husky/pre-commit entirely and
//   .github/workflows/verify-core.yml became the SOLE authority: full --force
//   rebuild on every push to main and every PR, from a cold actions/checkout
//   where no stale cache can exist.
//
//   That leaves exactly one way for this repo to silently stop being
//   type-checked: an edit to the workflow. Narrow verify-core.yml's triggers,
//   drop verify:core from it, mark it continue-on-error, or drop
//   check:tsc-error-count out of the verify:core chain, and there is no
//   type-check anywhere — and NOTHING WOULD GO RED. `npx tsc --noEmit` would
//   keep exiting 0, as it always has, on zero files. That is the precise shape
//   of every fake-success bug in this codebase's history.
//
//   This guard makes that edit loud. It asserts the authority chain end to
//   end, from the workflow trigger down to the --force flag.
//
// Reads only the working tree. No network, no DB, no git history.

import fs from "node:fs";
import path from "node:path";

const repoRoot = path.resolve(import.meta.dirname, "..");
const read = (p) => fs.readFileSync(path.join(repoRoot, p), "utf8");

const failures = [];
const checks = [];

function assert(ok, label, detail) {
  checks.push({ ok, label });
  if (!ok) failures.push(`${label}\n    ${detail}`);
}

// ---------- Link 1: the workflow still fires on push AND pull_request ----------
let wf = "";
try {
  wf = read(".github/workflows/verify-core.yml");
} catch {
  failures.push(
    "verify-core.yml is MISSING\n    The authoritative type-check workflow no longer exists, and since 2026-08-11 " +
      "pre-commit does not run one either. The repo now has NO type-check at all.",
  );
}

if (wf) {
  // Strip comments so a mention inside prose can't satisfy a structural check.
  const code = wf
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("#"))
    .join("\n");

  const onBlock = code.slice(
    code.indexOf("\non:"),
    code.indexOf("\njobs:") === -1 ? undefined : code.indexOf("\njobs:"),
  );

  assert(
    /\bpush:/.test(onBlock) && /branches:\s*\[[^\]]*\bmain\b/.test(onBlock),
    "verify-core.yml no longer runs on push to main",
    "This is the only place the type-check runs. Nothing checks types at commit time any more.",
  );

  assert(
    /\bpull_request:/.test(onBlock),
    "verify-core.yml no longer runs on pull_request",
    "PRs would merge without an authoritative type-check.",
  );

  assert(
    /run:\s*npm run verify:core/.test(code),
    "verify-core.yml no longer runs `npm run verify:core`",
    "That command is the only thing invoking the authoritative type-check in CI.",
  );

  // A workflow that always succeeds is the same as no workflow. This repo has
  // already shipped that exact bug: `continue-on-error: true` made GitHub
  // record a FAILED step's conclusion as "success" for 8 days (2026-08-07).
  assert(
    !/continue-on-error:\s*true/.test(code),
    "verify-core.yml has continue-on-error: true",
    "A step that cannot fail cannot gate anything. GitHub reports such a step's conclusion as success — this repo lost 8 days of deploys to that exact flag.",
  );
}

// ---------- Link 2: verify:core still includes the type-check ----------
const pkg = JSON.parse(read("package.json"));
const verifyCore = pkg.scripts?.["verify:core"] ?? "";

assert(
  verifyCore.includes("check:tsc-error-count"),
  "verify:core no longer includes check:tsc-error-count",
  "CI would run verify:core and never type-check. `npx tsc --noEmit` at the root exits 0 without checking a single file, so nothing else covers this.",
);

assert(
  (pkg.scripts?.["check:tsc-error-count"] ?? "").includes(
    "check-tsc-error-count.mjs",
  ),
  "the check:tsc-error-count npm script is missing or no longer points at the gate",
  "CI resolves the type-check through this script name; verify:core cannot reach it any other way.",
);

// ---------- Link 3: the gate still does a full, authoritative rebuild ----------
const gate = read("scripts/check-tsc-error-count.mjs");

assert(
  /npx tsc -b --noEmit --force/.test(gate),
  "check-tsc-error-count.mjs no longer issues `tsc -b --noEmit --force`",
  "Without --force the graph is judged from .tsbuildinfo, which this file's own 2026-07-27 note records reporting phantom counts in both directions. --force is what makes the CI answer authoritative.",
);

assert(
  /const BASELINE = \d+/.test(gate),
  "check-tsc-error-count.mjs no longer declares a numeric BASELINE",
  "Without a baseline the ratchet cannot fail, and a gate that cannot fail is not a gate.",
);

// ---------- report ----------
if (failures.length) {
  console.error(
    `\n✗ check:typecheck-authority — ${failures.length} broken link(s) in the type-check authority chain\n`,
  );
  failures.forEach((f) => console.error("  • " + f + "\n"));
  console.error(
    "The repo's ONLY real type-check is check:tsc-error-count's `tsc -b --noEmit --force`.",
  );
  console.error(
    "`npx tsc --noEmit` at the root exits 0 without checking any file (tsconfig has `files: []`).",
  );
  console.error(
    "Since 2026-08-11 it does NOT run at commit time — locally it costs 881s (measured),",
  );
  console.error(
    "and a 15-minute hook trained operators to abandon commits mid-gate. CI carrying it",
  );
  console.error("is what makes that trade safe. Restore the chain above.\n");
  process.exit(1);
}

console.log(
  `✓ check:typecheck-authority — ${checks.length}/${checks.length} links intact ` +
    "(verify-core.yml on push+PR → verify:core → check:tsc-error-count → tsc -b --force)",
);
process.exit(0);
