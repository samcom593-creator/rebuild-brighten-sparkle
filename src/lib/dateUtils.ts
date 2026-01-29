import { format, subDays, startOfWeek, startOfMonth } from "date-fns";
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
 * Get the start of current week in PST (Sunday start) as YYYY-MM-DD string
 */
export function getWeekStartPST(): string {
  const pstNow = getNowPST();
  return format(startOfWeek(pstNow, { weekStartsOn: 0 }), "yyyy-MM-dd");
}

/**
 * Get the start of current month in PST as YYYY-MM-DD string
 */
export function getMonthStartPST(): string {
  const pstNow = getNowPST();
  return format(startOfMonth(pstNow), "yyyy-MM-dd");
}

/**
 * Format a Date object as YYYY-MM-DD string
 */
export function formatDateString(date: Date): string {
  return format(date, "yyyy-MM-dd");
}
