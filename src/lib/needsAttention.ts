/**
 * Needs attention (MP-302, 2026-11-12): the owner Home's short list of people waiting on a
 * decision, built from the recruiting worklist's own rows and rules.
 *
 * Nothing here defines a new rule. Each group IS a worklist queue (inQueue, sortForQueue from
 * recruitingQueues), so a group's count equals the list it opens at
 * /dashboard/recruiting?queue=<key>, row for row. The page shows the first few of each and
 * the rest behind the link.
 *
 * Groups, in the order a missed one costs most:
 *   overdue     the next step someone set has passed
 *   new         applied in the last 7 days and nobody has worked them
 *   unassigned  open, on the Best leads list, with no accountable owner
 *
 * "No owner" is narrowed to Best leads on purpose: every open recruit without an owner is
 * the backlog, not a list anyone can act on from Home.
 */
import {
  effectiveDueMs,
  fullName,
  inQueue,
  sortForQueue,
  type QueueContext,
  type QueueKey,
  type WorklistRow,
} from "@/lib/recruitingQueues";

export type AttentionKey = "overdue" | "new" | "unassigned";

export interface AttentionItem {
  id: string;
  name: string;
  /** Stage key from the Next Step Engine, or the application status when no stage is set. */
  stage: string | null;
  licensed: boolean;
  ownerUserId: string | null;
  /** When the wait started: the due time for an overdue step, the application time otherwise. */
  waitingSince: string | null;
  /** The one thing to do. */
  nextAction: string;
  href: string;
}

export interface AttentionGroup {
  key: AttentionKey;
  queue: QueueKey;
  title: string;
  /** What the count means, in one plain sentence. */
  rule: string;
  count: number;
  items: AttentionItem[];
  href: string;
}

const GROUPS: ReadonlyArray<{ key: AttentionKey; queue: QueueKey; title: string; rule: string }> = [
  { key: "overdue", queue: "overdue", title: "Overdue follow-ups", rule: "The next step someone set has passed." },
  { key: "new", queue: "new", title: "New and untouched", rule: "Applied in the last 7 days and nobody has worked them." },
  { key: "unassigned", queue: "unassigned", title: "Best leads with no owner", rule: "Open, likely to join, and nobody is accountable for them." },
];

export const ATTENTION_PREVIEW = 3;

function nextActionFor(key: AttentionKey, row: WorklistRow): string {
  const planned = row.next_action_set_at ? row.next_action?.trim() : null;
  if (key === "overdue") return planned || "Follow up now";
  if (key === "new") return row.license_status === "licensed" ? "Call and book the licensed interview" : "Call and send the course link";
  return "Give them an owner";
}

function waitingSince(key: AttentionKey, row: WorklistRow): string | null {
  if (key === "overdue") {
    const due = effectiveDueMs(row);
    return due !== null && Number.isFinite(due) ? new Date(due).toISOString() : null;
  }
  return row.created_at || null;
}

export function buildNeedsAttention(rows: readonly WorklistRow[], ctx: QueueContext, preview = ATTENTION_PREVIEW): AttentionGroup[] {
  return GROUPS.map((g) => {
    const members = rows.filter((row) =>
      g.key === "unassigned" ? inQueue(row, "unassigned", ctx) && inQueue(row, "likely", ctx) : inQueue(row, g.queue, ctx));
    // Overdue: the longest-late first. The others keep the worklist's own order for that queue.
    const ordered = g.key === "overdue"
      ? [...members].sort((a, b) => (effectiveDueMs(a) ?? Infinity) - (effectiveDueMs(b) ?? Infinity) || a.id.localeCompare(b.id))
      : sortForQueue(members, g.key === "unassigned" ? "likely" : g.queue);
    return {
      key: g.key,
      queue: g.queue,
      title: g.title,
      rule: g.rule,
      count: members.length,
      href: g.key === "unassigned" ? "/dashboard/recruiting?queue=likely" : `/dashboard/recruiting?queue=${g.queue}`,
      items: ordered.slice(0, preview).map((row) => ({
        id: row.id,
        name: fullName(row),
        stage: row.next_step_stage_key ?? row.status,
        licensed: row.license_status === "licensed",
        ownerUserId: row.recruiting_owner_user_id,
        waitingSince: waitingSince(g.key, row),
        nextAction: nextActionFor(g.key, row),
        href: `/dashboard/recruiting?queue=${g.key === "unassigned" ? "likely" : g.queue}&person=${encodeURIComponent(row.id)}`,
      })),
    };
  });
}

/** How many people are waiting across every group (a person in two groups counts in both). */
export function attentionTotal(groups: readonly AttentionGroup[]): number {
  return groups.reduce((sum, g) => sum + g.count, 0);
}
