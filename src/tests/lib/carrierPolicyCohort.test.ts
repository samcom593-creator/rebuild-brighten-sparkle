import { describe, expect, it } from "vitest";
import { cohortPlacement, parseCarrierPolicyCohort, type CarrierCohortTotals } from "@/lib/carrierPolicyCohort";

export const completeCohort: CarrierCohortTotals = {
  posted_policies: 4, posted_ap: 4800, matched_policies: 4, unmatched_policies: 0,
  ambiguous_policies: 0, status_known_policies: 4, payment_supported_policies: 4,
  paying_status_policies: 2, paying_status_ap: 2400, in_force_policies: 2,
  pending_policies: 1, not_placed_policies: 1, at_risk_policies: 0, lapsed_policies: 0,
  conflicting_policies: 0, oldest_observed_on: "2026-11-23", newest_observed_on: "2026-11-24",
};
const payload = () => ({ viewer_user_id: "viewer-a", requested_agent_id: "alias-a", agent_id: "canonical-a",
  window: { start: "2026-11-01", end_exclusive: "2026-11-25" }, as_of: "2026-11-24T23:00:00Z",
  timezone: "America/Phoenix", scopes: { personal: { ...completeCohort } }, basis: "Synthetic fixture" });
const expected = { userId: "viewer-a", agentId: "alias-a", start: "2026-11-01", endExclusive: "2026-11-25" };

describe("application-cohort carrier outcomes", () => {
  it("uses the full posted cohort and withholds total placement for any evidence gap", () => {
    expect(cohortPlacement(completeCohort)).toEqual({ missingEvidence: 0, percent: 50 });
    expect(cohortPlacement({ ...completeCohort, payment_supported_policies: 3 })).toEqual({ missingEvidence: 1, percent: null });
    expect(cohortPlacement({ ...completeCohort, posted_policies: 0, payment_supported_policies: 0, paying_status_policies: 0 }).percent).toBeNull();
  });
  it("accepts canonical aliases only for the requested account, agent and exact window", () => {
    expect(parseCarrierPolicyCohort(payload(), expected).agent_id).toBe("canonical-a");
    for (const wrong of [{ ...expected, userId: "viewer-b" }, { ...expected, agentId: "canonical-a" }, { ...expected, endExclusive: "2026-11-26" }]) {
      expect(() => parseCarrierPolicyCohort(payload(), wrong)).toThrow(/did not match/);
    }
  });
  it("rejects inconsistent joins and unsupported payment numerators", () => {
    for (const invalid of [{ unmatched_policies: 1 }, { paying_status_policies: 5 }, { status_known_policies: 3 }, { conflicting_policies: 5 }, { paying_status_ap: -20 }]) {
      const raw = payload();
      raw.scopes.personal = { ...completeCohort, ...invalid };
      expect(() => parseCarrierPolicyCohort(raw, expected)).toThrow();
    }
  });
  it("keeps unavailable premium distinct from a supported zero", () => {
    const raw = payload();
    raw.scopes.personal = { ...completeCohort, paying_status_ap: null };
    expect(parseCarrierPolicyCohort(raw, expected).scopes.personal.paying_status_ap).toBeNull();
    raw.scopes.personal.paying_status_ap = 0;
    expect(parseCarrierPolicyCohort(raw, expected).scopes.personal.paying_status_ap).toBe(0);
  });
});
