import { parsePersonalTaskInput, PERSONAL_TASK_COLUMNS, type PersonalTaskInput } from "../_shared/personal-task-contract.ts";
import { isTaskIdentity } from "./contract.ts";

type Result = { data: unknown; error: unknown };
export type PersonalTaskCreate = PersonalTaskInput & { agent_id: string };
export interface PersonalTaskDependencies {
  getUser(): Promise<{ userId: string | null; error: unknown }>;
  taskIdentity(): PromiseLike<Result>;
  createTask(input: PersonalTaskCreate): PromiseLike<Result>;
}
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const json = (value: unknown, status: number) => new Response(JSON.stringify(value), { status, headers: { ...cors, "Content-Type": "application/json" } });

/** The caller's RPC rechecks identity and stamps assignment; no service write. */
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
    const identity = await deps.taskIdentity();
    if (identity.error) return json({ ok: false, error: "Task account could not be checked." }, 503);
    if (!isTaskIdentity(identity.data, auth.userId)) return json({ ok: false, error: "An active agent account is required." }, 403);
    const created = await deps.createTask({ ...input, agent_id: identity.data.agent_id });
    if (created.error) return json({ ok: false, error: "Task could not be saved." }, 500);
    const row = created.data as Record<string, unknown> | null;
    if (!row || typeof row.id !== "string" || !row.id || row.agent_id !== identity.data.agent_id) {
      return json({ ok: false, error: "Task save could not be confirmed. Refresh your list before retrying." }, 500);
    }
    const task = Object.fromEntries(PERSONAL_TASK_COLUMNS.split(",").map(key => [key, row[key]]));
    return json({ ok: true, task }, 201);
  } catch {
    return json({ ok: false, error: "Task could not be saved. Refresh your list before retrying." }, 500);
  }
}
