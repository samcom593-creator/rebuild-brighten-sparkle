import { describe, expect, it } from "vitest";
import { matchesLeadQuery } from "@/lib/leadWorklist";

describe("lead worklist search", () => {
  it("matches all words across fields, normalized for accents and case", () => {
    expect(matchesLeadQuery("jose TX", ["José", "Rivera", "TX", "jose@example.test"], ["6025550100"])).toBe(true);
    expect(matchesLeadQuery("jose FL", ["José", "Rivera", "TX"], ["6025550100"])).toBe(false);
    expect(matchesLeadQuery("", [null, undefined], [])).toBe(true);
  });
  it("finds US numbers with formatting and a country code in either source or query", () => {
    expect(matchesLeadQuery("+1 (602) 555-0100", ["Someone"], ["6025550100"])).toBe(true);
    expect(matchesLeadQuery("(602) 555-0100", [], ["+1 602-555-0100"])).toBe(true);
    expect(matchesLeadQuery("555-0101", [], ["6025550100"])).toBe(false);
  });
});
