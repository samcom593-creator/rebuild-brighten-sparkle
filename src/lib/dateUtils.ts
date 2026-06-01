import {
  addDays,
  differenceInCalendarDays,
  endOfMonth,
  format,
  startOfMonth,
  startOfWeek,
  subDays,
  subMonths,
  subWeeks,
} from "date-fns";
import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";

export const BUSINESS_TIMEZONE = "America/Chicago";

function toBusinessTime(date: Date = new Date()): Date {
  return toZonedTime(date, BUSINESS_TIMEZONE);
}

function businessDayKey(date: Date = new Date()): string {
  return formatInTimeZone(date, BUSINESS_TIMEZONE, "yyyy-MM-dd");
}

function startOfBusinessDay(date: Date = new Date()): Date {
  return fromZonedTime(`${businessDayKey(date)}T00:00:00`, BUSINESS_TIMEZONE);
}

function endOfBusinessDay(date: Date = new Date()): Date {
  return fromZonedTime(`${businessDayKey(addDays(toBusinessTime(date), 1))}T00:00:00`, BUSINESS_TIMEZONE);
}

function businessWeekStartDate(date: Date = new Date()): Date {
  return startOfWeek(toBusinessTime(date), { weekStartsOn: 1 });
}

function businessMonthStartDate(date: Date = new Date()): Date {
  return startOfMonth(toBusinessTime(date));
}

/**
 * Legacy name kept for compatibility. Returns the current business-time Date
 * in America/Chicago, not Pacific.
 */
export function getNowPST(): Date {
  return toBusinessTime();
}

/**
 * Legacy name kept for compatibility. Returns today's America/Chicago date key.
 */
export function getTodayPST(): string {
  return businessDayKey();
}

/**
 * Legacy name kept for compatibility. Returns N days ago in America/Chicago.
 */
export function getDateDaysAgoPST(daysAgo: number): string {
  return businessDayKey(subDays(toBusinessTime(), daysAgo));
}

/**
 * Legacy name kept for compatibility. Returns the current calendar week's
 * Monday in America/Chicago.
 */
export function getWeekStartPST(): string {
  return format(businessWeekStartDate(), "yyyy-MM-dd");
}

/**
 * Legacy name kept for compatibility. Returns the current calendar month's
 * first day in America/Chicago.
 */
export function getMonthStartPST(): string {
  return format(businessMonthStartDate(), "yyyy-MM-dd");
}

export function getIsoWeekStartPST(): string {
  return getWeekStartPST();
}

export function getCalendarMonthStartPST(): string {
  return getMonthStartPST();
}

export function formatDateString(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export function getWeekEndPST(): string {
  return businessDayKey(addDays(businessWeekStartDate(), 6));
}

export function getMonthEndPST(): string {
  return format(endOfMonth(toBusinessTime()), "yyyy-MM-dd");
}

export function getBusinessNow(): Date {
  return toBusinessTime();
}

export function getBusinessDayKey(date: Date = new Date()): string {
  return businessDayKey(date);
}

export function getBusinessDayBounds(date: Date = new Date()): { start: Date; end: Date; startIso: string; endIso: string } {
  const start = startOfBusinessDay(date);
  const end = endOfBusinessDay(date);
  return {
    start,
    end,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

export function getBusinessWeekBounds(date: Date = new Date()): { start: Date; end: Date; startIso: string; endIso: string } {
  const weekStartKey = format(businessWeekStartDate(date), "yyyy-MM-dd");
  const start = fromZonedTime(`${weekStartKey}T00:00:00`, BUSINESS_TIMEZONE);
  const end = endOfBusinessDay(date);
  return {
    start,
    end,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

export function getBusinessMonthBounds(date: Date = new Date()): { start: Date; end: Date; startIso: string; endIso: string } {
  const monthStartKey = format(businessMonthStartDate(date), "yyyy-MM-dd");
  const start = fromZonedTime(`${monthStartKey}T00:00:00`, BUSINESS_TIMEZONE);
  const end = endOfBusinessDay(date);
  return {
    start,
    end,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

export function getBusinessLastMonthBounds(date: Date = new Date()): { start: Date; end: Date; startIso: string; endIso: string } {
  // Calendar last month: first day of previous month → first day of this month
  const thisMonthStart = businessMonthStartDate(date);
  const lastMonthStart = subMonths(thisMonthStart, 1);
  const start = fromZonedTime(`${format(lastMonthStart, "yyyy-MM-dd")}T00:00:00`, BUSINESS_TIMEZONE);
  const end = fromZonedTime(`${format(thisMonthStart, "yyyy-MM-dd")}T00:00:00`, BUSINESS_TIMEZONE);
  return {
    start,
    end,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

export function getBusinessYearBounds(date: Date = new Date()): { start: Date; end: Date; startIso: string; endIso: string } {
  // Year-to-date: Jan 1 of current year → now
  const yearStartKey = format(date, "yyyy") + "-01-01";
  const start = fromZonedTime(`${yearStartKey}T00:00:00`, BUSINESS_TIMEZONE);
  const end = endOfBusinessDay(date);
  return {
    start,
    end,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

export function getMatchedPriorWeekBounds(date: Date = new Date()): {
  start: Date;
  end: Date;
  startIso: string;
  endIso: string;
  elapsedDays: number;
} {
  const businessNow = toBusinessTime(date);
  const currentWeekStart = businessWeekStartDate(businessNow);
  const elapsedDays = differenceInCalendarDays(businessNow, currentWeekStart);
  const priorWeekStart = subWeeks(currentWeekStart, 1);
  const priorWeekEnd = addDays(priorWeekStart, elapsedDays + 1);
  const start = fromZonedTime(`${format(priorWeekStart, "yyyy-MM-dd")}T00:00:00`, BUSINESS_TIMEZONE);
  const end = fromZonedTime(`${format(priorWeekEnd, "yyyy-MM-dd")}T00:00:00`, BUSINESS_TIMEZONE);
  return {
    start,
    end,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    elapsedDays,
  };
}

export function getBusinessMonthProjectionContext(date: Date = new Date()): {
  elapsedCalendarDays: number;
  daysInMonth: number;
} {
  const businessNow = toBusinessTime(date);
  return {
    elapsedCalendarDays: businessNow.getDate(),
    daysInMonth: endOfMonth(businessNow).getDate(),
  };
}
