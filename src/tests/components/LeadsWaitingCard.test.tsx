/** LeadsWaitingCard (MP-BEST-3, 2026-11-19): Home says when leads are waiting, and says nothing when none are. */
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ reply: { data: [] as unknown, error: null as unknown } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: () => Promise.resolve(db.reply) } }));

import { LeadsWaitingCard } from "@/components/dashboard/LeadsWaitingCard";
import { leadsWaitingSummary } from "@/lib/myLeads";

const row = (n: number, status: string, callable_now: boolean | null = true) => ({ item_id: `i-${n}`, status, callable_now });
function renderCard() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><LeadsWaitingCard /></MemoryRouter></QueryClientProvider>);
}

describe("leadsWaitingSummary", () => {
  it("counts what still needs a call, splits out call backs and never-called, and holds back closed hours", () => {
    const w = leadsWaitingSummary([
      row(1, "new"), row(2, "new"), row(3, "callback"), row(4, "appointment"), row(5, "no_answer"),
      row(6, "new", false), row(7, "sold"), row(8, "not_interested"), row(9, "do_not_call"), row(10, "bad_number"),
    ]);
    expect(w).toEqual({ open: 6, toCall: 5, callbacks: 0, neverCalled: 2, closedHours: 1, scheduled: 0, followupsWithoutTime: 2, held: 0 });
  });
  it("treats a row with no calling-hours verdict as workable, as My Leads does", () => {
    expect(leadsWaitingSummary([{ item_id: "x", status: "new" }]).toCall).toBe(1);
  });
});

describe("LeadsWaitingCard", () => {
  beforeEach(() => { db.reply = { data: [], error: null }; });

  it("renders nothing for someone holding no leads", async () => {
    const { container } = renderCard();
    await waitFor(() => expect(container.querySelector('[data-testid="leads-waiting"]')).toBeNull());
    expect(container.textContent).toBe("");
  });

  it("renders nothing when every lead has been worked", async () => {
    db.reply = { data: [row(1, "sold"), row(2, "not_interested")], error: null };
    const { container } = renderCard();
    await new Promise((r) => setTimeout(r, 20));
    expect(container.textContent).toBe("");
  });

  it("says how many to call, warm ones first, and links to My Leads", async () => {
    db.reply = { data: [row(1, "new"), row(2, "new"), row(3, "callback"), row(4, "no_answer"), row(5, "new", false)], error: null };
    renderCard();
    const card = await screen.findByTestId("leads-waiting");
    expect(card.textContent).toContain("4 leads to work");
    expect(card.textContent).toContain("1 follow-up needs an agreed time · 2 awaiting a first outcome · 1 more open later");
    expect(screen.getByRole("link", { name: /Work my leads/ }).getAttribute("href")).toBe("/dashboard/my-leads");
  });

  it("says calling hours are closed when leads are held but none can be called right now", async () => {
    db.reply = { data: [row(1, "new", false)], error: null };
    renderCard();
    const card = await screen.findByTestId("leads-waiting");
    expect(card.textContent).toContain("Calling hours are closed for your 1 lead");
    expect(screen.getByRole("link", { name: /See my leads/ })).toBeTruthy();
  });

  it("a failed read says so instead of passing for no leads", async () => {
    db.reply = { data: null, error: { message: "boom" } };
    renderCard();
    expect((await screen.findByTestId("leads-waiting-error")).textContent).toContain("Your leads did not load");
  });

  it("shows a future-only queue as scheduled rather than closed hours or due work", async () => {
    db.reply = { data: [{ ...row(1, "callback"), attrs: { callback_at: "2099-11-28T12:00:00Z" } }], error: null };
    renderCard();
    const card = await screen.findByTestId("leads-waiting");
    expect(card).toHaveTextContent("1 lead scheduled for later");
    expect(card).not.toHaveTextContent("Calling hours are closed");
    expect(card).not.toHaveTextContent("follow-ups due");
  });
});
