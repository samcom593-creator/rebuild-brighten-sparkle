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

/**
 * 2026-06-17 Sam directive: "with the Calendly link, the CDT time is just
 * fucking up my head completely." Calendly bookings show up across the site
 * as raw UTC ISO strings. Render them in America/Chicago (the recruiting
 * timezone — Calendly's configured tz) with both the absolute label AND a
 * "starting in 2h 15m" relative chip so Sam can read his schedule without
 * doing timezone math.
 *
 * formatBusinessTimeWithDay → "Wed Jun 18 · 9:30 AM CDT"
 *   Single line, sortable, includes the tz abbr so it's never ambiguous.
 */
export function formatBusinessTimeWithDay(date: Date | string | null | undefined): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "—";
  // formatInTimeZone uses date-fns tokens; `zzz` emits "CDT"/"CST".
  return formatInTimeZone(d, BUSINESS_TIMEZONE, "EEE MMM d · h:mm a zzz");
}

/**
 * formatRelativeFromNow → "in 2h 15m" / "starting now" / "started 4m ago"
 *   Computes purely off epoch-ms delta so it's tz-agnostic and stable.
 *   Buckets: <1 min = "starting now", <1 h = minutes, <1 d = h+m, else d+h.
 */
export function formatRelativeFromNow(date: Date | string | null | undefined, nowMs: number = Date.now()): string {
  if (!date) return "—";
  const d = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(d.getTime())) return "—";
  const deltaSec = (d.getTime() - nowMs) / 1000;
  if (deltaSec > -60 && deltaSec < 60) return "starting now";
  const future = deltaSec > 0;
  const abs = Math.abs(deltaSec);
  let body: string;
  if (abs < 3600) {
    body = `${Math.round(abs / 60)}m`;
  } else if (abs < 86400) {
    const h = Math.floor(abs / 3600);
    const m = Math.floor((abs % 3600) / 60);
    body = m ? `${h}h ${m}m` : `${h}h`;
  } else {
    const days = Math.floor(abs / 86400);
    const h = Math.floor((abs % 86400) / 3600);
    body = h ? `${days}d ${h}h` : `${days}d`;
  }
  return future ? `in ${body}` : `${body} ago`;
}

/**
 * Canonical "time ago" formatter — the single source of truth for every
 * "3m ago / 2h ago / Yesterday / Jul 20" label in the app.
 *
 * Guards future-dated and invalid inputs so it can NEVER render a negative
 * ("-18690m ago"): insurance posted/effective dates can legitimately be in the
 * future, so a just-written future-dated record reads "just now". Do NOT
 * hand-roll inline `Date.now() - date` delta formatters — they reintroduce the
 * negative-time class of bug. Enforced by scripts/check-inline-timeago.mjs.
 */
export function formatTimeAgo(input: Date | string | number | null | undefined): string {
  if (input === null || input === undefined || input === "") return "—";
  const d = input instanceof Date ? input : new Date(input);
  const t = d.getTime();
  if (Number.isNaN(t)) return "—";
  const diffMs = Math.max(0, Date.now() - t);
  const mins = Math.floor(diffMs / 60000);
  const hours = Math.floor(diffMs / 3600000);
  const days = Math.floor(hours / 24);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "Yesterday";
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
