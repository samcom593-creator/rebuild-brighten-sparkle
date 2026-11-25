/** Shared validation only: no network, credentials, or task writes. */
export const PERSONAL_TASK_COLUMNS = "id,agent_id,title,description,due_date,priority,status,completed_at,created_at,task_type";
export const TASK_AGENT_COLUMNS = "id,user_id,status,is_inactive,is_deactivated,canonical_agent_id";
export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TaskPriority = typeof TASK_PRIORITIES[number];
export interface PersonalTaskInput { title: string; description: string | null; due_date: string | null; priority: TaskPriority }
export interface TaskAgent {
  id: string; user_id: string | null; status: string;
  is_inactive: boolean | null; is_deactivated: boolean | null; canonical_agent_id: string | null;
}
export function isTaskAgent(value: unknown, userId: string, agentId: string): value is TaskAgent {
  if (!value || typeof value !== "object") return false;
  const row = value as Partial<TaskAgent>;
  return row.id === agentId && row.user_id === userId && row.canonical_agent_id === null
    && (row.status === "active" || row.status === "pending")
    && (row.is_inactive === false || row.is_inactive === null)
    && (row.is_deactivated === false || row.is_deactivated === null);
}
export function parsePersonalTaskInput(value: unknown): PersonalTaskInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Enter a task.");
  const row = value as Record<string, unknown>;
  const allowed = new Set(["title", "description", "due_date", "priority"]);
  if (Object.keys(row).some(key => !allowed.has(key))) throw new Error("Unsupported task field.");
  if (typeof row.title !== "string" || !row.title.trim() || row.title.trim().length > 200) throw new Error("Use a task title of 1–200 characters.");
  if (row.description !== undefined && row.description !== null && typeof row.description !== "string") throw new Error("Task notes must be text.");
  const description = typeof row.description === "string" ? row.description.trim() : "";
  if (description.length > 2000) throw new Error("Keep task notes under 2,000 characters.");
  const priority = row.priority ?? "normal";
  if (!TASK_PRIORITIES.includes(priority as TaskPriority)) throw new Error("Choose a valid priority.");
  const due = row.due_date === undefined || row.due_date === null || row.due_date === "" ? null : row.due_date;
  if (due !== null) {
    if (typeof due !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(due)) throw new Error("Choose a valid due date.");
    const parsed = new Date(`${due}T12:00:00Z`);
    if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== due) throw new Error("Choose a valid due date.");
  }
  return { title: row.title.trim(), description: description || null, due_date: due as string | null, priority: priority as TaskPriority };
}
