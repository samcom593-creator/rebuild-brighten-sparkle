/**
 * Home dashboard windows (F22 in the 2026-10-14 Galaxy OS map).
 *
 * The RPC behind AgentCloudHome filters Phoenix posted_date buckets with date
 * keys, so the same business-day key must produce the same window under
 * every viewer zone. The sweep reassigns process.env.TZ in-process (Node
 * re-reads TZ on assignment) and the first case in each zone runs the
 * builder the page used before the fix, verbatim, to prove two things at
 * once: the zone switch took effect, and the defect was real. A sweep that
 * cannot fail proves nothing, so that reference assertion is not optional.
 */
import { afterAll, describe, expect, it } from "vitest";
import {
  MAX_CUSTOM_RANGE_DAYS,
  PERIODS,
  inclusiveDays,
  isDateKey,
  monthLabel,
  monthShort,
  validateCustomRange,
  windowFor,
} from "@/lib/homeDashboard";

const ZONES = ["America/Phoenix", "America/New_York", "UTC", "Europe/London", "Asia/Tokyo"];
const ORIGINAL_TZ = process.env.TZ;
const TODAY = "2026-10-14";
const CUSTOM = { start: "2026-10-01", end: "2026-10-10" };

afterAll(() => {
  if (ORIGINAL_TZ === undefined) delete process.env.TZ;
  else process.env.TZ = ORIGINAL_TZ;
});

/**
 * The month-start construction AgentCloudHome.tsx used at HEAD 965a52ec
 * (phxToday + new Date(y, m, 1) + toLocaleDateString in Phoenix), fed a fixed
 * instant. Deliberately not the implementation under test.
 */
function legacyMonthStart(instant: Date): string {
  const t = new Date(instant.toLocaleString("en-US", { timeZone: "America/Phoenix" }));
  const mStart = new Date(t.getFullYear(), t.getMonth(), 1);
  return mStart.toLocaleDateString("en-CA", { timeZone: "America/Phoenix" });
}

describe("windowFor across viewer zones", () => {
  for (const zone of ZONES) {
    describe(`TZ=${zone}`, () => {
      it("the pre-fix builder moved the October start to Sep 30 everywhere but Phoenix (proves the zone switch is live)", () => {
        process.env.TZ = zone;
        const legacy = legacyMonthStart(new Date("2026-10-14T12:00:00Z"));
        expect(legacy).toBe(zone === "America/Phoenix" ? "2026-10-01" : "2026-09-30");
      });

      it("builds every preset in key space, end-exclusive, identical in every zone", () => {
        process.env.TZ = zone;
        expect(windowFor("this_month", CUSTOM, TODAY)).toEqual({ start: "2026-10-01", end: "2026-11-01", label: "This month" });
        expect(windowFor("last_month", CUSTOM, TODAY)).toEqual({ start: "2026-09-01", end: "2026-10-01", label: "September 2026" });
        expect(windowFor("last_30", CUSTOM, TODAY)).toEqual({ start: "2026-09-15", end: "2026-10-15", label: "Last 30 days" });
        expect(windowFor("last_90", CUSTOM, TODAY)).toEqual({ start: "2026-07-17", end: "2026-10-15", label: "Last 90 days" });
        expect(windowFor("ytd", CUSTOM, TODAY)).toEqual({ start: "2026-01-01", end: "2026-10-15", label: "2026 to date" });
        // The chosen end day is INCLUDED: the exclusive bound is the day after it.
        expect(windowFor("custom", CUSTOM, TODAY)).toEqual({ start: "2026-10-01", end: "2026-10-11", label: "2026-10-01 - 2026-10-10" });
      });

      it("month labels come from the key, not from the viewer's clock", () => {
        process.env.TZ = zone;
        expect(monthLabel("2026-09-01")).toBe("September 2026");
        expect(monthLabel("2026-12-31")).toBe("December 2026");
        expect(monthShort("2026-09")).toBe("Sep 26");
        expect(monthShort("2027-01")).toBe("Jan 27");
      });
    });
  }

  it("rolls the year back for last month in January and forward for this month in December", () => {
    const c = { start: "2027-01-01", end: "2027-01-05" };
    expect(windowFor("last_month", c, "2027-01-05")).toEqual({ start: "2026-12-01", end: "2027-01-01", label: "December 2026" });
    expect(windowFor("this_month", c, "2026-12-20")).toMatchObject({ start: "2026-12-01", end: "2027-01-01" });
    expect(windowFor("ytd", c, "2027-01-01")).toMatchObject({ start: "2027-01-01", end: "2027-01-02" });
  });

  it("handles February, including a leap day", () => {
    const c = { start: "2028-02-01", end: "2028-02-29" };
    expect(windowFor("last_month", c, "2028-03-15")).toMatchObject({ start: "2028-02-01", end: "2028-03-01" });
    expect(windowFor("this_month", c, "2028-02-29")).toMatchObject({ start: "2028-02-01", end: "2028-03-01" });
    expect(windowFor("custom", c, "2028-03-15")).toMatchObject({ start: "2028-02-01", end: "2028-03-01" });
  });

  it("every preset window starts before it ends and the to-date presets contain today", () => {
    for (const period of PERIODS) {
      if (period.key === "custom") continue;
      const w = windowFor(period.key, CUSTOM, TODAY);
      expect(w.start < w.end, period.key).toBe(true);
      if (period.key === "last_month") continue;
      expect(w.start <= TODAY, `${period.key} start`).toBe(true);
      expect(w.end > TODAY, `${period.key} end`).toBe(true);
    }
  });
});

describe("validateCustomRange", () => {
  it("accepts a valid pair and trims it", () => {
    expect(validateCustomRange({ start: " 2026-10-01", end: "2026-10-10 " })).toEqual({ ok: true, range: { start: "2026-10-01", end: "2026-10-10" } });
    expect(validateCustomRange({ start: "2026-10-10", end: "2026-10-10" })).toEqual({ ok: true, range: { start: "2026-10-10", end: "2026-10-10" } });
  });

  it("names the missing date instead of disabling anything", () => {
    expect(validateCustomRange({ start: "", end: "2026-10-10" })).toEqual({ ok: false, message: "Pick a start date." });
    expect(validateCustomRange({ start: "2026-10-01", end: "" })).toEqual({ ok: false, message: "Pick an end date." });
    expect(validateCustomRange({ start: "", end: "" })).toEqual({ ok: false, message: "Pick a start date and an end date." });
  });

  it("refuses a reversed pair and an impossible date with an actionable message", () => {
    expect(validateCustomRange({ start: "2026-10-20", end: "2026-10-10" })).toEqual({ ok: false, message: "The start date must be on or before the end date." });
    expect(validateCustomRange({ start: "2026-02-30", end: "2026-03-01" })).toMatchObject({ ok: false });
    expect(validateCustomRange({ start: "10/01/2026", end: "2026-10-10" })).toMatchObject({ ok: false });
  });

  it("mirrors the RPC's 3660-day cap so the viewer reads a message instead of a failed call", () => {
    expect(inclusiveDays("2026-10-01", "2026-10-10")).toBe(10);
    // 2016-10-01 to 2026-10-01 is 3652 days (Feb 29 of 2020 and 2024 inside), so +7 days is 3660 inclusive.
    const atCap = validateCustomRange({ start: "2016-10-01", end: "2026-10-08" });
    expect(inclusiveDays("2016-10-01", "2026-10-08")).toBe(MAX_CUSTOM_RANGE_DAYS);
    expect(atCap.ok).toBe(true);
    const overCap = validateCustomRange({ start: "2016-10-01", end: "2026-10-09" });
    expect(overCap).toEqual({ ok: false, message: `Pick a range of at most ${MAX_CUSTOM_RANGE_DAYS} days.` });
  });
});

describe("isDateKey", () => {
  it("accepts real calendar dates only", () => {
    expect(isDateKey("2026-10-14")).toBe(true);
    expect(isDateKey("2028-02-29")).toBe(true);
    expect(isDateKey("2026-02-29")).toBe(false);
    expect(isDateKey("2026-13-01")).toBe(false);
    expect(isDateKey("2026-1-4")).toBe(false);
    expect(isDateKey("")).toBe(false);
  });
});
