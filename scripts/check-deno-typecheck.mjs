#!/usr/bin/env node
/**
 * MP-543 — type-check the edge functions. Nothing did.
 *
 * THE BUG THIS EXISTS FOR, and it is not hypothetical: 66d59f20 ("remove
 * WhatsApp from the product", 2026-09-07) deleted `export const
 * NTFY_DEFAULT_TOPIC` and left its only use site behind, in the one line that
 * resolves Sam's ntfy topic. `system_settings` has never held an
 * `ntfy_topic_url` row, so that `||` branch is evaluated on EVERY call and an
 * undefined identifier there is an uncaught ReferenceError, not a falsy value.
 * The alert dispatcher's push to the one channel that reaches Sam's pocket
 * threw on every real alert for 8 days. MP-542 found it by hand.
 *
 * PROVEN, not asserted — this check, run against the exact file that shipped
 * (`git show 438a9e2d^:supabase/functions/apex-alert-dispatch/index.ts`):
 *
 *     TS2304 [ERROR]: Cannot find name 'NTFY_DEFAULT_TOPIC'.
 *         url = (data as any)?.value || NTFY_DEFAULT_TOPIC;
 *
 * and clean against the fix. The gate would have caught the real bug at the
 * commit that introduced it. That proof is pinned as a regression test in
 * src/tests/scripts/denoTypecheck.test.ts, so a future edit that stops this
 * script detecting TS2304 fails loudly instead of protecting nothing (MP-274:
 * a guard that restates the rule it guards is not a guard — the test drives
 * THIS file).
 *
 * WHY THE BASELINE IS A SET AND NOT A COUNT. MP-356: a count-only floor is
 * fungible — a real regression sat red for 8 commits and was then absorbed by
 * an unrelated pay-down, and the gate went green having learned nothing. A new
 * failing slug is red here even if two others were fixed in the same commit.
 *
 * WHY THE BASELINE DOES NOT GRANT AMNESTY TO TS2304. A slug-set ratchet alone
 * would let a function already in the baseline acquire an undefined identifier
 * and stay green — the exact class this file exists for, invisible inside its
 * own guard. So "Cannot find name" is graded separately across ALL entrypoints,
 * baselined or not. That tier ships at ZERO (measured: 0 of 228 on
 * 2026-09-16), so it cannot land permanently red.
 *
 * THE INSTRUMENT WAS WRONG BEFORE IT WAS RIGHT, and the number moved: a first
 * census reported 31 failures, 7 of which were `Could not find
 * "@supabase/supabase-js" in a node_modules folder`. Those functions are
 * correct — they import proper `npm:` specifiers. Deno 2 sees this repo's
 * package.json + node_modules and switches to byonm mode, where `npm:` is
 * resolved against node_modules instead of its own cache. That is the local
 * checkout, not the edge runtime, and Supabase resolves `npm:` natively.
 * `--node-modules-dir=none` is therefore load-bearing and not a tuning flag:
 * without it this gate reports 7 healthy functions as broken. 31 -> 25.
 *
 * COST IS MEASURED AND PRINTED, NEVER DOCUMENTED. The repo has already paid
 * for a gate whose header advertised "~10-15s" against a real 881s. This one
 * announces its span up front and prints its own elapsed time; if it gets slow,
 * the number moves on its own.
 *
 * FOUR WAYS IT REFUSES TO PASS VACUOUSLY:
 *   - deno missing        -> FAIL, never skip (MP-351 / check:deno-tests).
 *   - zero entrypoints    -> FAIL. MP-399's dead filter printed green for its
 *                            whole life because its predicate matched nothing.
 *   - spawn error/timeout -> FAIL as UNKNOWN. "I could not look" is never
 *                            laundered into "nothing is wrong".
 *   - baseline names a slug that no longer exists on disk -> FAIL. A baseline
 *                            that rots is the 465 fake-success rows in a JSON
 *                            file (MP-398).
 */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { cpus } from "node:os";
import path from "node:path";

const BASELINE_PATH = "scripts/deno-typecheck-baseline.json";
const WRITE = process.argv.includes("--write-baseline");
const TIMEOUT_MS = 180_000;

const probe = spawnSync("deno", ["--version"], { encoding: "utf8" });
if (probe.error || probe.status !== 0) {
  console.log("check:deno-typecheck — deno is NOT available.");
  console.log(
    "  This is the only type-check any edge function gets. src/ is covered by\n" +
    "  check:tsc-error-count; supabase/functions was covered by nothing at all\n" +
    "  until MP-543, which is how an undefined identifier reached production and\n" +
    "  survived 8 days. Skipping silently is that same defect, so this fails.\n" +
    "  Install: https://deno.land  (CI: denoland/setup-deno, wired in verify-core.yml)",
  );
  process.exit(1);
}

// --others --exclude-standard on purpose, for the reason check:deno-tests
// records: `git ls-files` alone lists only TRACKED files, so a function written
// minutes ago is invisible to it. Checking MORE files can only ever find more
// failures, so it cannot manufacture a green.
const files = [
  ...new Set(
    execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "supabase/functions/*/index.ts"],
      { encoding: "utf8" },
    ).split("\n").filter(Boolean),
  ),
].sort();

if (files.length === 0) {
  console.log("check:deno-typecheck — found ZERO edge-function entrypoints.");
  console.log("  A discovery that matches nothing is a broken discovery, not a clean run.");
  process.exit(1);
}

// The tier-2 predicate, named once so the self-test below and the census can
// never disagree about what "undefined identifier" means.
const SAYS_UNDEFINED_NAME = (out) => /TS2304 |Cannot find name/.test(out);

const slugOf = (f) => path.basename(path.dirname(f));
// POSITIVE CONTROL, run every time, before anything is believed.
//
// Tier 2 is a string match against deno's diagnostic text. A future deno that
// reworded TS2304, or a well-meaning tidy-up of the regex, would leave this
// gate printing a confident green while the one class it exists for walked
// straight past it -- silence reading exactly like a clean instrument. MP-399
// is the recorded cost of a filter that matched nothing for its whole life.
//
// So: compile a file that IS the bug, and a file that is not, and refuse to
// proceed unless the instrument can tell them apart.
function selfTest() {
  const dir = mkdtempSync(path.join(tmpdir(), "deno-typecheck-selftest-"));
  const bad = path.join(dir, "undefined-identifier.ts");
  const good = path.join(dir, "clean.ts");
  writeFileSync(bad, "export const x = MP543_SELFTEST_NEVER_DEFINED;\n");
  writeFileSync(good, "export const x = 1;\n");
  const run = (f) => {
    const r = spawnSync("deno", ["check", "--quiet", "--node-modules-dir=none", f], {
      encoding: "utf8", timeout: 60_000,
    });
    return { status: r.status, out: `${r.stdout || ""}${r.stderr || ""}` };
  };
  const b = run(bad);
  const g = run(good);
  const faults = [];
  if (b.status === 0) faults.push("deno check PASSED a file with an undefined identifier");
  if (!SAYS_UNDEFINED_NAME(b.out)) faults.push("the undefined-identifier predicate did NOT match deno's own diagnostic");
  if (g.status !== 0) faults.push("deno check FAILED a file that is plainly valid");
  if (SAYS_UNDEFINED_NAME(g.out)) faults.push("the predicate matched a clean file -- it would flag everything");
  rmSync(dir, { recursive: true, force: true });
  return faults;
}

const faults = selfTest();
if (faults.length) {
  console.log("check:deno-typecheck — THE INSTRUMENT IS BROKEN, so no verdict is offered.");
  for (const f of faults) console.log(`  - ${f}`);
  console.log(
    "\n  A green from here would mean 'I looked and found nothing', and what it\n" +
    "  would actually mean is 'I cannot see'. Fix SAYS_UNDEFINED_NAME against the\n" +
    "  installed deno's real output before trusting any run of this check.",
  );
  process.exit(1);
}

const CONCURRENCY = Math.max(2, Math.min(8, cpus().length - 2));
const started = Date.now();

console.log(
  `check:deno-typecheck — ${probe.stdout.split("\n")[0].trim()}; ` +
  `${files.length} entrypoint(s), ${CONCURRENCY} at a time.`,
);
console.log(
  "  This compiles every edge function and takes MINUTES, not seconds. The\n" +
  "  elapsed time is printed at the end; it is not documented anywhere, so it\n" +
  "  cannot drift away from what it actually costs.",
);

/** @type {Map<string, {status:string, out:string}>} */
const results = new Map();
let cursor = 0;
async function worker() {
  while (cursor < files.length) {
    const f = files[cursor++];
    const r = spawnSync(
      "deno",
      // --node-modules-dir=none: see the header. Without it, 7 correct
      // functions report as broken because deno resolves npm: against this
      // repo's node_modules instead of its own cache.
      ["check", "--quiet", "--node-modules-dir=none", f],
      { encoding: "utf8", timeout: TIMEOUT_MS },
    );
    const out = `${r.stdout || ""}${r.stderr || ""}`;
    let status;
    if (r.error && r.error.code === "ETIMEDOUT") status = "UNKNOWN";
    else if (r.error) status = "UNKNOWN";
    else if (r.status === 0) status = "PASS";
    else if (r.status === null) status = "UNKNOWN";
    else status = "FAIL";
    results.set(slugOf(f), { status, out });
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

const elapsed = ((Date.now() - started) / 1000).toFixed(1);
const unknown = [...results].filter(([, v]) => v.status === "UNKNOWN").map(([s]) => s).sort();
const failing = [...results].filter(([, v]) => v.status === "FAIL").map(([s]) => s).sort();

// Tier 2, graded across EVERY entrypoint including baselined ones: this is the
// class the gate exists for, and a baseline must not hide it.
const undefinedName = [...results]
  .filter(([, v]) => SAYS_UNDEFINED_NAME(v.out))
  .map(([s]) => s).sort();

if (WRITE) {
  const reasons = Object.fromEntries(failing.map((s) => {
    const codes = [...new Set((results.get(s).out.match(/TS[0-9]+/g) || []))].sort();
    return [s, codes.join(",") || "non-TS"];
  }));
  writeFileSync(BASELINE_PATH, `${JSON.stringify({
    _generated_by: "scripts/check-deno-typecheck.mjs --write-baseline (MP-543)",
    _measured: `${new Date().toISOString().slice(0, 10)} against ${probe.stdout.split("\n")[0].trim()}, ${files.length} entrypoints, --node-modules-dir=none`,
    _rule: "This is a SET, not a count. Any failing slug absent from it is a regression. Any slug here that now PASSES must be deleted from it — the set may only shrink.",
    failing: reasons,
  }, null, 2)}\n`);
  console.log(`\nWROTE ${BASELINE_PATH}: ${failing.length} failing slug(s), ${elapsed}s.`);
  process.exit(0);
}

if (!existsSync(BASELINE_PATH)) {
  console.log(`\ncheck:deno-typecheck — ${BASELINE_PATH} is MISSING.`);
  console.log("  Regenerate deliberately: node scripts/check-deno-typecheck.mjs --write-baseline");
  process.exit(1);
}
const baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
const known = new Set(Object.keys(baseline.failing || {}));

const problems = [];

if (unknown.length) {
  problems.push(
    `COULD NOT LOOK at ${unknown.length} function(s): ${unknown.join(", ")}.\n` +
    "    A check that could not run is not a check that passed. Re-run; if it\n" +
    "    persists, the compile is hanging and that is itself the finding.",
  );
}

const rot = [...known].filter((s) => !results.has(s)).sort();
if (rot.length) {
  problems.push(
    `BASELINE IS STALE — it names ${rot.length} function(s) that no longer exist: ${rot.join(", ")}.\n` +
    "    A baseline that drifts from the tree stops measuring and stays green.\n" +
    `    Fix: delete them from ${BASELINE_PATH}.`,
  );
}

const regressions = failing.filter((s) => !known.has(s));
if (regressions.length) {
  problems.push(
    `NEW type errors in ${regressions.length} edge function(s): ${regressions.join(", ")}.\n` +
    "    These are NOT in the baseline, so they were introduced. Edge functions\n" +
    "    have no other type-check anywhere in this repo. Reproduce one with:\n" +
    `      deno check --node-modules-dir=none supabase/functions/${regressions[0]}/index.ts`,
  );
}

const fixed = [...known].filter((s) => results.get(s)?.status === "PASS").sort();
if (fixed.length) {
  problems.push(
    `${fixed.length} baselined function(s) now PASS: ${fixed.join(", ")}.\n` +
    "    Good — but the set may only shrink, and a baseline nobody prunes is a\n" +
    "    ceiling that quietly becomes a floor. Fix (one command):\n" +
    "      node scripts/check-deno-typecheck.mjs --write-baseline",
  );
}

if (undefinedName.length) {
  problems.push(
    `UNDEFINED IDENTIFIER in ${undefinedName.length} function(s): ${undefinedName.join(", ")}.\n` +
    "    This is graded across EVERY entrypoint, baselined or not, because it is\n" +
    "    the exact class that shipped in 66d59f20 and threw on every real alert\n" +
    "    for 8 days. At runtime this is an uncaught ReferenceError, not a falsy\n" +
    "    value. The baseline does not cover it and cannot be used to silence it.",
  );
}

console.log(
  `\n${results.size} checked in ${elapsed}s — ${results.size - failing.length - unknown.length} pass, ` +
  `${failing.length} fail (${known.size} baselined), ${unknown.length} unknown, ` +
  `${undefinedName.length} with an undefined identifier.`,
);

if (problems.length) {
  console.log("\ncheck:deno-typecheck FAILED:\n");
  for (const p of problems) console.log(`  - ${p}\n`);
  process.exit(1);
}

console.log("OK — no new edge-function type errors, and no undefined identifiers anywhere.");
