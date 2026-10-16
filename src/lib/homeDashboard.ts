/**
 * Pure contracts for the Home operating dashboard (AgentCloudHome): the
 * period windows the apex_admin_home_dashboard RPC is called with, and the
 * validation of a custom range before it is committed.
 *
 * F22 (2026-10-14 Galaxy OS map): every window here is built in date-key
 * space with the businessClock helpers. The previous builder constructed
 * `new Date(y, m, 1)` (midnight in the viewer's zone) and formatted it in
 * Phoenix, which read the October 2026 window as 2026-09-30..2026-10-31 in
 * New York, UTC and London, dropped Oct 31 out of "this month", and under
 * UTC read "today" as yesterday for the first seven hours of each day. Keys
 * never touch the viewer's zone, so one key gives one window everywhere.
 *
 * The RPC (apex_admin_home_dashboard -> apex_admin_home_dashboard_uncached
 * -> apex_home_dashboard) takes date parameters and filters
 * `posted_date >= p_start and posted_date < p_end` in America/Phoenix days,
 * so every window here is end-exclusive and the keys go straight in. The
 * server also rejects p_end <= p_start and spans over 3660 days (measured
 * on 2026-10-15); validateCustomRange mirrors both so the viewer reads a
 * message instead of a failed call.
 */
import { monthStartKey, shiftDateKey, shiftMonthKey, yearStartKey } from "@/lib/businessClock";

export type PeriodKey = "this_month" | "last_month" | "last_30" | "last_90" | "ytd" | "custom";

export const PERIODS: ReadonlyArray<{ key: PeriodKey; label: string }> = [
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "last_30", label: "Last 30 days" },
  { key: "last_90", label: "Last 90 days" },
  { key: "ytd", label: "Year to date" },
  { key: "custom", label: "Custom range" },
];

/** What apex_admin_home_dashboard returns. */
export interface HomeData {
  as_of: string;
  today: { personal_ap: number; personal_policies: number; team_ap: number; team_policies: number };
  mtd: { personal_ap: number; personal_policies: number; team_ap: number; team_policies: number; goal: number; pct_to_goal: number; days_left: number };
  lifetime: { ap: number; policies: number };
  trend: Array<{ m: string; ap: number; policies: number }>;
  leaderboard: Array<{ name: string; ap: number; deals: number }>;
  policy_status: Record<string, number>;
  roster: { total: number; producing: number; in_onboarding: number };
  needs_attention: { lapse_pending: number; in_chargeback_window: number; dormant_producers: number };
}

/** A half-open window of business dates: start inclusive, end exclusive, both "YYYY-MM-DD". */
export interface DateWindow {
  start: string;
  end: string;
  label: string;
}

/** Both bounds inclusive, exactly as the viewer typed them. */
export interface CustomRange {
  start: string;
  end: string;
}

/** The widest inclusive span the RPC accepts; apex_admin_home_dashboard_uncached raises above it. */
export const MAX_CUSTOM_RANGE_DAYS = 3660;

const KEY_RX = /^\d{4}-\d{2}-\d{2}$/;

/** True for a real calendar date written as "YYYY-MM-DD"; "2026-02-30" is not one. */
export function isDateKey(value: string): boolean {
  // shiftDateKey normalises through Date.UTC, so an impossible day does not round-trip.
  return KEY_RX.test(value) && shiftDateKey(value, 0) === value;
}

function dayNumber(key: string): number {
  const [y, m, d] = key.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** Days from start to end, both included. Only meaningful for two valid keys. */
export function inclusiveDays(start: string, end: string): number {
  return dayNumber(end) - dayNumber(start) + 1;
}

export type CustomRangeCheck =
  | { ok: true; range: CustomRange }
  | { ok: false; message: string };

/**
 * F23: the inputs edit a draft; only a draft that passes here becomes the
 * committed range. Every refusal names what to change, and none of them
 * disables anything on the page.
 */
export function validateCustomRange(range: CustomRange): CustomRangeCheck {
  const start = range.start.trim();
  const end = range.end.trim();
  if (!start && !end) return { ok: false, message: "Pick a start date and an end date." };
  if (!start) return { ok: false, message: "Pick a start date." };
  if (!end) return { ok: false, message: "Pick an end date." };
  if (!isDateKey(start) || !isDateKey(end)) return { ok: false, message: "Enter both dates as a full calendar date (YYYY-MM-DD)." };
  if (start > end) return { ok: false, message: "The start date must be on or before the end date." };
  if (inclusiveDays(start, end) > MAX_CUSTOM_RANGE_DAYS) {
    return { ok: false, message: `Pick a range of at most ${MAX_CUSTOM_RANGE_DAYS} days.` };
  }
  return { ok: true, range: { start, end } };
}

/**
 * "September 2026" for any key in that month. Formatted in UTC from a UTC
 * instant: one zone in, the same zone out, so the viewer's clock cannot
 * move the label to the previous month.
 */
export function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
}

/** "Sep 26" for a "YYYY-MM" trend bucket; same single-zone rule as monthLabel. */
export function monthShort(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, (m ?? 1) - 1, 1)).toLocaleDateString("en-US", { month: "short", year: "2-digit", timeZone: "UTC" });
}

export const money = (n: number | null | undefined) => `$${Math.round(Number(n ?? 0)).toLocaleString()}`;

/**
 * The window for a period, anchored on the business-day key the page is
 * showing (useBusinessToday, America/Phoenix). `custom` must already have
 * passed validateCustomRange; AgentCloudHome only commits ranges that did.
 */
export function windowFor(key: PeriodKey, custom: CustomRange, todayKey: string): DateWindow {
  switch (key) {
    case "last_month": {
      const start = shiftMonthKey(todayKey, -1);
      return { start, end: monthStartKey(todayKey), label: monthLabel(start) };
    }
    case "last_30":
      return { start: shiftDateKey(todayKey, -29), end: shiftDateKey(todayKey, 1), label: "Last 30 days" };
    case "last_90":
      return { start: shiftDateKey(todayKey, -89), end: shiftDateKey(todayKey, 1), label: "Last 90 days" };
    case "ytd":
      return { start: yearStartKey(todayKey), end: shiftDateKey(todayKey, 1), label: `${todayKey.slice(0, 4)} to date` };
    case "custom":
      return { start: custom.start, end: shiftDateKey(custom.end, 1), label: `${custom.start} - ${custom.end}` };
    default:
      return { start: monthStartKey(todayKey), end: shiftMonthKey(todayKey, 1), label: "This month" };
  }
}
