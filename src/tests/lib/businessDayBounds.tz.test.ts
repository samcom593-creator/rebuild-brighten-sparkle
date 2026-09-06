/**
 * Business-day boundary sweep — MP-444.
 *
 * WHY THIS FILE EXISTS, AND WHY THE OBVIOUS TEST DID NOT CATCH THE BUG
 * ────────────────────────────────────────────────────────────────────
 * `metricTruth.test.ts` already asserted `start < end` for "day"/"week"/"month".
 * It passed for months, because it evaluated the bounds at *whatever instant CI
 * happened to run*. The defect only existed for 5 of every 24 hours under UTC —
 * so the suite went red at 05:00:00Z on 2026-09-06 and was green either side of
 * it. A boundary bug that is only reachable during part of the day needs the
 * whole day swept, not one sample.
 *
 * The defect: `toBusinessTime()` returns a Date *shifted* so its local fields
 * read as Chicago wall-clock. It is not the instant it looks like. Passing one
 * back into `businessDayKey()` applied the zone offset a second time, moving the
 * boundary by (chicagoOffset − browserOffset). East of Chicago that could land
 * "tomorrow" back on today → start === end → a zero-width window → every ALP
 * query on 7 dashboard surfaces returned $0.
 *
 * TIMEZONE COVERAGE IS THE OTHER HALF. Under TZ=America/Chicago the offset delta
 * is zero and every one of these assertions passes against the *broken* code.
 * This file sweeps instants; `scripts/check-business-day-bounds.mjs` re-runs it
 * under several timezones so a Chicago-only run cannot vouch for the tree.
 */
import { describe, expect, it } from "vitest";
import { addDays } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import {
  BUSINESS_TIMEZONE,
  getBusinessDayBounds,
  getBusinessMonthBounds,
  getBusinessWeekBounds,
  getBusinessYearBounds,
} from "@/lib/dateUtils";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Every hour of a plain, DST-free day. */
const HOURS = Array.from({ length: 24 }, (_, h) => new Date(Date.UTC(2026, 8, 6, h, 0, 0)));

/**
 * Independent truth: the Chicago calendar date `days` from `key`, computed in
 * key space and anchored at noon so a DST transition (Chicago shifts at 02:00)
 * cannot move the date. Deliberately not the implementation under test.
 */
function shiftKey(key: string, days: number): string {
  return formatInTimeZone(
    addDays(fromZonedTime(`${key}T12:00:00`, BUSINESS_TIMEZONE), days),
    BUSINESS_TIMEZONE,
    "yyyy-MM-dd",
  );
}

const chicagoKey = (d: Date) => formatInTimeZone(d, BUSINESS_TIMEZONE, "yyyy-MM-dd");
const label = (d: Date) => `${d.toISOString()} (Chicago ${formatInTimeZone(d, BUSINESS_TIMEZONE, "HH:mm")})`;

describe(`business-day bounds across all 24 hours [TZ=${process.env.TZ ?? "machine default"}]`, () => {
  it("day bounds are exactly 24h wide at every hour — never zero-width, never wider", () => {
    for (const now of HOURS) {
      const { start, end } = getBusinessDayBounds(now);
      expect(end.getTime() - start.getTime(), `day width at ${label(now)}`).toBe(DAY_MS);
    }
  });

  it("day bounds start at the current Chicago calendar day and end at the next", () => {
    for (const now of HOURS) {
      const { start, end } = getBusinessDayBounds(now);
      expect(chicagoKey(start), `day start at ${label(now)}`).toBe(chicagoKey(now));
      expect(chicagoKey(end), `day end at ${label(now)}`).toBe(shiftKey(chicagoKey(now), 1));
    }
  });

  it("the current instant always falls inside its own day window", () => {
    for (const now of HOURS) {
      const { start, end } = getBusinessDayBounds(now);
      expect(now.getTime(), `now >= start at ${label(now)}`).toBeGreaterThanOrEqual(start.getTime());
      expect(now.getTime(), `now < end at ${label(now)}`).toBeLessThan(end.getTime());
    }
  });

  it("week / month / ytd windows always contain the whole of today", () => {
    for (const now of HOURS) {
      const dayEnd = getBusinessDayBounds(now).end.getTime();
      for (const [name, fn] of [
        ["week", getBusinessWeekBounds],
        ["month", getBusinessMonthBounds],
        ["ytd", getBusinessYearBounds],
      ] as const) {
        const { start, end } = fn(now);
        expect(start.getTime(), `${name} start < end at ${label(now)}`).toBeLessThan(end.getTime());
        // A window that stops short of today's end silently drops today's deals.
        expect(end.getTime(), `${name} covers today at ${label(now)}`).toBeGreaterThanOrEqual(dayEnd);
      }
    }
  });

  it("ytd starts on Jan 1 of the *business* year, including on New Year's Eve", () => {
    // 2027-01-01T03:00Z is still 2026-12-31 21:00 in Chicago.
    for (const iso of ["2026-12-31T20:00:00Z", "2027-01-01T03:00:00Z", "2027-01-01T07:00:00Z"]) {
      const now = new Date(iso);
      const { start } = getBusinessYearBounds(now);
      expect(formatInTimeZone(start, BUSINESS_TIMEZONE, "MM-dd"), `ytd start ${iso}`).toBe("01-01");
      expect(formatInTimeZone(start, BUSINESS_TIMEZONE, "yyyy"), `ytd year ${iso}`).toBe(
        formatInTimeZone(now, BUSINESS_TIMEZONE, "yyyy"),
      );
    }
  });
});
