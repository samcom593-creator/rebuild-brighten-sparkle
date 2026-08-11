import { describe, expect, it } from "vitest";

import {
  APEX_JOURNEY_STEPS,
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
      paNumber: " pa 2048 ",
    })).toEqual({
      firstName: "Avery",
      lastName: "James",
      email: "avery@example.com",
      phone: "+16025550123",
      paNumber: "PA 2048",
    });
  });

  it("rejects malformed email, phone, and PA values", () => {
    const result = quickAddAgentSchema.safeParse({
      firstName: "Avery",
      lastName: "James",
      email: "not-an-email",
      phone: "555",
      paNumber: "#",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.map((issue) => issue.path[0])).toEqual(
        expect.arrayContaining(["email", "phone", "paNumber"]),
      );
    }
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
        "launch_ready",
        "first_sale",
        "first_consistent_month",
        "first_leadership_responsibility",
      ]),
    );
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
