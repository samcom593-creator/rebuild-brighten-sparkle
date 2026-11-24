import { describe, expect, it } from "vitest";
import { LICENSING_STEPS, nextStepLine, normalizeStep, stepLabel } from "@/lib/licensingStep";

describe("licensingStep", () => {
  it("every step has a label and a next action, and never offers 'licensed'", () => {
    for (const s of LICENSING_STEPS) { expect(s.label.length).toBeGreaterThan(0); expect(s.next.length).toBeGreaterThan(0); }
    expect(LICENSING_STEPS.map((s) => s.value)).not.toContain("licensed");
  });

  it("reads older synonyms and unknown values without inventing progress", () => {
    expect(normalizeStep("exam_passed")).toBe("passed_test");
    expect(normalizeStep("course_started")).toBe("course_purchased");
    expect(normalizeStep("in_field_training")).toBe("unlicensed");
    expect(normalizeStep(null)).toBe("unlicensed");
  });

  it("names the step and what comes next", () => {
    expect(stepLabel("finished_course")).toBe("Finished the course");
    expect(nextStepLine("finished_course")).toBe("Book your state exam now, while the material is fresh.");
    expect(stepLabel(undefined)).toBe("Not started");
  });
});
