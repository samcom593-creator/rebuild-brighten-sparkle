import { describe, expect, it } from "vitest";
import { carrierPlacementSnapshot, carrierPolicyStatus } from "@/lib/carrierPolicyStatus";

describe("carrier evidence presentation", () => {
  it("keeps explicit premium-paying evidence separate from coverage and receipts", () => {
    expect(carrierPolicyStatus({ carrier: "Ethos", bucket: "active", rawStatus: "PREMIUM_PAYING" })).toMatchObject({
      coverage: "active", statusLabel: "Premium paying", rawStatus: "PREMIUM_PAYING", payment: "premium_paying", recordedChargeback: false,
    });
    expect(carrierPolicyStatus({ carrier: "Chubb", bucket: "active", rawStatus: "In Force" }).payment).toBe("unknown");
    expect(carrierPolicyStatus({ carrier: "Ethos", rawStatus: "RENEWAL_PREMIUM_PROCESSING" }).payment).toBe("processing");
    expect(carrierPolicyStatus({ carrier: "Ethos", bucket: "lapsed", rawStatus: "PREMIUM_PAYING" })).toMatchObject({ coverage: "unknown", payment: "unknown", conflict: true });
  });
  it("uses a specific carrier decision over the generic pending bucket", () => {
    expect(carrierPolicyStatus({ bucket: "pending", rawStatus: "Declined" })).toMatchObject({ coverage: "declined", statusLabel: "Declined", payment: "unknown" });
    expect(carrierPolicyStatus({ bucket: "pending", rawStatus: "Issued" }).statusLabel).toBe("Issued · payment unverified");
    expect(carrierPolicyStatus({ bucket: "pending" }).statusLabel).toBe("Pending");
    expect(carrierPolicyStatus({}).statusLabel).toBe("Status unknown");
  });
  it("does not manufacture a chargeback from a lapse or cancellation", () => {
    expect(carrierPolicyStatus({ rawStatus: "LAPSED" }).recordedChargeback).toBe(false);
    expect(carrierPolicyStatus({ rawStatus: "CANCELED", chargeback: 0 })).toMatchObject({ statusLabel: "Cancelled", recordedChargeback: false });
    expect(carrierPolicyStatus({ rawStatus: "LAPSED", chargeback: 120 }).recordedChargeback).toBe(true);
    expect(carrierPolicyStatus({ rawStatus: "LAPSED", chargeback: -120 }).recordedChargeback).toBe(true);
  });
  it("preserves unfamiliar raw states instead of presenting a made-up submission", () => {
    expect(carrierPolicyStatus({ rawStatus: "REQUIRES_SPECIAL_REVIEW" })).toMatchObject({ rawStatus: "REQUIRES_SPECIAL_REVIEW", statusLabel: "Requires special review", coverage: "unknown", payment: "unknown" });
    expect(carrierPolicyStatus({ preStatus: "DISQUALIFIED_INSTANT_NO_REROUTE" }).statusLabel).toBe("Ineligible");
  });
  it("shows the exact placement-snapshot denominator and unknown exclusions", () => {
    expect(carrierPlacementSnapshot([{ bucket: "active" }, { bucket: "lapsed", rawStatus: "LAPSED" }, { bucket: "declined" }, { bucket: "pending" }, { bucket: "unknown" }, { bucket: "quote" }])).toEqual({
      placed: 2, known: 4, unknown: 1, excludedBeforeSubmission: 1, percent: 50,
    });
    expect(carrierPlacementSnapshot([{ bucket: "unknown" }]).percent).toBeNull();
    expect(carrierPlacementSnapshot([{ bucket: "lapsed", rawStatus: "CANCELLED" }])).toMatchObject({ placed: 0, known: 0, unknown: 1, percent: null });
  });
});
