import { describe, expect, it } from "vitest";
import { stepGap, stepSentence, stepVerdict, type StepImpact } from "@/lib/scriptStepImpact";

const base: StepImpact = {
  script_followed: "Veteran Final Expense", step: "Getting Bank", step_order: 7, calls: 20, done: 10, partly: 2, skipped: 8,
  skipped_pct: 40, close_pct_when_done: 60, close_pct_when_missed: 20,
};

describe("script step impact", () => {
  it("flags a step whose skipping costs sales", () => {
    expect(stepVerdict(base)).toBe("costs_sales");
    expect(stepGap(base)).toBe(40);
    expect(stepSentence(base)).toContain("closes 60% when done, 20% when skipped or rushed");
  });
  it("does not compare on a thin sample", () => {
    const thin = { ...base, calls: 6, done: 4 };
    expect(stepGap(thin)).toBeNull();
    expect(stepVerdict(thin)).toBe("often_skipped");
    expect(stepSentence(thin)).not.toContain("closes");
  });
  it("calls tiny samples too few", () => {
    expect(stepVerdict({ ...base, calls: 3, done: 2, skipped_pct: 33 })).toBe("too_few");
  });
  it("calls a mostly done step solid", () => {
    expect(stepVerdict({ ...base, done: 18, partly: 1, skipped: 1, skipped_pct: 5, close_pct_when_done: 40, close_pct_when_missed: 35 })).toBe("solid");
  });
});
