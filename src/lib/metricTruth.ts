import { addDays, formatDistanceToNowStrict } from "date-fns";
import { formatInTimeZone, fromZonedTime } from "date-fns-tz";
import {
  ACTIVE_PRODUCER_AP_THRESHOLD_7D,
  ACTIVE_PROMOTED_STAGES,
  LIVE_AGENT_DEAL_WINDOW_DAYS,
  ALP_FULL_NAME,
  ALP_LABEL,
  FORECAST_MIN_ACTIVE_DAYS,
  VALID_DEAL_STATUSES,
} from "@/lib/dataLayer";
import {
  BUSINESS_TIMEZONE,
  getBusinessDayBounds,
  getBusinessDayKey,
  getBusinessMonthBounds,
  getBusinessMonthProjectionContext,
  getBusinessNow,
  getBusinessWeekBounds,
  getMatchedPriorWeekBounds,
} from "@/lib/dateUtils";

export type MetricWindow = "day" | "week" | "month" | "custom";

export interface MetricDefinition {
  key: string;
  sourceTable: "deals" | "applications" | "daily_production" | "agentlink_sync_log";
  dateField: string;
  timezone: string;
  filters: string[];
  freshnessMinutes: number;
  displayLabel: string;
  lastRefreshedAt?: string | null;
}

export interface MetricValue {
  definition: MetricDefinition;
  value: number;
  lastUpdatedAt?: string | null;
  sourceSummary: string;
  confidence?: "low" | "medium" | "high";
}

export interface MetricBounds {
  start: Date;
  end: Date;
  startIso: string;
  endIso: string;
}

export interface CustomMetricRange {
  from?: Date;
  to?: Date;
}

export interface ProjectionResult {
  projection: number;
  confidence: "low" | "medium" | "high";
  activeDays: number;
  elapsedCalendarDays: number;
  daysInMonth: number;
}

export const METRIC_REGISTRY: Record<string, MetricDefinition> = {
  applicationsToday: {
    key: "applicationsToday",
    sourceTable: "applications",
    dateField: "created_at",
    timezone: BUSINESS_TIMEZONE,
    filters: ["terminated_at IS NULL"],
    freshnessMinutes: 5,
    displayLabel: "Applications Today",
  },
  hiresToday: {
    key: "hiresToday",
    sourceTable: "applications",
    dateField: "closed_at",
    timezone: BUSINESS_TIMEZONE,
    filters: ["closed_at IS NOT NULL"],
    freshnessMinutes: 5,
    displayLabel: "Hires Today",
  },
  dealsToday: {
    key: "dealsToday",
    sourceTable: "deals",
    dateField: "posted_at",
    timezone: BUSINESS_TIMEZONE,
    filters: [`status IN (${VALID_DEAL_STATUSES.join(",")})`],
    freshnessMinutes: 15,
    displayLabel: "Today's ALP",
  },
  weeklyAlp: {
    key: "weeklyAlp",
    sourceTable: "deals",
    dateField: "posted_at",
    timezone: BUSINESS_TIMEZONE,
    filters: [`status IN (${VALID_DEAL_STATUSES.join(",")})`],
    freshnessMinutes: 15,
    displayLabel: "Weekly ALP",
  },
  monthlyAlp: {
    key: "monthlyAlp",
    sourceTable: "deals",
    dateField: "posted_at",
    timezone: BUSINESS_TIMEZONE,
    filters: [`status IN (${VALID_DEAL_STATUSES.join(",")})`],
    freshnessMinutes: 15,
    displayLabel: "This Month's ALP",
  },
  leaderboards: {
    key: "leaderboards",
    sourceTable: "deals",
    dateField: "posted_at",
    timezone: BUSINESS_TIMEZONE,
    filters: [`status IN (${VALID_DEAL_STATUSES.join(",")})`],
    freshnessMinutes: 15,
    displayLabel: "Leaderboard totals",
  },
  activeAgents: {
    key: "activeAgents",
    sourceTable: "deals",
    dateField: "posted_at",
    timezone: BUSINESS_TIMEZONE,
    filters: [
      `agent has >= 1 submitted/active deal posted in the last ${LIVE_AGENT_DEAL_WINDOW_DAYS} days`,
    ],
    freshnessMinutes: 15,
    displayLabel: "Live Agents",
  },
  presentations: {
    key: "presentations",
    sourceTable: "daily_production",
    dateField: "production_date",
    timezone: BUSINESS_TIMEZONE,
    filters: ["presentations only; not ALP truth"],
    freshnessMinutes: 15,
    displayLabel: "Presentations",
  },
};

export { ACTIVE_PRODUCER_AP_THRESHOLD_7D, ACTIVE_PROMOTED_STAGES, ALP_FULL_NAME, ALP_LABEL };
export { LIVE_AGENT_DEAL_WINDOW_DAYS };
export { BUSINESS_TIMEZONE };

export function getLiveAgentCutoffIso(now: Date = getBusinessNow()): string {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - LIVE_AGENT_DEAL_WINDOW_DAYS);
  return cutoff.toISOString();
}

export function getMetricBounds(window: MetricWindow, customRange?: CustomMetricRange): MetricBounds {
  if (window === "custom" && customRange?.from && customRange.to) {
    const startKey = formatInTimeZone(customRange.from, BUSINESS_TIMEZONE, "yyyy-MM-dd");
    const endKey = formatInTimeZone(customRange.to, BUSINESS_TIMEZONE, "yyyy-MM-dd");
    const start = fromZonedTime(`${startKey}T00:00:00`, BUSINESS_TIMEZONE);
    const end = fromZonedTime(
      `${formatInTimeZone(addDays(customRange.to, 1), BUSINESS_TIMEZONE, "yyyy-MM-dd")}T00:00:00`,
      BUSINESS_TIMEZONE,
    );
    return {
      start,
      end,
      startIso: start.toISOString(),
      endIso: end.toISOString(),
    };
  }

  if (window === "day") return getBusinessDayBounds();
  if (window === "week") return getBusinessWeekBounds();
  return getBusinessMonthBounds();
}

export function getPriorWeekMatchedBounds(): MetricBounds & { elapsedDays: number } {
  return getMatchedPriorWeekBounds();
}

export function projectMonthEndAlp(mtdAlp: number, activeDays: number): ProjectionResult {
  const { elapsedCalendarDays, daysInMonth } = getBusinessMonthProjectionContext();
  const clampedProjection = elapsedCalendarDays > 0
    ? Math.min(
        Math.max(mtdAlp, (mtdAlp / elapsedCalendarDays) * daysInMonth),
        mtdAlp * 5,
      )
    : mtdAlp;

  const confidence = activeDays >= 10 ? "high" : activeDays >= 5 ? "medium" : "low";

  return {
    projection: activeDays < FORECAST_MIN_ACTIVE_DAYS ? mtdAlp : Math.round(clampedProjection),
    confidence,
    activeDays,
    elapsedCalendarDays,
    daysInMonth,
  };
}

export function sumAnnualPremium(rows: Array<{ annual_premium?: number | null }>): number {
  return rows.reduce((sum, row) => sum + Number(row.annual_premium ?? 0), 0);
}

export function countDistinctAgents<T extends { agent_id?: string | null }>(rows: T[]): number {
  return new Set(rows.map((row) => row.agent_id).filter(Boolean)).size;
}

export function countDistinctBusinessDays<T extends { posted_at?: string | null; created_at?: string | null }>(rows: T[]): number {
  return new Set(
    rows
      .map((row) => row.posted_at || row.created_at)
      .filter(Boolean)
      .map((value) => getBusinessDayKey(new Date(value as string))),
  ).size;
}

export function formatMetricSource(definition: MetricDefinition, lastUpdatedAt?: string | null): string {
  const refreshed = lastUpdatedAt
    ? ` · updated ${formatDistanceToNowStrict(new Date(lastUpdatedAt), { addSuffix: true })}`
    : "";
  return `${definition.displayLabel} · ${definition.sourceTable}.${definition.dateField} · ${definition.timezone}${refreshed}`;
}

export function isAgentLinkSyncStale(lastSuccessAt?: string | null, freshnessMinutes = 15): boolean {
  if (!lastSuccessAt) return true;
  const ageMs = getBusinessNow().getTime() - new Date(lastSuccessAt).getTime();
  return ageMs > freshnessMinutes * 60_000;
}

export function shouldAutoRepairLeaderboards(now: Date = getBusinessNow()): boolean {
  const businessNow = now;
  return businessNow.getHours() > 9 || (businessNow.getHours() === 9 && businessNow.getMinutes() >= 30);
}

export function getCloseRate(deals: number, presentations: number): number {
  if (presentations <= 0) return 0;
  return Math.round((deals / presentations) * 1000) / 10;
}

export function getTodayMetricSummary(lastUpdatedAt?: string | null): string {
  return `${ALP_FULL_NAME} truth from posted deals in ${BUSINESS_TIMEZONE}${lastUpdatedAt ? ` · refreshed ${formatDistanceToNowStrict(new Date(lastUpdatedAt), { addSuffix: true })}` : ""}`;
}
