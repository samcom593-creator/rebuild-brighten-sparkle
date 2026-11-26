import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { isTaskAgent, parsePersonalTaskInput } from "../../../supabase/functions/_shared/personal-task-contract";
import { isTaskIdentity } from "../../../supabase/functions/personal-task-create/contract";
import { handlePersonalTaskCreate, type PersonalTaskDependencies } from "../../../supabase/functions/personal-task-create/handler";

const userId = "11111111-1111-4111-8111-111111111111";
const agentId = "22222222-2222-4222-8222-222222222222";
const taskId = "33333333-3333-4333-8333-333333333333";
const aliasId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const otherAgentId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const otherUserId = "44444444-4444-4444-8444-444444444444";
const identity = { user_id: userId, agent_id: agentId, agent_ids: [agentId, aliasId] };
const task = { id: taskId, agent_id: agentId, title: "Follow up", description: null, due_date: null, priority: "normal", status: "pending", completed_at: null, created_at: "2026-11-25T12:00:00Z", task_type: "general" };
function dependencies() {
  return {
    getUser: vi.fn(async (): Promise<{ userId: string | null; error: unknown }> => ({ userId, error: null })),
    taskIdentity: vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({ data: identity, error: null })),
    createTask: vi.fn(async (): Promise<{ data: unknown; error: unknown }> => ({ data: task, error: null })),
  } satisfies PersonalTaskDependencies;
}
function request(body: unknown = { title: "Follow up" }, method = "POST", authorization: string | null = "Bearer caller-token") {
  return new Request("https://example.test/personal-task-create", {
    method, headers: authorization ? { Authorization: authorization } : {},
    ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
  });
}

describe("personal task create canonical authorization", () => {
  it.each([["OPTIONS", 200], ["GET", 405]] as const)("handles %s without credentials or records", async (method, status) => {
    const deps = dependencies();
    expect((await handlePersonalTaskCreate(request(undefined, method), deps)).status).toBe(status);
    expect(deps.getUser).not.toHaveBeenCalled();
    expect(deps.taskIdentity).not.toHaveBeenCalled();
    expect(deps.createTask).not.toHaveBeenCalled();
  });

  it.each([null, "", "Basic caller", "Bearer one two"])("denies a missing or malformed bearer before identity work: %s", async authorization => {
    const deps = dependencies();
    expect((await handlePersonalTaskCreate(request({}, "POST", authorization), deps)).status).toBe(401);
    expect(deps.getUser).not.toHaveBeenCalled();
    expect(deps.taskIdentity).not.toHaveBeenCalled();
    expect(deps.createTask).not.toHaveBeenCalled();
  });

  it.each([
    { userId: null, error: null },
    { userId: null, error: new Error("expired") },
    { userId, error: new Error("auth lookup failed") },
  ])("denies invalid authentication before identity or write operations", async auth => {
    const deps = dependencies();
    deps.getUser.mockResolvedValue(auth);
    expect((await handlePersonalTaskCreate(request(), deps)).status).toBe(401);
    expect(deps.taskIdentity).not.toHaveBeenCalled();
    expect(deps.createTask).not.toHaveBeenCalled();
  });

  it.each(["agent_id", "assigned_by", "user_id", "task_type", "status", "completed_at"])("rejects caller-controlled %s before identity or writes", async field => {
    const deps = dependencies();
    expect((await handlePersonalTaskCreate(request({ title: "Task", [field]: "spoof" }), deps)).status).toBe(400);
    expect(deps.taskIdentity).not.toHaveBeenCalled();
    expect(deps.createTask).not.toHaveBeenCalled();
  });

  it("rejects malformed JSON before asking for identity or writing", async () => {
    const deps = dependencies();
    const req = new Request("https://example.test/personal-task-create", { method: "POST", headers: { Authorization: "Bearer caller-token" }, body: "{" });
    expect((await handlePersonalTaskCreate(req, deps)).status).toBe(400);
    expect(deps.taskIdentity).not.toHaveBeenCalled();
    expect(deps.createTask).not.toHaveBeenCalled();
  });

  it.each([
    ["null", null],
    ["array", []],
    ["missing proof", {}],
    ["another login", { ...identity, user_id: otherUserId }],
    ["invalid canonical id", { ...identity, agent_id: "not-a-uuid" }],
    ["missing family", { user_id: userId, agent_id: agentId }],
    ["empty family", { ...identity, agent_ids: [] }],
    ["canonical root outside family", { ...identity, agent_ids: [aliasId] }],
    ["invalid family id", { ...identity, agent_ids: [agentId, "bad-id"] }],
    ["duplicate family", { ...identity, agent_ids: [agentId, aliasId, aliasId] }],
    ["case-variant duplicate", { ...identity, agent_ids: [agentId, aliasId, aliasId.toUpperCase()] }],
    ["oversized family", { ...identity, agent_ids: [agentId, ...Array.from({ length: 200 }, (_, i) => "00000000-0000-4000-8000-" + String(i + 1000).padStart(12, "0"))] }],
  ])("denies %s identity proof before a write", async (_name, proof) => {
    const deps = dependencies();
    deps.taskIdentity.mockResolvedValue({ data: proof, error: null });
    expect((await handlePersonalTaskCreate(request(), deps)).status).toBe(403);
    expect(deps.createTask).not.toHaveBeenCalled();
  });

  it("does not interpret an identity lookup error as permission or expose its details", async () => {
    const deps = dependencies();
    deps.taskIdentity.mockResolvedValue({ data: identity, error: new Error("internal identity failure") });
    const response = await handlePersonalTaskCreate(request(), deps);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("internal identity failure");
    expect(deps.createTask).not.toHaveBeenCalled();
  });

  it("takes the owner from the verified canonical family and returns only safe task columns", async () => {
    const calls: string[] = [];
    const saved = { ...task, description: "Call tomorrow", due_date: "2026-11-26", priority: "high" };
    const deps = {
      getUser: vi.fn(async () => { calls.push("auth"); return { userId, error: null }; }),
      taskIdentity: vi.fn(async () => { calls.push("identity"); return { data: identity, error: null }; }),
      createTask: vi.fn(async () => { calls.push("create"); return { data: { ...saved, agent_notes: "synthetic private note", internal_secret: "excluded" }, error: null }; }),
    } satisfies PersonalTaskDependencies;
    const response = await handlePersonalTaskCreate(request({ title: "  Follow up  ", description: " Call tomorrow ", due_date: "2026-11-26", priority: "high" }), deps);
    expect(response.status).toBe(201);
    expect(calls).toEqual(["auth", "identity", "create"]);
    expect(deps.createTask).toHaveBeenCalledWith({ title: "Follow up", description: "Call tomorrow", due_date: "2026-11-26", priority: "high", agent_id: agentId });
    expect(await response.json()).toEqual({ ok: true, task: saved });
  });

  it("accepts a verified one-member canonical family", async () => {
    const deps = dependencies();
    deps.taskIdentity.mockResolvedValue({ data: { ...identity, agent_ids: [agentId] }, error: null });
    expect((await handlePersonalTaskCreate(request(), deps)).status).toBe(201);
    expect(deps.createTask).toHaveBeenCalledWith({ title: "Follow up", description: null, due_date: null, priority: "normal", agent_id: agentId });
  });

  it("allows the maximum verified family without using a historical alias as the new owner", async () => {
    const deps = dependencies();
    const family = [agentId, ...Array.from({ length: 199 }, (_, i) => "00000000-0000-4000-8000-" + String(i + 1000).padStart(12, "0"))];
    deps.taskIdentity.mockResolvedValue({ data: { ...identity, agent_ids: family }, error: null });
    expect((await handlePersonalTaskCreate(request(), deps)).status).toBe(201);
    expect(deps.createTask).toHaveBeenCalledWith(expect.objectContaining({ agent_id: agentId }));
  });

  it.each([
    null, [], { ...task, id: null }, { ...task, id: "" }, { ...task, id: 123 },
    { ...task, agent_id: aliasId }, { ...task, agent_id: otherAgentId },
  ])("fails when no matching canonical save receipt is returned", async receipt => {
    const deps = dependencies();
    deps.createTask.mockResolvedValue({ data: receipt, error: null });
    const response = await handlePersonalTaskCreate(request(), deps);
    expect(response.status).toBe(500);
    expect((await response.json()).ok).toBe(false);
  });

  it("reports a write failure without returning internal details or a false success", async () => {
    const deps = dependencies();
    deps.createTask.mockResolvedValue({ data: task, error: new Error("internal table error") });
    const response = await handlePersonalTaskCreate(request(), deps);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("internal table error");
  });

  it("handles an unexpected dependency rejection without exposing its details", async () => {
    const deps = dependencies();
    deps.taskIdentity.mockRejectedValue(new Error("private failure details"));
    const response = await handlePersonalTaskCreate(request(), deps);
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("private failure details");
    expect(deps.createTask).not.toHaveBeenCalled();
  });
});

describe("task-specific identity proof contract", () => {
  it("binds the proof to an authenticated UUID, not just a matching arbitrary string", () => {
    expect(isTaskIdentity(identity, userId)).toBe(true);
    expect(isTaskIdentity({ ...identity, user_id: "not-a-uuid" }, "not-a-uuid")).toBe(false);
    expect(isTaskIdentity(identity, otherUserId)).toBe(false);
  });
  it("compares family UUID membership without allowing case-only duplicates", () => {
    expect(isTaskIdentity({ user_id: userId, agent_id: aliasId, agent_ids: [aliasId.toUpperCase()] }, userId)).toBe(true);
    expect(isTaskIdentity({ user_id: userId, agent_id: aliasId, agent_ids: [aliasId, aliasId.toUpperCase()] }, userId)).toBe(false);
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
  it("keeps authentication, identity resolution and task creation on the caller client", () => {
    const source = readFileSync(resolve("supabase/functions/personal-task-create/index.ts"), "utf8");
    expect(source).toContain('from "./handler.ts"');
    expect(source).toContain('Authorization: req.headers.get("Authorization") ?? ""');
    expect(source).toContain("auth: { persistSession: false }");
    expect(source).toContain("caller().auth.getUser()");
    expect(source).toContain('taskIdentity: () => caller().rpc("personal_task_identity")');
    expect(source).toContain('createTask: (input) => caller().rpc("personal_task_create", {');
    expect(source).toContain("p_agent_id: input.agent_id");
    expect(source).toContain("p_title: input.title");
    expect(source).toContain("p_description: input.description");
    expect(source).toContain("p_due_date: input.due_date");
    expect(source).toContain("p_priority: input.priority");
    expect(source).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
    expect(source).not.toMatch(/\.from\(["'](?:agents|agent_tasks)["']\)/);
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
