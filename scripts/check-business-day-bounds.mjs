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
import { existsSync } from "node:fs";
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

let failed = 0;
for (const tz of ZONES) {
  const run = spawnSync(
    "npx",
    ["vitest", "run", "--reporter=basic", TEST_FILE],
    { cwd: repoRoot, env: { ...process.env, TZ: tz }, encoding: "utf8" },
  );
  const out = `${run.stdout ?? ""}${run.stderr ?? ""}`;

  // A run that passed but executed nothing is not evidence. Require a positive
  // test count before believing exit code 0.
  const passed = Number(out.match(/Tests\s+(\d+)\s+passed/)?.[1] ?? 0);

  if (run.status === 0 && passed > 0) {
    console.log(`ok    ${tz.padEnd(17)} ${passed} assertions swept 24 hourly instants`);
    continue;
  }

  failed++;
  if (run.status === 0) {
    console.error(`FAIL  ${tz.padEnd(17)} exited 0 but no test count was observed — treating as unproven, not as a pass.`);
  } else {
    console.error(`FAIL  ${tz.padEnd(17)} business-day bounds are wrong in this timezone.`);
    for (const line of out.split("\n").filter((l) => /AssertionError|expected|→|✕/.test(l)).slice(0, 6)) {
      console.error(`      ${line.trim()}`);
    }
  }
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
