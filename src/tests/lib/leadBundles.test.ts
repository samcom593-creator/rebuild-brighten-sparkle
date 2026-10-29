import { describe, expect, it } from "vitest";
import { canDial, formatLabel, isOpenLead, leadStatusLabel, tierLabel } from "@/lib/leadBundles";

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
    expect(tierLabel("pos")).toBe("Policy owner");
    expect(tierLabel("A")).toBe("Tier A");
    expect(formatLabel("pos")).toBe("POS");
    expect(formatLabel("called_leads")).toBe("Called leads");
  });
});
