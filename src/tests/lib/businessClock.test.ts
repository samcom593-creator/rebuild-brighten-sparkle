/**
 * businessClock (F21 / F22 / F32): the next business midnight across zones,
 * including the New York DST days, plus pure date-key arithmetic.
 *
 * The truth used here is Intl itself, not the module under test: the result
 * must read as 00:00:00 on the next calendar day in the zone, and one
 * millisecond before it must still read as the starting day.
 */
import { describe, expect, it } from "vitest";
import {
  MAX_TIMER_DELAY_MS,
  businessDateKey,
  monthStartKey,
  msUntilNextBusinessMidnight,
  nextBusinessMidnightMs,
  resolveZone,
  shiftDateKey,
  shiftMonthKey,
  yearStartKey,
} from "@/lib/businessClock";

const HOUR = 3_600_000;

/** "YYYY-MM-DD HH:mm:ss" of an instant in a zone, straight from Intl. */
function wall(ms: number, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(new Date(ms));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const hour = get("hour") === "24" ? "00" : get("hour");
  return `${get("year")}-${get("month")}-${get("day")} ${hour}:${get("minute")}:${get("second")}`;
}

/** Calendar-day successor computed independently of shiftDateKey. */
function nextDay(key: string): string {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

const ZONES = ["America/Phoenix", "America/New_York", "UTC", "Asia/Tokyo"];
// US DST 2026: spring forward Sun 2026-03-08 02:00, fall back Sun 2026-11-01 02:00 (America/New_York).
const SWEEP_DAYS = ["2026-03-08", "2026-11-01", "2026-10-14", "2026-12-31"];

describe("nextBusinessMidnightMs", () => {
  it("Phoenix: noon rolls to 07:00Z the next day (UTC-7, no DST)", () => {
    const now = Date.parse("2026-10-14T19:00:00Z");
    expect(nextBusinessMidnightMs(now, "America/Phoenix")).toBe(Date.parse("2026-10-15T07:00:00Z"));
    expect(nextBusinessMidnightMs(now)).toBe(Date.parse("2026-10-15T07:00:00Z"));
  });

  it("UTC: one millisecond before midnight is one millisecond away", () => {
    const now = Date.parse("2026-10-14T23:59:59.999Z");
    expect(nextBusinessMidnightMs(now, "UTC")).toBe(Date.parse("2026-10-15T00:00:00Z"));
  });

  it("Tokyo: exactly at midnight the key has already turned, so the next midnight is a full day away", () => {
    const now = Date.parse("2026-10-14T15:00:00Z"); // 00:00:00 on 2026-10-15 in Tokyo
    expect(nextBusinessMidnightMs(now, "Asia/Tokyo")).toBe(Date.parse("2026-10-15T15:00:00Z"));
  });

  it("New York spring-forward day is 23 hours long", () => {
    const now = Date.parse("2026-03-08T06:00:00Z"); // 01:00 EST on 2026-03-08
    const next = nextBusinessMidnightMs(now, "America/New_York");
    expect(next).toBe(Date.parse("2026-03-09T04:00:00Z")); // 00:00 EDT
    expect(next - now).toBe(22 * HOUR);
  });

  it("New York fall-back day is 25 hours long, and the first midnight after it is EST", () => {
    const noonBefore = Date.parse("2026-10-31T16:00:00Z"); // 12:00 EDT on 2026-10-31
    const nov1 = nextBusinessMidnightMs(noonBefore, "America/New_York");
    expect(nov1).toBe(Date.parse("2026-11-01T04:00:00Z")); // 00:00 EDT
    const nov2 = nextBusinessMidnightMs(nov1, "America/New_York");
    expect(nov2).toBe(Date.parse("2026-11-02T05:00:00Z")); // 00:00 EST
    expect(nov2 - nov1).toBe(25 * HOUR);
    // From the repeated 01:30 hour on the fall-back day itself.
    const repeated = Date.parse("2026-11-01T05:30:00Z"); // 01:30 EDT, first pass
    expect(nextBusinessMidnightMs(repeated, "America/New_York")).toBe(nov2);
  });

  it("sweeps every hour of plain and DST days in four zones against Intl", () => {
    for (const tz of ZONES) {
      for (const day of SWEEP_DAYS) {
        for (let h = 0; h < 24; h += 1) {
          const now = Date.parse(`${day}T${String(h).padStart(2, "0")}:17:00Z`);
          const next = nextBusinessMidnightMs(now, tz);
          const startKey = wall(now, tz).slice(0, 10);
          expect(next, `${tz} ${day} ${h}h`).toBeGreaterThan(now);
          expect(wall(next, tz), `${tz} ${day} ${h}h`).toBe(`${nextDay(startKey)} 00:00:00`);
          expect(wall(next - 1, tz).slice(0, 10), `${tz} ${day} ${h}h`).toBe(startKey);
        }
      }
    }
  });

  it("rejects an invalid instant and falls back to the business zone for an invalid zone", () => {
    expect(() => nextBusinessMidnightMs(Number.NaN)).toThrow(RangeError);
    const now = Date.parse("2026-10-14T19:00:00Z");
    expect(nextBusinessMidnightMs(now, "Mars/Olympus")).toBe(nextBusinessMidnightMs(now, "America/Phoenix"));
    expect(resolveZone("Mars/Olympus")).toBe("America/Phoenix");
    expect(resolveZone(null)).toBe("America/Phoenix");
    expect(resolveZone("America/Chicago")).toBe("America/Chicago");
  });
});

describe("msUntilNextBusinessMidnight", () => {
  it("is the gap to the next midnight, at least 1ms and never past the timer ceiling", () => {
    const now = Date.parse("2026-10-14T19:00:00Z");
    expect(msUntilNextBusinessMidnight(now, "America/Phoenix")).toBe(12 * HOUR);
    expect(msUntilNextBusinessMidnight(Date.parse("2026-10-14T23:59:59.999Z"), "UTC")).toBe(1);
    expect(msUntilNextBusinessMidnight(now, "Asia/Tokyo")).toBeLessThanOrEqual(25 * HOUR);
    expect(MAX_TIMER_DELAY_MS).toBe(2_147_483_647);
  });
});

describe("businessDateKey", () => {
  it("reads the Phoenix day by default and any zone on request", () => {
    expect(businessDateKey(Date.parse("2026-10-14T06:59:59Z"))).toBe("2026-10-13");
    expect(businessDateKey(Date.parse("2026-10-14T07:00:00Z"))).toBe("2026-10-14");
    expect(businessDateKey(Date.parse("2026-10-14T05:30:00Z"), "America/Chicago")).toBe("2026-10-14"); // 00:30 CDT
    expect(businessDateKey(Date.parse("2026-10-14T05:30:00Z"), "America/Phoenix")).toBe("2026-10-13"); // 22:30 MST
    expect(() => businessDateKey(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe("date-key arithmetic", () => {
  it("shifts across month, year and leap boundaries without a zone", () => {
    expect(shiftDateKey("2026-10-31", 1)).toBe("2026-11-01");
    expect(shiftDateKey("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftDateKey("2027-01-01", -1)).toBe("2026-12-31");
    expect(shiftDateKey("2028-02-28", 1)).toBe("2028-02-29");
    expect(shiftDateKey("2027-02-28", 1)).toBe("2027-03-01");
    expect(shiftDateKey("2026-10-14", -29)).toBe("2026-09-15");
    expect(shiftDateKey("2026-10-14", 0)).toBe("2026-10-14");
  });

  it("builds month and year windows in key space, the F22 replacement for new Date(y, m, 1)", () => {
    expect(monthStartKey("2026-10-14")).toBe("2026-10-01");
    expect(shiftMonthKey("2026-10-14", 1)).toBe("2026-11-01");
    expect(shiftMonthKey("2026-10-14", -1)).toBe("2026-09-01");
    expect(shiftMonthKey("2026-01-15", -1)).toBe("2025-12-01");
    expect(shiftMonthKey("2026-12-15", 1)).toBe("2027-01-01");
    expect(shiftMonthKey("2026-10-31", 12)).toBe("2027-10-01");
    expect(yearStartKey("2026-10-14")).toBe("2026-01-01");
  });

  it("refuses a malformed key instead of guessing", () => {
    expect(() => shiftDateKey("10/14/2026", 1)).toThrow(RangeError);
    expect(() => monthStartKey("2026-10")).toThrow(RangeError);
  });
});
