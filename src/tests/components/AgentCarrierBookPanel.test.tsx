import { fireEvent, render, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";
const state = vi.hoisted(() => ({ userId: "viewer-a" }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: state.userId } }) }));
vi.mock("@/hooks/useProductionRealtime", () => ({ useProductionRealtime: () => undefined }));
import { AgentCarrierBookPanel } from "@/components/team/AgentCarrierBookPanel";
const policy = (key: string, bucket: string, raw: string | null) => ({ key, carrier: "Ethos", underwriter: null,
  client: `Synthetic ${key}`, policy_number: `POL-${key}`, product: "Whole life", bucket, status_raw: raw,
  annual_premium: 1200, chargeback: null, last_seen_on: "2026-11-23", sold_on: "2026-11-01", effective_on: null });
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
});
