import { act, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";

const state = vi.hoisted(() => ({
  auth: { user: { id: "admin-a" } as { id: string } | null, isAdmin: true, isManager: false, isLoading: false, effectiveMode: "admin" },
  preview: false,
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => state.auth }));
vi.mock("@/hooks/useRolePreview", () => ({ useRolePreview: () => ({ isPreviewing: state.preview }) }));
import BusinessAnalytics from "@/pages/BusinessAnalytics";

type Reply = { data: unknown; error: unknown };
type Read = { viewer: string; source: string; signal?: AbortSignal };
const reads: Read[] = [];
const pending = new Map<string, Promise<void>>();
let failedSource: string | null = null;
const keys = [
  "business-analytics-summary", "business-analytics-carriers", "business-analytics-insights",
  "sales-challenges", "trophy-cabinet", "agents-needs-attention", "agents-learn-from",
  "agents-inactive-summary", "admin-platform-pulse", "admin-dialer-seats",
];

function fixture(source: string, viewer: string): unknown {
  switch (source) {
    case "v_business_analytics_summary": return { total_deals_mtd: "10", total_premium_mtd: viewer === "admin-a" ? "43127" : "8765", active_producers_30d: "4", avg_deal_size: "1200", premium_last_month: "10000", growth_pct_mom: "5" };
    case "v_business_analytics_carriers": return [{ carrier_id: 1, carrier_name: `Carrier ${viewer}`, deal_count: 3, total_premium: "3600", avg_deal_size: "1200" }];
    case "v_business_analytics_insights": return { top_carrier_name: null, top_carrier_share_pct: "0", top_carrier_deals: "0", top3_producer_share_pct: "0", team_producers: "4", team_deals_30d: "10", team_premium_30d: "12000", streak_days: "2", days_in_month_elapsed: "5" };
    case "v_trophy_cabinet": return { daily_wins: 1, weekly_wins: 0, monthly_wins: 0, quarterly_wins: 0, total_wins: 1 };
    case "v_inactive_agents_summary": return { inactive_count: 0, sample_names: [] };
    case "v_sales_challenges":
    case "v_agents_needs_attention":
    case "v_agents_learn_from": return [];
    case "admin_platform_pulse":
    case "admin_dialer_seats": return null;
    default: throw new Error(`Unexpected test source: ${source}`);
  }
}
function replyFor(read: Read): Promise<Reply> {
  const response = { data: fixture(read.source, read.viewer), error: read.source === failedSource ? new Error("Synthetic report source unavailable") : null };
  return (pending.get(read.viewer) ?? Promise.resolve()).then(() => response);
}
function chainFor(source: string) {
  const read: Read = { source, viewer: state.auth.user!.id };
  reads.push(read);
  const chain = {
    select: () => chain,
    limit: () => chain,
    abortSignal: (signal: AbortSignal) => { read.signal = signal; return chain; },
    maybeSingle: () => replyFor(read),
    then: (fulfilled: (reply: Reply) => unknown, rejected?: (error: unknown) => unknown) => replyFor(read).then(fulfilled, rejected),
  };
  return chain;
}
function delay(viewer: string) {
  let resolve!: () => void;
  pending.set(viewer, new Promise<void>(done => { resolve = done; }));
  return resolve;
}
function mount() {
  // A fresh global key would stay cached indefinitely here: account switching
  // must work by identity, independently of refetch or cache-expiry timing.
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  const node = () => <QueryClientProvider client={client}><MemoryRouter><BusinessAnalytics /></MemoryRouter></QueryClientProvider>;
  return { client, node, ...render(node()) };
}

beforeEach(() => {
  state.auth = { user: { id: "admin-a" }, isAdmin: true, isManager: false, isLoading: false, effectiveMode: "admin" };
  state.preview = false;
  failedSource = null;
  pending.clear(); reads.length = 0;
  vi.mocked(supabase.from).mockReset();
  vi.mocked(supabase.from).mockImplementation((source: string) => chainFor(source) as never);
  vi.mocked(supabase.rpc).mockReset();
  vi.mocked(supabase.rpc).mockImplementation((source: string) => {
    const read = { source, viewer: state.auth.user!.id };
    reads.push(read);
    return replyFor(read) as never;
  });
});

describe("Reports account and role isolation", () => {
  it.each(["signed out", "loading", "manager", "preview"])("does not mount any Reports read for %s", mode => {
    if (mode === "signed out") state.auth.user = null;
    if (mode === "loading") state.auth.isLoading = true;
    if (mode === "manager") { state.auth.isAdmin = false; state.auth.isManager = true; }
    if (mode === "preview") state.preview = true;
    const view = mount();
    expect(reads).toEqual([]);
    expect(view.client.getQueryCache().getAll()).toHaveLength(0);
    expect(screen.queryByTestId("platform-pulse")).not.toBeInTheDocument();
    expect(screen.queryByTestId("dialer-seats")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Performance goals" })).not.toBeInTheDocument();
  });

  it("loads all ten real-admin sources under the viewer identity and retains Performance goals", async () => {
    const view = mount();
    expect(await screen.findByText("Carrier admin-a")).toBeInTheDocument();
    await waitFor(() => expect(reads).toHaveLength(10));
    expect(screen.getByText("$43,127")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Performance goals" })).toHaveAttribute("href", "/dashboard/admin/performance-bot");
    expect(view.client.getQueryCache().getAll().map(query => query.queryKey)).toEqual(expect.arrayContaining(keys.map(key => [key, "admin-a"])));
    expect(view.client.getQueryCache().getAll()).toHaveLength(10);
    expect(reads.filter(read => read.source.startsWith("v_")).every(read => read.signal instanceof AbortSignal)).toBe(true);
  });

  it.each(["preview", "role loss", "new-account loading"])("removes already-cached Reports during %s", async mode => {
    const view = mount();
    await screen.findByText("Carrier admin-a");
    if (mode === "preview") state.preview = true;
    if (mode === "role loss") state.auth.isAdmin = false;
    if (mode === "new-account loading") state.auth = { ...state.auth, user: { id: "agent-b" }, isLoading: true };
    view.rerender(view.node());
    expect(screen.queryByText("Carrier admin-a")).not.toBeInTheDocument();
    expect(screen.queryByText("$43,127")).not.toBeInTheDocument();
    expect(screen.queryByTestId("platform-pulse")).not.toBeInTheDocument();
    expect(screen.queryByTestId("dialer-seats")).not.toBeInTheDocument();
    expect(reads).toHaveLength(10);
  });

  it("does not reuse cached figures or nested admin panels while a second admin's reads are pending", async () => {
    const view = mount();
    await screen.findByText("Carrier admin-a");
    const finish = delay("admin-b");
    state.auth.user = { id: "admin-b" };
    view.rerender(view.node());
    expect(screen.queryByText("Carrier admin-a")).not.toBeInTheDocument();
    expect(screen.queryByText("$43,127")).not.toBeInTheDocument();
    await waitFor(() => expect(reads).toHaveLength(20));
    expect(view.client.getQueryCache().getAll().filter(query => query.queryKey[1] === "admin-b")).toHaveLength(10);
    await act(async () => finish());
    expect(await screen.findByText("Carrier admin-b")).toBeInTheDocument();
    expect(screen.getByText("$8,765")).toBeInTheDocument();
    expect(screen.queryByText("Carrier admin-a")).not.toBeInTheDocument();
  });

  it("cancels old table reads and ignores their late result after switching accounts", async () => {
    const finish = delay("admin-a");
    const view = mount();
    await waitFor(() => expect(reads).toHaveLength(10));
    const oldSignals = reads.filter(read => read.signal).map(read => read.signal!);
    state.auth.user = { id: "admin-b" };
    view.rerender(view.node());
    expect(await screen.findByText("Carrier admin-b")).toBeInTheDocument();
    expect(oldSignals).toHaveLength(8);
    expect(oldSignals.every(signal => signal.aborted)).toBe(true);
    await act(async () => finish());
    expect(screen.queryByText("Carrier admin-a")).not.toBeInTheDocument();
    expect(view.client.getQueryData(["business-analytics-summary", "admin-a"])).toBeUndefined();
    expect(view.client.getQueryData(["business-analytics-summary", "admin-b"])).toMatchObject({ total_premium_mtd: "8765" });
  });

  it("keeps the existing unavailable-summary state instead of rendering zero production", async () => {
    failedSource = "v_business_analytics_summary";
    mount();
    expect(await screen.findByText("Business Analytics failed to load")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText("Production · MTD premium")).not.toBeInTheDocument();
  });
});
