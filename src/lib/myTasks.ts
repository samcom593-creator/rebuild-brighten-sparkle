import { supabase } from "@/integrations/supabase/client";
import { taskAuthorization, type TaskViewLease } from "@/lib/privateTasks";
import { parsePersonalTaskInput, type PersonalTaskInput } from "../../supabase/functions/_shared/personal-task-contract";
import { isTaskIdentity } from "../../supabase/functions/personal-task-create/contract";

export type { PersonalTaskInput };
export interface MyTask {
  id: string; agent_id: string; title: string; description: string | null; due_date: string | null;
  priority: string; status: string; completed_at: string | null; created_at: string; task_type: string;
}
export interface MyTaskOwner { userId: string; agentId: string }
export const myTasksKey = (userId: string, agentId: string) => ["my-tasks", userId, agentId] as const;

function verifiedTask(value: unknown, agentIds: string[]): MyTask {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Your task response could not be verified. Refresh the list.");
  const row = value as Record<string, unknown>;
  const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
  const nullableText = (value: unknown): value is string | null => value === null || typeof value === "string";
  const timestamp = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
  if (!nonempty(row.id) || typeof row.agent_id !== "string" || !agentIds.includes(row.agent_id) || !nonempty(row.title)
    || !nullableText(row.description) || !nullableText(row.due_date)
    || !nonempty(row.priority) || !nonempty(row.status) || !nonempty(row.task_type)
    || !timestamp(row.created_at) || !nullableText(row.completed_at)
    || (row.completed_at !== null && !timestamp(row.completed_at))) {
    throw new Error("Your task response could not be verified. Refresh the list.");
  }
  return { id: row.id, agent_id: row.agent_id, title: row.title, description: row.description, due_date: row.due_date,
    priority: row.priority, status: row.status, task_type: row.task_type, created_at: row.created_at, completed_at: row.completed_at };
}

/** The task-specific resolver verifies the caller's eligible canonical family. */
export async function resolveMyTaskOwner(userId: string, isCurrent?: TaskViewLease): Promise<MyTaskOwner> {
  const authorization = await taskAuthorization(userId, isCurrent);
  const identity = await supabase.rpc("personal_task_identity").setHeader("Authorization", authorization);
  if (identity.error) throw new Error("Your task account could not be checked.");
  await taskAuthorization(userId, isCurrent);
  if (!isTaskIdentity(identity.data, userId)) throw new Error("An active agent account is required to use My Tasks.");
  return { userId, agentId: identity.data.agent_id };
}

export async function readMyTasks(owner: MyTaskOwner, isCurrent?: TaskViewLease): Promise<MyTask[]> {
  const authorization = await taskAuthorization(owner.userId, isCurrent);
  const { data, error } = await supabase.rpc("personal_task_list", { p_agent_id: owner.agentId }).setHeader("Authorization", authorization);
  if (error) throw new Error("Your tasks could not be loaded.");
  await taskAuthorization(owner.userId, isCurrent);
  if (!isTaskIdentity(data, owner.userId) || data.agent_id !== owner.agentId
    || !("tasks" in data) || !Array.isArray(data.tasks) || data.tasks.length > 200) throw new Error("Your task response could not be verified. Refresh the list.");
  const rows = data.tasks.map(row => verifiedTask(row, data.agent_ids));
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error("Your task response could not be verified. Refresh the list.");
  return rows;
}

export async function createMyTask(owner: MyTaskOwner, input: PersonalTaskInput, isCurrent?: TaskViewLease): Promise<MyTask> {
  const authorization = await taskAuthorization(owner.userId, isCurrent);
  const body = parsePersonalTaskInput(input);
  const { data, error } = await supabase.functions.invoke("personal-task-create", { body, headers: { Authorization: authorization } });
  if (error || !data?.ok || !data.task?.id) throw new Error("Task could not be saved. Refresh your list before retrying.");
  await taskAuthorization(owner.userId, isCurrent);
  if (data.task.agent_id !== owner.agentId) throw new Error("Your task account changed. Refresh the list.");
  return verifiedTask(data.task, [owner.agentId]);
}

export async function setMyTaskCompleted(owner: MyTaskOwner, taskId: string, completed: boolean, isCurrent?: TaskViewLease): Promise<void> {
  const authorization = await taskAuthorization(owner.userId, isCurrent);
  const { data, error } = await supabase.rpc("personal_task_set_completed", {
    p_agent_id: owner.agentId, p_task_id: taskId, p_completed: completed,
  }).setHeader("Authorization", authorization);
  if (error) throw new Error("Task could not be updated.");
  await taskAuthorization(owner.userId, isCurrent);
  if (!isTaskIdentity(data, owner.userId) || data.agent_id !== owner.agentId || !("task" in data)
    || !data.task || typeof data.task !== "object" || Array.isArray(data.task)
    || !("id" in data.task) || data.task.id !== taskId
    || !("agent_id" in data.task) || typeof data.task.agent_id !== "string" || !data.agent_ids.includes(data.task.agent_id)
    || !("status" in data.task) || data.task.status !== (completed ? "completed" : "pending")) throw new Error("Task was not updated. Refresh your list.");
}
