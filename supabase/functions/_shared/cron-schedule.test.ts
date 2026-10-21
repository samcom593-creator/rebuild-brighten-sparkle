// PL-WIB-HEALTH-SLOT. Run: deno test --no-check supabase/functions/_shared/cron-schedule.test.ts
import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { lastScheduledFire, parseCron, restartMarker, slotVerdict } from "./cron-schedule.ts";

const D = (s: string) => new Date(s);
const DIGEST = "0 13 * * 1-6"; // apex-manager-daily-digest, live schedule
const CHURN = "0 12 * * *"; // apex-daily-churn-check, live schedule
const base = { active: true, timezone: "GMT" };

// 2026-10-24 is a Saturday, 10-25 Sunday, 10-26 Monday.
Deno.test("the Sunday case: digest ran Saturday 13:00, Sunday 15:05 is not a missed slot", () => {
  const v = slotVerdict({ ...base, schedule: DIGEST, lastRunAt: D("2026-10-24T13:00:05Z"), now: D("2026-10-25T15:05:00Z") });
  assertEquals(v.fire, false);
  assertEquals(v.slot?.toISOString(), "2026-10-24T13:00:00.000Z");
});

Deno.test("the old 26h rule DID fire on that same Sunday (the case above is load-bearing)", () => {
  const hoursAgo = (D("2026-10-25T15:05:00Z").getTime() - D("2026-10-24T13:00:05Z").getTime()) / 3600000;
  assertEquals(hoursAgo > 26, true);
});

Deno.test("Monday 15:05 with no run since Saturday is a missed slot", () => {
  const v = slotVerdict({ ...base, schedule: DIGEST, lastRunAt: D("2026-10-24T13:00:05Z"), now: D("2026-10-26T15:05:00Z") });
  assertEquals(v.fire, true);
  assertEquals(v.slot?.toISOString(), "2026-10-26T13:00:00.000Z");
});

Deno.test("inside the grace window the cron still has its chance", () => {
  const v = slotVerdict({ ...base, schedule: CHURN, lastRunAt: D("2026-10-21T12:00:03Z"), now: D("2026-10-22T12:30:00Z") });
  assertEquals([v.fire, v.kind], [false, "in_grace"]);
});

Deno.test("daily slot missed and past grace fires", () => {
  const v = slotVerdict({ ...base, schedule: CHURN, lastRunAt: D("2026-10-21T12:00:03Z"), now: D("2026-10-22T14:05:00Z") });
  assertEquals([v.fire, v.kind], [true, "missed"]);
});

Deno.test("a run written a few minutes before the slot still counts (clock skew)", () => {
  const v = slotVerdict({ ...base, schedule: CHURN, lastRunAt: D("2026-10-22T11:55:00Z"), now: D("2026-10-22T15:00:00Z") });
  assertEquals([v.fire, v.kind], [false, "ran"]);
});

Deno.test("never run at all, past grace -> fires", () => {
  assertEquals(slotVerdict({ ...base, schedule: CHURN, lastRunAt: null, now: D("2026-10-22T15:00:00Z") }).fire, true);
});

Deno.test("cron off never fires", () => {
  assertEquals(slotVerdict({ ...base, active: false, schedule: CHURN, lastRunAt: null, now: D("2026-10-22T15:00:00Z") }).fire, false);
});

Deno.test("non-UTC or unreadable cron.timezone never fires", () => {
  for (const tz of ["America/Phoenix", null]) {
    const v = slotVerdict({ ...base, timezone: tz, schedule: CHURN, lastRunAt: null, now: D("2026-10-22T15:00:00Z") });
    assertEquals([v.fire, v.kind], [false, "ungraded"]);
  }
});

Deno.test("unparseable schedules never fire", () => {
  for (const s of ["@daily", "30 seconds", "0 12 * *", "61 * * * *", "0 12 * * MON", ""]) {
    const v = slotVerdict({ ...base, schedule: s, lastRunAt: null, now: D("2026-10-22T15:00:00Z") });
    assertEquals([s, v.fire, v.kind], [s, false, "ungraded"]);
  }
});

Deno.test("parser: steps, ranges, lists, Sunday as 7", () => {
  assertEquals(lastScheduledFire("*/15 * * * *", D("2026-10-21T21:37:42Z"))?.toISOString(), "2026-10-21T21:30:00.000Z");
  assertEquals(lastScheduledFire("5/20 * * * *", D("2026-10-21T21:37:00Z"))?.toISOString(), "2026-10-21T21:25:00.000Z");
  assertEquals(lastScheduledFire("0 9,17 * * *", D("2026-10-21T16:59:00Z"))?.toISOString(), "2026-10-21T09:00:00.000Z");
  assertEquals(lastScheduledFire("0 8 * * 7", D("2026-10-21T10:00:00Z"))?.toISOString(), "2026-10-18T08:00:00.000Z");
  assertEquals(lastScheduledFire("0 8 * * 0", D("2026-10-21T10:00:00Z"))?.toISOString(), "2026-10-18T08:00:00.000Z");
});

Deno.test("parser: both day fields restricted means either matches (Vixie)", () => {
  // 1st of the month OR Monday. 2026-10-19 is a Monday, 10-01 a Thursday.
  assertEquals(lastScheduledFire("0 0 1 * 1", D("2026-10-21T00:00:00Z"))?.toISOString(), "2026-10-19T00:00:00.000Z");
  assertEquals(parseCron("0 0 1 * 1")?.domStar, false);
});

Deno.test("the restart marker is stable per slot", () => {
  const s = D("2026-10-26T13:00:00Z");
  assertEquals(restartMarker("Manager Daily Digest", s), restartMarker("Manager Daily Digest", new Date(s.getTime())));
});
