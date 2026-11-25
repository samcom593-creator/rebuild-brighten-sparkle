import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMyTask, myTasksKey, readMyTasks, resolveMyTaskOwner, setMyTaskCompleted } from "@/lib/myTasks";
import { assertSamTaskSession, myDayCacheKey, taskAuthorization } from "@/lib/privateTasks";

const mocks = vi.hoisted(() => ({ getSession: vi.fn(), rpc: vi.fn(), from: vi.fn(), invoke: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession: mocks.getSession }, rpc: mocks.rpc, from: mocks.from, functions: { invoke: mocks.invoke } } }));
const owner = { userId: "account-a", agentId: "agent-a" };
const session = (id = owner.userId, token = "token-a") => ({ data: { session: { user: { id }, access_token: token } }, error: null });
const agent = { id: owner.agentId, user_id: owner.userId, status: "active", canonical_agent_id: null, is_inactive: false, is_deactivated: false };
const task = { id: "task-a", agent_id: owner.agentId, title: "Follow up", description: null, due_date: null, priority: "normal", status: "pending", completed_at: null, created_at: "2026-11-25T12:00:00Z", task_type: "general" };
const input = { title: "Follow up", description: null, due_date: null, priority: "normal" as const };
function query(data: unknown, error: unknown = null) {
  const result = Promise.resolve({ data, error });
  const builder = { select: vi.fn(), eq: vi.fn(), order: vi.fn(), limit: vi.fn(), update: vi.fn(), maybeSingle: vi.fn(), setHeader: vi.fn(), then: result.then.bind(result) };
  for (const method of [builder.select, builder.eq, builder.order, builder.limit, builder.update, builder.maybeSingle, builder.setHeader]) method.mockReturnValue(builder);
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

describe("My Tasks account scope", () => {
  it("resolves the same owner as server RLS using the checked account token", async () => {
    const identity = query(owner.agentId);
    const row = query(agent);
    mocks.rpc.mockReturnValue(identity);
    mocks.from.mockReturnValue(row);
    expect(await resolveMyTaskOwner(owner.userId)).toEqual(owner);
    expect(mocks.rpc).toHaveBeenCalledWith("current_agent_id");
    expect(identity.setHeader).toHaveBeenCalledWith("Authorization", "Bearer token-a");
    expect(row.eq).toHaveBeenCalledWith("id", owner.agentId);
    expect(row.setHeader).toHaveBeenCalledWith("Authorization", "Bearer token-a");
  });

  it.each([{ ...agent, user_id: "account-b" }, { ...agent, canonical_agent_id: "merged-agent" }, { ...agent, status: "terminated" }, null])("refuses an unowned or unusable agent", async row => {
    mocks.rpc.mockReturnValue(query(owner.agentId));
    mocks.from.mockReturnValue(query(row));
    await expect(resolveMyTaskOwner(owner.userId)).rejects.toThrow("active, unmerged");
  });

  it("bounds reads to the explicit owner and never uses a global cache key", async () => {
    const rows = query([task]);
    mocks.from.mockReturnValue(rows);
    expect(await readMyTasks(owner)).toEqual([task]);
    expect(mocks.from).toHaveBeenCalledWith("agent_tasks");
    expect(rows.eq).toHaveBeenCalledWith("agent_id", owner.agentId);
    expect(rows.limit).toHaveBeenCalledWith(200);
    expect(rows.setHeader).toHaveBeenCalledWith("Authorization", "Bearer token-a");
    expect(myTasksKey("account-a", "agent-a")).not.toEqual(myTasksKey("account-b", "agent-a"));
  });

  it("reports failed reads rather than an empty list", async () => {
    mocks.from.mockReturnValue(query(null, new Error("denied")));
    await expect(readMyTasks(owner)).rejects.toThrow("could not be loaded");
  });

  it("accepts a verified empty array as an empty task list", async () => {
    mocks.from.mockReturnValue(query([]));
    expect(await readMyTasks(owner)).toEqual([]);
  });

  it.each([
    null, undefined, {}, { data: [] }, [null], ["task"], [{ id: "task-a" }],
    [{ ...task, agent_id: "another-agent" }], [{ ...task, title: null }],
    [{ ...task, due_date: {} }], [{ ...task, status: undefined }],
    [{ ...task, created_at: "not-a-time" }], [{ ...task, completed_at: true }], [task, task],
  ])("rejects an unverified task response instead of empty/crashing: %j", async value => {
    mocks.from.mockReturnValue(query(value));
    await expect(readMyTasks(owner)).rejects.toThrow("could not be verified");
  });

  it("creates through the guarded endpoint with only supported fields and a pinned token", async () => {
    mocks.invoke.mockResolvedValue({ data: { ok: true, task }, error: null });
    expect(await createMyTask(owner, input)).toEqual(task);
    expect(mocks.invoke).toHaveBeenCalledWith("personal-task-create", { body: input, headers: { Authorization: "Bearer token-a" } });
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("does not accept a receipt for another agent", async () => {
    mocks.invoke.mockResolvedValue({ data: { ok: true, task: { ...task, agent_id: "agent-b" } }, error: null });
    await expect(createMyTask(owner, input)).rejects.toThrow("account changed");
  });

  it("checks the affected owner and status after completion", async () => {
    const update = query({ id: task.id, agent_id: owner.agentId, status: "completed" });
    mocks.from.mockReturnValue(update);
    await setMyTaskCompleted(owner, task.id, true);
    expect(update.eq).toHaveBeenCalledWith("agent_id", owner.agentId);
    expect(update.eq).toHaveBeenCalledWith("id", task.id);
    expect(update.update).toHaveBeenCalledWith({ status: "completed", completed_at: expect.any(String) });
    expect(update.setHeader).toHaveBeenCalledWith("Authorization", "Bearer token-a");
  });

  it("can reopen a task without a fabricated completion date", async () => {
    const update = query({ id: task.id, agent_id: owner.agentId, status: "pending" });
    mocks.from.mockReturnValue(update);
    await setMyTaskCompleted(owner, task.id, false);
    expect(update.update).toHaveBeenCalledWith({ status: "pending", completed_at: null });
  });

  it.each([null, { id: task.id, agent_id: "other", status: "completed" }, { id: task.id, agent_id: owner.agentId, status: "pending" }])("does not report completion for a missing or mismatched affected row", async receipt => {
    mocks.from.mockReturnValue(query(receipt));
    await expect(setMyTaskCompleted(owner, task.id, true)).rejects.toThrow("not updated");
  });

  it("does not start reads or writes after an account switch", async () => {
    mocks.getSession.mockResolvedValue(session("account-b", "token-b"));
    await expect(readMyTasks(owner)).rejects.toThrow("account changed");
    await expect(createMyTask(owner, input)).rejects.toThrow("account changed");
    await expect(setMyTaskCompleted(owner, task.id, true)).rejects.toThrow("account changed");
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

  it("rejects a late result after account change, retaining the original request token", async () => {
    const save = deferred<{ data: { ok: true; task: typeof task }; error: null }>();
    mocks.invoke.mockReturnValue(save.promise);
    const pending = createMyTask(owner, input);
    await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalled());
    mocks.getSession.mockResolvedValue(session("account-b", "token-b"));
    save.resolve({ data: { ok: true, task }, error: null });
    await expect(pending).rejects.toThrow("account changed");
    expect(mocks.invoke.mock.calls[0][1].headers.Authorization).toBe("Bearer token-a");
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
