import { format, subDays, startOfWeek, startOfMonth, endOfWeek, endOfMonth } from "date-fns";
import { toZonedTime } from "date-fns-tz";

const PST_TIMEZONE = "America/Los_Angeles";

/**
 * Get the current date/time in PST timezone
 */
export function getNowPST(): Date {
  return toZonedTime(new Date(), PST_TIMEZONE);
}

/**
 * Get today's date in PST timezone as YYYY-MM-DD string
 */
export function getTodayPST(): string {
  const pstNow = getNowPST();
  return format(pstNow, "yyyy-MM-dd");
}

/**
 * Get a date N days ago in PST timezone as YYYY-MM-DD string
 */
export function getDateDaysAgoPST(daysAgo: number): string {
  const pstNow = getNowPST();
  return format(subDays(pstNow, daysAgo), "yyyy-MM-dd");
}

/**
 * Start of the current ROLLING 7-day window in PST (today minus 6 days), as
 * YYYY-MM-DD. We dropped the ISO Mon-Sun window because it collapsed to 1-2
 * days every Monday/Tuesday morning, making "this week" look broken until
 * Friday. Rolling 7d always reflects ~a full week of activity, matches
 * Sam's active-agent rule (>=$4k AP last 7d), and matches the intuitive
 * meaning of "weekly" on the dashboard.
 *
 * Note: the function is named `WeekStartPST` for backwards compatibility
 * across many call sites; it now returns the rolling 7d start.
 */
export function getWeekStartPST(): string {
  const pstNow = getNowPST();
  return format(subDays(pstNow, 6), "yyyy-MM-dd");
}

/**
 * Start of the current ROLLING 30-day window in PST (today minus 29 days),
 * as YYYY-MM-DD. Same reasoning as `getWeekStartPST` — calendar-month-MTD
 * crashed to $0 every May 1, July 1, etc., even though production was
 * unchanged. Rolling 30d reads as "this month" without the cliff.
 */
export function getMonthStartPST(): string {
  const pstNow = getNowPST();
  return format(subDays(pstNow, 29), "yyyy-MM-dd");
}

/**
 * Calendar-week (ISO Mon-Sun) start in PST. Reserved for surfaces that
 * specifically need calendar-week semantics (cohort tables, weekly recap
 * digests). Most dashboard widgets should use `getWeekStartPST` instead.
 */
export function getIsoWeekStartPST(): string {
  const pstNow = getNowPST();
  return format(startOfWeek(pstNow, { weekStartsOn: 1 }), "yyyy-MM-dd");
}

/**
 * Calendar-month (date_trunc('month')) start in PST. Reserved for
 * surfaces that specifically need MTD semantics (commission rollups,
 * monthly recap emails). Most dashboard widgets should use
 * `getMonthStartPST` instead.
 */
export function getCalendarMonthStartPST(): string {
  const pstNow = getNowPST();
  return format(startOfMonth(pstNow), "yyyy-MM-dd");
}

/**
 * Format a Date object as YYYY-MM-DD string
 */
export function formatDateString(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/**
 * Get the end of current week in PST (Saturday end) as YYYY-MM-DD string
 */
export function getWeekEndPST(): string {
  const pstNow = getNowPST();
  return format(endOfWeek(pstNow, { weekStartsOn: 1 }), "yyyy-MM-dd");
}

/**
 * Get the end of current month in PST as YYYY-MM-DD string
 */
export function getMonthEndPST(): string {
  const pstNow = getNowPST();
  return format(endOfMonth(pstNow), "yyyy-MM-dd");
}
