import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

const state = vi.hoisted(() => ({
  auth: { user: { id: "viewer-agent" }, isLoading: false, isAdmin: false, isManager: false, isRecruiter: false, isVa: false, isVaManager: false, effectiveMode: "agent" },
  preview: false,
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => state.auth }));
vi.mock("@/hooks/useRolePreview", () => ({ useRolePreview: () => ({ isPreviewing: state.preview }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
import ClientMarketing from "@/pages/ClientMarketing";

type CountResponse = { count?: unknown; data: unknown; error: unknown };
type QueryCall = { table: string; select?: unknown[]; filters: unknown[][]; signal?: AbortSignal };
const calls: QueryCall[] = [];
let counts: Record<string, unknown>;
let fail = false;
let delayed: Promise<CountResponse> | null = null;
const clipboard = vi.fn();

function chainFor(table: string) {
  const call: QueryCall = { table, filters: [] };
  calls.push(call);
  let milestone = "applications";
  const chain: Record<string, unknown> = {
    select: (...args: unknown[]) => { call.select = args; return chain; },
    or: (...args: unknown[]) => { call.filters.push(["or", ...args]); return chain; },
    not: (...args: unknown[]) => { milestone = String(args[0]); call.filters.push(["not", ...args]); return chain; },
    abortSignal: (signal: AbortSignal) => { call.signal = signal; return chain; },
    then: (resolve: (value: CountResponse) => unknown, reject?: (error: unknown) => unknown) => (delayed ?? Promise.resolve({ data: null, count: fail ? null : counts[milestone], error: fail ? { message: "Synthetic count source unavailable" } : null })).then(resolve, reject),
  };
  return chain;
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const node = () => <QueryClientProvider client={client}><MemoryRouter><ClientMarketing /></MemoryRouter></QueryClientProvider>;
  return { client, ...render(node()), node };
}
function openFunnels() { fireEvent.click(screen.getByRole("button", { name: "Recruiting Funnels" })); }
function stage(label: string) { return screen.getByText(label, { exact: true }).parentElement!; }

beforeEach(() => {
  state.auth = { user: { id: "viewer-agent" }, isLoading: false, isAdmin: false, isManager: false, isRecruiter: false, isVa: false, isVaManager: false, effectiveMode: "agent" };
  state.preview = false;
  counts = { applications: 2501, contacted_at: 1250, licensed_at: 1500, first_deal_at: 250 };
  fail = false; delayed = null; calls.length = 0;
  vi.mocked(supabase.from).mockReset();
  vi.mocked(supabase.from).mockImplementation((table: string) => chainFor(table) as never);
  vi.mocked(toast.success).mockReset(); vi.mocked(toast.error).mockReset();
  clipboard.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
});

describe("Client Marketing recruiting access and counts", () => {
  it("keeps templates available to agents without application reads or staff-only links", () => {
    state.auth.effectiveMode = "admin"; // Account mode is not a role grant.
    mount();
    expect(screen.getByRole("heading", { name: "Client Marketing" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy Pre-Appointment Confirm" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Recruiting Funnels" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /pipeline|applicants/i })).not.toBeInTheDocument();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it.each(["isAdmin", "isManager", "isRecruiter", "isVa", "isVaManager"] as const)("allows the real %s role, but reads exact scoped counts only on the active funnel tab", async role => {
    state.auth[role] = true;
    mount();
    expect(supabase.from).not.toHaveBeenCalled();
    openFunnels();
    expect(await screen.findByText("2,501")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Open pipeline" })).toHaveAttribute("href", "/dashboard/recruiting");
    expect(calls).toHaveLength(4);
    for (const call of calls) {
      expect(call.table).toBe("applications");
      expect(call.select).toEqual(["id", { count: "exact", head: true }]);
      expect(call.filters).toContainEqual(["or", "is_duplicate.eq.false,is_duplicate.is.null"]);
      expect(call.signal).toBeInstanceOf(AbortSignal);
    }
    expect(calls.map(call => call.filters.find(filter => filter[0] === "not")?.[1] ?? "applications")).toEqual(["applications", "contacted_at", "licensed_at", "first_deal_at"]);
    // Licensed can exceed contacted because these are independently recorded milestones.
    expect(within(stage("Licensed")).getByText("60%")).toBeInTheDocument();
    expect(within(stage("Contacted")).getByText("50%")).toBeInTheDocument();
    expect(screen.queryByText(/from prior stage/)).not.toBeInTheDocument();
    expect(screen.queryByText("120%")).not.toBeInTheDocument();
  });

  it.each(["loading", "preview"])("suppresses the privileged funnel during %s", mode => {
    state.auth.isAdmin = true;
    state.auth.isLoading = mode === "loading";
    state.preview = mode === "preview";
    mount();
    expect(screen.queryByRole("button", { name: "Recruiting Funnels" })).not.toBeInTheDocument();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("unmounts pending reads when the tab is closed and never displays loading counts as zeros", () => {
    state.auth.isAdmin = true;
    delayed = new Promise(() => {});
    mount(); openFunnels();
    expect(screen.getByRole("status")).toHaveTextContent("Loading recruiting funnel counts");
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
    const signals = calls.map(call => call.signal!);
    fireEvent.click(screen.getByRole("button", { name: "Client Marketing" }));
    expect(screen.getByRole("heading", { name: "Client Marketing" })).toBeInTheDocument();
    expect(signals.every(signal => signal.aborted)).toBe(true);
    expect(calls).toHaveLength(4);
  });

  it("drops cached funnel display during role preview and requires reopening the tab afterward", async () => {
    state.auth.isAdmin = true;
    const view = mount(); openFunnels(); await screen.findByText("2,501");
    state.preview = true;
    view.rerender(view.node());
    expect(screen.queryByText("2,501")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open pipeline" })).not.toBeInTheDocument();
    state.preview = false;
    view.rerender(view.node());
    expect(screen.getByRole("heading", { name: "Client Marketing" })).toBeInTheDocument();
    expect(calls).toHaveLength(4);
  });

  it("isolates accounts and resets a switched staff account to templates before its own counts load", async () => {
    state.auth.isAdmin = true;
    const view = mount(); openFunnels(); await screen.findByText("2,501");
    expect(view.client.getQueryData(["recruiting-funnel-overview", "viewer-agent", "admin"])).toMatchObject({ applications: 2501 });
    state.auth = { ...state.auth, user: { id: "viewer-next" }, isAdmin: false, isRecruiter: true };
    counts = { applications: 17, contacted_at: 4, licensed_at: 2, first_deal_at: 1 };
    view.rerender(view.node());
    expect(screen.queryByText("2,501")).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Client Marketing" })).toBeInTheDocument();
    expect(calls).toHaveLength(4);
    openFunnels();
    expect(await screen.findByText("17")).toBeInTheDocument();
    expect(view.client.getQueryData(["recruiting-funnel-overview", "viewer-next", "recruiter"])).toMatchObject({ applications: 17 });
    expect(screen.queryByText("2,501")).not.toBeInTheDocument();
  });

  it("does not reuse admin counts after a same-account role change", async () => {
    state.auth.isAdmin = true;
    const view = mount(); openFunnels(); await screen.findByText("2,501");
    state.auth = { ...state.auth, isAdmin: false, isManager: true };
    counts = { applications: 5, contacted_at: 3, licensed_at: 2, first_deal_at: 1 };
    view.rerender(view.node());
    expect(screen.queryByText("2,501")).not.toBeInTheDocument();
    expect(await screen.findByText("5")).toBeInTheDocument();
    expect(view.client.getQueryData(["recruiting-funnel-overview", "viewer-agent", "manager"])).toMatchObject({ applications: 5 });
  });

  it.each([null, undefined, -1, 1.5, Number.NaN, Infinity, "2501"])("rejects missing or malformed exact count %s instead of reporting zero", async count => {
    state.auth.isAdmin = true;
    counts.applications = count;
    mount(); openFunnels();
    expect(await screen.findByRole("alert")).toHaveTextContent("no valid exact count");
    expect(screen.queryByText("No applications in your scope")).not.toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("rejects inconsistent count snapshots rather than showing impossible percentages", async () => {
    state.auth.isAdmin = true;
    counts.contacted_at = 3000;
    mount(); openFunnels();
    expect(await screen.findByRole("alert")).toHaveTextContent("counts changed while loading");
    expect(screen.queryByText("120%")).not.toBeInTheDocument();
  });

  it("shows a verified empty state only after four successful zero counts", async () => {
    state.auth.isAdmin = true;
    counts = { applications: 0, contacted_at: 0, licensed_at: 0, first_deal_at: 0 };
    mount(); openFunnels();
    expect(await screen.findByText("No applications in your scope")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(calls).toHaveLength(4);
  });

  it("offers retry after failed counts and labels cached counts stale after a later failure", async () => {
    state.auth.isAdmin = true;
    fail = true;
    const view = mount(); openFunnels();
    expect(await screen.findByRole("alert")).toHaveTextContent("Synthetic count source unavailable");
    fail = false;
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    await screen.findByText("2,501");
    fail = true;
    await act(async () => { await view.client.invalidateQueries({ queryKey: ["recruiting-funnel-overview", "viewer-agent", "admin"] }); });
    expect(await screen.findByText(/The latest refresh failed/)).toBeInTheDocument();
    expect(screen.getByText("2,501")).toBeInTheDocument();
    expect(screen.queryByText("No applications in your scope")).not.toBeInTheDocument();
  });
});

describe("Client Marketing clipboard feedback", () => {
  it("reports and counts a successful copy only after clipboard completion", async () => {
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Copy Pre-Appointment Confirm" }));
    expect(await screen.findByRole("button", { name: "Copied Pre-Appointment Confirm" })).toBeInTheDocument();
    expect(clipboard).toHaveBeenCalledWith(expect.stringContaining("{first_name}"));
    expect(toast.success).toHaveBeenCalledExactlyOnceWith("Copied: Pre-Appointment Confirm");
    expect(toast.error).not.toHaveBeenCalled();
    expect(screen.getByText("1× this session")).toBeInTheDocument();
  });

  it("shows a denied clipboard write without copied success or incremented copy counts", async () => {
    clipboard.mockRejectedValue(new DOMException("Denied", "NotAllowedError"));
    mount();
    fireEvent.click(screen.getByRole("button", { name: "Copy Pre-Appointment Confirm" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Could not copy. Select the template text and copy it manually."));
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Copied Pre-Appointment Confirm" })).not.toBeInTheDocument();
    expect(screen.queryByText("1× this session")).not.toBeInTheDocument();
  });

  it("suppresses completion feedback and copy counters after an account switch", async () => {
    let complete!: () => void;
    clipboard.mockImplementation(() => new Promise<void>(resolve => { complete = resolve; }));
    const view = mount();
    fireEvent.click(screen.getByRole("button", { name: "Copy Pre-Appointment Confirm" }));
    state.auth.user = { id: "viewer-next" };
    view.rerender(view.node());
    await act(async () => { complete(); });
    expect(toast.success).not.toHaveBeenCalled();
    expect(screen.queryByText("1× this session")).not.toBeInTheDocument();
  });
});
