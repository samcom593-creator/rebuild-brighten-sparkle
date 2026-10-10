/**
 * The "Over $5K" badge. Sam asked for an honest badge; what he has NOT yet said is which production number it reads
 * (ALP, annual premium, paid?), over what period (today, this month, lifetime?), for whom (personal, with downline?) and
 * how a reversal is treated. The only $5,000 rules on file are single-day milestones (plaque_awards single_day,
 * RecognitionQueue platinum), which are not the same thing as a badge.
 *
 * So the rule is written down and testable, and the badge stays OFF until the definition is confirmed. Turning it on is
 * one change here, not a redesign. While it is off, nothing renders: an undefined metric is never shown as $0.
 */
export interface OverFiveKConfig {
  active: boolean;
  /** Which number counts. null until confirmed. */
  metric: "alp" | "annual_premium" | null;
  /** Over what window. null until confirmed. */
  period: "today" | "month_to_date" | "last_30_days" | "lifetime" | null;
  /** Whose production. null until confirmed. */
  scope: "personal" | "with_downline" | null;
  /** Whether a reversed/cancelled deal is subtracted before the comparison. null until confirmed. */
  reversals: "subtract" | "ignore" | null;
}
export const OVER_5K_THRESHOLD = 5000;
export const OVER_5K: OverFiveKConfig = { active: false, metric: null, period: null, scope: null, reversals: null };

/** Strictly over $5,000. Exactly $5,000 is not over. Unknown (null/undefined/NaN) is never over and never zero. */
export function isOverFiveK(amount: number | null | undefined): boolean | null {
  if (amount == null || typeof amount !== "number" || !Number.isFinite(amount)) return null;
  return amount > OVER_5K_THRESHOLD;
}

const PERIOD_TEXT: Record<NonNullable<OverFiveKConfig["period"]>, string> = {
  today: "today", month_to_date: "this month", last_30_days: "in the last 30 days", lifetime: "lifetime",
};
const METRIC_TEXT: Record<NonNullable<OverFiveKConfig["metric"]>, string> = { alp: "ALP", annual_premium: "annual premium" };

/** The badge's tooltip: it states the metric and the period, or null while the badge is inactive. */
export function overFiveKTooltip(cfg: OverFiveKConfig = OVER_5K): string | null {
  if (!cfg.active || !cfg.metric || !cfg.period || !cfg.scope) return null;
  return `Over $5,000 ${METRIC_TEXT[cfg.metric]} ${PERIOD_TEXT[cfg.period]}${cfg.scope === "with_downline" ? ", including downline" : ", personal production"}${cfg.reversals === "subtract" ? ", reversals subtracted" : ""}.`;
}

/** Whether to render the badge for an amount under the current config. null config/amount → never. */
export function showOverFiveK(amount: number | null | undefined, cfg: OverFiveKConfig = OVER_5K): boolean {
  if (!cfg.active || !overFiveKTooltip(cfg)) return false;
  return isOverFiveK(amount) === true;
}
