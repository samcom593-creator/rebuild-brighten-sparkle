import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";
import type { UseAgentIdentityResult } from "@/hooks/useAgentIdentity";
import { parseFinancePolicyBook } from "@/lib/financePolicyBook";

const state = vi.hoisted(() => ({ auth: { user: { id: "user-own" }, isLoading: false }, identity: null as unknown }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => state.auth }));
vi.mock("@/hooks/useAgentIdentity", () => ({ useAgentIdentity: () => state.identity }));
vi.mock("@/components/dashboard/CarrierPolicyCohortCard", () => ({ CarrierPolicyCohortCard: ({ agentId }: { agentId: string }) => <div>Application cohort for {agentId}</div> }));
import { PersonalPolicyBook, PolicyBookView, PolicyFinancialEvidence } from "@/components/finances/PersonalPolicyBook";

const policy = (overrides: Record<string, unknown> = {}) => ({
  key: "Combined:synthetic-1", carrier: "Combined", underwriter: null, policy_number: "SYNTHETIC-1",
  client: "Synthetic Policyholder", product: "Whole life", bucket: "pending", status_raw: "issued",
  close_reason: null, annual_premium: 1200, face_amount: 25000, sold_on: "2026-11-01",
  effective_on: "2026-11-05", changed_on: null, chargeback: null, ...overrides,
});
const payload = (agent = "agent-own", rows = [policy()]) => ({ agent_id: agent, as_of: "2026-11-25T00:00:00Z", policies: rows });
const resolved = (user = "user-own", agent = "agent-own"): UseAgentIdentityResult => ({
  userId: user, agentId: agent, isLoading: false, isError: false, refetch: vi.fn(),
  identity: { status: "resolved", agentId: agent, row: { id: agent, user_id: user, display_name: "Synthetic Agent", agent_code: null, status: "active", is_inactive: false, is_deactivated: false, created_at: "2026-01-01", canonical_agent_id: null } },
});

function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const node = () => <QueryClientProvider client={client}><PersonalPolicyBook /></QueryClientProvider>;
  return { client, ...render(node()), refresh: node };
}

beforeEach(() => {
  state.auth = { user: { id: "user-own" }, isLoading: false };
  state.identity = resolved();
  vi.mocked(supabase.rpc).mockReset();
});

describe("personal financial policy book", () => {
  it("displays carrier compensation chargebacks even when the commission ledger has no corresponding entries", () => {
    const book = parseFinancePolicyBook({ ...payload(), summary: { chargebacks: 2, chargeback_amount: 450.5, debt_outstanding: 120 } }, "agent-own");
    render(<PolicyFinancialEvidence book={book} />);
    expect(screen.getByText("Carrier-recorded chargebacks").parentElement).toHaveTextContent("$450.50");
    expect(screen.getByText("Outstanding carrier debt").parentElement).toHaveTextContent("$120.00");
  });

  it("filters all returned carriers and restores the complete book after no matches", () => {
    const book = parseFinancePolicyBook(payload("agent-own", [policy(), policy({ key: "Ethos:other", carrier: "Ethos", policy_number: "ETHOS-2", status_raw: "DECLINED", bucket: "pending" })]), "agent-own");
    render(<PolicyBookView book={book} />);
    fireEvent.change(screen.getByRole("combobox", { name: "Policy carrier" }), { target: { value: "Ethos" } });
    expect(screen.getByText("ETHOS-2")).toBeInTheDocument();
    expect(screen.queryByText("SYNTHETIC-1")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search your policies"), { target: { value: "missing-policy" } });
    expect(screen.getByText("No policies match these filters.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show all policies" }));
    expect(screen.getByText("2 of 2 policies")).toBeInTheDocument();
    expect(screen.getByText("SYNTHETIC-1")).toBeInTheDocument();
  });
  it("shows reported issue and premium-paying facts without inventing issued-paid totals or placement", () => {
    const book = parseFinancePolicyBook({
      ...payload("agent-own", [
        policy({ key: "paying", carrier: "Ethos", bucket: "active", status_raw: "PREMIUM_PAYING", annual_premium: 1200 }),
        policy({ key: "generic", carrier: "Combined", bucket: "active", status_raw: "In force", annual_premium: 9000 }),
      ]),
      ethos_portal: { issued_ap: 90000, inforce_ap: 70000 },
    }, "agent-own");
    render(<PolicyFinancialEvidence book={book} />);
    expect(screen.getByText("Paid / premium-paying AP · carrier status").parentElement).toHaveTextContent("$1,200.00");
    expect(screen.getByText("Ethos issued AP · portal").parentElement).toHaveTextContent("$90,000.00");
    expect(screen.getByText("Ethos in-force AP · portal").parentElement).toHaveTextContent("$70,000.00");
    expect(screen.getByText("1 policy · Ethos.")).toBeInTheDocument();
    expect(screen.getByText(/1 other policy has no confirmed paid status/)).toBeInTheDocument();
    expect(screen.getByText(/Portal totals belong to the matched carrier NPN/)).toBeInTheDocument();
    expect(screen.queryByText("Issued & paid AP")).not.toBeInTheDocument();
    expect(screen.queryByText("Placement rate")).not.toBeInTheDocument();
    expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument();
  });

  it("marks incomplete premium-paying AP visibly and distinguishes absent portal totals from zero", () => {
    const book = parseFinancePolicyBook(payload("agent-own", [
      policy({ carrier: "Ethos", bucket: "active", status_raw: "PREMIUM_PAYING", annual_premium: null }),
    ]), "agent-own");
    render(<PolicyFinancialEvidence book={book} />);
    expect(screen.getByText("Paid / premium-paying AP · carrier status").parentElement).toHaveTextContent("Incomplete");
    expect(screen.getByText(/1 missing premium/)).toBeInTheDocument();
    expect(screen.queryByText("Ethos issued AP · portal")).not.toBeInTheDocument();
  });

  it("keeps the coverage graph based on policy counts when the table is filtered", () => {
    const book = parseFinancePolicyBook(payload("agent-own", [
      policy({ key: "pending-1", annual_premium: 100 }),
      policy({ key: "pending-2", annual_premium: null }),
      policy({ key: "active-1", policy_number: "ACTIVE-1", bucket: "active", status_raw: "In force", annual_premium: 50000 }),
    ]), "agent-own");
    render(<PolicyBookView book={book} />);
    expect(screen.getByRole("img", { name: "Pending: 2, In force: 1. Annual premium: Pending: $100.00 partial, In force: $50,000.00." })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Coverage" }), { target: { value: "active" } });
    expect(screen.getByText("1 of 3 policies")).toBeInTheDocument();
    expect(screen.getByText("ACTIVE-1")).toBeInTheDocument();
    expect(screen.getByRole("img", { name: "Pending: 2, In force: 1. Annual premium: Pending: $100.00 partial, In force: $50,000.00." })).toBeInTheDocument();
  });

  it("does not draw a percentage graph for an empty policy book", () => {
    render(<PolicyBookView book={parseFinancePolicyBook(payload("agent-own", []), "agent-own")} />);
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.getByText("0 of 0 policies")).toBeInTheDocument();
  });

  it("shows raw carrier and coverage facts without inventing payment or chargeback from status", () => {
    const book = parseFinancePolicyBook(payload("agent-own", [policy(), policy({ key: "Ethos:synthetic-2", policy_number: "SYNTHETIC-2", bucket: "lapsed", status_raw: "lapsed", annual_premium: null })]), "agent-own");
    render(<PolicyBookView book={book} />);
    const row = screen.getByText("SYNTHETIC-1").closest("tr")!;
    expect(within(row).getByText("issued")).toBeInTheDocument();
    expect(within(row).getByText("Pending")).toBeInTheDocument();
    expect(within(row).getByText("Whole life")).toBeInTheDocument();
    expect(within(row).getByText("2026-11-05")).toBeInTheDocument();
    expect(screen.getByText("1 missing premium · partial total")).toBeInTheDocument();
    expect(screen.queryByText("Lapsed · charged back")).not.toBeInTheDocument();
    expect(screen.queryByRole("columnheader", { name: "Issue date" })).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search your policies"), { target: { value: "SYNTHETIC-2" } });
    expect(screen.queryByText("SYNTHETIC-1")).not.toBeInTheDocument();
    expect(screen.getByText("1 of 2 policies")).toBeInTheDocument();
  });

  it("filters the reported issued status without marking the policy or commission as paid", () => {
    const onViewPayments = vi.fn();
    const book = parseFinancePolicyBook(payload("agent-own", [
      policy(), policy({ key: "Ethos:active", policy_number: "ACTIVE-1", status_raw: "In force", bucket: "active" }),
    ]), "agent-own");
    render(<PolicyBookView book={book} onViewPayments={onViewPayments} />);
    fireEvent.click(screen.getByText("More filters"));
    fireEvent.change(screen.getByRole("combobox", { name: "Carrier issue status" }), { target: { value: "issued" } });
    expect(screen.getByText("SYNTHETIC-1")).toBeInTheDocument();
    expect(screen.queryByText("ACTIVE-1")).not.toBeInTheDocument();
    const row = screen.getByText("SYNTHETIC-1").closest("tr")!;
    expect(within(row).getByText("issued")).toBeInTheDocument();
    expect(within(row).getByText("Pending")).toBeInTheDocument();
    expect(within(row).queryByText(/paid/i)).not.toBeInTheDocument();
    expect(screen.getByText(/The source has no commission-payment receipts or issue dates/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "View commission payments" }));
    expect(onViewPayments).toHaveBeenCalledTimes(1);
  });

  it("filters a pre-issue status when the carrier has no later raw status", () => {
    const book = parseFinancePolicyBook(payload("agent-own", [
      policy(), policy({ key: "Ethos:review", policy_number: "REVIEW-1", carrier: "Ethos", status_raw: null, status_pre: "IN_REVIEW", bucket: "pending" }),
    ]), "agent-own");
    render(<PolicyBookView book={book} />);
    fireEvent.click(screen.getByText("More filters"));
    expect(screen.getByRole("option", { name: "IN_REVIEW" })).toBeInTheDocument();
    fireEvent.change(screen.getByRole("combobox", { name: "Carrier issue status" }), { target: { value: "IN_REVIEW" } });
    expect(screen.getByText("REVIEW-1")).toBeInTheDocument();
    expect(screen.queryByText("SYNTHETIC-1")).not.toBeInTheDocument();
    expect(screen.getByText("1 of 2 policies")).toBeInTheDocument();
  });

  it("requests only the linked identity and isolates the query cache by login", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: payload(), error: null } as never);
    const { client } = mount();
    expect(await screen.findByText("SYNTHETIC-1")).toBeInTheDocument();
    expect(supabase.rpc).toHaveBeenCalledExactlyOnceWith("agent_carrier_book", { p_agent_id: "agent-own" });
    expect(client.getQueryData(["finance-policy-book", "user-own", "agent-own"])).toMatchObject({ agentId: "agent-own" });
  });

  it("keeps returned portal issue totals visible when there are no detailed carrier policy rows", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: { ...payload("agent-own", []), ethos_portal: { issued_ap: 90000, inforce_ap: null } }, error: null } as never);
    mount();
    expect(await screen.findByText("Ethos issued AP · portal")).toBeInTheDocument();
    expect(screen.getByText("Ethos issued AP · portal").parentElement).toHaveTextContent("$90,000.00");
    expect(screen.queryByText("No carrier policies on file")).not.toBeInTheDocument();
    expect(screen.getByText("0 of 0 policies")).toBeInTheDocument();
  });

  it("rejects a wrong-agent response and retries without reporting an empty book", async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: payload("other-agent"), error: null } as never).mockResolvedValueOnce({ data: payload(), error: null } as never);
    mount();
    expect(await screen.findByRole("alert")).toHaveTextContent("could not load");
    expect(screen.queryByText("No carrier policies on file")).not.toBeInTheDocument();
    expect(screen.queryByText("SYNTHETIC-1")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("SYNTHETIC-1")).toBeInTheDocument();
  });

  it("keeps cached data visibly stale after a failed refresh", async () => {
    vi.mocked(supabase.rpc).mockResolvedValueOnce({ data: payload(), error: null } as never).mockResolvedValueOnce({ data: null, error: { message: "Carrier source unavailable" } } as never);
    mount();
    await screen.findByText("SYNTHETIC-1");
    fireEvent.click(screen.getByRole("button", { name: "Refresh policies" }));
    expect(await screen.findByText(/The latest refresh failed/)).toBeInTheDocument();
    expect(screen.getByText("SYNTHETIC-1")).toBeInTheDocument();
  });

  it("clears prior-user facts immediately while identity resolves after an account change", async () => {
    vi.mocked(supabase.rpc).mockResolvedValue({ data: payload(), error: null } as never);
    const view = mount();
    await screen.findByText("SYNTHETIC-1");
    state.auth = { user: { id: "user-next" }, isLoading: false };
    // Deliberately leave the previous identity in memory during the auth transition.
    view.rerender(view.refresh());
    expect(screen.queryByText("SYNTHETIC-1")).not.toBeInTheDocument();
    expect(supabase.rpc).toHaveBeenCalledTimes(1);
    state.identity = resolved("user-next", "agent-next");
    vi.mocked(supabase.rpc).mockResolvedValue({ data: payload("agent-next", []), error: null } as never);
    view.rerender(view.refresh());
    expect(await screen.findByText("No carrier policies on file")).toBeInTheDocument();
    expect(supabase.rpc).toHaveBeenLastCalledWith("agent_carrier_book", { p_agent_id: "agent-next" });
  });

  it("does not query for ambiguous, failed or unresolved identity", async () => {
    state.identity = { ...resolved(), agentId: null, identity: { status: "ambiguous", candidates: [] } };
    const view = mount();
    expect(screen.getByText("More than one agent record matches this login")).toBeInTheDocument();
    state.identity = { ...resolved(), agentId: null, identity: { status: "error", message: "Resolver unavailable" }, isError: true };
    view.rerender(view.refresh());
    expect(screen.getByRole("alert")).toHaveTextContent("Resolver unavailable");
    await act(async () => {});
    expect(supabase.rpc).not.toHaveBeenCalled();
  });
});
