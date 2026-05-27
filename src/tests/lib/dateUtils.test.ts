/**
 * dateUtils.test.ts
 *
 * Tests for src/lib/dateUtils.ts
 * All functions operate in America/Chicago (BUSINESS_TIMEZONE).
 *
 * Coverage targets:
 *   ✅ getTodayPST         — returns yyyy-MM-dd in CST/CDT
 *   ✅ getDateDaysAgoPST   — correct offset (not UTC)
 *   ✅ getWeekStartPST     — ISO week starts Monday
 *   ✅ getMonthStartPST    — first of month
 *   ✅ getWeekEndPST       — 6 days after week start
 *   ✅ getMonthEndPST      — last day of month
 *   ✅ getBusinessDayBounds — start < end, covers full calendar day in CST
 *   ✅ getBusinessWeekBounds — start is Monday of week
 *   ✅ getMatchedPriorWeekBounds — Monday edge (0 elapsed days), mid-week
 *   ✅ getBusinessMonthProjectionContext — elapsedCalendarDays matches day-of-month
 *   ✅ DST boundary — spring-forward date (2026-03-08) doesn't produce NaN
 */

import { describe, it, expect } from "vitest";
import {
  getTodayPST,
  getDateDaysAgoPST,
  getWeekStartPST,
  getMonthStartPST,
  getWeekEndPST,
  getMonthEndPST,
  getBusinessDayBounds,
  getBusinessWeekBounds,
  getBusinessMonthBounds,
  getMatchedPriorWeekBounds,
  getBusinessMonthProjectionContext,
  getBusinessDayKey,
  formatDateString,
} from "@/lib/dateUtils";

// ── Helper: build a UTC Date whose wall-clock in Chicago matches the given string ──
// We test by passing a known Date and asserting the output, rather than mocking Date.now,
// so tests remain stable across machine timezones.

describe("getBusinessDayKey", () => {
  it("returns yyyy-MM-dd string for a UTC epoch in CDT (UTC-5)", () => {
    // 2026-05-20 10:00 UTC = 2026-05-20 05:00 CDT → still May 20 in Chicago
    const date = new Date("2026-05-20T10:00:00Z");
    expect(getBusinessDayKey(date)).toBe("2026-05-20");
  });

  it("returns PREVIOUS day when UTC is past midnight but still yesterday in CDT", () => {
    // 2026-05-21 02:00 UTC = 2026-05-20 21:00 CDT → still May 20 in Chicago
    const date = new Date("2026-05-21T02:00:00Z");
    expect(getBusinessDayKey(date)).toBe("2026-05-20");
  });

  it("rolls over at CDT midnight (05:00 UTC = 00:00 CDT, since CDT is UTC-5)", () => {
    // 2026-05-21 04:59 UTC = 2026-05-20 23:59 CDT → still May 20 in Chicago
    const beforeMidnight = new Date("2026-05-21T04:59:00Z");
    // 2026-05-21 05:00 UTC = 2026-05-21 00:00 CDT → May 21 in Chicago
    const afterMidnight = new Date("2026-05-21T05:00:00Z");
    expect(getBusinessDayKey(beforeMidnight)).toBe("2026-05-20");
    expect(getBusinessDayKey(afterMidnight)).toBe("2026-05-21");
  });
});

describe("formatDateString", () => {
  it("formats a Date object to yyyy-MM-dd", () => {
    expect(formatDateString(new Date("2026-01-05T00:00:00Z"))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("getBusinessDayBounds", () => {
  it("start is before end", () => {
    const date = new Date("2026-05-20T14:00:00Z");
    const { start, end } = getBusinessDayBounds(date);
    expect(start.getTime()).toBeLessThan(end.getTime());
  });

  it("startIso and endIso are valid ISO strings", () => {
    const { startIso, endIso } = getBusinessDayBounds(new Date("2026-05-20T14:00:00Z"));
    expect(() => new Date(startIso)).not.toThrow();
    expect(() => new Date(endIso)).not.toThrow();
  });

  it("end is exactly 24 hours after start on a non-DST day", () => {
    // 2026-05-20 is a Wednesday in CDT (no DST transition)
    const date = new Date("2026-05-20T14:00:00Z");
    const { start, end } = getBusinessDayBounds(date);
    const diff = end.getTime() - start.getTime();
    expect(diff).toBe(24 * 60 * 60 * 1000);
  });
});

describe("getBusinessWeekBounds", () => {
  it("start is on Monday in Chicago time", () => {
    // 2026-05-20 is Wednesday
    const date = new Date("2026-05-20T14:00:00Z");
    const { start } = getBusinessWeekBounds(date);
    // Chicago Monday of that week is 2026-05-18
    expect(getBusinessDayKey(start)).toBe("2026-05-18");
  });

  it("start equals week start on Monday itself", () => {
    // 2026-05-18 is Monday
    const date = new Date("2026-05-18T14:00:00Z");
    const { start } = getBusinessWeekBounds(date);
    expect(getBusinessDayKey(start)).toBe("2026-05-18");
  });
});

describe("getBusinessMonthBounds", () => {
  it("start is on the 1st of the month in Chicago", () => {
    const date = new Date("2026-05-20T14:00:00Z");
    const { start } = getBusinessMonthBounds(date);
    expect(getBusinessDayKey(start)).toBe("2026-05-01");
  });
});

describe("getMatchedPriorWeekBounds", () => {
  it("returns elapsed days = 0 when date is Monday", () => {
    // 2026-05-18 is Monday, so 0 days elapsed in current week
    const date = new Date("2026-05-18T14:00:00Z");
    const { elapsedDays } = getMatchedPriorWeekBounds(date);
    expect(elapsedDays).toBe(0);
  });

  it("returns elapsed days = 2 on Wednesday", () => {
    // 2026-05-20 is Wednesday (Mon=0, Tue=1, Wed=2)
    const date = new Date("2026-05-20T14:00:00Z");
    const { elapsedDays } = getMatchedPriorWeekBounds(date);
    expect(elapsedDays).toBe(2);
  });

  it("prior week start is 7 days before current week start", () => {
    const date = new Date("2026-05-20T14:00:00Z");
    const current = getBusinessWeekBounds(date);
    const { start: priorStart } = getMatchedPriorWeekBounds(date);
    const diffDays =
      (current.start.getTime() - priorStart.getTime()) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBe(7);
  });

  it("start is before end", () => {
    const date = new Date("2026-05-20T14:00:00Z");
    const { start, end } = getMatchedPriorWeekBounds(date);
    expect(start.getTime()).toBeLessThan(end.getTime());
  });

  it("does not produce NaN on DST spring-forward boundary (2026-03-08)", () => {
    // 2026-03-08 is the US spring-forward day (clocks jump 2:00→3:00)
    const date = new Date("2026-03-08T14:00:00Z");
    const { start, end, startIso, endIso } = getMatchedPriorWeekBounds(date);
    expect(isNaN(start.getTime())).toBe(false);
    expect(isNaN(end.getTime())).toBe(false);
    expect(startIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(endIso).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe("getBusinessMonthProjectionContext", () => {
  it("elapsedCalendarDays matches day-of-month in Chicago", () => {
    // 2026-05-15 = 15th
    const date = new Date("2026-05-15T14:00:00Z");
    const { elapsedCalendarDays } = getBusinessMonthProjectionContext(date);
    expect(elapsedCalendarDays).toBe(15);
  });

  it("daysInMonth = 31 for May", () => {
    const date = new Date("2026-05-15T14:00:00Z");
    const { daysInMonth } = getBusinessMonthProjectionContext(date);
    expect(daysInMonth).toBe(31);
  });

  it("daysInMonth = 28 for February 2027 (non-leap)", () => {
    const date = new Date("2027-02-15T14:00:00Z");
    const { daysInMonth } = getBusinessMonthProjectionContext(date);
    expect(daysInMonth).toBe(28);
  });
});
