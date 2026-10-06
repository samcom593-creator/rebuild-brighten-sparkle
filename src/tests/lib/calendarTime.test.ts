import { describe, expect, it } from "vitest";
import {
  BUSINESS_TZ,
  dateKeyInZone,
  describeEventTime,
  isValidTimeZone,
  timeValueInZone,
  zoneOffsetMinutes,
  zonedWallTimeToUtc,
} from "@/lib/calendarTime";

// US DST 2026: starts Sun 2026-03-08 02:00, ends Sun 2026-11-01 02:00 (America/New_York).
// America/Phoenix never observes DST (UTC-7 all year).

describe("zonedWallTimeToUtc", () => {
  it("keeps a New York 10:00 AM wall time across the November DST change (EDT -> EST)", () => {
    expect(zonedWallTimeToUtc("2026-10-29", "10:00", "America/New_York")).toBe("2026-10-29T14:00:00.000Z");
    expect(zonedWallTimeToUtc("2026-11-05", "10:00", "America/New_York")).toBe("2026-11-05T15:00:00.000Z");
  });

  it("Phoenix has one offset all year", () => {
    expect(zonedWallTimeToUtc("2026-10-29", "10:00", BUSINESS_TZ)).toBe("2026-10-29T17:00:00.000Z");
    expect(zonedWallTimeToUtc("2026-11-05", "10:00", BUSINESS_TZ)).toBe("2026-11-05T17:00:00.000Z");
    expect(zonedWallTimeToUtc("2026-01-15", "10:00", BUSINESS_TZ)).toBe("2026-01-15T17:00:00.000Z");
    expect(zoneOffsetMinutes(new Date("2026-07-01T12:00:00Z"), BUSINESS_TZ)).toBe(-420);
    expect(zoneOffsetMinutes(new Date("2026-12-01T12:00:00Z"), BUSINESS_TZ)).toBe(-420);
  });

  it("resolves the repeated 1:30 AM on fall-back day to the earlier (daylight) instant", () => {
    expect(zonedWallTimeToUtc("2026-11-01", "01:30", "America/New_York")).toBe("2026-11-01T05:30:00.000Z");
  });

  it("moves a nonexistent spring-forward time (2:30 AM) forward by the gap", () => {
    expect(zonedWallTimeToUtc("2026-03-08", "02:30", "America/New_York")).toBe("2026-03-08T07:30:00.000Z");
  });

  it("rejects bad zones and malformed input instead of guessing", () => {
    expect(() => zonedWallTimeToUtc("2026-11-05", "10:00", "Mars/Olympus")).toThrow(/time zone/);
    expect(() => zonedWallTimeToUtc("11/05/2026", "10:00", "America/New_York")).toThrow(/invalid/);
  });

  it("round-trips through the date/time inputs in the stored zone", () => {
    const iso = zonedWallTimeToUtc("2026-11-05", "10:00", "America/New_York");
    expect(dateKeyInZone(iso, "America/New_York")).toBe("2026-11-05");
    expect(timeValueInZone(iso, "America/New_York")).toBe("10:00");
  });
});

describe("describeEventTime", () => {
  it("labels an Eastern event with its own zone and shows the Phoenix viewer's time, before and after DST ends", () => {
    const before = describeEventTime("2026-10-29T14:00:00.000Z", "America/New_York", "America/Phoenix");
    expect(before.eventLabel).toBe("10:00 AM EDT");
    expect(before.viewerLabel).toBe("7:00 AM MST");
    expect(before.zoneUnknown).toBe(false);

    const after = describeEventTime("2026-11-05T15:00:00.000Z", "America/New_York", "America/Phoenix");
    expect(after.eventLabel).toBe("10:00 AM EST");
    // Same wall time in New York, but one hour LATER for Arizona once New York leaves DST.
    expect(after.viewerLabel).toBe("8:00 AM MST");
  });

  it("omits the viewer label when the viewer is in the event's zone (or an identical offset)", () => {
    expect(describeEventTime("2026-11-05T15:00:00.000Z", "America/New_York", "America/New_York").viewerLabel).toBeNull();
    // Phoenix (MST) and Denver (MST) share an offset in winter.
    expect(describeEventTime("2026-12-01T17:00:00.000Z", "America/Phoenix", "America/Denver").viewerLabel).toBeNull();
  });

  it("flags when the viewer's calendar day differs from the event's", () => {
    // 11:30 PM Thursday in New York = 12:30 PM Friday in Manila.
    const iso = zonedWallTimeToUtc("2026-11-05", "23:30", "America/New_York");
    expect(iso).toBe("2026-11-06T04:30:00.000Z");
    const t = describeEventTime(iso, "America/New_York", "Asia/Manila");
    expect(t.eventLabel).toBe("11:30 PM EST");
    expect(t.viewerLabel).toContain("12:30 PM");
    expect(t.viewerDayDiffers).toBe(true);
    expect(t.viewerDay).toBe("Fri, Nov 6");
    // The business-day bucket stays Thursday in Phoenix.
    expect(dateKeyInZone(iso, BUSINESS_TZ)).toBe("2026-11-05");
  });

  it("says when the event has no stored zone instead of pretending it is Phoenix's own", () => {
    const t = describeEventTime("2026-11-05T17:00:00.000Z", null, "America/Phoenix");
    expect(t.zoneUnknown).toBe(true);
    expect(t.eventZone).toBe(BUSINESS_TZ);
    expect(t.eventLabel).toBe("10:00 AM MST");
  });
});

describe("isValidTimeZone", () => {
  it("accepts IANA zones and rejects junk", () => {
    expect(isValidTimeZone("America/Chicago")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone(null)).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
  });
});
