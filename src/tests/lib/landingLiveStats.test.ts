import { describe, expect, it } from "vitest";
import { parseLandingLiveStats } from "@/lib/landingLiveStats";

describe("public agency counts", () => {
  it("preserves a verified zero instead of substituting an older positive count", () => {
    expect(parseLandingLiveStats({ active_agents: 0, applications_30d: 0, carriers_partnered: 0 })).toEqual({ active_agents: 0, applications_30d: 0, carriers_partnered: 0 });
  });

  it("keeps missing, fractional, and invalid counts unknown", () => {
    expect(parseLandingLiveStats({ active_agents: 4, applications_30d: -1, carriers_partnered: "22" })).toEqual({ active_agents: 4, applications_30d: null, carriers_partnered: null });
    expect(parseLandingLiveStats({ active_agents: Infinity, applications_30d: 0.5, carriers_partnered: 2 })).toEqual({ active_agents: null, applications_30d: null, carriers_partnered: 2 });
  });

  it("refuses malformed or wholly unavailable responses", () => {
    for (const value of [null, [], "offline", {}, { active_agents: -1 }, { active_agents: NaN }]) {
      expect(() => parseLandingLiveStats(value)).toThrow("Agency numbers are unavailable.");
    }
  });
});
