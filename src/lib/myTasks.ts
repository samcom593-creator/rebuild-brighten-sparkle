import { supabase } from "@/integrations/supabase/client";
import { taskAuthorization, type TaskViewLease } from "@/lib/privateTasks";
import { isTaskAgent, parsePersonalTaskInput, PERSONAL_TASK_COLUMNS, TASK_AGENT_COLUMNS, type PersonalTaskInput } from "../../supabase/functions/_shared/personal-task-contract";

export type { PersonalTaskInput };
export interface MyTask {
  id: string; agent_id: string; title: string; description: string | null; due_date: string | null;
  priority: string; status: string; completed_at: string | null; created_at: string; task_type: string;
}
export interface MyTaskOwner { userId: string; agentId: string }
export const myTasksKey = (userId: string, agentId: string) => ["my-tasks", userId, agentId] as const;

function verifiedTask(value: unknown, agentId: string): MyTask {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Your task response could not be verified. Refresh the list.");
  const row = value as Record<string, unknown>;
  const nonempty = (value: unknown): value is string => typeof value === "string" && value.trim().length > 0;
  const nullableText = (value: unknown): value is string | null => value === null || typeof value === "string";
  const timestamp = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
  if (!nonempty(row.id) || row.agent_id !== agentId || !nonempty(row.title)
    || !nullableText(row.description) || !nullableText(row.due_date)
    || !nonempty(row.priority) || !nonempty(row.status) || !nonempty(row.task_type)
    || !timestamp(row.created_at) || !nullableText(row.completed_at)
    || (row.completed_at !== null && !timestamp(row.completed_at))) {
    throw new Error("Your task response could not be verified. Refresh the list.");
  }
  return { id: row.id, agent_id: agentId, title: row.title, description: row.description, due_date: row.due_date,
    priority: row.priority, status: row.status, task_type: row.task_type, created_at: row.created_at, completed_at: row.completed_at };
}

/** Align with agent_tasks' current_agent_id() policies, and reject an unusable/merged identity. */
export async function resolveMyTaskOwner(userId: string, isCurrent?: TaskViewLease): Promise<MyTaskOwner> {
  const authorization = await taskAuthorization(userId, isCurrent);
  const identity = await supabase.rpc("current_agent_id").setHeader("Authorization", authorization);
  if (identity.error) throw new Error("Your task account could not be checked.");
  if (!identity.data) throw new Error("An agent account is required to use My Tasks.");
  await taskAuthorization(userId, isCurrent);
  const agent = await supabase.from("agents").select(TASK_AGENT_COLUMNS).eq("id", identity.data).maybeSingle().setHeader("Authorization", authorization);
  if (agent.error) throw new Error("Your task account could not be checked.");
  if (!isTaskAgent(agent.data, userId, identity.data)) throw new Error("An active, unmerged agent account is required to use My Tasks.");
  await taskAuthorization(userId, isCurrent);
  return { userId, agentId: identity.data };
}

export async function readMyTasks(owner: MyTaskOwner, isCurrent?: TaskViewLease): Promise<MyTask[]> {
  const authorization = await taskAuthorization(owner.userId, isCurrent);
  const { data, error } = await supabase.from("agent_tasks").select(PERSONAL_TASK_COLUMNS)
    .eq("agent_id", owner.agentId).order("created_at", { ascending: false }).limit(200).setHeader("Authorization", authorization);
  if (error) throw new Error("Your tasks could not be loaded.");
  await taskAuthorization(owner.userId, isCurrent);
  if (!Array.isArray(data)) throw new Error("Your task response could not be verified. Refresh the list.");
  const rows = data.map(row => verifiedTask(row, owner.agentId));
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
  return verifiedTask(data.task, owner.agentId);
}

export async function setMyTaskCompleted(owner: MyTaskOwner, taskId: string, completed: boolean, isCurrent?: TaskViewLease): Promise<void> {
  const authorization = await taskAuthorization(owner.userId, isCurrent);
  const { data, error } = await supabase.from("agent_tasks")
    .update({ status: completed ? "completed" : "pending", completed_at: completed ? new Date().toISOString() : null })
    .eq("agent_id", owner.agentId).eq("id", taskId).select("id,agent_id,status").maybeSingle().setHeader("Authorization", authorization);
  if (error) throw new Error("Task could not be updated.");
  if (!data || data.id !== taskId || data.agent_id !== owner.agentId || data.status !== (completed ? "completed" : "pending")) throw new Error("Task was not updated. Refresh your list.");
  await taskAuthorization(owner.userId, isCurrent);
}
