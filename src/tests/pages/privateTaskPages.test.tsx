import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SamTodo from "@/pages/SamTodo";
import MyDay from "@/pages/MyDay";
import SamHQ from "@/pages/admin/SamHQ";
import { MyDayTodoist } from "@/components/myday/MyDayTodoist";
import { MyDayWins, WIN_KINDS } from "@/components/myday/MyDayWins";
import { PrelicensingCheck } from "@/components/myday/PrelicensingCheck";
import { myDayCacheKey } from "@/lib/privateTasks";
import { phoenixDateKey } from "@/lib/contentWeek";
import { cloneElement, type ReactElement } from "react";

const state = vi.hoisted(() => ({ allowed: false, userId: "sam-account", checking: false, blockQueueWrites: false, blockQueueClear: false, getSession: vi.fn(), rpc: vi.fn(), from: vi.fn(), invoke: vi.fn(), toastError: vi.fn() }));
vi.mock("@/hooks/useSamPrivateAccess", () => ({ useSamPrivateAccess: () => ({ allowed: state.allowed, userId: state.userId, isChecking: state.checking, isError: false }) }));
vi.mock("@/hooks/useConfirm", () => ({ useConfirm: () => async () => false }));
vi.mock("@/components/contracting-review/ContractingReviewBanner", () => ({ ContractingReviewBanner: () => null }));
vi.mock("sonner", () => ({ toast: Object.assign(vi.fn(), { error: state.toastError, success: vi.fn() }) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { auth: { getSession: state.getSession }, rpc: state.rpc, from: state.from, functions: { invoke: state.invoke } } }));

const todo = { source: "manual", source_id: "synthetic-item", text: "Sam-only synthetic task", status: "pending", created_at: "2026-11-25T12:00:00Z", due_at: null, priority: 1, link: null };
const counts = Object.fromEntries(WIN_KINDS.map(({ kind }) => [kind, { today: 1, week: 2, total: 3 }]));
const prelicense = { email_key: "synthetic@example.test", name: "Synthetic Hire", phone: null, source: "course_buyer", bought_at: null, xcel_pct: null, xcel_status: null, in_slack: false, prelicensing_done: false, note: null };
// Exercise the current-task branch deterministically, including its browser scroll API.
const testNow = new Date("2026-11-25T07:15:00Z"); // 00:15 in Phoenix
const day = phoenixDateKey(testNow);
const weekday = new Date(`${day}T12:00:00Z`).getUTCDay() || 7;
const plan = { id: "schedule-a", weekday, start_min: 0, duration_min: 30, title: "Synthetic schedule", detail: null, category: "sales", sort: 0, alert: true };
const scrollIntoView = vi.fn();
const scrollIntoViewDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, "scrollIntoView");
type Call = { source: string; method: string; args: unknown[] };
const calls: Call[] = [];
const results = new Map<string, unknown>();
const errors = new Map<string, unknown>();
function query(source: string, data: unknown = []) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "in", "not", "neq", "order", "limit", "insert", "update", "delete", "upsert", "single", "maybeSingle", "setHeader"]) {
    chain[method] = (...args: unknown[]) => { calls.push({ source, method, args }); return chain; };
  }
  chain.then = (resolve: (result: unknown) => unknown) => Promise.resolve({ data, error: errors.get(source) ?? null, count: 0 }).then(resolve);
  return chain;
}
function mount(page: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });
  const node = () => <QueryClientProvider client={client}><MemoryRouter>{cloneElement(page)}</MemoryRouter></QueryClientProvider>;
  return { ...render(node()), client, node };
}
beforeEach(() => {
  vi.resetAllMocks(); calls.length = 0; results.clear(); errors.clear();
  // Keep async waits on real timers while freezing date-dependent schedule/cache keys.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(testNow);
  Object.defineProperty(Element.prototype, "scrollIntoView", { configurable: true, writable: true, value: scrollIntoView });
  const stored = new Map<string, string>();
  const storage: Storage = {
    get length() { return stored.size; }, clear: () => stored.clear(), key: index => [...stored.keys()][index] ?? null,
    getItem: key => stored.get(key) ?? null, removeItem: key => { stored.delete(key); },
    setItem: (key, value) => {
      if (key.endsWith(":pending") && (state.blockQueueWrites || (state.blockQueueClear && value === "[]"))) throw new DOMException("Quota exceeded", "QuotaExceededError");
      stored.set(key, value);
    },
  };
  vi.stubGlobal("localStorage", storage);
  state.allowed = false; state.userId = "sam-account"; state.checking = false;
  state.blockQueueWrites = false; state.blockQueueClear = false;
  state.getSession.mockImplementation(async () => ({ data: { session: { user: { id: state.userId }, access_token: "sam-token" } }, error: null }));
  state.rpc.mockImplementation((name: string) => query(name, results.has(name) ? results.get(name) : name === "is_sam" ? true : name === "sam_todo_list" ? [todo] : name === "myday_counters" ? counts : name === "prelicensing_check_list" ? [] : null));
  state.from.mockImplementation((table: string) => query(table, results.has(table) ? results.get(table) : []));
  state.invoke.mockResolvedValue({ data: { ok: true, tasks: [] }, error: null });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (scrollIntoViewDescriptor) Object.defineProperty(Element.prototype, "scrollIntoView", scrollIntoViewDescriptor);
  else Reflect.deleteProperty(Element.prototype, "scrollIntoView");
});

describe("private task entry points", () => {
  it.each([["Sam Todo", <SamTodo />], ["My Day", <MyDay />], ["Sam HQ", <SamHQ />], ["Todoist tile", <MyDayTodoist />], ["Wins", <MyDayWins />], ["Pre-licensing", <PrelicensingCheck defaultOpen />]] as const)("does not read or write %s without the owner gate", (_name, page) => {
    mount(page);
    expect(state.rpc).not.toHaveBeenCalled();
    expect(state.from).not.toHaveBeenCalled();
    expect(state.invoke).not.toHaveBeenCalled();
    expect(state.getSession).not.toHaveBeenCalled();
  });

  it("does not reveal an already cached global Sam Todo list", () => {
    const view = mount(<SamTodo />);
    view.client.setQueryData(["sam-todo"], [todo]);
    view.rerender(view.node());
    expect(screen.queryByText(todo.text)).not.toBeInTheDocument();
  });

  it("uses a Sam-account cache and request token, then hides it on account change", async () => {
    state.allowed = true;
    const view = mount(<SamTodo />);
    await screen.findByText(todo.text);
    expect(view.client.getQueryData(["sam-todo", "sam-account"])).toEqual([todo]);
    expect(view.client.getQueryData(["sam-todo"])).toBeUndefined();
    expect(calls).toContainEqual({ source: "sam_todo_list", method: "setHeader", args: ["Authorization", "Bearer sam-token"] });
    state.allowed = false; state.userId = "other-account";
    view.rerender(view.node());
    expect(screen.queryByText(todo.text)).not.toBeInTheDocument();
  });

  it("stops a pending dismiss when the gated page unmounts", async () => {
    state.allowed = true;
    const view = mount(<SamTodo />);
    await screen.findByText(todo.text);
    let release!: (value: { data: boolean; error: null }) => void;
    const pendingGate = new Promise<{ data: boolean; error: null }>(resolve => { release = resolve; });
    state.rpc.mockImplementation((name: string) => name === "is_sam" ? { setHeader: () => pendingGate } : query(name, [todo]));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    await waitFor(() => expect(state.rpc).toHaveBeenCalledWith("is_sam"));
    state.allowed = false;
    view.rerender(view.node());
    await act(async () => release({ data: true, error: null }));
    await waitFor(() => expect(state.getSession).toHaveBeenCalledTimes(2));
    expect(state.rpc.mock.calls.some(([name]) => name === "sam_todo_dismiss")).toBe(false);
    expect(state.toastError).not.toHaveBeenCalled();
  });

  it("ignores an old unowned offline queue rather than sending it as Sam", async () => {
    localStorage.setItem("myday:pending", JSON.stringify([{ task_id: "unknown-owner-task", day: "2026-11-25", done: true }]));
    localStorage.setItem("myday:tasks:3", JSON.stringify([{ id: "unknown-owner-task", title: "Old unowned cache" }]));
    state.allowed = true;
    mount(<MyDay />);
    await waitFor(() => expect(state.from).toHaveBeenCalledWith("day_plan_tasks"));
    await waitFor(() => expect(calls.some(call => call.source === "day_plan_tasks" && call.method === "setHeader")).toBe(true));
    expect(screen.queryByText("Old unowned cache")).not.toBeInTheDocument();
    expect(calls.some(call => ["upsert", "update", "delete", "insert"].includes(call.method))).toBe(false);
    expect(calls).toContainEqual({ source: "day_plan_tasks", method: "eq", args: ["user_id", "sam-account"] });
    expect(calls).toContainEqual({ source: "day_plan_checks", method: "eq", args: ["user_id", "sam-account"] });
    expect(localStorage.getItem(myDayCacheKey("other-account", "pending"))).toBeNull();
  });

  it("scopes Todoist cache and read request to the checked owner", async () => {
    state.allowed = true;
    const view = mount(<MyDayTodoist />);
    await screen.findByText("Nothing due or overdue in Todoist.");
    expect(view.client.getQueryData(["myday_todoist_today", "sam-account"])).toEqual([]);
    expect(state.invoke).toHaveBeenCalledWith("myday-todoist", { body: { action: "today" }, headers: { Authorization: "Bearer sam-token" } });
  });

  it("scopes every HQ query by owner and pins its request token", async () => {
    state.allowed = true;
    const view = mount(<SamHQ />);
    await screen.findByText(/No tasks set for today yet/);
    await waitFor(() => expect(view.client.getQueryCache().getAll().every(entry => entry.state.status === "success")).toBe(true));
    const queries = view.client.getQueryCache().getAll();
    expect(queries).toHaveLength(9);
    expect(queries.every(entry => entry.queryKey[1] === "sam-account")).toBe(true);
    expect(calls.filter(call => call.method === "setHeader")).toHaveLength(17);
    expect(calls.filter(call => call.method === "setHeader").every(call => call.args[1] === "Bearer sam-token")).toBe(true);
  });

  it("requires durable enqueue before showing or sending a checkmark", async () => {
    state.allowed = true;
    results.set("day_plan_tasks", [plan]);
    mount(<MyDay />);
    const button = await screen.findByRole("button", { name: /Synthetic schedule/ });
    expect(button).toHaveAttribute("aria-pressed", "false");
    state.blockQueueWrites = true;
    fireEvent.click(button);
    expect(await screen.findByRole("alert")).toHaveTextContent("Checkmark not changed");
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(calls.some(call => call.method === "upsert")).toBe(false);
    expect(screen.queryByText("Saved", { exact: true })).not.toBeInTheDocument();
    state.blockQueueWrites = false;
    fireEvent.click(button);
    await screen.findByText("Saved", { exact: true });
    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(JSON.parse(localStorage.getItem(myDayCacheKey("sam-account", "pending"))!)).toEqual([]);
  });

  it.each([
    { now: testNow, current: true },
    { now: new Date("2026-11-25T08:00:00Z"), current: false },
  ])("scrolls only to the current task at $now", async ({ now, current }) => {
    vi.setSystemTime(now);
    state.allowed = true;
    results.set("day_plan_tasks", [plan]);
    const view = mount(<MyDay />);
    const button = await screen.findByRole("button", { name: /Synthetic schedule/ });
    if (current) {
      expect(screen.getByText("Now", { exact: true })).toBeInTheDocument();
      expect(scrollIntoView).toHaveBeenCalledTimes(1);
      expect(scrollIntoView).toHaveBeenCalledWith({ block: "center", behavior: "smooth" });
      expect(scrollIntoView.mock.contexts).toEqual([button]);
    } else {
      expect(screen.queryByText("Now", { exact: true })).not.toBeInTheDocument();
      expect(scrollIntoView).not.toHaveBeenCalled();
    }
    view.rerender(view.node());
    expect(scrollIntoView).toHaveBeenCalledTimes(current ? 1 : 0);
  });

  it("keeps queue-clear failures visible after an online write instead of claiming Saved", async () => {
    state.allowed = true; state.blockQueueClear = true;
    results.set("day_plan_tasks", [plan]);
    mount(<MyDay />);
    fireEvent.click(await screen.findByRole("button", { name: /Synthetic schedule/ }));
    expect(await screen.findByRole("alert")).toHaveTextContent("queue has not been cleared");
    expect(calls.some(call => call.method === "upsert")).toBe(true);
    expect(screen.queryByText("Saved", { exact: true })).not.toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(myDayCacheKey("sam-account", "pending"))!)).toEqual([{ task_id: plan.id, day, done: true }]);
    state.blockQueueClear = false;
    fireEvent(window, new Event("online"));
    await screen.findByText("Saved", { exact: true });
    expect(JSON.parse(localStorage.getItem(myDayCacheKey("sam-account", "pending"))!)).toEqual([]);
  });

  it("does not replay or overwrite a malformed saved queue", async () => {
    state.allowed = true;
    results.set("day_plan_tasks", [plan]);
    const key = myDayCacheKey("sam-account", "pending");
    localStorage.setItem(key, "{}");
    mount(<MyDay />);
    const button = await screen.findByRole("button", { name: /Synthetic schedule/ });
    await screen.findByRole("alert");
    fireEvent.click(button);
    expect(button).toHaveAttribute("aria-pressed", "false");
    expect(calls.some(call => call.method === "upsert")).toBe(false);
    expect(localStorage.getItem(key)).toBe("{}");
  });

  it.each(["tasks", "checks"] as const)("replaces a malformed %s cache with verified online data", async part => {
    state.allowed = true;
    results.set("day_plan_tasks", [plan]);
    localStorage.setItem(myDayCacheKey("sam-account", part, part === "tasks" ? weekday : day), "{}");
    mount(<MyDay />);
    expect(await screen.findByRole("button", { name: /Synthetic schedule/ })).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByText(/Nothing planned for/)).not.toBeInTheDocument();
  });

  it.each(["error", "null"])("does not turn a %s checks response into unchecked tasks or a zero total", async mode => {
    state.allowed = true;
    results.set("day_plan_tasks", [plan]);
    if (mode === "error") errors.set("day_plan_checks", { message: "Synthetic unavailable checks" });
    else results.set("day_plan_checks", null);
    mount(<MyDay />);
    await screen.findByText("Checkmarks unavailable");
    const button = screen.getByRole("button", { name: /Synthetic schedule/ });
    expect(button).toHaveAttribute("aria-pressed", "mixed");
    expect(button).toHaveAttribute("aria-disabled", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Completion totals are unavailable");
    expect(screen.queryByText("0 of 1 done", { exact: true })).not.toBeInTheDocument();
    fireEvent.click(button);
    expect(calls.some(call => call.method === "upsert")).toBe(false);
    errors.clear(); results.set("day_plan_checks", []);
    fireEvent.click(screen.getByRole("button", { name: "Retry checkmarks" }));
    await screen.findByText("0 of 1 done", { exact: true });
    expect(screen.getByRole("button", { name: /Synthetic schedule/ })).toHaveAttribute("aria-pressed", "false");
  });

  it("preserves valid cached checks as stale when the online checks read fails", async () => {
    state.allowed = true;
    results.set("day_plan_tasks", [plan]);
    errors.set("day_plan_checks", { message: "Synthetic unavailable checks" });
    localStorage.setItem(myDayCacheKey("sam-account", "checks", day), JSON.stringify([plan.id]));
    mount(<MyDay />);
    await screen.findByText("Last saved: 1 of 1 done", { exact: true });
    expect(screen.getByRole("button", { name: /Synthetic schedule/ })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("alert")).toHaveTextContent("Showing the last saved checkmarks");
    expect(screen.queryByText("0 of 1 done", { exact: true })).not.toBeInTheDocument();
  });

  it.each([
    { name: "win add", page: <MyDayWins />, button: "Add one: Long-form video posted", rpc: "myday_counter_add" },
    { name: "win undo", page: <MyDayWins />, button: "Undo last: Long-form video posted", rpc: "myday_counter_undo" },
    { name: "pre-licensing update", page: <PrelicensingCheck defaultOpen />, button: "Not in the Slack", rpc: "prelicensing_set" },
  ])("cancels pending $name when access/preview changes", async ({ page, button, rpc }) => {
    state.allowed = true;
    results.set("prelicensing_check_list", [prelicense]);
    const view = mount(page);
    const control = await screen.findByRole("button", { name: button });
    await waitFor(() => expect(control).not.toBeDisabled());
    let release!: (value: { data: boolean; error: null }) => void;
    const gate = new Promise<{ data: boolean; error: null }>(resolve => { release = resolve; });
    state.rpc.mockImplementation((name: string) => name === "is_sam" ? { setHeader: () => gate } : query(name, { ok: true }));
    fireEvent.click(control);
    await waitFor(() => expect(state.rpc).toHaveBeenCalledWith("is_sam"));
    state.allowed = false;
    view.rerender(view.node());
    await act(async () => release({ data: true, error: null }));
    expect(state.rpc.mock.calls.some(([name]) => name === rpc)).toBe(false);
    expect(state.toastError).not.toHaveBeenCalled();
  });

  it.each([
    { page: <MyDayWins />, key: "myday_counters", control: "Add one: Long-form video posted", rpc: "myday_counter_add" },
    { page: <PrelicensingCheck defaultOpen />, key: "prelicensing_check_list", control: "Not in the Slack", rpc: "prelicensing_set" },
  ])("pins $key reads/writes and uses an account-specific cache", async ({ page, key, control, rpc }) => {
    state.allowed = true;
    results.set("prelicensing_check_list", [prelicense]); results.set(rpc, { ok: true });
    const view = mount(page);
    const button = await screen.findByRole("button", { name: control });
    await waitFor(() => expect(view.client.getQueryData([key, "sam-account"])).toBeDefined());
    expect(view.client.getQueryData([key])).toBeUndefined();
    fireEvent.click(button);
    await waitFor(() => expect(calls).toContainEqual({ source: rpc, method: "setHeader", args: ["Authorization", "Bearer sam-token"] }));
    expect(calls).toContainEqual({ source: key, method: "setHeader", args: ["Authorization", "Bearer sam-token"] });
    state.allowed = false; state.userId = "another-account";
    view.rerender(view.node());
    expect(screen.queryByRole("button", { name: control })).not.toBeInTheDocument();
  });
});
