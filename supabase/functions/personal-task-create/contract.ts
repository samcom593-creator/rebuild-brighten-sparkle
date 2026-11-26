/** A caller-bound proof from the task-specific database resolver. */
export interface TaskIdentity { user_id: string; agent_id: string; agent_ids: string[] }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isTaskIdentity(value: unknown, expectedUserId: string): value is TaskIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Partial<TaskIdentity>;
  if (row.user_id !== expectedUserId || !UUID.test(expectedUserId)
    || typeof row.agent_id !== "string" || !UUID.test(row.agent_id)
    || !Array.isArray(row.agent_ids) || row.agent_ids.length < 1 || row.agent_ids.length > 200
    || !row.agent_ids.every(id => typeof id === "string" && UUID.test(id))) return false;
  const family = row.agent_ids.map(id => id.toLowerCase());
  return new Set(family).size === family.length && family.includes(row.agent_id.toLowerCase());
}
