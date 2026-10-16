/**
 * Business-day clock helpers (F21, F22, F32 in the 2026-10-14 Galaxy OS map).
 *
 * Every function here works on a date KEY ("YYYY-MM-DD") or on an epoch
 * instant plus an IANA zone. None of them builds a browser-local Date for a
 * business boundary: `new Date(y, m, 1)` is midnight in the viewer's zone, and
 * formatting it in Phoenix again moved AgentCloudHome's month start to the
 * previous day for everyone east of Arizona.
 *
 * The default zone is calendarTime.BUSINESS_TZ (America/Phoenix), the zone
 * the server buckets agentlink_book production and calendar days in. The
 * legacy dashboards that still run on dateUtils.BUSINESS_TIMEZONE
 * (America/Chicago) pass that zone explicitly.
 */
import { BUSINESS_TZ, dateKeyInZone, isValidTimeZone, zonedWallTimeToUtc } from "@/lib/calendarTime";

const KEY_RX = /^(\d{4})-(\d{2})-(\d{2})$/;

/** The longest delay setTimeout accepts; longer values fire immediately. */
export const MAX_TIMER_DELAY_MS = 2_147_483_647;

function parseKey(key: string): [number, number, number] {
  const m = KEY_RX.exec(key);
  if (!m) throw new RangeError(`invalid date key: ${key}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function toKey(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function assertInstant(nowMs: number): void {
  if (!Number.isFinite(nowMs)) throw new RangeError(`invalid instant: ${nowMs}`);
}

/** A valid IANA zone, or the business zone when the input is missing or invalid. */
export function resolveZone(tz?: string | null): string {
  return tz && isValidTimeZone(tz) ? tz : BUSINESS_TZ;
}

/** Shift a date key by whole calendar days. Pure key arithmetic; no zone, no DST. */
export function shiftDateKey(key: string, days: number): string {
  const [y, m, d] = parseKey(key);
  const t = new Date(Date.UTC(y, m - 1, d + days));
  return toKey(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** First day of the key's month. */
export function monthStartKey(key: string): string {
  const [y, m] = parseKey(key);
  return toKey(y, m, 1);
}

/** First day of the month `months` away from the key's month (negative goes back). */
export function shiftMonthKey(key: string, months: number): string {
  const [y, m] = parseKey(key);
  const t = new Date(Date.UTC(y, m - 1 + months, 1));
  return toKey(t.getUTCFullYear(), t.getUTCMonth() + 1, 1);
}

/** January 1 of the key's year. */
export function yearStartKey(key: string): string {
  const [y] = parseKey(key);
  return toKey(y, 1, 1);
}

/** The business date key for an instant. */
export function businessDateKey(nowMs: number = Date.now(), tz: string = BUSINESS_TZ): string {
  assertInstant(nowMs);
  return dateKeyInZone(new Date(nowMs), resolveZone(tz));
}

/**
 * The epoch ms of the first instant of the next business day in `tz`: the
 * zone's next midnight, strictly after `nowMs`. DST days are handled by
 * zonedWallTimeToUtc (a 23h or 25h day gives a 23h or 25h gap), and a zone
 * whose clocks skip 00:00 on a transition day lands on the day's first
 * existing wall time.
 */
export function nextBusinessMidnightMs(nowMs: number, tz: string = BUSINESS_TZ): number {
  assertInstant(nowMs);
  const zone = resolveZone(tz);
  let key = shiftDateKey(dateKeyInZone(new Date(nowMs), zone), 1);
  let midnight = Date.parse(zonedWallTimeToUtc(key, "00:00", zone));
  if (midnight <= nowMs) {
    key = shiftDateKey(key, 1);
    midnight = Date.parse(zonedWallTimeToUtc(key, "00:00", zone));
  }
  return midnight;
}

/** Delay to hand setTimeout so it fires at the next business midnight: at least 1ms, never past the timer ceiling. */
export function msUntilNextBusinessMidnight(nowMs: number, tz: string = BUSINESS_TZ): number {
  const delay = nextBusinessMidnightMs(nowMs, tz) - nowMs;
  return Math.min(Math.max(delay, 1), MAX_TIMER_DELAY_MS);
}
