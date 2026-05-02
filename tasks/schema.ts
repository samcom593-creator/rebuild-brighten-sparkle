/**
 * Unified task schema. The same shape is used in:
 *   - tasks.json (local cache)
 *   - public.agent_inbox (Supabase)
 *   - the React TaskInbox component
 *
 * Apple Reminders is *not* the source of record — its AppleScript surface is
 * limited (notably no reliable tag/status round-trip), so advanced metadata
 * lives only in JSON/Supabase. We keep `reminderExternalId` to re-find a
 * Reminder we previously created.
 */
export type TaskPriority = "low" | "medium" | "high" | "urgent";
export type TaskStatus = "open" | "in_progress" | "blocked" | "done" | "cancelled";
export type TaskSource =
  | "cli"
  | "vscode"
  | "siri"
  | "shortcut"
  | "ui"
  | "reminders" // pulled from Apple Reminders
  | "supabase"; // pulled from cloud
export type TaskList = "APEX-Daily" | "Recruiting" | "Build" | "Follow-ups";

export const ALL_LISTS: TaskList[] = [
  "APEX-Daily",
  "Recruiting",
  "Build",
  "Follow-ups",
];

export interface Task {
  id: string; // local UUID, generated at creation
  title: string;
  list: TaskList;
  due: string | null; // ISO 8601 date (YYYY-MM-DD) or full datetime
  priority: TaskPriority;
  tags: string[];
  status: TaskStatus;
  source: TaskSource;
  reminderExternalId: string | null; // Apple Reminders item id (returned by AppleScript)
  supabaseId: string | null; // public.agent_inbox.id when synced
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
  completedAt: string | null;
}

export const DEFAULTS = {
  list: "APEX-Daily" as TaskList,
  priority: "medium" as TaskPriority,
  status: "open" as TaskStatus,
  source: "cli" as TaskSource,
};

/** Priority ordering for sorts. Higher = more important. */
export const PRIORITY_RANK: Record<TaskPriority, number> = {
  urgent: 4,
  high: 3,
  medium: 2,
  low: 1,
};

/** Normalise input to a comparable key used for matching when no external IDs match. */
export function fingerprint(t: Pick<Task, "title" | "list" | "due">): string {
  const title = (t.title || "").trim().toLowerCase().replace(/\s+/g, " ");
  const due = (t.due || "").slice(0, 10);
  return `${t.list}|${due}|${title}`;
}

/** Keyword → list inference, mirrors the Siri shortcut's branches. */
export function inferList(title: string): TaskList {
  const t = title.toLowerCase();
  if (/\b(recruit|agent|hire|onboard|applicant)\b/.test(t)) return "Recruiting";
  if (/\b(build|code|bug|website|crm|deploy|fix|ship|component)\b/.test(t))
    return "Build";
  if (/\b(follow up|follow-up|followup|call back|callback|text|client|reply)\b/.test(t))
    return "Follow-ups";
  return "APEX-Daily";
}
