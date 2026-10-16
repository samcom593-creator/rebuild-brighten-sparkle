/**
 * Sold Calls (src/pages/SoldCalls.tsx), 2026-10-15.
 *
 * Sam: policy info must be clear, no reveal button, no little side drawer, and
 * calling the client has to be one tap. These pin that: every sale renders in full
 * on the page with the SSN and bank numbers already loaded, a Call button that
 * carries the number, and plain-language asks instead of raw field keys.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ current: { user: { id: "sam" }, isAdmin: true } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth.current }));

const db = vi.hoisted(() => ({
  queue: [] as unknown[],
  packets: [] as unknown[],
  sensitive: { data: [] as unknown[], error: null as null | { message: string } },
  rpcCalls: [] as string[],
}));

vi.mock("@/lib/looseSupabase", () => {
  const builder = (table: string) => {
    const result = () => ({ data: table === "v_sold_calls_queue" ? db.queue : db.packets, error: null });
    const b: Record<string, unknown> = {};
    for (const m of ["select", "order", "eq", "limit"]) b[m] = () => b;
    b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject);
    return b;
  };
  return { looseSupabase: { from: (table: string) => builder(table) } };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string) => {
      db.rpcCalls.push(fn);
      if (fn === "booking_packets_sensitive_all") return Promise.resolve(db.sensitive);
      return Promise.resolve({ data: null, error: null });
    },
  },
}));

import SoldCalls from "@/pages/SoldCalls";

const packetRow = {
  call_id: "call-1",
  call_at: "2026-10-12T17:00:00Z",
  agent_raw: "Marcos",
  lead_first_name: "Kathy",
  lead_last_name: "Smith",
  lead_phone: "6015551234",
  duration_seconds: 1840,
  recording_url: "https://apexfinancial.readymode.com/File%20types/data/callrec/1_hq.mp3",
  packet_id: "pk-1",
  client_first_name: "Kathy",
  client_last_name: "Smith",
  client_state: "TX",
  carrier: "American Amicable",
  product: "Senior Choice",
  face_amount: 15000,
  monthly_premium: 54,
  policy_number: null,
  ssn_last4: "6789",
  has_ssn: true,
  has_bank: true,
  beneficiaries: [{ name: "John Smith", relationship: "son", pct: 100 }],
  sensitive_pointers: { ssn: { t_start: 1045 }, bank_account: { t_start: 1075 }, routing: { t_start: 1075 } },
  missing_fields: ["policy_number", "client_phone", "beneficiaries[0].dob", "client_email"],
  call_summary: "Kathy bought a $15k final expense policy.",
  key_points: ["Drafts on the 3rd"],
  draft_day: "3",
  payment_method_type: "checking",
  status: "needs_review",
  booked_at: null,
  packet_status: "needs_review",
};
const waitingRow = {
  ...packetRow,
  call_id: "call-2",
  lead_first_name: "Dora",
  lead_last_name: "Lane",
  lead_phone: "6015559999",
  packet_id: null,
  client_first_name: null,
  client_last_name: null,
  packet_status: "transcribing",
};

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter><SoldCalls /></MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  auth.current = { user: { id: "sam" }, isAdmin: true };
  db.queue = [packetRow, waitingRow];
  db.packets = [{
    packet_id: "pk-1", client_dob: "1958-03-07", client_phone: null, client_email: null,
    client_street: "12 Oak St", client_city: "Tyler", client_zip: "75701", tobacco: false,
    health_notes: "High blood pressure", bank_name: "Chase", booked_policy_number: null,
  }];
  db.sensitive = { data: [{ packet_id: "pk-1", ssn: "123456789", bank_account: "000123456789", bank_routing: "111000025" }], error: null };
  db.rpcCalls = [];
});

describe("Sold Calls", () => {
  it("shows the SSN and bank numbers on the card with no reveal step", async () => {
    renderPage();
    const card = await screen.findByRole("article", { name: "Sold call: Kathy Smith" });
    await waitFor(() => expect(within(card).getByText("123-45-6789")).toBeInTheDocument());
    expect(within(card).getByText("111000025")).toBeInTheDocument();
    expect(within(card).getByText("000123456789")).toBeInTheDocument();
    expect(within(card).getByText("Chase")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reveal/i })).toBeNull();
    expect(db.rpcCalls).toContain("booking_packets_sensitive_all");
  });

  it("puts the client's number on a Call button", async () => {
    renderPage();
    const card = await screen.findByRole("article", { name: "Sold call: Kathy Smith" });
    const call = within(card).getByRole("link", { name: /Call \(601\) 555-1234/ });
    expect(decodeURIComponent(decodeURIComponent(call.getAttribute("href") ?? ""))).toContain("+16015551234");
  });

  it("asks for what the client can give, in words, and never for the policy number", async () => {
    renderPage();
    const card = await screen.findByRole("article", { name: "Sold call: Kathy Smith" });
    const asks = within(card).getByText("Ask the client for:").parentElement as HTMLElement;
    expect(asks.textContent).toContain("Beneficiary date of birth");
    expect(asks.textContent).toContain("Email");
    expect(asks.textContent).not.toMatch(/policy|client_phone|\[0\]/i);
  });

  it("shows the full policy and client facts on the page", async () => {
    renderPage();
    const card = await screen.findByRole("article", { name: "Sold call: Kathy Smith" });
    for (const text of ["American Amicable", "Senior Choice", "$15,000", "$54/mo", "3rd of the month", "03/07/1958", "Checking account", "John Smith · son"]) {
      expect(within(card).getByText(text, { exact: false })).toBeInTheDocument();
    }
  });

  it("starts on the sales left to book and keeps waiting sales one tap away", async () => {
    renderPage();
    await screen.findByRole("article", { name: "Sold call: Kathy Smith" });
    expect(screen.queryByRole("article", { name: "Sold call: Dora Lane" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Waiting on packet/ }));
    const waiting = await screen.findByRole("article", { name: "Sold call: Dora Lane" });
    expect(within(waiting).getByText(/booking packet is being written/)).toBeInTheDocument();
    expect(within(waiting).getByRole("link", { name: /Call \(601\) 555-9999/ })).toBeInTheDocument();
  });

  it("says so when the SSN and bank numbers fail to load", async () => {
    db.sensitive = { data: null as unknown as unknown[], error: { message: "permission denied" } };
    renderPage();
    expect(await screen.findByText(/SSN and bank numbers did not load: permission denied/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Try again/ })).toBeInTheDocument();
  });

  it("stays closed to anyone who is not Sam or Aisha", () => {
    auth.current = { user: { id: "agent" }, isAdmin: false };
    renderPage();
    expect(screen.getByText("This page is restricted.")).toBeInTheDocument();
    expect(db.rpcCalls).toEqual([]);
  });
});
