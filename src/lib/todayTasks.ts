/**
 * Ranking and day bucketing for the Galaxy Today page (F18, F20 and F21 in
 * the 2026-10-14 Galaxy OS map).
 *
 * Pure: every function takes the rows plus the clock it should use (an epoch
 * instant and the business date key) and never reads Date.now() or builds a
 * browser-local Date for a business boundary. "Today" is the key the page gets
 * from useBusinessToday, bucketed in calendarTime.BUSINESS_TZ, the same zone
 * the calendar and attendance pages use.
 *
 * today_tasks, measured live 2026-10-15: due_at and completed_at are
 * timestamptz and nullable, priority is text with default 'med' (observed
 * values high and med), and there is no pin column. The page's vocabulary is
 * high | med | low; anything else ranks as med, the column default.
 *
 * summarizePostedPremium totals the REVENUE tile's rows without folding a
 * missing premium into the sum as $0.
 */
import { BUSINESS_TZ, dateKeyInZone } from "@/lib/calendarTime";

export interface TodayTask {
  id: string;
  title: string;
  notes: string | null;
  due_at: string | null;
  completed_at: string | null;
  priority: string;
  is_income_producing: boolean;
  created_at: string;
}

/** Where a task sits relative to the business day, in rank order. */
export type DueBucket = "overdue" | "due_today" | "unscheduled" | "due_later";

const BUCKET_RANK: Record<DueBucket, number> = { overdue: 0, due_today: 1, unscheduled: 2, due_later: 3 };

const PRIORITY_RANK: Record<string, number> = { high: 0, med: 1, low: 2 };

/** Rank of a priority value; an unknown or missing value ranks as med, the column default. */
export function priorityRank(priority: string | null | undefined): number {
  const rank = PRIORITY_RANK[(priority ?? "").trim().toLowerCase()];
  return rank === undefined ? PRIORITY_RANK.med : rank;
}

export interface RankClock {
  /** The instant "now", epoch ms. */
  nowMs: number;
  /** Today's business date key, "YYYY-MM-DD", from useBusinessToday. */
  todayKey: string;
  /** The zone the key was built in. Defaults to the business zone. */
  tz?: string;
}

function instantMs(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/** True when the instant falls on the business day the key names. False for a missing or unreadable instant. */
export function isOnBusinessDay(iso: string | null | undefined, todayKey: string, tz: string = BUSINESS_TZ): boolean {
  return instantMs(iso) !== null && dateKeyInZone(iso as string, tz) === todayKey;
}

/**
 * The due bucket for a task. A due time already behind the clock is overdue;
 * one later on the business day is due today; no due time (or one that cannot
 * be read) is unscheduled, never overdue; anything else is due later.
 */
export function dueBucket(task: Pick<TodayTask, "due_at">, clock: RankClock): DueBucket {
  const due = instantMs(task.due_at);
  if (due === null) return "unscheduled";
  if (due < clock.nowMs) return "overdue";
  return dateKeyInZone(task.due_at as string, clock.tz ?? BUSINESS_TZ) === clock.todayKey ? "due_today" : "due_later";
}

/** Earlier instant first; a missing or unreadable instant sorts last. */
function compareInstants(a: string | null | undefined, b: string | null | undefined): number {
  const am = instantMs(a);
  const bm = instantMs(b);
  if (am === null && bm === null) return 0;
  if (am === null) return 1;
  if (bm === null) return -1;
  return am - bm;
}

/**
 * Sort order for the priorities list: due bucket, then priority (high, med,
 * low), then income-producing work, then the earlier due time, then the
 * earlier created_at, then id so the order is total and stable.
 */
export function compareTodayTasks(a: TodayTask, b: TodayTask, clock: RankClock): number {
  return (
    BUCKET_RANK[dueBucket(a, clock)] - BUCKET_RANK[dueBucket(b, clock)] ||
    priorityRank(a.priority) - priorityRank(b.priority) ||
    Number(b.is_income_producing) - Number(a.is_income_producing) ||
    compareInstants(a.due_at, b.due_at) ||
    compareInstants(a.created_at, b.created_at) ||
    a.id.localeCompare(b.id)
  );
}

/** The open tasks, most urgent first. Completed rows are left out; the input is not mutated. */
export function rankTodayTasks(tasks: readonly TodayTask[], clock: RankClock): TodayTask[] {
  return tasks.filter((task) => !task.completed_at).sort((a, b) => compareTodayTasks(a, b, clock));
}

/** True when the task was completed on the business day the key names. */
export function completedOnBusinessDay(task: Pick<TodayTask, "completed_at">, todayKey: string, tz: string = BUSINESS_TZ): boolean {
  return isOnBusinessDay(task.completed_at, todayKey, tz);
}

export interface TodayCall {
  start_at: string | null;
  end_at: string | null;
}

/** The calls that start on the business day the key names, earliest first. Rows with no readable start are left out. */
export function callsOnBusinessDay<T extends TodayCall>(calls: readonly T[], todayKey: string, tz: string = BUSINESS_TZ): T[] {
  return calls.filter((call) => isOnBusinessDay(call.start_at, todayKey, tz)).sort((a, b) => compareInstants(a.start_at, b.start_at));
}

/** The earliest call still running or still ahead: its end (or its start, when no end is recorded) is after the clock. */
export function nextMeetingAfter<T extends TodayCall>(calls: readonly T[], nowMs: number): T | null {
  const inOrder = [...calls].sort((a, b) => compareInstants(a.start_at, b.start_at));
  for (const call of inOrder) {
    const edge = instantMs(call.end_at) ?? instantMs(call.start_at);
    if (edge !== null && edge > nowMs) return call;
  }
  return null;
}

/** A posted deal as the REVENUE tile reads it: only the premium is used. */
export interface PostedPremiumRow {
  annual_premium: number | string | null;
}

export interface PostedPremiumSummary {
  /** Sum of the premiums that were recorded. */
  aop: number;
  /** Every posted deal, with or without a premium. */
  deals: number;
  /** Deals with no readable premium amount. They are counted here, never summed as $0. */
  unpriced: number;
}

/** Totals the posted deals. A null, blank or unreadable premium is counted as unpriced, not added as zero. */
export function summarizePostedPremium(rows: readonly PostedPremiumRow[]): PostedPremiumSummary {
  let aop = 0;
  let unpriced = 0;
  for (const row of rows) {
    const raw = row.annual_premium;
    const amount = raw === null || raw === undefined || (typeof raw === "string" && raw.trim() === "") ? Number.NaN : Number(raw);
    if (Number.isFinite(amount)) aop += amount;
    else unpriced += 1;
  }
  return { aop, deals: rows.length, unpriced };
}
