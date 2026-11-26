import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMyTask, myTasksKey, readMyTasks, resolveMyTaskOwner, setMyTaskCompleted } from "@/lib/myTasks";
import { assertSamTaskSession, myDayCacheKey, taskAuthorization } from "@/lib/privateTasks";

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), rpc: vi.fn(), from: vi.fn(), invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession: mocks.getSession }, rpc: mocks.rpc, from: mocks.from, functions: { invoke: mocks.invoke } } }));
const owner = { userId: "00000000-0000-4000-8000-000000000001", agentId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
const otherUser = "00000000-0000-4000-8000-000000000002";
const aliasId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const foreignId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const identity = { user_id: owner.userId, agent_id: owner.agentId, agent_ids: [owner.agentId, aliasId] };
const session = (id = owner.userId, token = "token-a") => ({ data: { session: { user: { id }, access_token: token } }, error: null });
const task = { id: "task-a", agent_id: owner.agentId, title: "Follow up", description: null, due_date: null, priority: "normal", status: "pending", completed_at: null, created_at: "2026-11-25T12:00:00Z", task_type: "general" };
const historicalTask = { ...task, id: "task-history", agent_id: aliasId };
const input = { title: "Follow up", description: null, due_date: null, priority: "normal" as const };
const listResponse = (tasks: unknown = [task]) => ({ ...identity, tasks });
const completionResponse = (receipt: unknown = { id: task.id, agent_id: owner.agentId, status: "completed" }) => ({ ...identity, task: receipt });
function query(data: unknown, error: unknown = null) {
  const result = Promise.resolve({ data, error });
  const builder = { setHeader: vi.fn(), then: result.then.bind(result) };
  builder.setHeader.mockReturnValue(builder);
  return builder;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(r => { resolve = r; });
  return { promise, resolve };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.getSession.mockResolvedValue(session());
});

describe("My Tasks canonical account scope", () => {
  it("resolves the server-verified canonical family with the checked account token", async () => {
    const response = query(identity);
    mocks.rpc.mockReturnValue(response);
    expect(await resolveMyTaskOwner(owner.userId)).toEqual(owner);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("personal_task_identity");
    expect(response.setHeader).toHaveBeenCalledWith("Authorization", "Bearer token-a");
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it.each([
    ["null", null],
    ["array", []],
    ["missing proof", {}],
    ["another login", { ...identity, user_id: otherUser }],
    ["invalid root", { ...identity, agent_id: "not-a-uuid" }],
    ["missing family", { user_id: owner.userId, agent_id: owner.agentId }],
    ["empty family", { ...identity, agent_ids: [] }],
    ["missing canonical root", { ...identity, agent_ids: [aliasId] }],
    ["invalid family member", { ...identity, agent_ids: [owner.agentId, "invalid"] }],
    ["duplicate family", { ...identity, agent_ids: [owner.agentId, owner.agentId] }],
    ["case-variant duplicate", { ...identity, agent_ids: [owner.agentId, owner.agentId.toUpperCase()] }],
    ["oversized family", { ...identity, agent_ids: [owner.agentId, ...Array.from({ length: 200 }, (_, i) => "00000000-0000-4000-8000-" + String(i + 1000).padStart(12, "0"))] }],
  ])("refuses %s identity proof", async (_name, value) => {
    mocks.rpc.mockReturnValue(query(value));
    await expect(resolveMyTaskOwner(owner.userId)).rejects.toThrow("active agent account");
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("reports an identity RPC failure without a table fallback", async () => {
    mocks.rpc.mockReturnValue(query(null, new Error("denied")));
    await expect(resolveMyTaskOwner(owner.userId)).rejects.toThrow("could not be checked");
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("reads the bounded server family including historical owners without rewriting attribution", async () => {
    const response = query(listResponse([task, historicalTask]));
    mocks.rpc.mockReturnValue(response);
    expect(await readMyTasks(owner)).toEqual([task, historicalTask]);
    expect(mocks.rpc).toHaveBeenCalledWith("personal_task_list", { p_agent_id: owner.agentId });
    expect(response.setHeader).toHaveBeenCalledWith("Authorization", "Bearer token-a");
    expect(mocks.from).not.toHaveBeenCalled();
    expect(myTasksKey(owner.userId, owner.agentId)).not.toEqual(myTasksKey(otherUser, owner.agentId));
    expect(myTasksKey(owner.userId, owner.agentId)).not.toEqual(myTasksKey(owner.userId, foreignId));
  });

  it("reports failed reads rather than an empty list", async () => {
    mocks.rpc.mockReturnValue(query(null, new Error("denied")));
    await expect(readMyTasks(owner)).rejects.toThrow("could not be loaded");
  });

  it("accepts a verified empty list", async () => {
    mocks.rpc.mockReturnValue(query(listResponse([])));
    expect(await readMyTasks(owner)).toEqual([]);
  });

  it.each([
    ["null response", null],
    ["bare array", [task]],
    ["missing proof", { tasks: [] }],
    ["wrong login", { ...listResponse(), user_id: otherUser }],
    ["changed root", { ...listResponse(), agent_id: foreignId, agent_ids: [foreignId] }],
    ["duplicate family", { ...listResponse(), agent_ids: [owner.agentId, owner.agentId] }],
    ["missing tasks", identity],
    ["object tasks", listResponse({})],
    ["null task", listResponse([null])],
    ["incomplete task", listResponse([{ id: task.id }])],
    ["foreign task", listResponse([{ ...task, agent_id: foreignId }])],
    ["empty title", listResponse([{ ...task, title: " " }])],
    ["invalid description", listResponse([{ ...task, description: {} }])],
    ["invalid due date type", listResponse([{ ...task, due_date: {} }])],
    ["missing status", listResponse([{ ...task, status: undefined }])],
    ["invalid timestamp", listResponse([{ ...task, created_at: "not-a-time" }])],
    ["invalid completed time", listResponse([{ ...task, completed_at: true }])],
    ["duplicate tasks", listResponse([task, task])],
    ["over 200 tasks", listResponse(Array.from({ length: 201 }, (_, i) => ({ ...task, id: "task-" + i })))],
  ])("rejects %s instead of displaying unverified tasks", async (_name, value) => {
    mocks.rpc.mockReturnValue(query(value));
    await expect(readMyTasks(owner)).rejects.toThrow("could not be verified");
  });

  it("clips additional task fields instead of leaking them through the client contract", async () => {
    mocks.rpc.mockReturnValue(query(listResponse([{ ...task, private_payload: "synthetic-only", assigned_by: otherUser }])));
    expect(await readMyTasks(owner)).toEqual([task]);
  });

  it("creates through the guarded endpoint with only supported fields and a pinned token", async () => {
    mocks.invoke.mockResolvedValue({ data: { ok: true, task }, error: null });
    expect(await createMyTask(owner, input)).toEqual(task);
    expect(mocks.invoke).toHaveBeenCalledWith("personal-task-create", { body: input, headers: { Authorization: "Bearer token-a" } });
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects invalid input before invoking the endpoint", async () => {
    await expect(createMyTask(owner, { ...input, title: " " })).rejects.toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it.each([aliasId, foreignId])("does not accept a creation receipt under noncanonical owner %s", async agentId => {
    mocks.invoke.mockResolvedValue({ data: { ok: true, task: { ...task, agent_id: agentId } }, error: null });
    await expect(createMyTask(owner, input)).rejects.toThrow("account changed");
  });

  it.each([
    { data: null, error: new Error("denied") },
    { data: { ok: false }, error: null },
    { data: { ok: true }, error: null },
    { data: { ok: true, task: { ...task, id: "" } }, error: null },
  ])("does not claim a save without a successful task receipt", async result => {
    mocks.invoke.mockResolvedValue(result);
    await expect(createMyTask(owner, input)).rejects.toThrow("could not be saved");
  });

  it("rejects an incomplete saved task even when its id and owner match", async () => {
    mocks.invoke.mockResolvedValue({ data: { ok: true, task: { id: task.id, agent_id: owner.agentId } }, error: null });
    await expect(createMyTask(owner, input)).rejects.toThrow("could not be verified");
  });

  it("completes through the guarded RPC and pins the caller token", async () => {
    const response = query(completionResponse());
    mocks.rpc.mockReturnValue(response);
    await setMyTaskCompleted(owner, task.id, true);
    expect(mocks.rpc).toHaveBeenCalledWith("personal_task_set_completed", { p_agent_id: owner.agentId, p_task_id: task.id, p_completed: true });
    expect(response.setHeader).toHaveBeenCalledWith("Authorization", "Bearer token-a");
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("accepts completion of an existing historical-family task without moving its owner", async () => {
    mocks.rpc.mockReturnValue(query(completionResponse({ id: historicalTask.id, agent_id: aliasId, status: "completed" })));
    await expect(setMyTaskCompleted(owner, historicalTask.id, true)).resolves.toBeUndefined();
  });

  it("reopens through the guarded RPC without manufacturing a completion timestamp", async () => {
    mocks.rpc.mockReturnValue(query(completionResponse({ id: task.id, agent_id: owner.agentId, status: "pending" })));
    await setMyTaskCompleted(owner, task.id, false);
    expect(mocks.rpc).toHaveBeenCalledWith("personal_task_set_completed", { p_agent_id: owner.agentId, p_task_id: task.id, p_completed: false });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("reports completion RPC errors", async () => {
    mocks.rpc.mockReturnValue(query(null, new Error("denied")));
    await expect(setMyTaskCompleted(owner, task.id, true)).rejects.toThrow("could not be updated");
  });

  it.each([
    ["null response", null],
    ["missing proof", { task: { id: task.id, agent_id: owner.agentId, status: "completed" } }],
    ["another login", { ...completionResponse(), user_id: otherUser }],
    ["changed canonical root", { ...completionResponse(), agent_id: foreignId, agent_ids: [foreignId] }],
    ["unverified family", { ...completionResponse(), agent_ids: [] }],
    ["missing row", completionResponse(null)],
    ["array row", completionResponse([])],
    ["wrong task", completionResponse({ id: "another-task", agent_id: owner.agentId, status: "completed" })],
    ["foreign owner", completionResponse({ id: task.id, agent_id: foreignId, status: "completed" })],
    ["wrong status", completionResponse({ id: task.id, agent_id: owner.agentId, status: "pending" })],
  ])("does not report completion for %s", async (_name, receipt) => {
    mocks.rpc.mockReturnValue(query(receipt));
    await expect(setMyTaskCompleted(owner, task.id, true)).rejects.toThrow("not updated");
  });

  it("does not start resolution, reads or writes after an account switch", async () => {
    mocks.getSession.mockResolvedValue(session(otherUser, "token-b"));
    await expect(resolveMyTaskOwner(owner.userId)).rejects.toThrow("account changed");
    await expect(readMyTasks(owner)).rejects.toThrow("account changed");
    await expect(createMyTask(owner, input)).rejects.toThrow("account changed");
    await expect(setMyTaskCompleted(owner, task.id, true)).rejects.toThrow("account changed");
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("stops an awaited create when its page unmounts or enters preview", async () => {
    const check = deferred<ReturnType<typeof session>>();
    mocks.getSession.mockReturnValue(check.promise);
    let current = true;
    const pending = createMyTask(owner, input, () => current);
    current = false;
    check.resolve(session());
    await expect(pending).rejects.toThrow("no longer open");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("rejects a late save after account change and retains the original request token", async () => {
    const save = deferred<{ data: { ok: true; task: typeof task }; error: null }>();
    mocks.invoke.mockReturnValue(save.promise);
    const pending = createMyTask(owner, input);
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalled());
    mocks.getSession.mockResolvedValue(session(otherUser, "token-b"));
    save.resolve({ data: { ok: true, task }, error: null });
    await expect(pending).rejects.toThrow("account changed");
    expect(mocks.invoke.mock.calls[0][1].headers.Authorization).toBe("Bearer token-a");
  });

  it("rejects a late save after its page lease closes", async () => {
    const save = deferred<{ data: { ok: true; task: typeof task }; error: null }>();
    mocks.invoke.mockReturnValue(save.promise);
    let current = true;
    const pending = createMyTask(owner, input, () => current);
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalled());
    current = false;
    save.resolve({ data: { ok: true, task }, error: null });
    await expect(pending).rejects.toThrow("no longer open");
  });

  const rpcActions = [
    { name: "identity resolution", run: (current: () => boolean) => resolveMyTaskOwner(owner.userId, current), data: identity },
    { name: "list", run: (current: () => boolean) => readMyTasks(owner, current), data: listResponse() },
    { name: "completion", run: (current: () => boolean) => setMyTaskCompleted(owner, task.id, true, current), data: completionResponse() },
  ];

  it.each(rpcActions)("rejects a late $name response after the login changes", async action => {
    const response = deferred<{ data: unknown; error: null }>();
    const header = vi.fn().mockReturnValue(response.promise);
    mocks.rpc.mockReturnValue({ setHeader: header });
    const pending = action.run(() => true);
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    mocks.getSession.mockResolvedValue(session(otherUser, "token-b"));
    response.resolve({ data: action.data, error: null });
    await expect(pending).rejects.toThrow("account changed");
    expect(header).toHaveBeenCalledWith("Authorization", "Bearer token-a");
  });

  it.each(rpcActions)("rejects a late $name response after its view closes", async action => {
    const response = deferred<{ data: unknown; error: null }>();
    mocks.rpc.mockReturnValue({ setHeader: vi.fn().mockReturnValue(response.promise) });
    let current = true;
    const pending = action.run(() => current);
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    current = false;
    response.resolve({ data: action.data, error: null });
    await expect(pending).rejects.toThrow("no longer open");
  });

  it("allows same-user token renewal while preserving the token pinned to the request", async () => {
    const response = deferred<{ data: unknown; error: null }>();
    const header = vi.fn().mockReturnValue(response.promise);
    mocks.rpc.mockReturnValue({ setHeader: header });
    const pending = readMyTasks(owner);
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    mocks.getSession.mockResolvedValue(session(owner.userId, "token-renewed"));
    response.resolve({ data: listResponse(), error: null });
    await expect(pending).resolves.toEqual([task]);
    expect(header).toHaveBeenCalledWith("Authorization", "Bearer token-a");
  });
});

describe("Sam task isolation", () => {
  it("namespaces task, daily check, and offline queue keys by account", () => {
    for (const part of ["tasks", "checks", "pending"] as const) {
      expect(myDayCacheKey("account-a", part, "2026-11-25")).not.toBe(myDayCacheKey("account-b", part, "2026-11-25"));
      expect(myDayCacheKey("account-a", part)).toMatch(/^myday:v2:account-a:/);
    }
    expect(() => myDayCacheKey("", "pending")).toThrow();
  });
  it.each([false, null, "true"])("requires literal server is_sam true: %s", async value => {
    mocks.rpc.mockReturnValue(query(value));
    await expect(assertSamTaskSession(owner.userId)).rejects.toThrow("private to Sam");
  });
  it("checks the live Sam gate using the checked account and returns its request header", async () => {
    const gate = query(true);
    mocks.rpc.mockReturnValue(gate);
    expect(await assertSamTaskSession(owner.userId)).toBe("Bearer token-a");
    expect(mocks.rpc).toHaveBeenCalledWith("is_sam");
    expect(gate.setHeader).toHaveBeenCalledWith("Authorization", "Bearer token-a");
  });
  it("blocks an account switch while the Sam gate is pending", async () => {
    const gate = deferred<{ data: boolean; error: null }>();
    mocks.rpc.mockReturnValue({ setHeader: () => gate.promise });
    const pending = assertSamTaskSession(owner.userId);
    await vi.waitFor(() => expect(mocks.rpc).toHaveBeenCalled());
    mocks.getSession.mockResolvedValue(session("account-b", "token-b"));
    gate.resolve({ data: true, error: null });
    await expect(pending).rejects.toThrow("account changed");
  });
  it("rejects a closed task view before touching the session", async () => {
    await expect(taskAuthorization(owner.userId, () => false)).rejects.toThrow("no longer open");
    expect(mocks.getSession).not.toHaveBeenCalled();
  });
});
