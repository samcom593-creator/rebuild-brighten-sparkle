/**
 * My Leads work list (2026-11-19).
 *
 * Measured the day this shipped: 656 leads were in agents' hands and 420 had never been touched. The list drew every
 * lead with all eight result buttons open, so a phone showed two leads per screen. Now each lead is one line, one
 * lead at a time shows its result buttons, a recorded result opens the next lead, call backs come first, and a pack
 * can always be searched, filtered and paged without changing calling restrictions.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  leads: [] as Array<Record<string, unknown>>,
  logged: [] as Array<{ item: string; status: string }>,
}));

vi.mock("@/components/callcenter/CallCenterVoiceRecorder", () => ({ CallCenterVoiceRecorder: () => null }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args?: Record<string, unknown>) => {
      if (fn === "my_lead_bundles") return Promise.resolve({ data: db.leads.map((l) => ({ ...l })), error: null });
      if (fn === "lead_bundle_item_log") {
        const item = String(args?.p_item), status = String(args?.p_status);
        db.logged.push({ item, status });
        const row = db.leads.find((l) => l.item_id === item);
        if (row) row.status = status;
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: { ok: true }, error: null });
    },
  },
}));

import MyLeads from "@/pages/MyLeads";

const lead = (n: number, over: Record<string, unknown> = {}) => ({
  item_id: `item-${n}`, bundle_id: "b-1", bundle_name: "Starter pack", bundle_note: null, format: "client_leads",
  phone10: `60255501${String(n).padStart(2, "0")}`, first_name: `Lead${n}`, last_name: "Test", email: null, state: "AZ",
  age: 60, quality_tier: "A", quality_reason: "Warm", attrs: { pool: "marketing" }, attempts: null, last_dialed_at: null,
  last_disposition: null, status: "new", status_note: null, status_at: null, granted_at: "2026-11-12T16:15:00Z",
  callable_now: true, callable_at: null, ...over,
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <MyLeads />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const rowNames = () => screen.getAllByTestId("lead-row").map((r) => r.textContent?.match(/Lead\d+/)?.[0]);
const openRows = () => screen.getAllByTestId("lead-row").filter((r) => r.getAttribute("data-open") === "true");

describe("My Leads work list", () => {
  beforeEach(() => {
    db.logged.length = 0;
    db.leads = [lead(1), lead(2), lead(3)];
  });

  it("opens only the first lead; every other lead is one line with no result buttons", async () => {
    renderPage();
    await screen.findAllByTestId("lead-row");
    expect(openRows()).toHaveLength(1);
    expect(openRows()[0].textContent).toContain("Lead1");
    expect(screen.getAllByTestId("lead-panel")).toHaveLength(1);
    // one set of the seven result buttons on the page, not one per lead
    expect(screen.getAllByRole("button", { name: "No answer" })).toHaveLength(1);
    // every lead still carries its own call link
    expect(screen.getAllByTestId("lead-call-link")).toHaveLength(3);
  });

  it("recording a result on the open lead opens the next one down", async () => {
    renderPage();
    await screen.findAllByTestId("lead-row");
    fireEvent.click(screen.getByRole("button", { name: "No answer" }));
    await waitFor(() => expect(db.logged).toEqual([{ item: "item-1", status: "no_answer" }]));
    await waitFor(() => expect(openRows()[0]?.textContent).toContain("Lead2"));
    expect(openRows()).toHaveLength(1);
  });

  it("tapping a lead's number opens that lead so the result buttons are waiting after the call", async () => {
    renderPage();
    await screen.findAllByTestId("lead-row");
    fireEvent.click(screen.getAllByTestId("lead-call-link")[2]);
    await waitFor(() => expect(openRows()[0].textContent).toContain("Lead3"));
  });

  it("the arrow opens and closes a lead, and closing leaves every lead as one line", async () => {
    renderPage();
    await screen.findAllByTestId("lead-row");
    fireEvent.click(screen.getByRole("button", { name: "Open Lead2 Test" }));
    expect(openRows()[0].textContent).toContain("Lead2");
    fireEvent.click(screen.getByRole("button", { name: "Close Lead2 Test" }));
    expect(openRows()).toHaveLength(0);
    expect(screen.queryByTestId("lead-panel")).toBeNull();
  });

  it("lists call backs and booked appointments first, then never-called leads, then no-answers", async () => {
    db.leads = [lead(1, { status: "no_answer" }), lead(2), lead(3, { status: "callback" }), lead(4, { status: "appointment" })];
    renderPage();
    await screen.findAllByTestId("lead-row");
    expect(rowNames()).toEqual(["Lead3", "Lead4", "Lead2", "Lead1"]);
    expect(screen.getByTestId("callbacks-due").textContent).toContain("2 waiting on your call back");
  });

  it("keeps the server's order outside the To call view", async () => {
    db.leads = [lead(1, { status: "no_answer" }), lead(2), lead(3, { status: "callback" })];
    renderPage();
    await screen.findAllByTestId("lead-row");
    fireEvent.click(screen.getByRole("button", { name: /^All/ }));
    expect(rowNames()).toEqual(["Lead1", "Lead2", "Lead3"]);
  });

  it("keeps search available even for a small pack and can clear it in one tap", async () => {
    renderPage();
    await screen.findAllByTestId("lead-row");
    fireEvent.change(screen.getByLabelText("Find a lead"), { target: { value: "Lead2" } });
    expect(rowNames()).toEqual(["Lead2"]);
    fireEvent.click(screen.getByRole("button", { name: "Clear find a lead" }));
    expect(rowNames()).toEqual(["Lead1", "Lead2", "Lead3"]);
  });

  it("makes every assigned row reachable and resets paging when filters change", async () => {
    db.leads = Array.from({ length: 55 }, (_, i) => lead(i + 1));
    renderPage();
    await screen.findAllByTestId("lead-row");
    expect(screen.getAllByTestId("lead-row")).toHaveLength(25);
    expect(rowNames()[0]).toBe("Lead1");
    fireEvent.click(screen.getByRole("button", { name: "Next assigned leads page" }));
    expect(rowNames()[0]).toBe("Lead26");
    fireEvent.click(screen.getByRole("button", { name: "Next assigned leads page" }));
    expect(rowNames()).toEqual(["Lead51", "Lead52", "Lead53", "Lead54", "Lead55"]);
    fireEvent.change(screen.getByLabelText("Find a lead"), { target: { value: "+1 (602) 555-0155" } });
    expect(rowNames()).toEqual(["Lead55"]);
    fireEvent.click(screen.getByRole("button", { name: "Reset filters" }));
    await waitFor(() => expect(rowNames()[0]).toBe("Lead1"));
  });

  it("opens the next lead across a page boundary after logging a result", async () => {
    db.leads = Array.from({ length: 30 }, (_, i) => lead(i + 1));
    renderPage();
    await screen.findAllByTestId("lead-row");
    fireEvent.click(screen.getByRole("button", { name: "Open Lead25 Test" }));
    fireEvent.click(screen.getByRole("button", { name: "Callback" }));
    await waitFor(() => expect(db.logged).toEqual([{ item: "item-25", status: "callback" }]));
    await waitFor(() => expect(openRows()[0]?.textContent).toContain("Lead26"));
    expect(screen.getByRole("button", { name: "Previous assigned leads page" })).not.toBeDisabled();
  });

  it("combines state and pack filters and starts work only on the matching leads", async () => {
    db.leads = [lead(1), lead(2, { state: "TX" }), lead(3, { state: "TX", bundle_id: "b-2", bundle_name: "Second pack" })];
    renderPage();
    await screen.findAllByTestId("lead-row");
    fireEvent.change(screen.getByLabelText("Lead state"), { target: { value: "TX" } });
    fireEvent.change(screen.getByLabelText("Lead pack"), { target: { value: "b-1" } });
    expect(rowNames()).toEqual(["Lead2"]);
    expect(screen.getByRole("button", { name: "To call (1)" })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Work leads (1)" }));
    expect(screen.getByRole("heading", { name: /Lead2 Test/ })).toBeTruthy();
    expect(screen.getByText("0 of 1 worked")).toBeTruthy();
  });

  it("search narrows the list by name, by phone digits and by state", async () => {
    db.leads = Array.from({ length: 10 }, (_, i) => lead(i + 1, i === 6 ? { first_name: "Marisol", state: "TX" } : {}));
    renderPage();
    await screen.findAllByTestId("lead-row");
    const box = screen.getByTestId("lead-search");
    fireEvent.change(box, { target: { value: "maris" } });
    expect(screen.getAllByTestId("lead-row")).toHaveLength(1);
    expect(within(screen.getByTestId("lead-row")).getByText(/Marisol/)).toBeTruthy();
    fireEvent.change(box, { target: { value: "(602) 555-0103" } });
    expect(rowNames()).toEqual(["Lead3"]);
    fireEvent.change(box, { target: { value: "tx" } });
    expect(screen.getAllByTestId("lead-row")).toHaveLength(1);
    fireEvent.change(box, { target: { value: "nobody-here" } });
    expect(screen.queryByTestId("lead-row")).toBeNull();
    expect(screen.getByText(/No lead in this view matches/)).toBeTruthy();
  });
});
