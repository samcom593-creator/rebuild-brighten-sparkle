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
  rpcArgs: [] as Array<{ fn: string; args: unknown }>,
  objections: [] as unknown[],
}));

vi.mock("@/lib/looseSupabase", () => {
  const builder = (table: string) => {
    const result = () => ({ data: table === "v_sold_calls_queue" ? db.queue : table === "v_objection_calls" ? db.objections : db.packets, error: null });
    const b: Record<string, unknown> = {};
    for (const m of ["select", "order", "eq", "limit"]) b[m] = () => b;
    b.range = () => Promise.resolve(result());
    b.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject);
    return b;
  };
  return { looseSupabase: { from: (table: string) => builder(table) } };
});

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args?: unknown) => {
      db.rpcCalls.push(fn);
      db.rpcArgs.push({ fn, args });
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
  monthly_premium: 54.37,
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
  db.rpcArgs = [];
  db.objections = [];
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
    // The payment block shows a loading state until the SSN and bank read lands.
    expect(await within(card).findByText("Checking account", { exact: false })).toBeInTheDocument();
    for (const text of ["American Amicable", "Senior Choice", "$15,000", "$54.37/mo", "3rd of the month", "03/07/1958", "Checking account", "John Smith · son"]) {
      expect(within(card).getByText(text, { exact: false })).toBeInTheDocument();
    }
  });

  it("starts on the sales left to resell and keeps waiting sales one tap away", async () => {
    renderPage();
    await screen.findByRole("article", { name: "Sold call: Kathy Smith" });
    expect(screen.queryByRole("article", { name: "Sold call: Dora Lane" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Packet coming/ }));
    const waiting = await screen.findByRole("article", { name: "Sold call: Dora Lane" });
    expect(within(waiting).getByText(/sale packet is being written/)).toBeInTheDocument();
    expect(within(waiting).getByRole("link", { name: /Call \(601\) 555-9999/ })).toBeInTheDocument();
  });

  it("calls a seconds-long sale a short call and points to the client's full sale", async () => {
    db.queue = [packetRow, { ...waitingRow, call_id: "call-3", lead_phone: "(601) 555-1234", duration_seconds: 4, packet_status: "short_call" }];
    renderPage();
    await screen.findByRole("article", { name: "Sold call: Kathy Smith" });
    fireEvent.click(screen.getByRole("button", { name: /No packet/ }));
    const short = await screen.findByRole("article", { name: "Sold call: Dora Lane" });
    expect(within(short).getByText(/lasted 0:04, too short to hold an application/)).toBeInTheDocument();
    fireEvent.click(within(short).getByRole("button", { name: "Show that sale" }));
    expect(await screen.findByRole("article", { name: "Sold call: Kathy Smith" })).toBeInTheDocument();
    expect((screen.getByRole("textbox", { name: "Search sold calls" }) as HTMLInputElement).value).toBe("6015551234");
  });

  it("shows each beneficiary's date of birth and the policy number entered at resale, and finds a sale by it", async () => {
    db.queue = [{ ...packetRow, policy_number: "AA-100", beneficiaries: [{ name: "John Smith", relationship: "son", pct: 100, dob: "1985-02-03" }] }, waitingRow];
    db.packets = [{ ...(db.packets[0] as Record<string, unknown>), booked_policy_number: "AA-999" }];
    renderPage();
    const card = await screen.findByRole("article", { name: "Sold call: Kathy Smith" });
    expect(within(card).getByText(/John Smith · son · DOB 02\/03\/1985/)).toBeInTheDocument();
    expect(await within(card).findByText("AA-999")).toBeInTheDocument();
    expect(within(card).getByText("Policy # at resale")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    fireEvent.change(screen.getByRole("textbox", { name: "Search sold calls" }), { target: { value: "aa-999" } });
    expect(await screen.findByRole("article", { name: "Sold call: Kathy Smith" })).toBeInTheDocument();
    expect(screen.queryByRole("article", { name: "Sold call: Dora Lane" })).toBeNull();
  });

  it("puts the call date in the corner, the age arithmetic by the birth date, and what the call means for reselling", async () => {
    db.queue = [{
      ...packetRow,
      approval_status: "declined", declined_after_ssn_bank: true, said_ssn: true, said_bank: true,
      mortgage_protection: true, spouse_coverage: true, price_objection: true,
      other_opportunities: ["Wants coverage for her grandson"],
      insight_summary: "Willing buyer; carrier declined after SSN and bank. Try another carrier.",
      key_moments: [{ t: "14:05", label: "mortgage protection", quote: "what about something for the house" }],
      approval_quote: "it came back declined",
    }, waitingRow];
    renderPage();
    const card = await screen.findByRole("article", { name: "Sold call: Kathy Smith" });
    expect(within(card).getByText(/Mon, Oct 12, 2026 · /)).toBeInTheDocument();
    expect(await within(card).findByText(/2026 − 1958/)).toBeInTheDocument();
    for (const chip of ["Gave SSN + bank, declined: resell with another carrier", "Gave SSN", "Gave bank", "Wants mortgage protection", "Asked about the spouse", "Price objection"]) {
      expect(within(card).getByText(chip)).toBeInTheDocument();
    }
    expect(within(card).getByText(/what about something for the house/)).toBeInTheDocument();
    expect(within(card).getByText(/Wants coverage for her grandson/)).toBeInTheDocument();
    // The recording itself is gone from the card; the transcript moments replace it.
    expect(within(card).queryByRole("link", { name: /Recording/ })).toBeNull();
  });

  it("marks a call contacted, resold, push or pushback with one tap, and a note", async () => {
    renderPage();
    const card = await screen.findByRole("article", { name: "Sold call: Kathy Smith" });
    for (const name of ["Mark contacted", "Mark resold", "Mark push", "Mark pushback"]) {
      expect(within(card).getByRole("button", { name })).toBeInTheDocument();
    }
    fireEvent.click(within(card).getByRole("button", { name: "Mark pushback" }));
    await waitFor(() => expect(db.rpcArgs.some((c) => c.fn === "sold_call_set_status")).toBe(true));
    expect(db.rpcArgs.find((c) => c.fn === "sold_call_set_status")?.args).toEqual({ p_call_id: "call-1", p_status: "pushback", p_note: null });
    fireEvent.change(within(card).getByRole("textbox", { name: "Note for Kathy Smith" }), { target: { value: "Call back Friday with her husband" } });
    fireEvent.click(within(card).getByRole("button", { name: "Save note" }));
    await waitFor(() => expect(db.rpcArgs.filter((c) => c.fn === "sold_call_set_status")).toHaveLength(2));
    expect(db.rpcArgs.filter((c) => c.fn === "sold_call_set_status")[1].args).toEqual({ p_call_id: "call-1", p_status: null, p_note: "Call back Friday with her husband" });
  });

  it("lists bank and SSN objection calls with Call, the date and the same buttons", async () => {
    db.objections = [
      { call_id: "obj-1", call_at: "2026-10-14T18:30:00Z", agent_raw: "Marcos", lead_first_name: "Rita", lead_last_name: "Moss", lead_phone: "6015550101", lead_email: null, disposition: "Bank Objection", duration_seconds: 1500, rec_seconds: null, has_transcript: false, download_status: null, sold_later: false },
      { call_id: "obj-2", call_at: "2026-10-13T18:30:00Z", agent_raw: "Marcos", lead_first_name: "Sam", lead_last_name: "Ode", lead_phone: "6015550102", lead_email: null, disposition: "Social Objection", duration_seconds: 300, rec_seconds: null, has_transcript: false, download_status: null, sold_later: false },
    ];
    renderPage();
    await screen.findByRole("article", { name: "Sold call: Kathy Smith" });
    fireEvent.click(screen.getByRole("tab", { name: /Bank & SSN objections/ }));
    const card = await screen.findByRole("article", { name: "Objection call: Rita Moss" });
    expect(screen.queryByRole("article", { name: "Objection call: Sam Ode" })).toBeNull(); // starts on bank objections
    expect(within(card).getByRole("link", { name: /Call \(601\) 555-0101/ })).toBeInTheDocument();
    expect(within(card).getByText(/Wed, Oct 14, 2026 · /)).toBeInTheDocument();
    fireEvent.click(within(card).getByRole("button", { name: "Mark contacted" }));
    await waitFor(() => expect(db.rpcArgs.find((c) => c.fn === "sold_call_set_status")?.args).toEqual({ p_call_id: "obj-1", p_status: "contacted", p_note: null }));
    fireEvent.click(screen.getByRole("button", { name: /^Social objection/ }));
    expect(await screen.findByRole("article", { name: "Objection call: Sam Ode" })).toBeInTheDocument();
  });

  it("flags an SSN heard with an extra digit and a routing number that fails its check digit", async () => {
    db.sensitive = { data: [{ packet_id: "pk-1", ssn: "1234567890", bank_account: "000123456789", bank_routing: "111000026" }], error: null };
    renderPage();
    const card = await screen.findByRole("article", { name: "Sold call: Kathy Smith" });
    await waitFor(() => expect(within(card).getByText("10 digits, one more than an SSN has. Confirm it with the client.")).toBeInTheDocument());
    expect(within(card).getByText("fails the bank's check digit, so a digit is wrong or two are swapped. Confirm it with the client.")).toBeInTheDocument();
    expect(within(card).getByText("2 numbers to check")).toBeInTheDocument();
    expect(within(card).getByText(/Confirm the SSN: 10 digits, one more than an SSN has/)).toBeInTheDocument();
    // A number that cannot be right stays on screen but is not offered for pasting into an application.
    expect(within(card).queryByRole("button", { name: "Copy SSN" })).toBeNull();
    expect(within(card).queryByRole("button", { name: "Copy Routing #" })).toBeNull();
    expect(within(card).getByRole("button", { name: "Copy Account #" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Numbers to check/ })).toHaveTextContent("1");
  });

  it("saves the SSN the client confirms, and will not save one that still cannot be right", async () => {
    db.sensitive = { data: [{ packet_id: "pk-1", ssn: "1234567890", bank_account: "000123456789", bank_routing: "111000025" }], error: null };
    renderPage();
    const card = await screen.findByRole("article", { name: "Sold call: Kathy Smith" });
    fireEvent.click(await within(card).findByRole("button", { name: "Fix the SSN" }));
    const input = within(card).getByRole("textbox", { name: "SSN the client confirmed" });
    const form = input.closest("form") as HTMLFormElement;
    fireEvent.change(input, { target: { value: "12345" } });
    expect(within(form).getByText("5 digits, 4 fewer than an SSN has")).toBeInTheDocument();
    expect(within(form).getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(input, { target: { value: "123-45-6780" } });
    fireEvent.click(within(form).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(db.rpcArgs).toContainEqual({ fn: "booking_packet_fix_number", args: { p_packet_id: "pk-1", p_field: "ssn", p_value: "123456780" } }));
  });

  it("never shows Add or a 0 count for numbers it could not read", async () => {
    db.sensitive = { data: null as unknown as unknown[], error: { message: "timeout" } };
    renderPage();
    const card = await screen.findByRole("article", { name: "Sold call: Kathy Smith" });
    await waitFor(() => expect(within(card).getByText("SSN and bank numbers did not load. Use Try again at the top of the page.")).toBeInTheDocument());
    expect(within(card).queryByRole("button", { name: "Add the SSN" })).toBeNull();
    const chip = screen.getByRole("button", { name: /Numbers to check/ });
    expect(chip).toHaveTextContent("–");
    fireEvent.click(chip);
    expect(await screen.findByText("Numbers to check did not load")).toBeInTheDocument();
    expect(screen.queryByText("No sold calls in this list right now.")).toBeNull();
  });

  it("opens on one call from an Easy Resells link (?call=), with a way back to all", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/dashboard/sold-calls?call=call-1"]}><SoldCalls /></MemoryRouter>
      </QueryClientProvider>,
    );
    expect(await screen.findByRole("article", { name: "Sold call: Kathy Smith" })).toBeInTheDocument();
    expect(screen.getAllByRole("article")).toHaveLength(1);
    expect(screen.getByText("Showing one call, opened from Easy Resells.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    await waitFor(() => expect(screen.queryByText("Showing one call, opened from Easy Resells.")).toBeNull());
  });

  it("drops the one-call link when the other tab is opened", async () => {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <QueryClientProvider client={qc}>
        <MemoryRouter initialEntries={["/dashboard/sold-calls?call=call-1"]}><SoldCalls /></MemoryRouter>
      </QueryClientProvider>,
    );
    await screen.findByText("Showing one call, opened from Easy Resells.");
    fireEvent.click(screen.getByRole("tab", { name: /Bank & SSN objections/ }));
    await waitFor(() => expect(screen.queryByText("Showing one call, opened from Easy Resells.")).toBeNull());
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
