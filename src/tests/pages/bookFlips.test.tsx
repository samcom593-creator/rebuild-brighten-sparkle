/**
 * Book Flips (src/pages/BookFlips.tsx), OVERHAUL-resells (2026-10-29).
 *
 * Sam: "cleaner cards, and rank opportunities by evidence ... Show why each one ranks where it does."
 * These pin the page's new opening order (somebody you can call, then the most evidence, then the
 * departed-writer priority), the chips and score that explain each card, the one gold button, the
 * evidence tiles that equal the list they open, what a manager sees, and that the old orders are a
 * choice away.
 */
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ current: { user: { id: "sam" }, isAdmin: true } as { user: { id: string } | null; isAdmin: boolean } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth.current }));
vi.mock("@/hooks/useSoldCallKeys", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/hooks/useSoldCallKeys")>()),
  useSoldCallKeys: () => ({ ready: true, count: 0, has: () => false }),
}));
vi.mock("@/components/deals/SubmitDealDialog", () => ({
  SubmitDealDialog: ({ trigger, onPosted }: { trigger?: ReactNode; onPosted?: (r: { dealId: string; status: string; annualPaid: number; policyNumber: string }) => void }) => (
    <>{trigger}<button type="button" onClick={() => onPosted?.({ dealId: "d1", status: "submitted", annualPaid: 600, policyNumber: "NEW1" })}>Post deal (test)</button></>
  ),
}));
const celebrated = vi.hoisted(() => ({ kinds: [] as string[] }));
vi.mock("@/lib/celebrate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/celebrate")>()),
  celebrate: async (kind: string) => { celebrated.kinds.push(kind); },
}));

const db = vi.hoisted(() => ({ rows: [] as Array<Record<string, unknown>>, evidence: [] as unknown[], evidenceFails: false, calls: [] as Array<{ fn: string; args: unknown }> }));
vi.mock("@/integrations/supabase/client", () => {
  const ranged = (data: () => unknown[] | null, error: () => { message: string } | null) => ({
    range: (from: number, to: number) => Promise.resolve(error() ? { data: null, error: error() } : { data: (data() ?? []).slice(from, to + 1), error: null }),
  });
  const view = (table: string) => {
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => (table === "v_book_flip_carrier_counts"
        ? Promise.resolve({ data: [{ carrier: "Combined", policies: 4, book_active: 2, unknown_status: 0, lapsing: 1, workable: 4, with_phone: 3, to_call: 4, callbacks_due: 0, resold: 0, resold_annual_premium: 0, last_imported_at: "2026-09-04T12:00:00Z" }], error: null })
        : ranged(() => db.rows, () => null)),
    };
    return chain;
  };
  return {
    supabase: {
      from: (table: string) => view(table),
      rpc: (fn: string, args?: unknown) => {
        db.calls.push({ fn, args });
        if (fn === "resell_evidence") return ranged(() => db.evidence, () => (db.evidenceFails ? { message: "statement timeout" } : null));
        return Promise.resolve({ data: { flip_status: (args as { p_status?: string })?.p_status, attempts: 1 }, error: null });
      },
    },
  };
});

import BookFlips from "@/pages/BookFlips";

const policy = (o: Record<string, unknown>) => ({
  flip_key: "k", carrier: "Combined", policy_number: "P1", client_key: "k", product: "Final Expense", book_status: "Active", is_dead: false,
  is_book_active: true, status_group: "active", client_name: "Ann Able", client_first_name: "Ann", client_last_name: "Able", phone: "6025550101",
  phone_source: "client_record", dob: null, age_years: null, state: "AZ", city: null, do_not_call: false, best_time_to_call: null, face_amount: 10000,
  monthly_premium: 40, annual_premium: 480, effective_date: "2026-03-01", posted_date: "2026-02-20", months_in_force: 7, agent_name: "Kay Gone",
  agent_gone: true, agent_group: null, clients_on_number: 1, flip_status: "to_call", attempts: 0, last_contact_at: null, callback_at: null, notes: null,
  resold_policy_number: null, resold_carrier: null, resold_annual_premium: null, ...o,
});
const ev = (o: Record<string, unknown>) => ({
  kind: "phone", match_key: "", dials: 0, answered: 0, last_answered_at: null, sold_calls: 0, last_sold_at: null, gave_ssn_and_bank: false, ...o,
});

function renderPage(path = "/dashboard/books?book=all") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter initialEntries={[path]}><BookFlips /></MemoryRouter></QueryClientProvider>);
}
const order = () => screen.getAllByRole("listitem", { name: /^Policy: / }).map((li) => li.getAttribute("aria-label")!.slice(8));
const card = (name: string) => within(screen.getByRole("listitem", { name: `Policy: ${name}` }));

const openFilters = () => fireEvent.click(screen.getByRole("button", { name: /^Filters:/ }));

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-29T19:00:00Z"));
  auth.current = { user: { id: "sam" }, isAdmin: true };
  db.calls = [];
  db.evidenceFails = false;
  celebrated.kinds = [];
  db.rows = [
    policy({ flip_key: "a", client_name: "Ann Able", client_first_name: "Ann", client_last_name: "Able", phone: "6025550101", annual_premium: 900 }),
    policy({ flip_key: "b", client_name: "Bob Buyer", client_first_name: "Bob", client_last_name: "Buyer", phone: "6025550102", annual_premium: 300 }),
    policy({ flip_key: "c", client_name: "Cy Lapse", client_first_name: "Cy", client_last_name: "Lapse", phone: "6025550103", status_group: "lapsing", book_status: "Lapse Pending", is_book_active: false }),
    policy({ flip_key: "d", client_name: "Dee Nophone", client_first_name: "Dee", client_last_name: "Nophone", phone: null }),
  ];
  db.evidence = [
    // Bob bought on a call and answered: 30 + 15 = 45. Dee gave SSN and bank on a call under her name, but there is no number to call.
    ev({ match_key: "6025550102", dials: 3, answered: 1, last_answered_at: "2026-09-21T20:00:00Z", sold_calls: 1, last_sold_at: "2026-09-21T20:00:00Z" }),
    ev({ kind: "name", match_key: "deenophone", dials: null, answered: null, gave_ssn_and_bank: true }),
  ];
});
afterEach(() => { vi.useRealTimers(); });

describe("Book Flips", () => {
  it("opens on the most evidence first: somebody to call, then the score, then the departed-writer priority", async () => {
    renderPage();
    await screen.findByRole("listitem", { name: "Policy: Bob Buyer" });
    // Bob 45, Cy 25 (lapse pending), Ann 0, then Dee, who cannot be called whatever her score.
    expect(order()).toEqual(["Bob Buyer", "Cy Lapse", "Ann Able", "Dee Nophone"]);
    // The filters are folded; the button says what is chosen, and the order sits inside it.
    expect(screen.getByRole("button", { name: /^Filters:/ })).toHaveTextContent("Filters: All · To call");
    openFilters();
    expect(screen.getByRole("combobox", { name: "Sort" })).toHaveValue("evidence");
    const bob = card("Bob Buyer");
    expect(bob.getByText("Number 1 in this list")).toBeInTheDocument();
    expect(bob.getByText("45")).toBeInTheDocument();
    const why = bob.getByRole("list", { name: /^Why it ranks here/ });
    expect(within(why).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Sold on a call Sep 21+30", "Answered Sep 21+15"]);
    expect(card("Cy Lapse").getByText("Lapse pending")).toBeInTheDocument();
    expect(card("Dee Nophone").getByText("Gave SSN and bank · same name")).toBeInTheDocument();
    expect(card("Dee Nophone").getByText("No phone on file")).toBeInTheDocument();
  });

  it("keeps one gold button on the screen: the first card's Call", async () => {
    const { container } = renderPage();
    await screen.findByRole("listitem", { name: "Policy: Bob Buyer" });
    const gold = [...container.querySelectorAll("a, button")].filter((e) => /(^|\s)bg-primary(\s|$)/.test(e.className));
    expect(gold.map((e) => e.textContent)).toEqual(["(602) 555-0102"]);
  });

  it("counts evidence on tiles that open exactly those policies", async () => {
    renderPage();
    await screen.findByRole("listitem", { name: "Policy: Bob Buyer" });
    const board = within(screen.getByRole("region", { name: "Why people rank high" }));
    expect(board.getByRole("button", { name: /Sold on a call/ })).toHaveTextContent("1");
    expect(board.getByRole("button", { name: /Lapsing/ })).toHaveTextContent("1");
    fireEvent.click(board.getByRole("button", { name: /Gave SSN and bank/ }));
    expect(order()).toEqual(["Dee Nophone"]);
    openFilters();
    // The status chips count with the tile on, so each says what tapping it would show.
    expect(within(screen.getByRole("group", { name: "Book status" })).getByRole("button", { name: /^All/ })).toHaveTextContent("1");
    expect(within(screen.getByRole("group", { name: "Book status" })).getByRole("button", { name: /^Lapsing/ })).toHaveTextContent("0");
  });

  it("keeps the old orders a choice away", async () => {
    renderPage();
    await screen.findByRole("listitem", { name: "Policy: Bob Buyer" });
    openFilters();
    fireEvent.change(screen.getByRole("combobox", { name: "Sort" }), { target: { value: "priority" } });
    // Departed writers first: the lapse pending policy (save it) leads, then the biggest premium.
    expect(order()).toEqual(["Cy Lapse", "Ann Able", "Dee Nophone", "Bob Buyer"]);
    expect(screen.getByRole("button", { name: /^Filters:/ })).toHaveTextContent("Departed writers first");
    // Open filters stay open on this device the next time the page opens.
    expect(window.localStorage.getItem("book-flips:filters-open")).toBe("1");
  });

  it("shows a manager what they may see and says why SSN and bank is blank", async () => {
    auth.current = { user: { id: "manager-1" }, isAdmin: false };
    renderPage();
    await screen.findByRole("listitem", { name: "Policy: Bob Buyer" });
    const board = within(screen.getByRole("region", { name: "Why people rank high" }));
    expect(board.queryByRole("button", { name: /Gave SSN and bank/ })).toBeNull();
    expect(board.getByText("Only admins see this")).toBeInTheDocument();
  });

  it("falls back to the departed-writer order without ranks when the evidence does not load", async () => {
    db.evidenceFails = true;
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Call evidence did not load");
    expect(order()).toEqual(["Cy Lapse", "Ann Able", "Dee Nophone", "Bob Buyer"]);
    expect(screen.queryByText("Number 1 in this list")).toBeNull();
  });

  it("marks resold with the new policy, from the card, and celebrates once the server saves it", async () => {
    renderPage();
    await screen.findByRole("listitem", { name: "Policy: Bob Buyer" });
    fireEvent.click(card("Bob Buyer").getByRole("button", { name: "Post deal (test)" }));
    await waitFor(() => expect(db.calls.find((c) => c.fn === "book_flip_set")?.args).toMatchObject({
      p_carrier: "Combined", p_policy_number: "P1", p_client_key: "k", p_status: "resold", p_resold_policy_number: "NEW1", p_resold_annual_premium: 600,
    }));
    await waitFor(() => expect(celebrated.kinds).toEqual(["win"]));
  });
});
