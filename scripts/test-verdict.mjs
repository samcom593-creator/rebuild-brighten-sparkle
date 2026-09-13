#!/usr/bin/env node
// test-verdict — MP-526 (2026-09-13). The honest local verdict of the unit suite.
//
// THE BUG THIS ENDS: on 2026-09-12 and 2026-09-13 two consecutive waves
// (MP-524 `fb8bb0ca`, MP-525 `c8af1b51`) reported "suite 1074 passed" as part
// of their ship receipt. Measured this run, the true local state was:
//
//     Test Files  1 failed | 110 passed (111)
//          Tests  1 failed | 1074 passed | 6 todo (1081)
//     EXIT=1
//
// 1074 is a REAL number. It is also the passed-count of a RED suite. Quoting it
// as the verdict is the operand error this repo has paid for repeatedly: a
// correct number under a false sentence (the $2,336,292.84 InsuraCloud phantom,
// MP-380's reach clause asserting its conclusion on the evidence that refutes
// it). The receipt read the count and never the exit code — the same slip
// already recorded twice in this bot's own memory: "caught myself reading
// EXIT=0 off a `| tail -3` pipeline instead of the script", and MP-327's
// "nearly read a FAILED type-check as green off a `| tail` exit code".
//
// So the headline of this script is the VERDICT, never a count. A count is
// printed only underneath a word that grades it.
//
// WHY A RED LOCAL SUITE IS NOT AUTOMATICALLY A RED COMMIT: this box runs
// several workers against ONE checkout. The single failing file today is
// src/tests/pages/recoveryCommandContract.test.ts — untracked AND unstaged,
// another worker's in-flight tree, in nobody's index. CI checks out HEAD, so
// that file does not exist there and all three gates on c8af1b51 were
// genuinely green. Grading this worker's commit on it would make the suite
// permanently red on work that is not this worker's to adjudicate, and a
// permanently-red gate is one everybody learns to skip (apex-doctor Check #19's
// own header, and the six costumes of that disease in this ledger).
//
// The split therefore uses uncommittablePaths() from scripts/lib/committable.mjs
// — MP-457's rule, SINGLE-SOURCED so this and the four guards that already use
// it cannot drift the way curl's --max-time and fn_agentlink_reap_stuck did.
// Staged-but-untracked counts as committable: it is going into a commit.
//
// AND IT IS NEVER SILENT ABOUT WHAT IT SKIPPED. Quietly dropping another
// worker's real defect is the fake-success disease wearing a politeness
// costume. Skipped failures are named, with their assertion, every run.
//
// REFUSES TO VOUCH (MP-399): if the run produced no parsable report, or
// reported zero test files, or exited non-zero with no failing test to explain
// it (a crash, an unhandled rejection, a missing binary), this exits non-zero
// with a REFUSAL. A guard that returns a confident wrong zero is worse than no
// guard, because it is believed.
//
// IT IS NOW `npm test` ITSELF (MP-527). MP-526 shipped this script beside the
// command it was written to replace and left the default pointed at the unsafe
// one: `npm test` ("vitest run") is what README:32 documents, what
// verify-core.yml:102 runs, and what check-unit-tests-wired.mjs grades — so
// reaching the honest verdict required knowing to type a different command.
// Measured on the same tree the same day, the two disagreed: `npm test` printed
// "1074 passed" and EXIT=1; `npm run test:verdict` printed SUITE GREEN and
// EXIT=0. The misleading one was the default, the documented one, and the
// guarded one.
//
// MP-526's stated reason for staying out of CI was correct and is preserved:
// CI checks out HEAD, so uncommittablePaths() is EMPTY there by construction
// and this script's verdict is byte-for-byte the bare runner's. It is wired now
// not to change CI but so that ONE command answers "did the suite pass" in both
// places — two commands for one question is how curl's --max-time and
// fn_agentlink_reap_stuck drifted. That the skip is not a blanket exemption is
// proven, not asserted: MP-526's M2 staged the same failing file and the notice
// became a RED verdict. `npm run test:raw` is the bare runner, kept for when
// someone needs vitest's own output; nothing grades on it.

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, rmSync, mkdtempSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import { uncommittablePaths } from "./lib/committable.mjs";

const root = process.cwd();
const args = process.argv.slice(2);
const jsonDir = mkdtempSync(resolve(tmpdir(), "test-verdict-"));
const jsonPath = resolve(jsonDir, "results.json");

const refuse = (why) => {
  console.error(`\n  REFUSED TO VOUCH — ${why}`);
  console.error("  This is not a green suite. It is a suite whose result could not be read.\n");
  rmSync(jsonDir, { recursive: true, force: true });
  process.exit(2);
};

// ── 1. Run the suite. Its exit code is evidence, not the whole verdict ───────
let runExit = 0;
try {
  execFileSync(
    "npx",
    ["vitest", "run", "--reporter=basic", "--reporter=json", `--outputFile.json=${jsonPath}`, ...args],
    { cwd: root, stdio: "inherit" },
  );
} catch (error) {
  runExit = typeof error.status === "number" ? error.status : 1;
  if (error.status === null || error.status === undefined) {
    refuse(`vitest did not exit normally (${error.message}).`);
  }
}

// ── 2. Read the structured report, or refuse ────────────────────────────────
if (!existsSync(jsonPath)) {
  refuse(`vitest wrote no JSON report to ${jsonPath} (exit ${runExit}).`);
}
let report;
try {
  report = JSON.parse(readFileSync(jsonPath, "utf8"));
} catch (error) {
  refuse(`the JSON report did not parse (${error.message}).`);
}
rmSync(jsonDir, { recursive: true, force: true });

const fileResults = Array.isArray(report.testResults) ? report.testResults : [];
if (fileResults.length === 0) {
  refuse(`the report contains zero test files — the include glob matched nothing (exit ${runExit}).`);
}

// ── 3. Split the failures on committability ─────────────────────────────────
const rel = (p) => String(p ?? "").replace(`${root}/`, "").split("\\").join("/");
const skip = uncommittablePaths(root);

const failedFiles = [];
for (const file of fileResults) {
  const failures = (file.assertionResults ?? []).filter((a) => a.status === "failed");
  const fileFailed = file.status === "failed" || failures.length > 0;
  if (!fileFailed) continue;
  failedFiles.push({
    path: rel(file.name),
    failures: failures.map((a) => a.fullName || a.title),
    message: file.message || "",
  });
}

const graded = failedFiles.filter((f) => !skip.has(f.path));
const notices = failedFiles.filter((f) => skip.has(f.path));

const totals = fileResults.reduce(
  (acc, f) => {
    for (const a of f.assertionResults ?? []) {
      if (a.status === "passed") acc.passed++;
      else if (a.status === "failed") acc.failed++;
      else acc.todo++;
    }
    return acc;
  },
  { passed: 0, failed: 0, todo: 0 },
);

// ── 4. A non-zero exit with nothing to explain it is a crash, not a pass ────
if (runExit !== 0 && failedFiles.length === 0) {
  refuse(
    `vitest exited ${runExit} but the report names no failing test. That is a crash, ` +
    "an unhandled rejection, or a runner fault — not 0 failures.",
  );
}

// ── 5. Verdict first. Counts only underneath a word that grades them ────────
const line = "─".repeat(72);
console.log(`\n${line}`);

if (notices.length > 0) {
  console.log(`  NOTICE — ${notices.length} failing file(s) are UNTRACKED and UNSTAGED:`);
  console.log("  another worker's in-flight tree, in no commit, absent from CI's checkout.");
  console.log("  Not graded here. Named so they are never silently dropped:\n");
  for (const f of notices) {
    console.log(`    ${f.path}`);
    for (const name of f.failures) console.log(`      ✗ ${name}`);
  }
  console.log("");
}

if (graded.length > 0) {
  console.log(`  SUITE RED — ${graded.length} failing file(s) in committable code:\n`);
  for (const f of graded) {
    console.log(`    ${f.path}`);
    for (const name of f.failures) console.log(`      ✗ ${name}`);
    if (f.message && f.failures.length === 0) console.log(`      ✗ ${f.message.split("\n")[0]}`);
  }
  console.log(`\n  ${totals.passed} passed / ${totals.failed} failed / ${totals.todo} todo`);
  console.log("  Do NOT quote the passed count as a green suite.");
  console.log(`${line}\n`);
  process.exit(1);
}

console.log("  SUITE GREEN for everything this commit can carry.");
console.log(`  ${totals.passed} passed / ${totals.failed} failed / ${totals.todo} todo` +
  (notices.length > 0 ? `  (${totals.failed} failure(s) all in untracked, unstaged files above)` : ""));
console.log(`${line}\n`);
process.exit(0);
