import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";

const state = vi.hoisted(() => ({ auth: { user: { id: "agent-user" }, isAdmin: false, isManager: false, isLoading: false } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => state.auth }));
import { CommissionsDashboard } from "@/components/finances/CommissionsDashboard";

const lanesZero = Object.fromEntries(["in_force", "pending", "awaiting_feed", "not_in_feed", "lost", "no_feed"].map((l) => [l, { n: 0, ap: 0, est: null }]));

function payload(over: Record<string, unknown> = {}) {
  return {
    ok: true, as_of: "2026-11-27T19:00:00Z", today: "2026-11-27",
    agent: { agent_id: "a1", name: "Pat Example", npn: "12345678", rate_pct: 85, rate_provenance: "admin_ui", rate_on_file: true, record_ids: ["a1"] },
    kpis: {
      mtd_est: 1200.5, mtd_deals: 2, mtd_ap: 1500, last_month_est: 800, last_month_deals: 1, ytd_est: 9000, ytd_deals: 12, ytd_ap: 11000,
      deals_12m: 13, ap_12m: 11500, est_12m: 9500,
      lanes: { ...lanesZero, in_force: { n: 1, ap: 500, est: 425 }, awaiting_feed: { n: 1, ap: 1000, est: 850 } },
    },
    months: [{ month: "2026-10", deals: 1, ap: 500, est: 425, est_in_force: 425, est_pending: null, est_lost: null, est_unknown: null },
             { month: "2026-11", deals: 1, ap: 1000, est: 850, est_in_force: null, est_pending: 850, est_lost: null, est_unknown: null }],
    deals: [
      { row_key: "d1", posted_date: "2026-11-25", client_name: "Client One", carrier: "Ethos", product: "Life", policy_number: "P1", annual_premium: 1000, est: 850, deal_status: "submitted", origin: "apex_native", lane: "awaiting_feed", book_carrier: null, status_bucket: null, status_raw: null, status_changed_on: null, issued_on: null, lost_on: null, close_reason: null },
      { row_key: "d2", posted_date: "2026-10-03", client_name: "Client Two", carrier: "Chubb", product: "Accident", policy_number: "P2", annual_premium: 500, est: 425, deal_status: "active", origin: "agentlink", lane: "in_force", book_carrier: "Chubb", status_bucket: "active", status_raw: "Active", status_changed_on: "2026-10-10", issued_on: "2026-10-09", lost_on: null, close_reason: null },
    ],
    chargebacks: [], chargeback_open_total: 0, ethos: null,
    book: { last_run_at: "2026-11-24T00:17:29Z", last_read_on: "2026-11-23", carriers: ["Chubb", "Ethos"] },
    sources: { commission_ledger_rows: 3, paid_feed: false },
    ...over,
  };
}

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><CommissionsDashboard embedded /></QueryClientProvider>);
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  state.auth = { user: { id: "agent-user" }, isAdmin: false, isManager: false, isLoading: false };
  vi.mocked(supabase.rpc).mockReset();
  vi.mocked(supabase.from).mockClear();
});
afterEach(() => { vi.unstubAllGlobals(); });

describe("CommissionsDashboard", () => {
  it("prices the tiles at the contract rate, shows every deal with the carrier's verdict, and never reads the agents table for a plain agent", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: payload(), error: null } as never);
    mount();
    expect(await screen.findByText("Pat Example's commissions")).toBeInTheDocument();
    expect(supabase.rpc).toHaveBeenCalledWith("commissions_dashboard", { p_agent_id: null });
    expect(supabase.from).not.toHaveBeenCalled();
    expect(screen.getByText("Contract rate 85% (admin ui). Estimates are annual premium times this rate, before carrier payment, adjustments or chargebacks.")).toBeInTheDocument();
    expect(screen.getByText("$1,201")).toBeInTheDocument(); // this month
    expect(screen.getByText("$9,000")).toBeInTheDocument(); // year to date
    expect(screen.getByText("$9,500")).toBeInTheDocument(); // last 12 months
    expect(screen.getByText("13 deals · $11,500 premium")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Awaiting carrier feed/ })).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "Estimated" })).toBeInTheDocument();
    const rows = screen.getAllByRole("row");
    expect(rows).toHaveLength(3);
    expect(screen.getByText("Client One")).toBeInTheDocument();
    expect(screen.getByText("Policy statuses come from Chubb and Ethos, last read 4 days ago. That is stale; statuses may have moved since.")).toBeInTheDocument();
    expect(screen.getByText(/nothing here is money received/)).toBeInTheDocument();
    expect(screen.getByText(/3 rows for this record/)).toBeInTheDocument();
  });

  it("filters the deals by lane when a lane chip is pressed, and clears", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: payload(), error: null } as never);
    mount();
    await screen.findByText("Client One");
    fireEvent.click(screen.getByRole("button", { name: /^In force/ }));
    expect(screen.queryByText("Client One")).not.toBeInTheDocument();
    expect(screen.getByText("Client Two")).toBeInTheDocument();
    expect(screen.getByText(/1 of 2 · \$500 premium · \$425 estimated/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.getByText("Client One")).toBeInTheDocument();
  });

  it("hides every estimate and says why when the contract rate is not on file", async () => {
    const p = payload();
    p.agent = { ...p.agent, rate_pct: null, rate_provenance: "unknown", rate_on_file: false };
    p.kpis = { ...p.kpis, mtd_est: null, last_month_est: null, ytd_est: null, est_12m: null };
    vi.mocked(supabase.rpc).mockResolvedValue({ data: p, error: null } as never);
    mount();
    await screen.findByText("Pat Example's commissions");
    expect(screen.getAllByText("Rate not on file")).toHaveLength(4);
    expect(screen.getByText(/Contract rate not on file/)).toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Estimated" })).not.toBeInTheDocument();
    expect(screen.queryByText("$850")).not.toBeInTheDocument();
    expect(screen.getByText("Annual premium posted by month")).toBeInTheDocument();
  });

  it("reports a failed read as unavailable with Retry, never as an empty book", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: { message: "Synthetic failure" } } as never);
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(/Commissions could not load/);
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
    expect(screen.queryByText(/No deals posted/)).not.toBeInTheDocument();
  });

  it("refuses a payload it does not understand instead of rendering zeros", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: { ok: true, agent: {} }, error: null } as never);
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(/incomplete result/);
  });

  it("shows the no-record state when the server says this login has no agent record", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: { ok: false, reason: "no_agent_record", as_of: "x" }, error: null } as never);
    mount();
    expect(await screen.findByText("No agent record is linked to this login")).toBeInTheDocument();
  });

  it("lets an admin pick another agent and asks the server for that agent", async () => {
    state.auth = { user: { id: "admin-user" }, isAdmin: true, isManager: false, isLoading: false };
    vi.mocked(supabase.rpc).mockResolvedValue({ data: payload(), error: null } as never);
    const chain: Record<string, unknown> = {};
    for (const method of ["select", "neq", "order", "limit"]) chain[method] = () => chain;
    chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [{ id: "a1", display_name: "Pat Example" }, { id: "a2", display_name: "Sam Other" }], error: null }).then(resolve);
    vi.mocked(supabase.from).mockImplementation(() => chain as never);
    mount();
    const picker = await screen.findByLabelText("Viewing");
    expect(within(picker).getAllByRole("option")).toHaveLength(3);
    fireEvent.change(picker, { target: { value: "a2" } });
    await waitFor(() => expect(supabase.rpc).toHaveBeenCalledWith("commissions_dashboard", { p_agent_id: "a2" }));
  });
});
