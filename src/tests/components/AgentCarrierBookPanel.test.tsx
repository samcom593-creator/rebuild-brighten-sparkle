import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";
const state = vi.hoisted(() => ({ userId: "viewer-a" }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: state.userId } }) }));
vi.mock("@/hooks/useProductionRealtime", () => ({ useProductionRealtime: () => undefined }));
import { AgentCarrierBookPanel } from "@/components/team/AgentCarrierBookPanel";
const policy = (key: string, bucket: string, raw: string | null, overrides: Record<string, unknown> = {}) => ({ key, carrier: "Ethos", underwriter: null,
  client: `Synthetic ${key}`, policy_number: `POL-${key}`, product: "Whole life", bucket, status_raw: raw,
  annual_premium: 1200, chargeback: null, last_seen_on: "2026-11-23", sold_on: "2026-11-01", effective_on: null, ...overrides });
const book = () => ({ agent_id: "canonical-a", requested_agent_id: "alias-a", as_of: "2026-11-25T12:00:00Z",
  policies: [policy("paying", "active", "PREMIUM_PAYING"), policy("declined", "pending", "Declined"), policy("lapsed", "lapsed", "LAPSED"), policy("unknown", "unknown", null)],
  carrier_sources: [{ carrier: "Ethos", policy_count: 4, last_seen_on: "2026-11-23" }],
  summary: { chargebacks: 0, chargeback_amount: 0, debt_outstanding: 0 } });
type Rpc = (name: string, args?: object) => Promise<unknown>;
const rpc = vi.mocked(supabase.rpc as unknown as Rpc);
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><AgentCarrierBookPanel agentId="alias-a" /></QueryClientProvider>);
}
const tile = (label: string) => within(screen.getByText(label, { selector: "p" }).parentElement!);
beforeEach(() => { state.userId = "viewer-a"; rpc.mockReset(); rpc.mockResolvedValue({ data: book(), error: null }); });
describe("producer carrier book", () => {
  it("shows distinct paying, declined, lapsed and unknown carrier facts and source observation dates", async () => {
    mount();
    expect(await screen.findByText("Synthetic declined")).toBeInTheDocument();
    const row = screen.getByText("Synthetic declined").closest("li")!;
    expect(within(row).getAllByText("Declined")).toHaveLength(2);
    expect(screen.getByText("Premium paying")).toBeInTheDocument();
    expect(screen.getByText(/oldest observation Nov 23, 26/)).toBeInTheDocument();
    expect(screen.queryByText("Submitted")).not.toBeInTheDocument();
    expect(screen.queryByText("Lapsed · charged back")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Declined \/ not taken/ }));
    expect(screen.getByText("Synthetic declined")).toBeInTheDocument();
    expect(screen.queryByText("Synthetic paying")).not.toBeInTheDocument();
  });
  it("rejects carrier records returned for a different requested producer", async () => {
    rpc.mockResolvedValue({ data: { ...book(), requested_agent_id: "other-producer" }, error: null });
    mount();
    expect(await screen.findByText(/Carrier evidence is unavailable for this producer/)).toBeInTheDocument();
    expect(screen.queryByText("Synthetic paying")).not.toBeInTheDocument();
  });
  it("keeps known premium and cents visible beside the missing-policy count", async () => {
    rpc.mockResolvedValue({ data: { ...book(), policies: [
      policy("known", "active", "In force", { annual_premium: "1200.50" }),
      policy("missing", "active", "In force", { annual_premium: null }),
      policy("pending", "pending", "Issued", { annual_premium: 149.75 }),
    ] }, error: null });
    mount();
    await screen.findByText("Synthetic known");
    expect(tile("Carrier policies").getByText("3")).toBeInTheDocument();
    expect(tile("Carrier policies").getByText("$1,350.25 known annual premium · 1 missing premium · partial total")).toBeInTheDocument();
    expect(tile("Currently in force").getByText("2")).toBeInTheDocument();
    expect(tile("Currently in force").getByText("$1,200.50 known annual premium · 1 missing premium · partial total · coverage status")).toBeInTheDocument();
  });
  it("does not render a zero-dollar premium when every policy amount is missing", async () => {
    rpc.mockResolvedValue({ data: { ...book(), policies: [policy("missing", "pending", "Issued", { annual_premium: null })] }, error: null });
    mount();
    await screen.findByText("Synthetic missing");
    expect(tile("Carrier policies").getByText("Annual premium unavailable · 1 missing premium")).toBeInTheDocument();
    expect(tile("Carrier policies").queryByText(/\$0/)).not.toBeInTheDocument();
  });
  it.each([book().summary, undefined])("keeps absent chargebacks unrecorded and zero paid-status counts separate from cash, summary %j", async summary => {
    rpc.mockResolvedValue({ data: { ...book(), summary, policies: [
      policy("inforce", "active", "In force"), policy("issued", "pending", "Issued"),
      policy("awaiting", "pending", "PENDING_INITIAL_PREMIUM"),
    ] }, error: null });
    mount();
    await screen.findByText("Synthetic inforce");
    expect(tile("Paying / paid · carrier reported").getByText("0")).toBeInTheDocument();
    expect(tile("Paying / paid · carrier reported").getByText("No confirmed statuses · no commission payment implied")).toBeInTheDocument();
    expect(tile("Paying / paid · carrier reported").queryByText(/\$0/)).not.toBeInTheDocument();
    expect(tile("Recorded chargebacks").getByText("Not recorded")).toBeInTheDocument();
    expect(tile("Recorded chargebacks").queryByText(/\$0/)).not.toBeInTheDocument();
  });
  it("uses only explicit paid statuses for partial AP and preserves recorded chargeback evidence", async () => {
    rpc.mockResolvedValue({ data: { ...book(), policies: [
      policy("paying-known", "active", "PREMIUM_PAYING", { annual_premium: 100.25 }),
      policy("paid-missing", "active", "Paid", { annual_premium: null }),
      policy("conflict", "lapsed", "PREMIUM_PAYING", { annual_premium: 9999, chargeback: -12.25 }),
    ], summary: { chargebacks: 1, chargeback_amount: 12.25, debt_outstanding: 0 } }, error: null });
    mount();
    await screen.findByText("Synthetic paying-known");
    expect(tile("Paying / paid · carrier reported").getByText("2")).toBeInTheDocument();
    expect(tile("Paying / paid · carrier reported").getByText("$100.25 known annual premium · 1 missing premium · partial total · no commission payment implied")).toBeInTheDocument();
    expect(tile("Recorded chargebacks").getByText("$12.25")).toBeInTheDocument();
    expect(screen.getByText("Recorded chargeback -$12.25")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Paying \/ paid status/ }));
    expect(screen.queryByText("Synthetic conflict")).not.toBeInTheDocument();
    expect(screen.getByText("Synthetic paid-missing")).toBeInTheDocument();
  });
  it("counts source coverage from displayed policies while retaining the oldest source observation", async () => {
    rpc.mockResolvedValue({ data: { ...book(), policies: [
      policy("ethos", "pending", "Issued"),
      policy("combined-one", "active", "In force", { carrier: "Combined" }),
      policy("combined-two", "lapsed", "Lapsed", { carrier: "Combined" }),
    ], carrier_sources: [
      { carrier: "Ethos", policy_count: 40, last_seen_on: "2026-11-21" },
      { carrier: "Combined", policy_count: 50, last_seen_on: "2026-11-20" },
    ] }, error: null });
    mount();
    await screen.findByText("Synthetic ethos");
    const source = screen.getByText(/^Source coverage:/);
    expect(source).toHaveTextContent("Combined: 2 policies · oldest observation Nov 20, 26");
    expect(source).toHaveTextContent("Ethos: 1 policy · oldest observation Nov 21, 26");
    expect(source).not.toHaveTextContent("40");
    expect(source).not.toHaveTextContent("50");
    fireEvent.click(screen.getByRole("button", { name: /In force/ }));
    expect(screen.getByText("1 of 3 policies")).toBeInTheDocument();
    expect(source).toHaveTextContent("Combined: 2 policies");
  });
});
