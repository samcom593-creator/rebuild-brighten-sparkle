#!/usr/bin/env node
/**
 * check:business-day-bounds — MP-444
 *
 * Runs src/tests/lib/businessDayBounds.tz.test.ts once per timezone.
 *
 * WHY A DRIVER AND NOT JUST THE TEST FILE
 * ───────────────────────────────────────
 * The bug this guards (a zoned wall-clock Date fed back into a zone formatter,
 * applying the offset twice) is INVISIBLE under TZ=America/Chicago, because the
 * offset delta is zero and the double conversion cancels. A green run in the
 * business timezone therefore proves nothing about the code. It is also only
 * reachable for part of the day — measured before the fix: 0/24 hours broken on
 * Chicago, 1/24 Eastern, 2/24 Phoenix, 5/24 UTC, 14/24 Tokyo. So the guard has
 * to vary BOTH the timezone and the hour, and the test file owns the hours.
 *
 * TIMEZONE SET — each earns its place, none is decorative:
 *   America/Chicago    the business zone; delta 0, the case that hid the bug
 *   America/New_York   east of Chicago — real Apex agents, the smallest live break
 *   America/Phoenix    west of Chicago, no DST — Sam's own laptop
 *   UTC                what CI and every server runtime uses
 *   Asia/Tokyo         a large delta, so a partial regression cannot hide
 *
 * This guard does NOT grade a count of offending sites. A count-only floor is
 * fungible — a regression can be laundered by an unrelated pay-down (MP-356).
 * The contract here is absolute: every assertion passes in every listed zone.
 *
 * EXIT CODES
 *   0  every timezone passed, and each run was observed to execute tests
 *   1  a timezone failed, OR a run could not be verified to have run anything
 *      (a vacuous green is treated as a failure, never as a pass — MP-399)
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TEST_FILE = "src/tests/lib/businessDayBounds.tz.test.ts";
const ZONES = [
  "America/Chicago",
  "America/New_York",
  "America/Phoenix",
  "UTC",
  "Asia/Tokyo",
];

if (!existsSync(path.join(repoRoot, TEST_FILE))) {
  console.error(`FAIL  ${TEST_FILE} is missing — the guard cannot vouch for a tree it never measured.`);
  console.error("      Restore the sweep, or delete this guard deliberately; do not leave it passing on nothing.");
  process.exit(1);
}

const tmp = mkdtempSync(path.join(os.tmpdir(), "bdb-"));
let failed = 0;
try {
  for (const tz of ZONES) {
    const report = path.join(tmp, `${tz.replace(/\//g, "_")}.json`);

    // Read the verdict from the JSON reporter, not from the human one. Under
    // CI=true vitest forces ANSI colour on, so the pretty summary reads
    // "Tests \e[22m \e[1m\e[32m5 passed" — a `Tests\s+(\d+)\s+passed` match
    // silently found nothing and every zone reported "no test count observed".
    // Locally, colour was off when piped and the same regex matched, so the
    // guard was green on this machine and red in CI on the same commit.
    const run = spawnSync(
      "npx",
      ["vitest", "run", "--reporter=json", `--outputFile=${report}`, TEST_FILE],
      { cwd: repoRoot, env: { ...process.env, TZ: tz }, encoding: "utf8" },
    );
    const out = `${run.stdout ?? ""}${run.stderr ?? ""}`;

    let summary = null;
    try {
      const j = JSON.parse(readFileSync(report, "utf8"));
      if (typeof j.numTotalTests === "number") summary = j;
    } catch {
      summary = null; // absent or unparseable — treated as unproven below
    }

    if (run.status === 0 && summary && summary.numPassedTests > 0 && summary.numFailedTests === 0) {
      console.log(`ok    ${tz.padEnd(17)} ${summary.numPassedTests} assertions swept 24 hourly instants`);
      continue;
    }

    failed++;
    if (!summary) {
      // A run that exits 0 having executed nothing is not evidence (MP-399).
      console.error(`FAIL  ${tz.padEnd(17)} no machine-readable verdict was produced — unproven, not a pass.`);
      for (const line of out.split("\n").filter(Boolean).slice(-6)) {
        console.error(`      | ${line.trim()}`);
      }
    } else if (summary.numTotalTests === 0) {
      console.error(`FAIL  ${tz.padEnd(17)} vitest matched 0 tests — the sweep did not run.`);
    } else {
      console.error(`FAIL  ${tz.padEnd(17)} business-day bounds are wrong in this timezone.`);
      const msgs = (summary.testResults ?? [])
        .flatMap((f) => f.assertionResults ?? [])
        .filter((a) => a.status === "failed")
        .flatMap((a) => [a.fullName, ...(a.failureMessages ?? [])]);
      for (const line of msgs.join("\n").split("\n").slice(0, 8)) {
        console.error(`      ${line.trim()}`);
      }
    }
  }
} finally {
  rmSync(tmp, { recursive: true, force: true });
}

if (failed > 0) {
  console.error("");
  console.error(`${failed} of ${ZONES.length} timezone(s) failed.`);
  console.error("Almost always the same root cause: a Date from toBusinessTime()/toZonedTime() —");
  console.error("a shifted wall-clock value, NOT an instant — passed into formatInTimeZone(),");
  console.error("businessDayKey(), fromZonedTime() or .toISOString(), applying the offset twice.");
  console.error("Do the arithmetic in day-key space via shiftBusinessDayKey(), or on the raw instant.");
  process.exit(1);
}

console.log(`ok    business-day bounds hold across ${ZONES.length} timezones x 24 hourly instants`);
