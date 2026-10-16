/**
 * Easy Resells (src/pages/EasyResells.tsx), 2026-10-16.
 *
 * Sam: every page was too much to crawl, and the easy resells ("everyone under Vantage") were
 * buried. These pin the list he starts the day on: easiest first, one line of why, one-tap call,
 * the Vantage cut across buckets, and marks that write to the same records the other pages read.
 */
import type { ReactNode } from "react";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ current: { user: { id: "sam" }, isAdmin: true } as { user: { id: string } | null; isAdmin: boolean } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth.current }));
vi.mock("@/components/deals/SubmitDealDialog", () => ({
  SubmitDealDialog: ({ trigger }: { trigger?: ReactNode }) => <>{trigger}</>,
}));

const db = vi.hoisted(() => ({ rows: [] as unknown[], calls: [] as Array<{ fn: string; args: unknown }> }));
vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: (fn: string, args?: unknown) => {
      db.calls.push({ fn, args });
      if (fn === "easy_resells") {
        return { range: (from: number, to: number) => Promise.resolve({ data: db.rows.slice(from, to + 1), error: null }) };
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
  flip_status: "to_call", callback_at: null, attempts: 0, last_touch_at: null, ...o,
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><EasyResells /></MemoryRouter></QueryClientProvider>);
}

beforeEach(() => {
  auth.current = { user: { id: "sam" }, isAdmin: true };
  db.calls = [];
  db.rows = [
    row({ item_key: "book:left", bucket: "agent_left", tier: 5, client_name: "Lee Left", phone: "6025550105" }),
    row({ item_key: "call:ready", bucket: "ready_to_finish", tier: 1, reason: "Gave SSN and bank on the call, and no deal was ever posted. Finish the application.",
      client_name: "Kathy Smith", phone: "6015551234", call_id: "call-1", flip_carrier: null, flip_policy_number: null, flip_client_key: null, flip_status: null,
      policy_status: "Sold on the call", event_at: "2026-10-12T17:00:00Z" }),
    row({ item_key: "book:van", bucket: "lapsing", tier: 2, reason: "Policy is lapsed. Save it, or rewrite it before it drops.", client_name: "Vic Vantage",
      phone: "6025550102", agent_name: "KJ Vaughn", agent_group: "Vantage", policy_status: "Lapsed", flip_policy_number: "P2", flip_client_key: "vic vantage" }),
  ];
});

describe("Easy Resells", () => {
  it("lists the easiest first, says why, and puts the number on a Call link", async () => {
    renderPage();
    const items = await screen.findAllByRole("listitem");
    expect(items.map((li) => li.getAttribute("aria-label"))).toEqual(["Resell: Kathy Smith", "Resell: Vic Vantage", "Resell: Lee Left"]);
    const first = within(items[0]);
    expect(first.getByText("Ready to finish")).toBeInTheDocument();
    expect(first.getByText(/no deal was ever posted/)).toBeInTheDocument();
    expect(first.getByRole("link", { name: /601/ })).toHaveAttribute("href", expect.stringContaining("6015551234"));
    expect(first.getByRole("link", { name: /Full call card/ })).toHaveAttribute("href", "/dashboard/sold-calls?call=call-1");
  });

  it("cuts everyone under Vantage across buckets", async () => {
    renderPage();
    await screen.findAllByRole("listitem");
    const chip = screen.getByRole("button", { name: /Everyone under Vantage/ });
    expect(chip).toHaveTextContent("1");
    fireEvent.click(chip);
    const items = screen.getAllByRole("listitem");
    expect(items).toHaveLength(1);
    expect(within(items[0]).getByText("Vantage")).toBeInTheDocument();
    expect(within(items[0]).getByText("Lapsing")).toBeInTheDocument();
  });

  it("marks a call with the Sold Calls status, and a book policy with the Book Flips status", async () => {
    renderPage();
    const items = await screen.findAllByRole("listitem");
    fireEvent.click(within(items[0]).getByRole("button", { name: "Contacted" }));
    await waitFor(() => expect(db.calls).toContainEqual({ fn: "sold_call_set_status", args: { p_call_id: "call-1", p_status: "contacted", p_note: null } }));
    fireEvent.click(within(items[1]).getByRole("button", { name: "No answer" }));
    await waitFor(() => expect(db.calls.find((c) => c.fn === "book_flip_set")?.args).toMatchObject({
      p_carrier: "Combined", p_policy_number: "P2", p_client_key: "vic vantage", p_status: "no_answer", p_count_attempt: true,
    }));
  });

  it("stays closed to anyone who is not an admin or Aisha", () => {
    auth.current = { user: { id: "someone" }, isAdmin: false };
    renderPage();
    expect(screen.getByText("This page is restricted.")).toBeInTheDocument();
    expect(db.calls.some((c) => c.fn === "easy_resells")).toBe(false);
  });
});
