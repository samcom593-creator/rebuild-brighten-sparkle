// Script-step impact (MP-310, 2026-10-29): which steps of the agency scripts get skipped, and what skipping costs.
// Rows come from v_script_step_impact (rubric v2 grades). A close-rate gap on a thin sample is noise, so the
// comparison is only stated when both sides have MIN_SIDE calls.

export interface StepImpact {
  script_followed: string;
  step: string;
  step_order: number;
  calls: number;
  done: number;
  partly: number;
  skipped: number;
  skipped_pct: number | null;
  close_pct_when_done: number | null;
  close_pct_when_missed: number | null;
}

export const MIN_SIDE = 5;
export type StepVerdict = "costs_sales" | "often_skipped" | "solid" | "too_few";

function comparable(r: StepImpact): boolean {
  return r.done >= MIN_SIDE && r.calls - r.done >= MIN_SIDE && r.close_pct_when_done != null && r.close_pct_when_missed != null;
}

/** Close-rate points lost when the step is skipped or rushed, or null when the sample is too thin to say. */
export function stepGap(r: StepImpact): number | null {
  return comparable(r) ? Number(r.close_pct_when_done) - Number(r.close_pct_when_missed) : null;
}

export function stepVerdict(r: StepImpact): StepVerdict {
  const gap = stepGap(r);
  if (gap != null && gap >= 10) return "costs_sales";
  if (r.calls < MIN_SIDE) return "too_few";
  if (Number(r.skipped_pct ?? 0) >= 30) return "often_skipped";
  return "solid";
}

export function stepSentence(r: StepImpact): string {
  const head = `Skipped on ${Math.round(Number(r.skipped_pct ?? 0))}% of ${r.calls} call${r.calls === 1 ? "" : "s"}`;
  if (!comparable(r)) return `${head}.`;
  return `${head}; closes ${Math.round(Number(r.close_pct_when_done))}% when done, ${Math.round(Number(r.close_pct_when_missed))}% when skipped or rushed.`;
}
