import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";
import type { UseAgentIdentityResult } from "@/hooks/useAgentIdentity";

const state = vi.hoisted(() => ({ auth: { user: { id: "user-own" }, isAdmin: false, isLoading: false }, identity: null as unknown }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => state.auth }));
vi.mock("@/hooks/useAgentIdentity", () => ({ useAgentIdentity: () => state.identity }));
vi.mock("@/hooks/useBusinessToday", () => ({ useBusinessToday: () => "2026-11-25" }));
import MyCommissions from "@/pages/MyCommissions";

type Result = { data: unknown[] | null; error: unknown };
const results = new Map<string, Result>();
const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
const resolved = (user = "user-own", agent = "agent-own"): UseAgentIdentityResult => ({
  userId: user, agentId: agent, isLoading: false, isError: false, refetch: vi.fn(),
  identity: { status: "resolved", agentId: agent, row: { id: agent, user_id: user, display_name: "Synthetic Agent", agent_code: null, status: "active", is_inactive: false, is_deactivated: false, created_at: "2026-01-01", canonical_agent_id: null } },
});
const ledgerRow = (id: string, status: string, amount: number, paid: string | null) => ({
  id: `ledger-${id}`, deal_id: `deal-${id}`, annual_premium: 1200, rate_pct: 50, rate_source: "contract", amount, status,
  expected_paid_date: "2026-11-20", actual_paid_date: paid, created_at: "2026-11-10T20:00:00Z",
  deal: { source: "native", external_deal_id: null, status: "posted", client_first_name: "Synthetic", client_last_name: id,
    product_sold: "Whole life", policy_number: `POL-${id.toUpperCase()}`, carrier: { name: "Synthetic Carrier" } },
});

function chainFor(table: string) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "in", "or", "order", "range"]) chain[method] = (...args: unknown[]) => { calls.push({ table, method, args }); return chain; };
  chain.then = (resolve: (value: Result) => unknown) => Promise.resolve(results.get(table) ?? { data: null, error: { message: "Unstubbed source" } }).then(resolve);
  return chain;
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const node = () => <QueryClientProvider client={client}><MemoryRouter><MyCommissions embedded /></MemoryRouter></QueryClientProvider>;
  return { client, ...render(node()), node };
}

beforeEach(() => {
  results.clear(); calls.length = 0;
  state.auth = { user: { id: "user-own" }, isAdmin: false, isLoading: false };
  state.identity = resolved();
  results.set("commission_ledger", { data: [ledgerRow("paid", "paid", 200, "2026-11-21"), ledgerRow("pending", "pending", 50, null), ledgerRow("undated", "paid", 100, null), ledgerRow("future", "paid", 100, "2026-12-01")], error: null });
  results.set("v_production_comp_truth", { data: [{ row_key: "deal-paid", policy_number: "POL-PAID", annual_premium: 1200, direct_estimate: 600, seller_comp_pct: 50, status: "posted", posted_date: "2026-11-10", client_name: "Synthetic paid", product: "Whole life", carrier: "Synthetic Carrier" }], error: null });
  vi.mocked(supabase.from).mockReset();
  vi.mocked(supabase.from).mockImplementation((table: string) => chainFor(table) as never);
  vi.mocked(supabase.rpc).mockReset();
  vi.mocked(supabase.rpc).mockImplementation((name: string) => Promise.resolve({ data: name === "fn_agent_contract_pct" ? [{ pct: 50, provenance: "contract" }] : { commission_types: { direct_ytd: 600, override_pending: 0, trail_pending: 0, renewal_pending: 0 } }, error: null }) as never);
});

describe("personal finance ledger", () => {
  it("shows policy/product, recorded status and actual payment date separately from the estimate", async () => {
    mount();
    const row = (await screen.findByText("POL-PAID")).closest("tr")!;
    const cells = within(row).getAllByRole("cell");
    expect(cells).toHaveLength(7);
    expect(cells[0]).toHaveTextContent("Whole life");
    expect(cells[1]).toHaveTextContent("posted");
    expect(cells[3]).toHaveTextContent("$200.00Recorded commission");
    expect(cells[3]).toHaveTextContent("$600.00Contract estimate · not paid");
    expect(cells[4]).toHaveTextContent("50% contract rate");
    expect(cells[4]).toHaveTextContent("50% comp level");
    expect(cells[5]).toHaveTextContent("Paid · recorded");
    expect(cells[6]).toHaveTextContent("2026-11-21");
    expect(screen.queryByRole("heading", { level: 1 })).not.toBeInTheDocument();
    expect(calls).toContainEqual({ table: "commission_ledger", method: "in", args: ["agent_id", ["agent-own"]] });
    expect(calls).toContainEqual({ table: "v_production_comp_truth", method: "or", args: ["agent_id.eq.agent-own,raw_agent_id.eq.agent-own"] });
  });

  it("counts only dated payments through today in paid YTD; pending, undated and future payments remain distinct", async () => {
    mount();
    await screen.findByText("POL-PAID");
    expect(screen.getByText("Commission paid · 2026").parentElement).toHaveTextContent("$200.00");
    expect(screen.getByText("Open commission ledger").parentElement).toHaveTextContent("$50.00");
    expect(within(screen.getByText("POL-PENDING").closest("tr")!).getAllByRole("cell")[6]).toHaveTextContent("No confirmed payment");
    expect(within(screen.getByText("POL-UNDATED").closest("tr")!).getByText("Marked paid; payment date missing or invalid")).toBeInTheDocument();
    expect(within(screen.getByText("POL-FUTURE").closest("tr")!).getByText("Future-dated; not counted as paid")).toBeInTheDocument();
  });

  it("does not present an estimate-only book or zero paid total when the ledger read fails", async () => {
    results.set("commission_ledger", { data: null, error: { message: "Synthetic ledger unavailable" } });
    mount();
    expect((await screen.findAllByRole("alert"))[0]).toHaveTextContent("Synthetic ledger unavailable");
    expect(screen.queryByText("POL-PAID")).not.toBeInTheDocument();
    expect(screen.queryByText("Commission paid · 2026")).not.toBeInTheDocument();
    expect(screen.queryByText("No commission rows yet")).not.toBeInTheDocument();
  });

  it("isolates cached facts by authenticated account, including a stale identity during switching", async () => {
    const view = mount();
    await screen.findByText("POL-PAID");
    expect(view.client.getQueryData(["my-commission-ledger", "user-own", "agent-own"])).toHaveLength(4);
    const readCount = vi.mocked(supabase.from).mock.calls.length;
    state.auth.user = { id: "user-next" };
    view.rerender(view.node());
    expect(screen.queryByText("POL-PAID")).not.toBeInTheDocument();
    expect(supabase.from).toHaveBeenCalledTimes(readCount);
  });

  it("retains the merge-visibility warning instead of claiming another login's restricted ledger is complete", async () => {
    const merged = resolved();
    if (merged.identity?.status === "resolved") {
      merged.identity.row.user_id = "different-login";
      merged.identity.mergedFromAgentId = "agent-merged-away";
    }
    state.identity = merged;
    mount();
    await screen.findByText("POL-PAID");
    expect(screen.getByText("Commission paid · 2026").parentElement).toHaveTextContent("Unavailable");
    expect(screen.getByText(/That record's commission ledger is visible only to its own login/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Recorded payment trend" })).not.toBeInTheDocument();
  });

  it("filters dated paid cash separately from missing and future dates without changing headline totals", async () => {
    mount();
    await screen.findByText("POL-PAID");
    fireEvent.change(screen.getByRole("combobox", { name: "Commission payment status" }), { target: { value: "paid" } });
    expect(screen.getByText("POL-PAID")).toBeInTheDocument();
    expect(screen.queryByText("POL-UNDATED")).not.toBeInTheDocument();
    expect(screen.queryByText("POL-FUTURE")).not.toBeInTheDocument();
    expect(screen.getByText("1 of 4 records")).toBeInTheDocument();
    expect(screen.getByText("Open commission ledger").parentElement).toHaveTextContent("$50.00");
    fireEvent.change(screen.getByRole("combobox", { name: "Commission payment status" }), { target: { value: "unverified" } });
    expect(screen.queryByText("POL-PAID")).not.toBeInTheDocument();
    expect(screen.getByText("POL-UNDATED")).toBeInTheDocument();
    expect(screen.getByText("POL-FUTURE")).toBeInTheDocument();
    fireEvent.change(screen.getByRole("textbox", { name: "Search policy commissions" }), { target: { value: "POL-FUTURE" } });
    expect(screen.queryByText("POL-UNDATED")).not.toBeInTheDocument();
    expect(screen.getByText("POL-FUTURE")).toBeInTheDocument();
  });

  it("does not turn paid commission or source-issued status into verified issued-and-paid premium", async () => {
    const paid = ledgerRow("paid", "paid", 200, "2026-11-21");
    paid.deal.status = "issued";
    results.set("commission_ledger", { data: [paid], error: null });
    mount();
    await screen.findByText("POL-PAID");
    expect(screen.queryByText("Issued & paid AP")).not.toBeInTheDocument();
    expect(screen.getByText("Commission paid · 2026").parentElement).toHaveTextContent("$200.00");
    expect(screen.getByText("Commission paid · 2026").parentElement).not.toHaveTextContent("$1,200");
    expect(within(screen.getByText("POL-PAID").closest("tr")!).getByText("issued")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Nov: \$200.00 from 1 payment/ })).toBeInTheDocument();
  });

  it("shows missing payment evidence instead of three authoritative zero balances", async () => {
    results.set("commission_ledger", { data: [], error: null });
    mount();
    await screen.findByText("POL-PAID");
    expect(screen.getByText("Commission paid · 2026").parentElement).toHaveTextContent("Not recorded");
    expect(screen.getByText("Open commission ledger").parentElement).toHaveTextContent("No open records");
    expect(screen.getByText("Ledger clawbacks").parentElement).toHaveTextContent("Not recorded");
    expect(screen.getByRole("region", { name: "Posted production commission estimate" })).toHaveTextContent("$600.00");
    expect(screen.getByRole("region", { name: "Commission payment totals" })).not.toHaveTextContent("$0.00");
  });

  it("marks a partial estimate as incomplete and exposes excluded records beside the known subtotal", async () => {
    const priced = results.get("v_production_comp_truth")!.data![0] as Record<string, unknown>;
    results.set("v_production_comp_truth", { data: [priced, { ...priced, row_key: "unpriced-deal", policy_number: "POL-UNPRICED", direct_estimate: null }, { ...priced, row_key: null }], error: null });
    mount();
    await screen.findByText("POL-PAID");
    const estimate = screen.getByRole("region", { name: "Posted production commission estimate" });
    expect(estimate).toHaveTextContent("Incomplete");
    expect(estimate).toHaveTextContent("Known subtotal $600.00 · 1 priced record");
    expect(estimate).toHaveTextContent("1 estimate that could not be priced");
    expect(estimate).toHaveTextContent("1 production row without a record key");
    expect(estimate).toHaveTextContent("3 production records");
  });

  it("does not promote an all-unpriced production cohort to a zero estimate", async () => {
    const unpriced = results.get("v_production_comp_truth")!.data![0] as Record<string, unknown>;
    results.set("v_production_comp_truth", { data: [{ ...unpriced, direct_estimate: null }], error: null });
    mount();
    await screen.findByText("POL-PAID");
    const estimate = screen.getByRole("region", { name: "Posted production commission estimate" });
    expect(estimate).toHaveTextContent("Unavailable");
    expect(estimate).toHaveTextContent("1 estimate that could not be priced");
    expect(estimate).not.toHaveTextContent("$0.00");
  });
});
