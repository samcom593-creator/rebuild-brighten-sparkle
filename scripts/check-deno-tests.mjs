#!/usr/bin/env node
/**
 * MP-421 — run the edge-function Deno tests. Nothing did.
 *
 * THE BUG THIS EXISTS FOR: five test files live under supabase/functions
 * (_shared/header-safe, like-escape, nanp-phone, resolve-one, slack-verify).
 * Measured 2026-09-04: the ONLY references to any of them anywhere in the repo
 * are the `// Run: deno test ...` comments inside the files themselves. Not in
 * package.json, not in .husky, not in any workflow. 28 assertions, executed by
 * no route at all.
 *
 * That is MP-351's class ("24 security contracts were guarded by a script
 * nothing ran"), and it was already load-bearing: MP-420 shipped
 * nanp-phone.parity.test.ts one day earlier and its header says the parity
 * assertions exist "so the browser copy and the Deno copy cannot drift apart".
 * They could drift freely. A contract in a comment is not a contract.
 *
 * WHY DISCOVERY AND NOT A LIST: a hardcoded set of paths is a set that goes
 * stale the first time someone adds a sixth test, and it goes stale silently --
 * the run stays green while coverage shrinks. This walks the tree.
 *
 * TWO WAYS THIS REFUSES TO PASS VACUOUSLY, both of them failure modes this
 * repo has actually paid for:
 *   - deno missing  -> FAIL, never skip. A check that silently no-ops when its
 *     tool is absent is the guard-run-by-nothing it was written to end.
 *   - zero files    -> FAIL. MP-399's dead filter printed green for its whole
 *     life because its predicate matched no rows; a confident zero is not a
 *     pass.
 *
 * --no-check is deliberate and is explained at the top of nanp-phone.test.ts:
 * that file imports the browser copy of the phone rule, and Deno's type-checker
 * rejects src/lib/phone.ts on window.matchMedia. Runtime behaviour is the only
 * thing a drift between two copies shows up in. src/ is type-checked by
 * check:tsc-error-count.
 */
import { execFileSync, spawnSync } from "node:child_process";

const probe = spawnSync("deno", ["--version"], { encoding: "utf8" });
if (probe.error || probe.status !== 0) {
  console.log("check:deno-tests — deno is NOT available.");
  console.log(
    "  These tests are the only executable proof for the edge-function shared\n" +
    "  primitives. Skipping them silently is the exact defect this check was\n" +
    "  written to end, so this is a failure, not a skip.\n" +
    "  Install: https://deno.land  (CI: denoland/setup-deno, wired in verify-core.yml)",
  );
  process.exit(1);
}

// --others --exclude-standard on purpose: `git ls-files` alone lists only
// TRACKED files, so a test file that exists on disk but has not been staged yet
// is invisible to it. That was not theoretical -- this check's own first run
// reported 5 files while 6 were present, silently omitting the one written
// minutes earlier. Including untracked files can only ever run MORE tests, so
// it cannot manufacture a green. (MP-403 moved a WIRING verdict onto the index
// for the opposite reason: there, an untracked guard was the defect.)
const files = [
  ...new Set(
    execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "supabase/functions/**/*.test.ts"],
      { encoding: "utf8" },
    ).split("\n").filter(Boolean),
  ),
].sort();

if (files.length === 0) {
  console.log("check:deno-tests — found ZERO test files under supabase/functions.");
  console.log("  A discovery that matches nothing is a broken discovery, not a clean run.");
  process.exit(1);
}

console.log(
  `check:deno-tests — ${probe.stdout.split("\n")[0]}; ${files.length} test file(s):`,
);
for (const f of files) console.log(`  ${f}`);

const run = spawnSync(
  "deno",
  ["test", "--no-check", "--allow-read", "--quiet", ...files],
  { encoding: "utf8", stdio: "inherit" },
);
if (run.status !== 0) {
  console.log("\ncheck:deno-tests FAILED — see the assertion above.");
  process.exit(1);
}
console.log(`\nOK — ${files.length} Deno test file(s) passed.`);
