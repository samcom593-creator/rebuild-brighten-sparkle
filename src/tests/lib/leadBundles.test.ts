import { describe, expect, it } from "vitest";
import { TIER_LEGEND, TIER_STYLE, canDial, flagBadges, formatLabel, isOpenLead, leadStatusLabel, tierLabel, tierLegendFor } from "@/lib/leadBundles";

describe("lead bundle labels", () => {
  it("names every status in plain words", () => {
    expect(leadStatusLabel(null)).toBe("Not called yet");
    expect(leadStatusLabel("new")).toBe("Not called yet");
    expect(leadStatusLabel("do_not_call")).toBe("Do not call");
    expect(leadStatusLabel("not_interested")).toBe("Not interested");
  });
  it("keeps open leads open and closes the rest", () => {
    expect(isOpenLead("callback")).toBe(true);
    expect(isOpenLead(undefined)).toBe(true);
    expect(isOpenLead("sold")).toBe(false);
    expect(isOpenLead("do_not_call")).toBe(false);
  });
  it("never dials a do-not-call lead", () => {
    expect(canDial("do_not_call")).toBe(false);
    expect(canDial("callback")).toBe(true);
  });
  it("labels tiers and formats", () => {
    expect(tierLabel("pos")).toBe("Sale reported");
    expect(tierLabel("A")).toBe("Tier A");
    expect(formatLabel("pos")).toBe("POS");
    expect(formatLabel("called_leads")).toBe("Called leads");
  });
  // MP-LEAD-MANAGER-RM: the dialer pool is every ReadyMode lead, so most of it has never been called.
  it("names a never-called dialer lead Fresh, with a description and a colour", () => {
    expect(tierLabel("F")).toBe("Fresh");
    expect(TIER_STYLE.F).toBeTruthy();
    const dialer = tierLegendFor("dialer").map((t) => t.tier);
    expect(dialer).toEqual(["pos", "A", "B", "F", "C", "D"]);
  });
  it("describes every tier of every pool, so a tier is never shown without its meaning", () => {
    for (const pool of ["marketing", "dialer", "rewrite", "winback"]) {
      const legend = TIER_LEGEND[pool];
      expect(legend.length).toBeGreaterThan(1);
      for (const t of legend) {
        expect(t.desc.length).toBeGreaterThan(10);
        expect(TIER_STYLE[t.tier]).toBeTruthy();
      }
    }
    for (const t of ["A", "B", "C", "D"]) {
      expect(TIER_LEGEND.marketing.some((x) => x.tier === t)).toBe(true);
      expect(TIER_LEGEND.dialer.some((x) => x.tier === t)).toBe(true);
    }
  });
  it("badges a current client, and ignores bookkeeping flags that are not for the eye", () => {
    const badges = flagBadges({ current_client: true, state_from_area_code: true, campaign: "POS", times_called: 3 }, false);
    expect(badges.map((b) => b.key)).toEqual(["current_client"]);
  });
});
