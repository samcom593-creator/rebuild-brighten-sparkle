import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";

const state = vi.hoisted(() => ({ auth: { user: { id: "agent-user" }, isAdmin: false, isLoading: false }, preview: false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => state.auth }));
vi.mock("@/hooks/useRolePreview", () => ({ useRolePreview: () => ({ isPreviewing: state.preview }) }));
vi.mock("@/pages/MyCommissions", () => ({ default: ({ embedded }: { embedded?: boolean }) => <div>Personal ledger {embedded ? "embedded" : "standalone"}</div> }));
vi.mock("@/components/finances/PersonalPolicyBook", () => ({ PersonalPolicyBook: () => <div>Personal carrier policy book</div> }));
vi.mock("@/components/dashboard/ImoByAgency", () => ({ ImoByAgency: () => <div>Admin agency breakdown</div> }));
vi.mock("@/components/deals/SubmitDealDialog", () => ({ SubmitDealDialog: () => <button>Post a Deal</button> }));
import Finances from "@/pages/Finances";

const overview = () => ({
  scope: "agency", as_of: "2026-11-25T00:00:00Z", comp_note: "Synthetic estimates.",
  kpis: { today: 30, forecast_90d: 100, mtd: 60, ytd: 200 }, team_kpis: { today: 50, mtd: 100, ytd: 300 },
  production: { policies: 2, alp: 2400, producers: 1, last_synced_at: null },
  commission_types: { direct_ytd: 100, override_pending: 20, trail_pending: 0, renewal_pending: 0 },
  forecast: [], payouts: { month: "2026-11", total: 0, rows: [] },
  breakdown: { by_carrier: [], by_product: [], by_month: [], by_agent_overrides: [] },
});

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const node = () => <QueryClientProvider client={client}><MemoryRouter><Finances /></MemoryRouter></QueryClientProvider>;
  return { client, ...render(node()), node };
}
function selectTab(name: string) {
  fireEvent.mouseDown(screen.getByRole("tab", { name }), { button: 0, ctrlKey: false });
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  state.auth = { user: { id: "agent-user" }, isAdmin: false, isLoading: false };
  state.preview = false;
  vi.mocked(supabase.rpc).mockReset();
  vi.mocked(supabase.from).mockClear();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("unified Finances permissions", () => {
  it("renders one header and personal sections without mounting any management query for an agent", () => {
    mount();
    expect(screen.getAllByRole("heading", { level: 1, name: "Finances" })).toHaveLength(1);
    expect(screen.getByText("Personal ledger embedded")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Management" })).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Issue & pay" })).toHaveAttribute("data-state", "active");
    selectTab("Policy book");
    expect(screen.getByText("Personal carrier policy book")).toBeInTheDocument();
    expect(screen.queryByText("Personal ledger embedded")).not.toBeInTheDocument();
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it.each([{ preview: true, loading: false }, { preview: false, loading: true }])("fails closed for admin preview/loading %j", flags => {
    state.auth.isAdmin = true;
    state.auth.isLoading = flags.loading;
    state.preview = flags.preview;
    mount();
    expect(screen.queryByRole("tab", { name: "Management" })).not.toBeInTheDocument();
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("mounts agency management only when selected by an actual admin, with viewer-scoped cache", async () => {
    state.auth = { user: { id: "admin-user" }, isAdmin: true, isLoading: false };
    vi.mocked(supabase.rpc).mockResolvedValue({ data: overview(), error: null } as never);
    const view = mount();
    expect(supabase.rpc).not.toHaveBeenCalled();
    selectTab("Management");
    expect(await screen.findByText("Estimated commission · today")).toBeInTheDocument();
    expect(screen.getByText("Admin agency breakdown")).toBeInTheDocument();
    expect(supabase.rpc).toHaveBeenCalledWith("finances_overview", expect.objectContaining({ p_scope: "agency" }));
    expect(view.client.getQueryCache().findAll({ queryKey: ["finances-overview", "admin-user"] })).toHaveLength(1);
    state.auth = { user: { id: "next-agent-user" }, isAdmin: false, isLoading: false };
    view.rerender(view.node());
    expect(screen.queryByText("Admin agency breakdown")).not.toBeInTheDocument();
    expect(screen.queryByText("Estimated commission · today")).not.toBeInTheDocument();
    expect(screen.getByText("Personal ledger embedded")).toBeInTheDocument();
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
  });

  it("reports malformed management financial payload as unavailable rather than fake zeros", async () => {
    state.auth.isAdmin = true;
    vi.mocked(supabase.rpc).mockResolvedValue({ data: { ...overview(), production: null }, error: null } as never);
    mount();
    selectTab("Management");
    expect(await screen.findByText("Finance truth could not load")).toBeInTheDocument();
    expect(screen.queryByText("Estimated commission · today")).not.toBeInTheDocument();
  });

  it("renders the SQL-supported Vantage gap component in default agency management", async () => {
    state.auth.isAdmin = true;
    vi.mocked(supabase.rpc).mockResolvedValue({ data: {
      ...overview(),
      payouts: { month: "2026-11", total: 120, rows: [
        { date: "2026-11-25", agent: "Vantage agency", client: null, carrier: null, product: null, ap: 1000, est: 120, component: "gap" },
      ] },
    }, error: null } as never);
    mount();
    selectTab("Management");
    expect(await screen.findByText("Estimated commission · today")).toBeInTheDocument();
    expect(supabase.rpc).toHaveBeenCalledWith("finances_overview", expect.objectContaining({ p_scope: "agency" }));
    expect(screen.getByText("Vantage agency")).toBeInTheDocument();
    expect(screen.getByText("gap")).toBeInTheDocument();
    expect(screen.queryByText("Finance truth could not load")).not.toBeInTheDocument();
  });

  it("rejects a payout component outside the finance SQL contract", async () => {
    state.auth.isAdmin = true;
    vi.mocked(supabase.rpc).mockResolvedValue({ data: {
      ...overview(),
      payouts: { month: "2026-11", total: 120, rows: [
        { date: "2026-11-25", agent: "Unexpected component", client: null, carrier: null, product: null, ap: 1000, est: 120, component: "unrecognized" },
      ] },
    }, error: null } as never);
    mount();
    selectTab("Management");
    expect(await screen.findByText("Finance truth could not load")).toBeInTheDocument();
    expect(screen.queryByText("Estimated commission · today")).not.toBeInTheDocument();
    expect(screen.queryByText("Unexpected component")).not.toBeInTheDocument();
  });

  it("does not label failed CFO reads as a clean ledger or no anomalies", async () => {
    state.auth.isAdmin = true;
    vi.mocked(supabase.rpc).mockResolvedValue({ data: overview(), error: null } as never);
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "maybeSingle", "order", "limit", "eq"]) chain[method] = () => chain;
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: { message: "Synthetic secured-source failure" } }).then(resolve);
    vi.mocked(supabase.from).mockImplementation(() => chain as never);
    mount();
    selectTab("Management");
    await screen.findByText("Estimated commission · today");
    selectTab("Reconciliation");
    expect(await screen.findByRole("alert")).toHaveTextContent(/finance reconciliation/i);
    expect(screen.queryByText(/no duplicate-charge anomalies/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/ledger is empty/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    await waitFor(() => expect(supabase.from).toHaveBeenCalledWith("cfo_approval_requests"));
  });

  it("accepts explicit null JSON aggregates on present authorized CFO rows as no matches", async () => {
    state.auth.isAdmin = true;
    vi.mocked(supabase.rpc).mockResolvedValue({ data: overview(), error: null } as never);
    const data: Record<string, unknown> = {
      v_cfo_snapshot: { ghost_ap_at_risk: 0, ica_paid_stuck: 0, lapsed_walked_commission: 0, dup_charges_open: 0,
        idle_active_agents: 0, insuracloud_sync: "current", agentlink_sync: "current", mentorship_revenue_usd: 0,
        mentorship_paid_total: 0, as_of: "2026-11-25T00:00:00Z" },
      v_cfo_dup_charge_watch: { anomalies: null }, v_cfo_ica_paid_stuck: { stuck_list: null },
      v_cfo_agent_activation_watch: { idle_agents: null }, commission_ledger: [], cfo_approval_requests: [],
    };
    vi.mocked(supabase.from).mockImplementation((table: string) => {
      const chain: Record<string, unknown> = {};
      for (const method of ["select", "maybeSingle", "order", "limit", "eq"]) chain[method] = () => chain;
      chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: data[table], error: null }).then(resolve);
      return chain as never;
    });
    mount();
    selectTab("Management");
    await screen.findByText("Estimated commission · today");
    selectTab("Reconciliation");
    expect(await screen.findByText("Clean — no duplicate-charge anomalies flagged.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
