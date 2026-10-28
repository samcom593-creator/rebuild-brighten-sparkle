import {
  NEW_WINDOW_DAYS,
  effectiveDueMs,
  isOpen,
  phoenixDayBounds,
  planCheck,
  type WorklistRow,
} from "@/lib/recruitingQueues";
import { formatDueShort, formatTimeWithZone, plainSpan } from "./worklistFormat";

export type StatusTone = "danger" | "warning" | "primary" | "neutral";

export interface RowStatus {
  /** Empty when there is nothing worth saying (a closed record). */
  label: string;
  tone: StatusTone;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The due time alone, in words: "Date unreadable", "Late · 2 days", "Today · 3:00 PM MST",
 * "Tomorrow 10:00 AM", "Thu 10:00 AM", "Nov 12". Null when nothing is due. The Table's
 * Due column and the status pill both read this, so one person is never "Late · 2 days"
 * in the list and "2d ago" in the table. An unreadable date is said, never treated as
 * "not due" (the same rule as the queues).
 */
export function dueStatus(row: WorklistRow, now: number): RowStatus | null {
  const due = effectiveDueMs(row);
  if (due === null) return null;
  const iso = row.next_action_due_at ?? row.next_review_at;
  if (Number.isNaN(due)) return { label: "Date unreadable", tone: "danger" };
  if (due < now) return { label: `Late · ${plainSpan(now - due)}`, tone: "danger" };
  const { end } = phoenixDayBounds(new Date(now));
  // "Today" is the Phoenix business day (same as the queues); the time carries its zone so a
  // viewer in another zone is never told "today" with an unlabelled time from their tomorrow.
  if (due < end) return { label: `Today · ${formatTimeWithZone(iso)}`, tone: "warning" };
  return { label: formatDueShort(iso, now), tone: "neutral" };
}

/**
 * One plain-English word or two that tells a caller where a person stands, most
 * urgent first: an unreadable date, late, due today, new, waiting, a future step, or
 * no next step at all. It describes the record itself (the same Phoenix day and due
 * rules as the queues) so a 90-day-old overdue item still reads "Late", even though
 * the queues park it under "Older than 90 days". Status is never colour alone: the
 * label always carries the meaning.
 */
export function rowStatus(row: WorklistRow, now: number): RowStatus {
  if (!isOpen(row)) return { label: "", tone: "neutral" };
  const due = dueStatus(row, now);
  // Unreadable, late and due today outrank everything; a future step waits its turn below.
  if (due && due.tone !== "neutral") return due;
  const created = new Date(row.created_at).getTime();
  if (!Number.isNaN(created) && created >= now - NEW_WINDOW_DAYS * DAY_MS && !row.last_contact_outcome_at) {
    return { label: "New", tone: "primary" };
  }
  if (row.waiting_reason?.trim() && !row.next_action_due_at) return { label: "Waiting on them", tone: "neutral" };
  if (due) return due;
  if (!planCheck(row).ok) return { label: "No next step", tone: "neutral" };
  return { label: "", tone: "neutral" };
}

/** "Licensed", "Unlicensed", "Pending", or "License unknown". */
export function licenseWord(status: string | null | undefined): string {
  if (status === "licensed") return "Licensed";
  if (status === "unlicensed") return "Unlicensed";
  if (status === "pending") return "Pending";
  return "License unknown";
}
