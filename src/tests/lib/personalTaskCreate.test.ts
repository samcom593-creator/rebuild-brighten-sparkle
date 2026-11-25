import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { isTaskAgent, parsePersonalTaskInput } from "../../../supabase/functions/_shared/personal-task-contract";
import { handlePersonalTaskCreate, type PersonalTaskDependencies } from "../../../supabase/functions/_shared/personal-task-handler";

const userId = "11111111-1111-4111-8111-111111111111";
const agentId = "22222222-2222-4222-8222-222222222222";
const taskId = "33333333-3333-4333-8333-333333333333";
const agent = { id: agentId, user_id: userId, status: "active", canonical_agent_id: null, is_inactive: false, is_deactivated: false };
const task = { id: taskId, agent_id: agentId, title: "Follow up", description: null, due_date: null, priority: "normal", status: "pending", completed_at: null, created_at: "2026-11-25T12:00:00Z", task_type: "general" };
function dependencies() {
  return {
    getUser: vi.fn(async () => ({ userId, error: null })),
    currentAgentId: vi.fn(async () => ({ data: agentId, error: null })),
    agentById: vi.fn(async () => ({ data: agent, error: null })),
    insertTask: vi.fn(async () => ({ data: task, error: null })),
  } satisfies PersonalTaskDependencies;
}
function request(body: unknown = { title: "Follow up" }, method = "POST", authorization: string | null = "Bearer caller-token") {
  return new Request("https://example.test/personal-task-create", {
    method, headers: authorization ? { Authorization: authorization } : {},
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
}

describe("personal task create authorization", () => {
  it.each([["OPTIONS", 200], ["GET", 405]] as const)("handles %s without credentials or records", async (method, status) => {
    const deps = dependencies();
    expect((await handlePersonalTaskCreate(request(undefined, method), deps)).status).toBe(status);
    expect(deps.getUser).not.toHaveBeenCalled();
    expect(deps.insertTask).not.toHaveBeenCalled();
  });

  it.each([null, "", "Basic caller", "Bearer one two"])("denies a missing or malformed bearer before identity work: %s", async authorization => {
    const deps = dependencies();
    expect((await handlePersonalTaskCreate(request({}, "POST", authorization), deps)).status).toBe(401);
    expect(deps.getUser).not.toHaveBeenCalled();
    expect(deps.insertTask).not.toHaveBeenCalled();
  });

  it("denies invalid authentication before current_agent_id or service access", async () => {
    const deps = dependencies();
    deps.getUser.mockResolvedValue({ userId: null, error: new Error("expired") });
    expect((await handlePersonalTaskCreate(request(), deps)).status).toBe(401);
    expect(deps.currentAgentId).not.toHaveBeenCalled();
    expect(deps.insertTask).not.toHaveBeenCalled();
  });

  it.each(["agent_id", "assigned_by", "user_id", "task_type", "status", "completed_at"])("rejects caller-controlled %s before identity/service work", async field => {
    const deps = dependencies();
    expect((await handlePersonalTaskCreate(request({ title: "Task", [field]: "spoof" }), deps)).status).toBe(400);
    expect(deps.currentAgentId).not.toHaveBeenCalled();
    expect(deps.insertTask).not.toHaveBeenCalled();
  });

  it.each([null, "", "not-a-uuid"])("rejects an absent or invalid current agent: %s", async identity => {
    const deps = dependencies();
    deps.currentAgentId.mockResolvedValue({ data: identity, error: null });
    expect((await handlePersonalTaskCreate(request(), deps)).status).toBe(403);
    expect(deps.agentById).not.toHaveBeenCalled();
    expect(deps.insertTask).not.toHaveBeenCalled();
  });

  it("does not interpret an identity lookup error as permission", async () => {
    const deps = dependencies();
    deps.currentAgentId.mockResolvedValue({ data: agentId, error: new Error("database") });
    expect((await handlePersonalTaskCreate(request(), deps)).status).toBe(503);
    expect(deps.insertTask).not.toHaveBeenCalled();
  });

  it.each([
    { user_id: "other-user" }, { id: "other-agent" }, { status: "inactive" }, { status: "terminated" },
    { is_inactive: true }, { is_deactivated: true }, { canonical_agent_id: "other-agent" },
    { is_inactive: undefined }, { is_deactivated: undefined },
  ])("rejects unusable or unowned agent identity %j", async change => {
    const deps: PersonalTaskDependencies = { ...dependencies(), agentById: vi.fn(async () => ({ data: { ...agent, ...change }, error: null })) };
    expect((await handlePersonalTaskCreate(request(), deps)).status).toBe(403);
    expect(deps.insertTask).not.toHaveBeenCalled();
  });

  it("stamps the authenticated owner and returns only safe task columns", async () => {
    const calls: string[] = [];
    const deps = {
      getUser: vi.fn(async () => { calls.push("auth"); return { userId, error: null }; }),
      currentAgentId: vi.fn(async () => { calls.push("identity"); return { data: agentId, error: null }; }),
      agentById: vi.fn(async () => { calls.push("agent"); return { data: agent, error: null }; }),
      insertTask: vi.fn(async () => { calls.push("insert"); return { data: { ...task, agent_notes: "not for this response", internal_secret: "excluded" }, error: null }; }),
    };
    const response = await handlePersonalTaskCreate(request({ title: "  Follow up  ", description: " Call tomorrow ", due_date: "2026-11-26", priority: "high" }), deps);
    expect(response.status).toBe(201);
    expect(calls).toEqual(["auth", "identity", "agent", "insert"]);
    expect(deps.agentById).toHaveBeenCalledWith(agentId);
    expect(deps.insertTask).toHaveBeenCalledWith({ title: "Follow up", description: "Call tomorrow", due_date: "2026-11-26", priority: "high", agent_id: agentId, assigned_by: userId, task_type: "general", status: "pending" });
    expect(await response.json()).toEqual({ ok: true, task });
  });

  it("accepts a caller-owned pending agent with explicit noninactive flags", async () => {
    const deps = dependencies();
    deps.agentById.mockResolvedValue({ data: { ...agent, status: "pending", is_inactive: null, is_deactivated: null }, error: null });
    expect((await handlePersonalTaskCreate(request(), deps)).status).toBe(201);
  });

  it.each([null, { ...task, agent_id: "somebody-else" }, { ...task, id: null }])("fails when no matching save receipt is returned", async receipt => {
    const deps: PersonalTaskDependencies = { ...dependencies(), insertTask: vi.fn(async () => ({ data: receipt, error: null })) };
    const response = await handlePersonalTaskCreate(request(), deps);
    expect(response.status).toBe(500);
    expect((await response.json()).ok).toBe(false);
  });

  it("reports insert failure without returning details or a false success", async () => {
    const deps: PersonalTaskDependencies = { ...dependencies(), insertTask: vi.fn(async () => ({ data: null, error: new Error("internal table error") })) };
    const response = await handlePersonalTaskCreate(request(), deps);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("internal table error");
  });
});

describe("task input contract", () => {
  it("normalizes only supported input", () => {
    expect(parsePersonalTaskInput({ title: "  Prepare call  ", description: " " })).toEqual({ title: "Prepare call", description: null, due_date: null, priority: "normal" });
  });
  it.each([null, [], { title: " " }, { title: "x".repeat(201) }, { title: "Task", description: "x".repeat(2001) }, { title: "Task", priority: "critical" }, { title: "Task", due_date: "2026-02-30" }, { title: "Task", due_date: "tomorrow" }])("rejects invalid input %j", value => {
    expect(() => parsePersonalTaskInput(value)).toThrow();
  });
  it("does not authorize an incomplete identity object", () => {
    expect(isTaskAgent({ id: agentId, user_id: userId, status: "active", canonical_agent_id: null }, userId, agentId)).toBe(false);
  });
});

describe("deployment wiring", () => {
  it("keeps current_agent_id and the ownership read on the caller client", () => {
    const source = readFileSync(resolve("supabase/functions/personal-task-create/index.ts"), "utf8");
    expect(source).toContain('currentAgentId: () => caller().rpc("current_agent_id")');
    expect(source).toContain('agentById: (id) => caller().from("agents")');
    expect(source.indexOf('Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")')).toBeGreaterThan(source.indexOf("insertTask: (input)"));
    expect(readFileSync(resolve("supabase/config.toml"), "utf8")).toMatch(/\[functions\.personal-task-create\]\s*verify_jwt = true/);
  });
  it("checks Sam's live-session RPC and admin role before the shared Todoist token", () => {
    const source = readFileSync(resolve("supabase/functions/myday-todoist/index.ts"), "utf8");
    const auth = source.indexOf("userClient.auth.getUser()");
    const sam = source.indexOf('userClient.rpc("is_sam")');
    const reject = source.indexOf('if (samError || isSam !== true)');
    const service = source.indexOf('Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")');
    const admin = source.indexOf('if (roleError || !role || role.length === 0)');
    const secret = source.indexOf('.eq("key", "todoist_api_token")');
    expect(auth).toBeGreaterThan(-1);
    expect(sam).toBeGreaterThan(auth);
    expect(reject).toBeGreaterThan(sam);
    expect(service).toBeGreaterThan(reject);
    expect(admin).toBeGreaterThan(service);
    expect(secret).toBeGreaterThan(admin);
  });
});
