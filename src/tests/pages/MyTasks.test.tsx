import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MyTasks from "@/pages/MyTasks";
import type { MyTask } from "@/lib/myTasks";

const state = vi.hoisted(() => ({ userId: "account-a" as string | null, loading: false, preview: false, resolve: vi.fn(), read: vi.fn(), create: vi.fn(), complete: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: state.userId ? { id: state.userId } : null, isLoading: state.loading }) }));
vi.mock("@/hooks/useRolePreview", () => ({ useRolePreview: () => ({ isPreviewing: state.preview }) }));
vi.mock("@/lib/myTasks", () => ({ resolveMyTaskOwner: state.resolve, readMyTasks: state.read, createMyTask: state.create, setMyTaskCompleted: state.complete, myTasksKey: (user: string, agent: string) => ["my-tasks", user, agent] }));
const task: MyTask = { id: "task-a", agent_id: "agent-account-a", title: "Synthetic follow-up", description: null, due_date: null, priority: "normal", status: "pending", completed_at: null, created_at: "2026-11-25T12:00:00Z", task_type: "general" };
let rows: MyTask[];
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false }, mutations: { retry: false } } });
  const node = () => <QueryClientProvider client={client}><MyTasks /></QueryClientProvider>;
  return { ...render(node()), node, client };
}
beforeEach(() => {
  vi.resetAllMocks();
  state.userId = "account-a"; state.loading = false; state.preview = false;
  rows = [];
  state.resolve.mockImplementation(async (userId: string) => ({ userId, agentId: `agent-${userId}` }));
  state.read.mockImplementation(async () => rows);
  state.create.mockImplementation(async (_owner, input) => { const saved = { ...task, ...input }; rows = [saved]; return saved; });
  state.complete.mockImplementation(async (_owner, id: string, completed: boolean) => { rows = rows.map(row => row.id === id ? { ...row, status: completed ? "completed" : "pending" } : row); });
});
afterEach(cleanup);

describe("My Tasks", () => {
  it.each(["anonymous", "loading", "preview"])("does not fetch tasks while %s", mode => {
    if (mode === "anonymous") state.userId = null;
    if (mode === "loading") state.loading = true;
    if (mode === "preview") state.preview = true;
    mount();
    expect(state.resolve).not.toHaveBeenCalled();
    expect(state.read).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Add task" })).not.toBeInTheDocument();
  });

  it("creates a task with optional details, then shows the saved record", async () => {
    const view = mount();
    await screen.findByText("Add your first task to get started.");
    fireEvent.change(screen.getByLabelText("What needs to happen?"), { target: { value: "Prepare tomorrow's calls" } });
    fireEvent.click(screen.getByText("Date, priority, and notes"));
    fireEvent.change(screen.getByLabelText("Due date"), { target: { value: "2026-11-26" } });
    fireEvent.change(screen.getByLabelText("Priority"), { target: { value: "high" } });
    fireEvent.change(screen.getByLabelText("Task notes"), { target: { value: "Review the contact list" } });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    expect(await screen.findByText("Prepare tomorrow's calls")).toBeInTheDocument();
    expect(state.create).toHaveBeenCalledWith({ userId: "account-a", agentId: "agent-account-a" }, { title: "Prepare tomorrow's calls", due_date: "2026-11-26", priority: "high", description: "Review the contact list" }, expect.any(Function));
    expect(screen.getByLabelText("What needs to happen?")).toHaveValue("");
    expect(view.client.getQueryData(["my-tasks", "account-a", "agent-account-a"])).toHaveLength(1);
  });

  it("completes and reopens only the selected saved task", async () => {
    rows = [task];
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Complete: Synthetic follow-up" }));
    await screen.findByText("Your open list is clear.");
    expect(state.complete).toHaveBeenCalledWith({ userId: "account-a", agentId: "agent-account-a" }, task.id, true, expect.any(Function));
    fireEvent.click(screen.getByRole("button", { name: "Show completed" }));
    fireEvent.click(screen.getByRole("button", { name: "Reopen: Synthetic follow-up" }));
    await screen.findByRole("button", { name: "Complete: Synthetic follow-up" });
    expect(state.complete).toHaveBeenLastCalledWith({ userId: "account-a", agentId: "agent-account-a" }, task.id, false, expect.any(Function));
  });

  it("shows a read failure without presenting an empty successful list", async () => {
    state.read.mockRejectedValue(new Error("Your tasks could not be loaded."));
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be loaded");
    expect(screen.queryByText("Add your first task to get started.")).not.toBeInTheDocument();
    expect(screen.queryByText("0 open in this list")).not.toBeInTheDocument();
  });

  it("retains input and reports a failed create", async () => {
    state.create.mockRejectedValue(new Error("Task could not be saved. Refresh your list before retrying."));
    mount();
    fireEvent.change(await screen.findByLabelText("What needs to happen?"), { target: { value: "Keep this draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Refresh your list before retrying");
    expect(screen.getByLabelText("What needs to happen?")).toHaveValue("Keep this draft");
  });

  it("does not hide a task when the server reports zero updated rows", async () => {
    rows = [task];
    state.complete.mockRejectedValue(new Error("Task was not updated. Refresh your list."));
    mount();
    fireEvent.click(await screen.findByRole("button", { name: "Complete: Synthetic follow-up" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("not updated");
    expect(screen.getByText("Synthetic follow-up")).toBeInTheDocument();
  });

  it("removes prior account data and form state while the next identity is loading", async () => {
    rows = [task];
    const view = mount();
    await screen.findByText("Synthetic follow-up");
    fireEvent.change(screen.getByLabelText("What needs to happen?"), { target: { value: "Private draft" } });
    state.resolve.mockImplementation(() => new Promise(() => {}));
    state.userId = "account-b";
    view.rerender(view.node());
    expect(screen.queryByText("Synthetic follow-up")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("Private draft")).not.toBeInTheDocument();
    await waitFor(() => expect(state.resolve).toHaveBeenLastCalledWith("account-b", expect.any(Function)));
    expect(state.read).toHaveBeenCalledTimes(1);
  });

  it("closes an in-flight write lease when role preview starts", async () => {
    let finish!: (value: MyTask) => void;
    state.create.mockReturnValue(new Promise<MyTask>(resolve => { finish = resolve; }));
    const view = mount();
    fireEvent.change(await screen.findByLabelText("What needs to happen?"), { target: { value: "Draft task" } });
    fireEvent.click(screen.getByRole("button", { name: "Add task" }));
    await waitFor(() => expect(state.create).toHaveBeenCalled());
    const lease = state.create.mock.calls[0][2] as () => boolean;
    expect(lease()).toBe(true);
    state.preview = true;
    view.rerender(view.node());
    expect(lease()).toBe(false);
    expect(screen.getByText("Exit role preview to open your own tasks.")).toBeInTheDocument();
    await act(async () => finish(task));
    expect(screen.queryByText("Synthetic follow-up")).not.toBeInTheDocument();
  });
});
