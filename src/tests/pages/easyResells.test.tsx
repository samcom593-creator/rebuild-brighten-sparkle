/**
 * Easy Resells (src/pages/EasyResells.tsx), 2026-10-16; ranked by evidence since OVERHAUL-resells (2026-10-29).
 *
 * Sam: every page was too much to crawl, and the easy resells ("everyone under Vantage") were
 * buried. These pin the list he starts the day on: the most evidence first, one line of why, the chips
 * and points that explain the rank, one-tap call (gold on the first card only), the Vantage cut across
 * buckets, tiles that equal the list they open, and marks that write to the same records the other
 * pages read.
 */
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ current: { user: { id: "sam" }, isAdmin: true } as { user: { id: string } | null; isAdmin: boolean } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth.current }));
vi.mock("@/components/deals/SubmitDealDialog", () => ({
  // The real dialog posts a deal; the stand-in hands back a receipt so the page's own follow-up can be checked.
  SubmitDealDialog: ({ trigger, onPosted }: { trigger?: ReactNode; onPosted?: (r: { dealId: string; status: string; annualPaid: number; policyNumber: string }) => void }) => (
    <>{trigger}<button type="button" onClick={() => onPosted?.({ dealId: "d1", status: "submitted", annualPaid: 600, policyNumber: "NEW1" })}>Post deal (test)</button></>
  ),
}));
const celebrated = vi.hoisted(() => ({ kinds: [] as string[] }));
vi.mock("@/lib/celebrate", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/celebrate")>()),
  celebrate: async (kind: string) => { celebrated.kinds.push(kind); },
}));

const db = vi.hoisted(() => ({
  rows: [] as unknown[], evidence: [] as unknown[], evidenceFails: false, calls: [] as Array<{ fn: string; args: unknown }>,
  /** While set, an evidence read waits until the test calls it, to see what the page shows meanwhile. */
  holdEvidence: null as null | Promise<void>,
}));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args?: unknown) => {
      db.calls.push({ fn, args });
      if (fn === "easy_resells") {
        return { range: (from: number, to: number) => Promise.resolve({ data: db.rows.slice(from, to + 1), error: null }) };
      }
      if (fn === "resell_evidence") {
        return {
          range: async (from: number, to: number) => {
            if (db.holdEvidence) await db.holdEvidence;
            return db.evidenceFails
              ? { data: null, error: { message: "canceling statement due to statement timeout" } }
              : { data: db.evidence.slice(from, to + 1), error: null };
          },
        };
      }
      return Promise.resolve({ data: {}, error: null });
    },
  },
}));

import EasyResells from "@/pages/EasyResells";

const row = (o: Record<string, unknown>) => ({
  item_key: "k", bucket: "agent_left", tier: 5, reason: "Written by Ann Agent, who is no longer with Apex.",
  client_name: "Pat Doe", phone: "6025550101", state: "AZ", age_years: 70, carrier: "Combined", product: "Final expense",
  monthly_premium: 54.37, policy_status: "Active", agent_name: "Ann Agent", agent_group: null, event_at: "2026-05-01T00:00:00Z",
  call_id: null, work_status: null, flip_carrier: "Combined", flip_policy_number: "P1", flip_client_key: "pat doe",
  flip_status: "to_call", callback_at: null, attempts: 0, last_touch_at: null, dob: null, packet_id: null, ...o,
});
const ev = (o: Record<string, unknown>) => ({
  kind: "phone", match_key: "", dials: 0, answered: 0, last_answered_at: null, sold_calls: 0, last_sold_at: null, gave_ssn_and_bank: false, ...o,
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><EasyResells /></MemoryRouter></QueryClientProvider>);
}
const names = () => screen.getAllByRole("listitem", { name: /^Resell: / }).map((li) => li.getAttribute("aria-label"));
const card = (name: string) => within(screen.getByRole("listitem", { name: `Resell: ${name}` }));

beforeEach(() => {
  // Only the clock is fixed (the lapse chip counts months from the policy's start); timers stay real.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-29T19:00:00Z"));
  auth.current = { user: { id: "sam" }, isAdmin: true };
  db.calls = [];
  db.evidenceFails = false;
  db.holdEvidence = null;
  celebrated.kinds = [];
  db.rows = [
    row({ item_key: "book:left", bucket: "agent_left", tier: 5, client_name: "Lee Left", phone: "6025550105" }),
    row({ item_key: "call:ready", bucket: "ready_to_finish", tier: 1, reason: "Gave SSN and bank on the call, and no deal was ever posted. Finish the application.",
      client_name: "Kathy Smith", phone: "6015551234", call_id: "call-1", flip_carrier: null, flip_policy_number: null, flip_client_key: null, flip_status: null,
      policy_status: "Sold on the call", event_at: "2026-10-12T17:00:00Z", packet_id: "pk-1", dob: "1958-03-07" }),
    row({ item_key: "book:van", bucket: "lapsing", tier: 2, reason: "Policy is lapsed. Save it, or rewrite it before it drops.", client_name: "Vic Vantage",
      phone: "6025550102", agent_name: "KJ Vaughn", agent_group: "Vantage", policy_status: "Lapsed", flip_policy_number: "P2", flip_client_key: "vic vantage" }),
    row({ item_key: "call:warm", bucket: "warm_objection", tier: 6, reason: "Asked about covering the spouse. Did not buy (Social Objection).",
      client_name: "Wes Warm", phone: "6025550106", call_id: "call-9", agent_group: "Vantage", flip_carrier: null, flip_policy_number: null,
      flip_client_key: null, flip_status: null, policy_status: "Social Objection", event_at: "2026-10-01T17:00:00Z" }),
  ];
  db.evidence = [
    // Kathy: sold on the call, gave SSN and bank, answered: 40 + 30 + 15 = 85.
    ev({ match_key: "6015551234", dials: 1, answered: 1, last_answered_at: "2026-10-12T17:00:00Z", sold_calls: 1, last_sold_at: "2026-10-12T17:00:00Z", gave_ssn_and_bank: true }),
    // Wes: answered the objection call: 15. Lee: nothing on file. Vic: the lapse alone (started May 1, so within 6 months): 20.
    ev({ match_key: "6025550106", dials: 2, answered: 1, last_answered_at: "2026-10-01T17:00:00Z" }),
  ];
});
afterEach(() => { vi.useRealTimers(); });

describe("Easy Resells", () => {
  it("ranks the most evidence first, says why with points, and puts the number on a Call link", async () => {
    renderPage();
    await screen.findByRole("listitem", { name: "Resell: Kathy Smith" });
    // Wes answered a call (15 points), so he now sits above Lee, who has nothing on file.
    expect(names()).toEqual(["Resell: Kathy Smith", "Resell: Vic Vantage", "Resell: Wes Warm", "Resell: Lee Left"]);
    const first = card("Kathy Smith");
    expect(first.getByText("Ready to finish")).toBeInTheDocument();
    expect(first.getByText(/no deal was ever posted/)).toBeInTheDocument();
    expect(first.getByRole("link", { name: /601/ })).toHaveAttribute("href", expect.stringContaining("6015551234"));
    expect(first.getByRole("link", { name: /Full call card/ })).toHaveAttribute("href", "/dashboard/sold-calls?call=call-1");
    expect(first.getByText("Number 1 in this list")).toBeInTheDocument();
    expect(first.getByText("85")).toBeInTheDocument();
    const why = first.getByRole("list", { name: /^Why it ranks here/ });
    expect(within(why).getAllByRole("listitem").map((li) => li.textContent)).toEqual(["Gave SSN and bank+40", "Sold on a call Oct 12+30", "Answered Oct 12+15"]);
    expect(card("Vic Vantage").getByText("Lapsed within 6 months")).toBeInTheDocument();
    expect(card("Lee Left").getByText("No call evidence on file yet.")).toBeInTheDocument();
  });

  it("keeps one gold button on the screen: the first card's Call", async () => {
    const { container } = renderPage();
    await screen.findByRole("listitem", { name: "Resell: Kathy Smith" });
    const gold = [...container.querySelectorAll("a, button")].filter((e) => /(^|\s)bg-primary(\s|$)/.test(e.className));
    expect(gold.map((e) => e.textContent)).toEqual(["(601) 555-1234"]);
  });

  it("counts each kind of evidence on a tile that opens exactly those people", async () => {
    renderPage();
    await screen.findByRole("listitem", { name: "Resell: Kathy Smith" });
    const board = within(screen.getByRole("region", { name: "Why people rank high" }));
    const tile = (label: RegExp) => board.getByRole("button", { name: label });
    expect(tile(/Gave SSN and bank/)).toHaveTextContent("1");
    expect(tile(/Answers the phone/)).toHaveTextContent("2");
    fireEvent.click(tile(/Answers the phone/));
    expect(names()).toEqual(["Resell: Kathy Smith", "Resell: Wes Warm"]);
    // A chip counts with the tile on, so its number is what tapping it shows.
    expect(screen.getByRole("button", { name: /Warm calls/ })).toHaveTextContent("1");
    // The line above the list names the narrowing and offers the way back.
    expect(screen.getByRole("status")).toHaveTextContent("2 people, most evidence first · only Answers the phone");
    fireEvent.click(screen.getByRole("button", { name: "Show everyone" }));
    expect(names()).toHaveLength(4);
    fireEvent.click(tile(/Gave SSN and bank/));
    expect(names()).toEqual(["Resell: Kathy Smith"]);
    fireEvent.click(tile(/Gave SSN and bank/));
    expect(names()).toHaveLength(4);
  });

  it("cuts everyone under Vantage across buckets", async () => {
    renderPage();
    await screen.findByRole("listitem", { name: "Resell: Kathy Smith" });
    const chip = screen.getByRole("button", { name: /Everyone under Vantage/ });
    expect(chip).toHaveTextContent("2");
    fireEvent.click(chip);
    expect(names()).toEqual(["Resell: Vic Vantage", "Resell: Wes Warm"]);
    expect(card("Vic Vantage").getByText("Lapsing")).toBeInTheDocument();
    expect(card("Wes Warm").getByText("Warm call")).toBeInTheDocument();
    expect(card("Wes Warm").getByText("Vantage")).toBeInTheDocument();
  });

  it("says the evidence did not load and keeps the usual order without ranks, rather than ranking on nothing", async () => {
    db.evidenceFails = true;
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent("Call evidence did not load");
    expect(names()).toEqual(["Resell: Kathy Smith", "Resell: Vic Vantage", "Resell: Lee Left", "Resell: Wes Warm"]);
    expect(screen.queryByText("Number 1 in this list")).toBeNull();
    expect(screen.queryByText("No call evidence on file yet.")).toBeNull();
    const board = within(screen.getByRole("region", { name: "Why people rank high" }));
    expect(board.getByRole("button", { name: /Try again/ })).toBeInTheDocument();
    expect(board.queryByRole("button", { name: /Gave SSN and bank/ })).toBeNull();
  });

  it("marks a call with the Sold Calls status, and a book policy with the Book Flips status", async () => {
    renderPage();
    await screen.findByRole("listitem", { name: "Resell: Kathy Smith" });
    fireEvent.click(card("Kathy Smith").getByRole("button", { name: "Contacted" }));
    await waitFor(() => expect(db.calls).toContainEqual({ fn: "sold_call_set_status", args: { p_call_id: "call-1", p_status: "contacted", p_note: null } }));
    fireEvent.click(card("Vic Vantage").getByRole("button", { name: "No answer" }));
    await waitFor(() => expect(db.calls.find((c) => c.fn === "book_flip_set")?.args).toMatchObject({
      p_carrier: "Combined", p_policy_number: "P2", p_client_key: "vic vantage", p_status: "no_answer", p_count_attempt: true,
    }));
    // Marked rows update where they are instead of reloading and jumping: same order, new status line.
    await waitFor(() => expect(card("Kathy Smith").getByText(/^Contacted · /)).toBeInTheDocument());
    expect(card("Vic Vantage").getByText(/^No answer · /)).toBeInTheDocument();
    expect(names().slice(0, 2)).toEqual(["Resell: Kathy Smith", "Resell: Vic Vantage"]);
    expect(db.calls.filter((c) => c.fn === "easy_resells")).toHaveLength(1);
  });

  it("books the sale's packet with the new policy number on Resold, celebrates, then takes the person off the list", async () => {
    renderPage();
    await screen.findByRole("listitem", { name: "Resell: Kathy Smith" });
    let release = () => {};
    db.holdEvidence = new Promise<void>((resolve) => { release = resolve; });
    fireEvent.click(card("Kathy Smith").getByRole("button", { name: "Post deal (test)" }));
    await waitFor(() => expect(db.calls.map((c) => c.fn)).toEqual(expect.arrayContaining(["booking_packet_mark_booked", "sold_call_set_status"])));
    const booked = db.calls.findIndex((c) => c.fn === "booking_packet_mark_booked");
    const resold = db.calls.findIndex((c) => c.fn === "sold_call_set_status");
    expect(db.calls[booked].args).toEqual({ p_id: "pk-1", p_policy: "NEW1" });
    expect(db.calls[resold].args).toMatchObject({ p_call_id: "call-1", p_status: "resold" });
    expect(booked).toBeLessThan(resold);
    await waitFor(() => expect(screen.queryByRole("listitem", { name: "Resell: Kathy Smith" })).toBeNull());
    expect(celebrated.kinds).toEqual(["win"]);
    // The rest stay where they were, ranked, while the evidence is read again for the shorter list.
    await waitFor(() => expect(db.calls.filter((c) => c.fn === "resell_evidence")).toHaveLength(2));
    expect(names()).toEqual(["Resell: Vic Vantage", "Resell: Wes Warm", "Resell: Lee Left"]);
    expect(screen.queryByLabelText("Loading the resell list")).toBeNull();
    release();
  });

  it("asks the evidence about every number and name on the list, once", async () => {
    renderPage();
    await screen.findByRole("listitem", { name: "Resell: Kathy Smith" });
    const asks = db.calls.filter((c) => c.fn === "resell_evidence");
    expect(asks).toHaveLength(1);
    expect(asks[0].args).toEqual({
      p_phones: ["6015551234", "6025550102", "6025550105", "6025550106"],
      p_names: ["kathysmith", "leeleft", "vicvantage", "weswarm"],
    });
  });

  it("stays closed to anyone who is not an admin or Aisha", () => {
    auth.current = { user: { id: "someone" }, isAdmin: false };
    renderPage();
    expect(screen.getByText("This page is restricted.")).toBeInTheDocument();
    expect(db.calls.some((c) => c.fn === "easy_resells" || c.fn === "resell_evidence")).toBe(false);
  });
});
