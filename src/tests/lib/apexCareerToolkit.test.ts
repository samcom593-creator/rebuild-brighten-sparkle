import { describe, expect, it } from "vitest";

import {
  APEX_JOURNEY_STEPS,
  buildRecruitLifecycleSnapshot,
  calculateCareerQualification,
  normalizeQuickAddAgent,
  quickAddAgentSchema,
} from "@/lib/apexCareerToolkit";

describe("quickAddAgentSchema", () => {
  it("normalizes the five accepted agent fields", () => {
    expect(normalizeQuickAddAgent({
      firstName: "  Avery ",
      lastName: " James ",
      email: " AVERY@EXAMPLE.COM ",
      phone: "(602) 555-0123",
      npn: " NPN 21-346-999 ",
    })).toEqual({
      firstName: "Avery",
      lastName: "James",
      email: "avery@example.com",
      phone: "+16025550123",
      npn: "21346999",
    });
  });

  it("rejects malformed email, phone, and NPN values", () => {
    const result = quickAddAgentSchema.safeParse({
      firstName: "Avery",
      lastName: "James",
      email: "not-an-email",
      phone: "555",
      npn: "#",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path[0])).toEqual(
        expect.arrayContaining(["email", "phone", "npn"]),
      );
    }
  });

  it("enforces the NPN 5-to-10-digit boundary", () => {
    const base = {
      firstName: "Avery",
      lastName: "James",
      email: "avery@example.com",
      phone: "6025550123",
    };
    expect(quickAddAgentSchema.safeParse({ ...base, npn: "1234" }).success).toBe(false);
    expect(quickAddAgentSchema.safeParse({ ...base, npn: "12345" }).success).toBe(true);
    expect(quickAddAgentSchema.safeParse({ ...base, npn: "1234567890" }).success).toBe(true);
    expect(quickAddAgentSchema.safeParse({ ...base, npn: "12345678901" }).success).toBe(false);
  });
});

describe("APEX_JOURNEY_STEPS", () => {
  it("covers the full licensing-through-leadership milestone sequence", () => {
    expect(APEX_JOURNEY_STEPS.unlicensed.map((step) => step.key)).toEqual(
      expect.arrayContaining([
        "course_active",
        "exam_scheduled",
        "exam_passed",
        "licensed",
        "first_sale",
        "first_consistent_month",
        "first_leadership_responsibility",
      ]),
    );
    expect(APEX_JOURNEY_STEPS.licensed.map((step) => step.key)).toEqual(
      expect.arrayContaining([
        "agentlink",
        "contracting",
        "training",
        "certification",
        "launch_ready",
        "first_sale",
        "first_consistent_month",
        "first_leadership_responsibility",
      ]),
    );
  });
});

describe("buildRecruitLifecycleSnapshot", () => {
  it("continues an unlicensed recruit beyond licensing through first sale", () => {
    const snapshot = buildRecruitLifecycleSnapshot({
      path: "unlicensed",
      licenseStatus: "licensed",
      licenseProgress: "licensed",
      startedTraining: true,
      completedSteps: ["welcome", "training", "certification", "launch_ready"],
      lastProgressAt: "2026-08-19T12:00:00Z",
      now: new Date("2026-08-20T12:00:00Z"),
    });

    expect(snapshot.license.label).toBe("Verified");
    expect(snapshot.apexTraining.label).toBe("Complete");
    expect(snapshot.certification.label).toBe("Passed");
    expect(snapshot.launchReady.label).toBe("Ready");
    expect(snapshot.firstSale.label).toBe("No");
    expect(snapshot.nextAction).toBe("Profile & documents");
  });

  it("shows failed exams and a truthful stalled-risk state", () => {
    const snapshot = buildRecruitLifecycleSnapshot({
      path: "unlicensed",
      licenseStatus: "pending",
      licenseProgress: "failed_test",
      startedTraining: false,
      completedSteps: ["welcome"],
      lastProgressAt: "2026-08-01T12:00:00Z",
      now: new Date("2026-08-20T12:00:00Z"),
    });

    expect(snapshot.examResult).toEqual({ label: "Failed · retest", tone: "failed" });
    expect(snapshot.risk).toEqual({ label: "Red · 19d", tone: "failed" });
    expect(snapshot.percentComplete).toBeLessThan(50);
  });
});

describe("calculateCareerQualification", () => {
  it("uses the weaker of two consecutive production months", () => {
    const result = calculateCareerQualification({
      track: "producer",
      firstMonthProduction: 32_000,
      secondMonthProduction: 21_000,
      qualifyingLegs: 0,
    });
    expect(result.current.title).toBe("Partner");
    expect(result.twoMonthProduction).toBe(21_000);
    expect(result.next?.title).toBe("Senior Partner");
    expect(result.productionRemaining).toBe(4_000);
  });

  it("enforces builder leg requirements at VP and above", () => {
    const withoutLegs = calculateCareerQualification({
      track: "builder",
      firstMonthProduction: 450_000,
      secondMonthProduction: 450_000,
      qualifyingLegs: 2,
    });
    expect(withoutLegs.current.level).toBe(125);
    expect(withoutLegs.next?.level).toBe(130);
    expect(withoutLegs.legsRemaining).toBe(1);

    const withLegs = calculateCareerQualification({
      track: "builder",
      firstMonthProduction: 450_000,
      secondMonthProduction: 450_000,
      qualifyingLegs: 3,
    });
    expect(withLegs.current.level).toBe(130);
  });
});
