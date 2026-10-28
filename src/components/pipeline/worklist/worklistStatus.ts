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
 * One plain-English word or two that tells a caller where a person stands, most
 * urgent first: an unreadable date, late, due today, new, waiting, a future step, or
 * no next step at all. It describes the record itself (the same Phoenix day and due
 * rules as the queues) so a 90-day-old overdue item still reads "Late", even though
 * the queues park it under "Older than 90 days". Status is never colour alone: the
 * label always carries the meaning.
 */
export function rowStatus(row: WorklistRow, now: number): RowStatus {
  if (!isOpen(row)) return { label: "", tone: "neutral" };
  const due = effectiveDueMs(row);
  const iso = row.next_action_due_at ?? row.next_review_at;
  if (due !== null && Number.isNaN(due)) return { label: "Date unreadable", tone: "danger" };
  if (due !== null && due < now) return { label: `Late · ${plainSpan(now - due)}`, tone: "danger" };
  const { end } = phoenixDayBounds(new Date(now));
  // "Today" is the Phoenix business day (same as the queues); the time carries its zone so a
  // viewer in another zone is never told "today" with an unlabelled time from their tomorrow.
  if (due !== null && due < end) return { label: `Today · ${formatTimeWithZone(iso)}`, tone: "warning" };
  const created = new Date(row.created_at).getTime();
  if (!Number.isNaN(created) && created >= now - NEW_WINDOW_DAYS * DAY_MS && !row.last_contact_outcome_at) {
    return { label: "New", tone: "primary" };
  }
  if (row.waiting_reason?.trim() && !row.next_action_due_at) return { label: "Waiting on them", tone: "neutral" };
  if (due !== null) return { label: formatDueShort(iso, now), tone: "neutral" };
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
