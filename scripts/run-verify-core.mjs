#!/usr/bin/env node
// MP-456: run every link of the verify:core chain and report EVERY failure.
//
// THE DEFECT THIS REMOVES
// ----------------------
// `verify:core` is a single 80-link `&&` chain. `&&` short-circuits, so the
// run stops at the FIRST red check and the remaining links never execute.
// The log then names one failure, and the operator reads "one thing is wrong"
// when the true answer is unknown — every check after the failure is UNRUN,
// not passing. On 2026-09-06 that masked 26 checks across 6 commits / 7.3h
// (see scripts/check-credential-minting.mjs:189). The sweep afterwards proved
// only 2 were red and both benign, so the incident cost was zero — this is
// shipped as a structural fix, NOT dressed up as a near-miss.
//
// WHY THE EARLIER DEFERRAL WAS WRONG
// ----------------------------------
// MP-454 deferred this, reasoning that "~20 of the checks run AFTER
// `npm run build` and some read dist/, so a naive run-them-all reports
// cascading noise when the build fails." MEASURED, that is false in both
// directions: all 22 post-build links pass with NO dist/ present at all
// (proven in a clean `git clone` of HEAD with dist/ absent, 21/21 then 22/22).
// The one link a grep for "dist" flagged, check:ilike-user-input, matches
// because it EXCLUDES dist/ from its walk. Nothing in the chain consumes the
// build output, so continuing past a red link produces no cascading noise.
//
// The first fixture I built for that measurement was a `git archive` extract,
// which is not a git repository. Six checks failed on `git ls-files`, not on
// dist/, and reading those failures rather than counting them is the only
// reason this file exists. That is MP-403's recorded trap, reproduced.
//
// SINGLE SOURCE OF TRUTH
// ----------------------
// The ordered check list is NOT duplicated here. It is parsed out of
// package.json's `verify:core` at run time, so a check added to that chain is
// picked up automatically and cannot be silently dropped from this runner.
// check:verify-core-nonmasking grades that this file and CI stay honest.
//
// COST, STATED HONESTLY
// ---------------------
// A red run now pays the FULL chain instead of exiting early, because "which
// other checks are also red" is the question this exists to answer. Green runs
// are unchanged. check:tsc-error-count dominates either way.

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const chain = pkg.scripts?.["verify:core"];

if (typeof chain !== "string" || chain.trim() === "") {
  console.error("✗ run-verify-core — REFUSING TO VOUCH: package.json has no verify:core script.");
  console.error("  This runner derives its list from that chain. With no chain there is no list,");
  console.error("  and exiting 0 here would report a gate that ran ZERO checks as green.");
  process.exit(1);
}

// Refuse to guess. If the chain ever grows a separator this parser does not
// model (`||`, `;`, `&`, subshells), a best-effort split would silently drop
// or merge links and this runner would vouch for checks it never ran.
if (/\|\||;|(?<!&)&(?!&)|\$\(|`/.test(chain)) {
  console.error("✗ run-verify-core — REFUSING TO VOUCH: verify:core contains a separator this parser does not model.");
  console.error("  Chain:", chain);
  process.exit(1);
}

const links = chain.split("&&").map((s) => s.trim()).filter(Boolean);
const BAD = links.filter((l) => !/^npm run (--silent )?[A-Za-z0-9:_-]+$/.test(l));
if (BAD.length) {
  console.error("✗ run-verify-core — REFUSING TO VOUCH: unparseable link(s) in verify:core:");
  for (const b of BAD) console.error("   ", JSON.stringify(b));
  process.exit(1);
}

console.log(`run-verify-core — ${links.length} link(s), running ALL of them (no short-circuit).\n`);

const failures = [];
let idx = 0;
for (const link of links) {
  idx += 1;
  const label = link.replace(/^npm run (--silent )?/, "");
  const started = Date.now();
  const r = spawnSync(link, { cwd: ROOT, shell: true, stdio: "inherit" });
  const secs = ((Date.now() - started) / 1000).toFixed(1);
  const code = r.status === null ? 1 : r.status;
  if (code !== 0) {
    failures.push({ label, code, secs });
    console.log(`\n[${idx}/${links.length}] ✗ ${label} — exit ${code} (${secs}s) — CONTINUING to run the rest\n`);
  } else {
    console.log(`[${idx}/${links.length}] ✓ ${label} (${secs}s)`);
  }
}

console.log("\n" + "=".repeat(72));
if (failures.length === 0) {
  console.log(`✓ verify:core — all ${links.length} link(s) ran and passed. Zero unrun.`);
  process.exit(0);
}
console.log(`✗ verify:core — ${failures.length} of ${links.length} link(s) FAILED. All ${links.length} ran; none were masked.`);
for (const f of failures) console.log(`    ✗ ${f.label} (exit ${f.code}, ${f.secs}s)`);
console.log("=".repeat(72));
process.exit(1);
