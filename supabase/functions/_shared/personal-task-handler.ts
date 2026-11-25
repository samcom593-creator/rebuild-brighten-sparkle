import { isTaskAgent, parsePersonalTaskInput, type PersonalTaskInput } from "./personal-task-contract.ts";

type Result = { data: unknown; error: unknown };
export type PersonalTaskInsert = PersonalTaskInput & { agent_id: string; assigned_by: string; task_type: "general"; status: "pending" };
export interface PersonalTaskDependencies {
  getUser(): Promise<{ userId: string | null; error: unknown }>;
  currentAgentId(): PromiseLike<Result>;
  agentById(id: string): PromiseLike<Result>;
  insertTask(input: PersonalTaskInsert): PromiseLike<Result>;
}
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (value: unknown, status: number) => new Response(JSON.stringify(value), { status, headers: { ...cors, "Content-Type": "application/json" } });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Create only. Ownership is resolved with the caller's JWT before the service insert is reachable. */
export async function handlePersonalTaskCreate(req: Request, deps: PersonalTaskDependencies): Promise<Response> {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ ok: false, error: "POST only" }, 405);
  if (!/^Bearer\s+\S+$/i.test(req.headers.get("Authorization") ?? "")) return json({ ok: false, error: "Sign in required." }, 401);
  try {
    const auth = await deps.getUser();
    if (auth.error || !auth.userId) return json({ ok: false, error: "Sign in required." }, 401);
    let input: PersonalTaskInput;
    try { input = parsePersonalTaskInput(await req.json()); }
    catch (error) { return json({ ok: false, error: error instanceof Error ? error.message : "Invalid task." }, 400); }
    const identity = await deps.currentAgentId();
    if (identity.error) return json({ ok: false, error: "Task account could not be checked." }, 503);
    if (typeof identity.data !== "string" || !UUID.test(identity.data)) return json({ ok: false, error: "An active agent account is required." }, 403);
    const agent = await deps.agentById(identity.data);
    if (agent.error) return json({ ok: false, error: "Task account could not be checked." }, 503);
    if (!isTaskAgent(agent.data, auth.userId, identity.data)) return json({ ok: false, error: "An active, unmerged agent account is required." }, 403);
    const created = await deps.insertTask({ ...input, agent_id: identity.data, assigned_by: auth.userId, task_type: "general", status: "pending" });
    if (created.error) return json({ ok: false, error: "Task could not be saved." }, 500);
    const row = created.data as Record<string, unknown> | null;
    if (!row || typeof row.id !== "string" || row.agent_id !== identity.data) return json({ ok: false, error: "Task save could not be confirmed. Refresh your list before retrying." }, 500);
    // Even an adapter with a wider SELECT cannot leak unrelated columns.
    const task = Object.fromEntries(["id", "agent_id", "title", "description", "due_date", "priority", "status", "completed_at", "created_at", "task_type"].map(key => [key, row[key]]));
    return json({ ok: true, task }, 201);
  } catch {
    return json({ ok: false, error: "Task could not be saved. Refresh your list before retrying." }, 500);
  }
}
