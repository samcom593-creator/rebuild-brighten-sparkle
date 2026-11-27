/** plaque_awards.amount has multiple units; the recorded milestone writer determines them. */
export interface PlaqueMetricRecord {
  milestone_type: string;
  milestone_date: string;
  amount: number | null;
}

type MetricKind = "alp" | "premium" | "premium_increase" | "hires" | "days" | "unknown";

// Current keys: 20260831090000_recruiting_milestones.sql. Legacy keys:
// check-recruiting-milestones (contracted application counts, day/week).
const HIRE_PERIODS: Record<string, "day" | "month" | "week"> = {
  day_on_the_board: "day", day_recruiter_rising: "day", day_hiring_champion: "day",
  month_first_hire: "month", month_builder: "month", month_team_builder: "month",
  month_agency_builder: "month", month_empire_builder: "month",
  hiring_champion: "day", recruiter_rising: "day", team_builder: "week",
};
const hirePeriod = (key: string) => Object.prototype.hasOwnProperty.call(HIRE_PERIODS, key) ? HIRE_PERIODS[key] : undefined;
// check-streak-milestones and check-daily-awards store a day count.
const STREAK_DAYS = new Set(["hot_streak", "on_fire", "unstoppable", "streak_5", "streak_10", "streak_20"]);
// These writers read daily_production.aop. Keep the neutral premium label;
// the UI cannot establish that every legacy row has the same ALP definition.
const LEGACY_PREMIUM = new Set([
  "single_day_platinum", "single_day", "single_day_bronze", "diamond_week",
  "weekly", "monthly",
  "team_single_day_10k", "team_single_day_25k", "team_two_day_20k", "team_week_50k",
]);
// check-daily-awards, generate-monthly-awards and 20260423200000 explicitly
// write ALP/annual premium. A pasted title alone is not evidence of its unit.
const ALP = new Set(["first_deal_of_day", "first_deal_ever", "monthly_20k", "monthly_top6", "lifetime_100k"]);

export function presentPlaqueMetric(row: Pick<PlaqueMetricRecord, "milestone_type" | "amount">) {
  const period = hirePeriod(row.milestone_type);
  const kind: MetricKind = period ? "hires" : STREAK_DAYS.has(row.milestone_type) ? "days"
    : row.milestone_type === "comeback_champion" ? "premium_increase"
    : LEGACY_PREMIUM.has(row.milestone_type) ? "premium" : ALP.has(row.milestone_type) ? "alp" : "unknown";
  const premium = kind === "alp" || kind === "premium" || kind === "premium_increase";
  const numeric = typeof row.amount === "number" && Number.isFinite(row.amount) ? row.amount : null;
  const available = numeric !== null && (premium ? numeric > 0 : kind === "hires" || kind === "days" ? Number.isInteger(numeric) && numeric >= 0 : true);
  const value = !available || numeric === null ? null : premium
    ? numeric.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: Number.isInteger(numeric) ? 0 : 2, maximumFractionDigits: 2 })
    : numeric.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const label = kind === "alp" ? "Recorded ALP"
    : kind === "premium" ? "Recorded premium"
    : kind === "premium_increase" ? "Recorded premium increase"
    : kind === "hires" ? `${period === "day" ? "Daily" : period === "month" ? "Monthly" : "Weekly"} hires`
    : kind === "days" ? "Streak days" : "Recorded value · unit unavailable";
  const missingText = premium ? "Premium not on file" : kind === "hires" ? "Hire count not on file"
    : kind === "days" ? "Day count not on file" : "Value not on file";
  return { kind, value, label, missingText, missingPremium: premium && !available };
}

export function presentPlaqueDate(row: Pick<PlaqueMetricRecord, "milestone_type" | "milestone_date">) {
  const monthlyBucket = hirePeriod(row.milestone_type) === "month";
  const label = monthlyBucket ? "Milestone month" : "Milestone date";
  const value = row.milestone_date;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { label, value: "Date not on file" };
  const date = new Date(`${value}T12:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return { label, value: "Date not on file" };
  return {
    label,
    value: new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: monthlyBucket ? "long" : "short", day: monthlyBucket ? undefined : "numeric", year: "numeric" }).format(date),
  };
}
