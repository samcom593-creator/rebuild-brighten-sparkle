import { describe, expect, it } from "vitest";
import { inLane, laneOf } from "@/pages/LicensedInbox";

const NOW = Date.parse("2026-10-08T18:00:00Z");
const ago = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

describe("licensed recruit lanes", () => {
  it("never contacted, or no usable contact time, is the first lane", () => {
    expect(laneOf({ last_contacted_at: null }, NOW)).toBe("never");
    expect(laneOf({ last_contacted_at: undefined }, NOW)).toBe("never");
    expect(laneOf({ last_contacted_at: "garbage" }, NOW)).toBe("never");
  });

  it("14 days or more since contact is quiet, less is recently worked", () => {
    expect(laneOf({ last_contacted_at: ago(14) }, NOW)).toBe("quiet");
    expect(laneOf({ last_contacted_at: ago(30) }, NOW)).toBe("quiet");
    expect(laneOf({ last_contacted_at: ago(13) }, NOW)).toBe("active");
    expect(laneOf({ last_contacted_at: ago(0) }, NOW)).toBe("active");
  });

  it("Get going = never + quiet, and never hides someone nobody has reached", () => {
    expect(inLane({ last_contacted_at: null }, "go", NOW)).toBe(true);
    expect(inLane({ last_contacted_at: ago(20) }, "go", NOW)).toBe(true);
    expect(inLane({ last_contacted_at: ago(2) }, "go", NOW)).toBe(false);
    expect(inLane({ last_contacted_at: ago(2) }, "all", NOW)).toBe(true);
  });
});
