/**
 * Lead Manager: every pool filters the same way, tiers explain themselves, and untouched leads can be taken back
 * (MP-LEAD-MANAGER-RM, 2026-11-24).
 *
 * Sam: "for all categories I should have the same options like filtering through state ... a description of each
 * lead type A, B, C, D ... move leads out of inboxes and remove them from people who aren't working them."
 * Before this the state and age filters existed on the Marketing pool only, the tier meanings sat behind an info
 * icon, and the only way to take leads back was pack by pack.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  calls: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  signed: [] as string[],
}));

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/integrations/supabase/client", () => {
  const rpc = (fn: string, args?: Record<string, unknown>) => {
    db.calls.push({ fn, args: args ?? {} });
    const ok = (data: unknown) => Promise.resolve({ data, error: null });
    switch (fn) {
      case "lead_pool_tiles":
        return ok({ marketing: { total: 195000, by_tier: { A: 70000, B: 39000, C: 65000, D: 20000 } }, dialer: { total: 380000, by_tier: { pos: 427, A: 1300, B: 430, F: 220000, C: 120000, D: 38000 } }, rewrite: { total: 213, by_tier: { S: 157 } }, winback: { total: 190, by_tier: { A: 62 } } });
      case "lead_pool_counts":
        return ok({ total: 1234, by_tier: { A: 10, F: 900 }, under_9mo: 0, dnc_excluded: 3, resold_excluded: 0, in_bundle_excluded: 0, sample: [], as_of: "2026-11-24T00:20:00Z" });
      case "lead_pool_assign": return ok({ items: 100, agent: "Chudi" });
      case "lead_pool_facets":
        return ok(args?.p_source === "dialer"
          ? { states: [{ k: "TX", n: 45000 }, { k: "FL", n: 30000 }], no_state: 12, campaigns: [{ k: "POS", n: 600 }, { k: "Veterans-A", n: 11000 }] }
          : { states: [{ k: "TX", n: 20000 }], no_state: 0, campaigns: [] });
      case "lead_assignable_agents":
        return ok([{ user_id: "u-chudi", agent_id: "a-1", display_name: "Chudi", subagency: null, is_live: true }, { user_id: "u-danon", agent_id: "a-2", display_name: "Danon", subagency: null, is_live: true }]);
      case "lead_holder_board":
        return ok([
          { user_id: "u-danon", name: "Danon", packs: 3, live_leads: 133, unworked: 130, worked: 3, follow_ups: 1, sold: 0, oldest_unworked_at: "2026-11-10T16:00:00Z", last_worked_at: "2026-11-17T17:00:00Z", last_sign_in_at: "2026-11-20T17:00:00Z", recordings: 0, paused: false },
          { user_id: "u-chudi", name: "Chudi", packs: 1, live_leads: 40, unworked: 0, worked: 40, follow_ups: 5, sold: 2, oldest_unworked_at: null, last_worked_at: "2026-11-23T17:00:00Z", last_sign_in_at: "2026-11-23T15:00:00Z", recordings: 4, paused: false },
        ]);
      case "lead_pull_back":
        return ok({ pulled: 130, shared_packs_revoked: 0, paused: true });
      case "lead_recordings_recent":
        return ok([{ id: "r-1", created_at: "2026-11-23T20:00:00Z", path: "callcenter/2026-11-23/a.webm", summary: "Wants a call back Friday", sentiment: "positive", agent: "Chudi", lead_name: "Paul Smith", state: "OR", tier: "F", status: "callback" }]);
      default:
        return ok([]);
    }
  };
  return {
    supabase: {
      rpc,
      auth: {
        getSession: () => Promise.resolve({ data: { session: { expires_at: Math.floor(Date.now() / 1000) + 3600 } } }),
        refreshSession: () => Promise.resolve({ data: {}, error: null }),
      },
      storage: { from: () => ({ createSignedUrl: (path: string) => { db.signed.push(path); return Promise.resolve({ data: { signedUrl: `https://signed.example/${path}` }, error: null }); } }) },
    },
  };
});

import LeadManager from "@/pages/LeadManager";

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><LeadManager /></MemoryRouter></QueryClientProvider>);
}
const lastCounts = () => [...db.calls].reverse().find((c) => c.fn === "lead_pool_counts");

describe("Lead Manager pools", () => {
  beforeAll(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
    HTMLElement.prototype.scrollIntoView = vi.fn();
  });
  afterAll(() => vi.unstubAllGlobals());
  beforeEach(() => { db.calls.length = 0; db.signed.length = 0; localStorage.clear(); });

  it("shows what every tier means without a tap, for the pool on screen", async () => {
    renderPage();
    const legend = await screen.findByTestId("tier-legend");
    expect(within(legend).getByText(/A-list purchased lead/)).toBeTruthy();
    expect(within(legend).getAllByRole("listitem")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: /Dialer/ }));
    await waitFor(() => expect(within(screen.getByTestId("tier-legend")).getByText(/never called yet/)).toBeTruthy());
    const dialer = within(screen.getByTestId("tier-legend")).getAllByRole("listitem").map((li) => li.textContent ?? "");
    expect(dialer).toHaveLength(6);
    expect(dialer.some((t) => t.startsWith("POS"))).toBe(true);
    expect(dialer.some((t) => t.startsWith("Fresh"))).toBe(true);
  });

  it("offers the state and age filters on every pool, and the campaign filter where the pool has campaigns", async () => {
    renderPage();
    await screen.findByTestId("tier-legend");
    for (const pool of ["Marketing", "Dialer", "Re-write pile", "Win-back"]) {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(pool) }));
      expect(screen.getByRole("combobox", { name: "States" })).toBeTruthy();
      expect(screen.getAllByPlaceholderText("Any")).toHaveLength(2);
    }
    expect(screen.queryByRole("combobox", { name: "Campaigns" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /Dialer/ }));
    expect(await screen.findByRole("combobox", { name: "Campaigns" })).toBeTruthy();
  });

  it("sends an age filter typed on the Dialer pool to the server (it used to be dropped off Marketing)", async () => {
    renderPage();
    await screen.findByTestId("tier-legend");
    fireEvent.click(screen.getByRole("button", { name: /Dialer/ }));
    fireEvent.change(screen.getAllByPlaceholderText("Any")[0], { target: { value: "50" } });
    await waitFor(() => {
      const c = lastCounts();
      expect(c?.args.p_source).toBe("dialer");
      expect((c?.args.p_filters as Record<string, unknown>).min_age).toBe(50);
    }, { timeout: 2500 });
  });

  it("lists who is sitting on untouched leads, worst first, and takes them back only after a second tap", async () => {
    renderPage();
    const board = await screen.findByTestId("holder-board");
    const rows = await within(board).findAllByTestId("holder-row");
    // Chudi has touched everything, so only Danon is listed until "show everyone" is tapped
    expect(rows).toHaveLength(1);
    expect(rows[0].textContent).toContain("Danon");
    expect(rows[0].textContent).toContain("130 untouched of 133");
    fireEvent.click(within(rows[0]).getByRole("button", { name: /Take back 130 untouched/ }));
    expect(db.calls.some((c) => c.fn === "lead_pull_back")).toBe(false);
    fireEvent.click(within(rows[0]).getByRole("button", { name: /Yes, take back 130/ }));
    await waitFor(() => expect(db.calls.find((c) => c.fn === "lead_pull_back")?.args).toEqual({ p_user: "u-danon", p_pause: true }));
    fireEvent.click(within(board).getByRole("button", { name: /Show everyone holding leads \(2\)/ }));
    expect(within(board).getAllByTestId("holder-row")).toHaveLength(2);
  });

  it("lists calls recorded from lead cards and opens one through a signed link", async () => {
    renderPage();
    const card = await screen.findByTestId("lead-recordings");
    expect(await within(card).findByText(/Wants a call back Friday/)).toBeTruthy();
    fireEvent.click(within(card).getByRole("button", { name: /Play/ }));
    await waitFor(() => expect(db.signed).toEqual(["callcenter/2026-11-23/a.webm"]));
  });

  it("uses the exact work-filter preview for assignment and waits out the debounce", async () => {
    renderPage();
    fireEvent.click(await screen.findByRole("combobox", { name: /Pick an agent/ }));
    fireEvent.click(await screen.findByRole("option", { name: "Chudi" }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Drop 100 into Chudi/ })).not.toBeDisabled());
    fireEvent.change(screen.getByLabelText("Last caller"), { target: { value: "Caller One" } });
    fireEvent.change(screen.getByLabelText("Minimum attempts"), { target: { value: "2" } });
    fireEvent.change(screen.getByLabelText("Callback due by"), { target: { value: "2026-11-24" } });
    expect(screen.getByRole("button", { name: /Drop 100 into Chudi/ })).toBeDisabled();
    await waitFor(() => expect(lastCounts()?.args.p_filters).toMatchObject({ caller: "Caller One", min_attempts: 2, callback_before: "2026-11-24", exclude_dnc: true, exclude_resold: true }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Drop 100 into Chudi/ })).not.toBeDisabled());
    const preview = lastCounts()?.args.p_filters;
    fireEvent.click(screen.getByRole("button", { name: /Drop 100 into Chudi/ }));
    await waitFor(() => expect(db.calls.find((call) => call.fn === "lead_pool_assign")?.args.p_filters).toEqual(preview));
    expect(screen.getByRole("link", { name: "Import consumers" })).toHaveAttribute("href", "/dashboard/consumer-import");
    expect(screen.queryByText("Hold back Do-Not-Call")).toBeNull();
  });

});
