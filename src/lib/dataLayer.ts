/**
 * Truth-layer constants — APEX dashboard data rules
 *
 * Single source of truth for the rules every dashboard widget MUST follow.
 * Import these instead of hardcoding string literals so a future rule
 * change updates every consumer in one place.
 *
 * Background:
 * - `daily_production.aop` is the OLD self-reported source. It drifts
 *   ~$345k vs deals truth on 30d windows AND held the AL phantom-Sam
 *   pollution (1948-dated rows attributing $2.1M / 1,155 deals to Sam).
 *   The 2026-04-27 truth-layer-repair migration cleared Sam's rows but
 *   the column itself stays (it's still the source of `presentations`).
 * - `deals` table is canonical for ALP and deal counts.
 * - `agent_lifetime_production` is heavily polluted (sums to $1.9M lifetime
 *   ALP vs deals truth $790k). Do NOT read it for any UI metric until
 *   rebuilt from deals.
 */

/** Deal statuses that count as ALP-producing production. */
export const VALID_DEAL_STATUSES = ["submitted", "active"] as const;
export type ValidDealStatus = typeof VALID_DEAL_STATUSES[number];

/** Sam's agent_id — must always have zero deals (DB triggers + UI guards enforce). */
export const SAM_AGENT_ID = "7c3c5581-3544-437f-bfe2-91391afb217d";

/**
 * Live-agent rule.
 *
 * Sam's launch definition: an agent is live only when they have submitted at
 * least one valid deal in the last 10 days. Agent profile status, onboarding
 * stage, or recent promotion do not count as a live activation by themselves.
 */
export const LIVE_AGENT_DEAL_WINDOW_DAYS = 10;
export const ACTIVE_PRODUCER_WINDOW_DAYS = LIVE_AGENT_DEAL_WINDOW_DAYS;
export const ACTIVE_PRODUCER_AP_THRESHOLD_7D = 0; // legacy alias; deal existence is the rule now.
export const ACTIVE_PROMOTED_STAGES = ["live", "evaluated", "transfer"] as const;

/** Forecast guardrails — prevent insane projections from sparse data. */
export const FORECAST_MIN_ACTIVE_DAYS = 3;
export const FORECAST_MAX_MULTIPLIER = 5; // never project beyond 5x MTD
export const FORECAST_CONFIDENCE_BANDS = {
  high: 10, // active days needed
  medium: 5,
} as const;

/** Roster filter — "on the team". */
export const ROSTER_FILTER = {
  is_deactivated: false,
  is_inactive: false,
} as const;

/**
 * SQL fragment for filtering deals to truth-layer.
 * Use as: `.in("status", VALID_DEAL_STATUSES as unknown as string[])`
 */
export const dealsTruthFilter = (qb: any) =>
  qb.in("status", VALID_DEAL_STATUSES as unknown as string[])
    .neq("agent_id", SAM_AGENT_ID);

/**
 * Nominal label for the metric — ALP, never AOP.
 * Ban: "Annual Operating Premium", "AOP", "Aop"
 * Allow: "ALP", "Annual Life Premium" (full term in tooltips)
 */
export const ALP_LABEL = "ALP";
export const ALP_FULL_NAME = "Annual Life Premium";

/** Forbidden table reads for ALP/deal stats. (Keep for presentations only.) */
export const FORBIDDEN_FOR_ALP = [
  "daily_production",          // historical, drift, AL pollution
  "agent_lifetime_production", // pollution lake, $1.1M phantom
  "agentlink_book_of_business",// secondary mirror
] as const;

/** Confidence tier from active days. */
export function forecastConfidence(activeDays: number): "low" | "medium" | "high" {
  if (activeDays >= FORECAST_CONFIDENCE_BANDS.high) return "high";
  if (activeDays >= FORECAST_CONFIDENCE_BANDS.medium) return "medium";
  return "low";
}

/** Cap projection so single-day spikes can't yield $4M month-end fantasy. */
export function capProjection(rawProjection: number, mtd: number, activeDays: number): number {
  if (activeDays < FORECAST_MIN_ACTIVE_DAYS) return mtd; // not enough data; just show MTD
  return Math.max(0, Math.min(rawProjection, mtd * FORECAST_MAX_MULTIPLIER));
}

/** Format earnings as Unavailable when commission data is missing. */
export const EARNINGS_UNAVAILABLE_LABEL = "Unavailable — needs commission setup";
export function isEarningsUnavailable(commissionRowCount: number, total: number): boolean {
  return commissionRowCount === 0 || total === 0;
}
