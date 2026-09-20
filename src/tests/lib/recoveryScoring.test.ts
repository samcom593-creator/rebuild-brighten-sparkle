import { describe, expect, it } from "vitest";

import {
  firstAttemptDueAt,
  normalizeRecoveryStatus,
  priorityBand,
  scoreRecoveryOpportunity,
  type RecoveryScoreInput,
} from "@/lib/recovery/scoring";

const now = new Date("2026-09-06T18:00:00.000Z");

function opportunity(patch: Partial<RecoveryScoreInput> = {}): RecoveryScoreInput {
  return {
    rawStatus: "Initial Premium Failed",
    recordDate: "2026-09-04T18:00:00.000Z",
    resumeCapable: true,
    hasProductSelection: true,
    administrativeIssue: true,
    hasValidPhone: true,
    hasValidEmail: true,
    contactBasisConfirmed: true,
    lastAttemptAt: null,
    hasLicensedAgentAvailable: true,
    workflow: "NEW",
    ...patch,
  };
}

describe("APEX Recovery Command scoring", () => {
  it("normalizes the source states used by Ethos and carrier imports", () => {
    expect(normalizeRecoveryStatus("Initial Premium Failed")).toBe("INITIAL_PREMIUM_FAILED");
    expect(normalizeRecoveryStatus("Pending Initial Premium")).toBe("PENDING_INITIAL_PREMIUM");
    expect(normalizeRecoveryStatus("Premium Paying")).toBe("POLICY_ACTIVE");
    expect(normalizeRecoveryStatus("Application Started")).toBe("APPLICATION_STARTED");
    expect(normalizeRecoveryStatus("Underwriting Declined")).toBe("UNDERWRITING_DECLINED");
  });

  it("implements every priority boundary without redistributing missing points", () => {
    expect(priorityBand(80)).toBe("A");
    expect(priorityBand(79)).toBe("B");
    expect(priorityBand(60)).toBe("B");
    expect(priorityBand(59)).toBe("C");
    expect(priorityBand(40)).toBe("C");
    expect(priorityBand(39)).toBe("D");

    const incomplete = scoreRecoveryOpportunity(opportunity({ recordDate: null, hasValidPhone: false, hasValidEmail: false }), now);
    expect(incomplete.components.find((part) => part.key === "recency")?.points).toBe(0);
    expect(incomplete.components.find((part) => part.key === "contactability")?.points).toBe(2);
    expect(incomplete.confidence).toBe("partial");
  });

  it("puts strong recent payment failures in low-hanging fruit", () => {
    const result = scoreRecoveryOpportunity(opportunity(), now);
    expect(result.score).toBe(100);
    expect(result.band).toBe("A");
    expect(result.lane).toBe("LOW_HANGING");
    expect(result.eligible).toBe(true);
  });

  it("isolates active policies and never counts them as recovery opportunities", () => {
    const result = scoreRecoveryOpportunity(opportunity({ rawStatus: "Premium Paying" }), now);
    expect(result.lane).toBe("ACTIVE_POLICY_REVIEW");
    expect(result.eligible).toBe(false);
  });

  it("sends suppressions, duplicates, declines, and licensing gaps to blocked review", () => {
    expect(scoreRecoveryOpportunity(opportunity({ suppressed: true }), now).lane).toBe("BLOCKED");
    expect(scoreRecoveryOpportunity(opportunity({ probableDuplicate: true }), now).lane).toBe("BLOCKED");
    expect(scoreRecoveryOpportunity(opportunity({ rawStatus: "Underwriting Declined" }), now).lane).toBe("BLOCKED");
    expect(scoreRecoveryOpportunity(opportunity({ hasLicensedAgentAvailable: false }), now).lane).toBe("BLOCKED");
  });

  it("counts PREMIUM_PAYING as recovered and no earlier workflow stage", () => {
    expect(scoreRecoveryOpportunity(opportunity({ workflow: "ISSUED" }), now).lane).not.toBe("RECOVERED");
    expect(scoreRecoveryOpportunity(opportunity({ workflow: "PREMIUM_PAYING" }), now).lane).toBe("RECOVERED");
  });

  it("starts Priority A SLA exactly two hours after assignment", () => {
    expect(firstAttemptDueAt("2026-09-06T18:00:00.000Z", "A")).toBe("2026-09-06T20:00:00.000Z");
    expect(firstAttemptDueAt(null, "A")).toBeNull();
  });
});
