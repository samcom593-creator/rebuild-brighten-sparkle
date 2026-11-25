export interface RunRateEvidence {
  mtd_ap: number;
  completed_ap?: number;
  completed_active_days?: number;
}

/** An arithmetic extrapolation of complete Phoenix days. No confidence score,
 * partial-day inflation, future dates, or fabricated forecast for a thin sample. */
export function productionRunRate(metric: RunRateEvidence, completedDays: number | undefined, daysInMonth: number) {
  const valid = typeof completedDays === "number" && Number.isInteger(completedDays)
    && completedDays >= 0 && Number.isInteger(daysInMonth) && daysInMonth >= 28 && daysInMonth <= 31
    && completedDays < daysInMonth && Number.isFinite(metric.mtd_ap) && metric.mtd_ap >= 0
    && typeof metric.completed_ap === "number" && Number.isFinite(metric.completed_ap)
    && metric.completed_ap >= 0 && metric.completed_ap <= metric.mtd_ap
    && typeof metric.completed_active_days === "number" && Number.isInteger(metric.completed_active_days)
    && metric.completed_active_days >= 0 && metric.completed_active_days <= completedDays;
  if (!valid) return { amount: null, dailyAP: null, reason: "The completed-day source sample is unavailable." };
  if (completedDays < 3 || metric.completed_active_days! < 3 || metric.completed_ap! <= 0) {
    return { amount: null, dailyAP: null, reason: "Needs at least three completed days with posted production." };
  }
  const dailyAP = metric.completed_ap! / completedDays;
  return { amount: Math.round(Math.max(metric.mtd_ap, dailyAP * daysInMonth) * 100) / 100, dailyAP, reason: null };
}
