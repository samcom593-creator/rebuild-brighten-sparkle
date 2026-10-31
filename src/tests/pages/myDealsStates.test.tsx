/**
 * Book of Business, Where to buy leads (OVERHAUL-states, 2026-10-30), rendered against a stubbed book.
 *
 * Sam: "show what states I should get, in order: where most of our deals are coming from". The panel is for
 * the full-book readers; every state opens the book filtered to it, and the list and its count read the same
 * client_state filter, so a state's number is the list it opens. The policies with no state are their own row.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";
import type { UseAgentIdentityResult } from "@/hooks/useAgentIdentity";
import type { ResolvedDownline } from "@/hooks/useResolvedDownline";
import type { AgentIdentityRow } from "@/lib/agentIdentity";

const auth = vi.hoisted(() => ({ current: { user: { id: "user-1" }, isAdmin: true, isManager: false } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth.current }));
const identity = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/hooks/useAgentIdentity", () => ({ useAgentIdentity: () => identity.current }));
const downline = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/hooks/useResolvedDownline", () => ({ useResolvedDownline: () => downline.current }));
vi.mock("@/components/deals/SubmitDealDialog", () => ({
  SubmitDealDialog: ({ trigger }: { trigger?: ReactNode }) => <>{trigger ?? <button type="button">Post a Deal (default)</button>}</>,
}));
vi.mock("@/hooks/useSoldCallKeys", () => ({
  SOLD_CALL_EXTRA_UID: "aisha",
  useSoldCallKeys: () => ({ ready: true, count: 0, has: () => false }),
}));
vi.mock("@/hooks/useSoundEffects", () => ({ playSoundEffect: vi.fn() }));

import MyDeals from "@/pages/MyDeals";

type Chain = {
  table: string;
  select?: string;
  options?: { count?: string; head?: boolean };
  ins: Array<[string, unknown]>;
  eqs: Array<[string, unknown]>;
  nots: Array<[string, string, unknown]>;
  iss: Array<[string, unknown]>;
};

const requests: Chain[] = [];

// 20 policies: 8 in Texas (3 with the state on file), 6 in Ohio, 6 with no state (2 of them agency totals).
type Row = {
  row_key: string; origin: string; agent_id: string; agent_name: string; client_name: string | null; carrier: string;
  product: string; policy_number: string | null; annual_premium: number; posted_date: string; effective_date: null;
  status: string; status_key: string; standing: string; synced_at: string; client_state: string | null; client_state_source: string | null;
};
const STATUS = [["active", "Active", "active"], ["issued_not_paid", "Issued, Not Paid", "pending"], ["lapsed", "Lapsed", "lapsing"], ["declined", "Declined", "gone"], ["unknown", "Unknown", "unknown"]] as const;
// Posted in the last few weeks, counted from the day the test runs, so the 30 and 90 day windows never age.
const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
function row(i: number, state: string | null, source: string | null, s: number, client = true): Row {
  const [status_key, status, standing] = STATUS[s];
  return {
    row_key: `r${String(i).padStart(3, "0")}`, origin: client ? "agentlink" : "agentcloud_producer", agent_id: "agent-1", agent_name: "Test Agent",
    client_name: client ? `Client${i} Last${i}` : null, carrier: "Carrier", product: "Term", policy_number: client ? `P${i}` : null,
    annual_premium: 1000 + i, posted_date: daysAgo(i + 1), effective_date: null,
    status, status_key, standing, synced_at: "2026-10-15T12:00:00Z", client_state: state, client_state_source: source,
  };
}
const book: Row[] = [
  ...[0, 0, 0, 1, 2, 3, 0, 4].map((s, i) => row(i, "TX", i < 3 ? "on_file" : "area_code", s)),
  ...[0, 0, 1, 4, 4, 3].map((s, i) => row(8 + i, "OH", "area_code", s)),
  ...[0, 4, 4, 4].map((s, i) => row(14 + i, null, null, s)),
  row(18, null, null, 4, false),
  row(19, null, null, 4, false),
];

function filtered(chain: Chain) {
  return book.filter((d) => {
    for (const [col, value] of chain.eqs) if ((d as Record<string, unknown>)[col] !== value) return false;
    for (const [col, value] of chain.iss) if (value === null && (d as Record<string, unknown>)[col] !== null) return false;
    for (const [col, op, value] of chain.nots) {
      if (col === "standing" && op === "in" && String(value).replace(/[()]/g, "").split(",").includes(d.standing)) return false;
    }
    return true;
  });
}

function chainFor(table: string) {
  const chain: Chain = { table, ins: [], eqs: [], nots: [], iss: [] };
  const builder: Record<string, unknown> = {
    select: (columns: string, options?: Chain["options"]) => { chain.select = columns; chain.options = options; return builder; },
    order: () => builder,
    limit: () => builder,
    in: (c: string, v: unknown) => { chain.ins.push([c, v]); return builder; },
    or: () => builder,
    eq: (c: string, v: unknown) => { chain.eqs.push([c, v]); return builder; },
    not: (c: string, op: string, v: unknown) => { chain.nots.push([c, op, v]); return builder; },
    is: (c: string, v: unknown) => { chain.iss.push([c, v]); return builder; },
    maybeSingle: () => builder,
    then: (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) => {
      requests.push(chain);
      let answer: { data?: unknown; count?: number | null; error?: unknown } = { data: [] };
      if (table === "v_book_of_business") {
        const rows = filtered(chain);
        answer = chain.options?.head ? { count: rows.length } : { data: rows, count: rows.length };
      }
      return Promise.resolve({ data: answer.data ?? null, error: answer.error ?? null, count: answer.count ?? null }).then(onFulfilled, onRejected);
    },
  };
  return builder;
}

const today = new Date();
/** book_state_summary() over the stub book, the way the database counts it. */
function summaryOf(rows: Row[]) {
  const by = new Map<string, Row[]>();
  for (const r of rows) by.set(r.client_state ?? "~", [...(by.get(r.client_state ?? "~") ?? []), r]);
  const days = (d: string) => Math.floor((today.getTime() - new Date(`${d}T12:00:00`).getTime()) / 864e5);
  return [...by.entries()].map(([k, rs]) => ({
    state: k === "~" ? null : k,
    policies: rs.length,
    on_file: rs.filter((r) => r.client_state_source === "on_file").length,
    clients: rs.filter((r) => r.client_name).length,
    annual_premium: rs.reduce((a, r) => a + r.annual_premium, 0),
    premium_policies: rs.length,
    active: rs.filter((r) => r.standing === "active").length,
    pending: rs.filter((r) => r.standing === "pending").length,
    lapsing: rs.filter((r) => r.standing === "lapsing").length,
    gone: rs.filter((r) => r.standing === "gone").length,
    no_status: rs.filter((r) => r.standing === "unknown").length,
    last_30_days: rs.filter((r) => days(r.posted_date) < 30).length,
    last_90_days: rs.filter((r) => days(r.posted_date) < 90).length,
    prior_90_days: 0,
    licensed_agents: 0,
    active_writers: k === "~" ? 0 : 1,
    no_client: rs.filter((r) => !r.client_name).length,
  }));
}
function countsOf(rows: Row[]) {
  const m = new Map<string, number>();
  for (const d of rows) m.set(`${d.standing}|${d.status_key}`, (m.get(`${d.standing}|${d.status_key}`) ?? 0) + 1);
  return [...m.entries()].map(([k, n]) => ({ standing: k.split("|")[0], status_key: k.split("|")[1], n }));
}
const YIELD = [
  { state: "TX", leads_bought: 11164, never_called: 8253, leads_dialed: 5949, dialed_sales: 48, area_checked: 11000, area_matched: 9500, calls_since: "2026-04-01", lists_loaded: "2026-08-04" },
  { state: "OH", leads_bought: 5052, never_called: 3641, leads_dialed: 3741, dialed_sales: 50, area_checked: 5000, area_matched: 4300, calls_since: "2026-04-01", lists_loaded: "2026-08-04" },
];

type RpcHandler = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> | undefined;
let rpcOverride: RpcHandler = () => undefined;
const rpcCalls = () => vi.mocked(supabase.rpc).mock.calls.map((c) => String(c[0]));

const AGENT_ROW: AgentIdentityRow = {
  id: "agent-1", user_id: "user-1", agent_code: "AGT1", display_name: "Test Agent", status: "active",
  is_inactive: false, is_deactivated: false, created_at: "2026-01-01T00:00:00Z", canonical_agent_id: null,
};

let lastSearch = "";
function LocationProbe() {
  lastSearch = useLocation().search;
  return null;
}
function renderPage(path = "/dashboard/production") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <MyDeals />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
const lastListRead = () => requests.filter((c) => c.table === "v_book_of_business" && c.select === "*" && !c.eqs.some(([col]) => col === "row_key")).at(-1);
const lastHeadCount = () => requests.filter((c) => c.table === "v_book_of_business" && c.options?.head).at(-1);
const panel = () => screen.getByRole("heading", { name: "Where to buy leads" }).closest(".apex-card") as HTMLElement;

const writeText = vi.fn(async () => undefined);

beforeEach(() => {
  requests.length = 0;
  auth.current = { user: { id: "user-1" }, isAdmin: true, isManager: false };
  identity.current = {
    identity: { status: "resolved", agentId: "agent-1", row: AGENT_ROW }, agentId: "agent-1",
    isLoading: false, isError: false, refetch: vi.fn(), userId: "user-1",
  } satisfies UseAgentIdentityResult;
  downline.current = { ids: undefined, isWaiting: false, isError: false, error: null, refetch: vi.fn(), source: "none" } satisfies ResolvedDownline;
  rpcOverride = () => undefined;
  vi.mocked(supabase.from).mockClear();
  vi.mocked(supabase.rpc).mockClear();
  vi.mocked(supabase.from).mockImplementation(((table: string) => chainFor(table)) as never);
  vi.mocked(supabase.rpc).mockImplementation(((fn: string, args: Record<string, unknown>) => {
    const custom = rpcOverride(fn, args);
    if (custom) return custom;
    if (fn === "book_of_business_counts") return Promise.resolve({ data: countsOf(book), error: null });
    if (fn === "book_state_summary") return Promise.resolve({ data: summaryOf(book), error: null });
    if (fn === "lead_state_yield") return Promise.resolve({ data: YIELD, error: null });
    return Promise.resolve({ data: [], error: null });
  }) as never);
  writeText.mockClear();
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
  try { window.localStorage.clear(); } catch { /* jsdom always has storage */ } // empty-catch-allow:test-storage
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Where to buy leads", () => {
  it("shows the full-book reader the states to buy, and Copy order puts the plain list on the clipboard", async () => {
    renderPage();
    const buy = await screen.findByRole("list", { name: "States to buy and how many leads" }, { timeout: 5000 });
    const chips = within(buy).getAllByRole("button");
    // Both states have fewer than 10 policies decided, so both use the agency's share: the split is 8 : 6.
    expect(chips.map((b) => b.textContent)).toEqual(["TX57", "OH43"]);
    fireEvent.click(within(panel()).getByRole("button", { name: /Copy order/ }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("TX 57, OH 43"));
    expect(await within(panel()).findByRole("button", { name: /Copied/ })).toBeInTheDocument();
    // The split's math is on the page, worked for the first state (agency: 7 active of 10 decided).
    expect(within(panel()).getByText("TX: 8 deals × 70% (agency) = 5.6 of 9.8 → 57 of 100")).toBeInTheDocument();
  });

  it("adds up to the book: the states and the not-known row are every policy the board counts", async () => {
    renderPage();
    expect(await within(panel()).findAllByText("The same total as the board above.", undefined, { timeout: 5000 })).not.toHaveLength(0);
    // How each state is known is said, with the agency totals that can never have a state.
    expect(within(panel()).getByText(/3 on file .*; 11 likely, by the phone's area code/)).toBeInTheDocument();
    expect(within(panel()).getByText(/6 not known \(2 reported as agency totals with no client\)/)).toBeInTheDocument();
  });

  it("opens a state: the list and its count both read the state, the URL keeps it, and the state's standings are chips", async () => {
    renderPage();
    const buy = await screen.findByRole("list", { name: "States to buy and how many leads" }, { timeout: 5000 });
    fireEvent.click(within(buy).getByRole("button", { name: /TX/ }));
    await waitFor(() => expect(lastSearch).toBe("?state=TX"));
    await waitFor(() => expect(lastListRead()?.eqs).toEqual([["client_state", "TX"]]));
    expect(lastHeadCount()?.eqs).toEqual([["client_state", "TX"]]);
    const listCard = (await screen.findByRole("heading", { name: "Texas" })).closest(".apex-card") as HTMLElement;
    expect(await within(listCard).findByText("8 policies")).toBeInTheDocument();
    expect(screen.getByText("3 with the state on file; the other 5 are likely Texas, by the phone's area code.")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Client8 Last8")).not.toBeInTheDocument());

    // Inside the state, one standing: both filters reach the list and the count.
    const standings = screen.getByRole("group", { name: "Texas by standing" });
    expect(within(standings).getByRole("button", { name: /All\s*8/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(within(standings).getByRole("button", { name: /Active\s*4/ }));
    await waitFor(() => expect(lastSearch).toBe("?state=TX&standing=active"));
    await waitFor(() => expect(lastListRead()?.eqs).toEqual([["standing", "active"], ["client_state", "TX"]]));
    expect(lastHeadCount()?.eqs).toEqual([["standing", "active"], ["client_state", "TX"]]);
    expect(await within(listCard).findByText("4 policies")).toBeInTheDocument();

    // Show every state goes back to the whole book.
    fireEvent.click(screen.getByRole("button", { name: "Show every state" }));
    await waitFor(() => expect(lastSearch).toBe("?standing=active"));
  });

  it("lists the policies with no state known as their own part of the book", async () => {
    renderPage("/dashboard/production?state=unknown");
    await waitFor(() => expect(lastListRead()?.iss).toEqual([["client_state", null]]), { timeout: 5000 });
    expect(lastHeadCount()?.iss).toEqual([["client_state", null]]);
    expect(await screen.findByText("6 policies")).toBeInTheDocument();
    expect(screen.getByText(/2 reported as agency totals with no client; the other 4 have no state on file/)).toBeInTheDocument();
  });

  it("leaves the state behind when a tile is chosen: the four tiles count the whole book", async () => {
    renderPage("/dashboard/production?state=OH");
    await waitFor(() => expect(lastListRead()?.eqs).toEqual([["client_state", "OH"]]), { timeout: 5000 });
    const board = screen.getByRole("region", { name: "Who is on the books" });
    // Under a state no tile reads as chosen, so a tile's number never sits beside a list it does not count.
    await waitFor(() => expect(within(board).getByRole("button", { name: /Active/ })).toHaveAttribute("aria-pressed", "false"));
    fireEvent.click(within(board).getByRole("button", { name: /Lapsing/ }));
    await waitFor(() => expect(lastSearch).toBe("?standing=lapsing"));
    await waitFor(() => expect(lastListRead()?.eqs).toEqual([["standing", "lapsing"]]));
  });

  it("shows the lead lists in the Leads view, and a failed lead read keeps the deals and says so", async () => {
    rpcOverride = (fn) => (fn === "lead_state_yield" ? Promise.resolve({ data: null, error: { message: "Only the full-book readers can read the lead lists." } }) : undefined);
    renderPage();
    await screen.findByRole("list", { name: "States to buy and how many leads" }, { timeout: 5000 });
    fireEvent.click(within(panel()).getByRole("button", { name: "Leads" }));
    expect(await within(panel()).findByText(/The lead lists did not load: Only the full-book readers can read the lead lists/)).toBeInTheDocument();
    expect(within(panel()).getByRole("button", { name: "Try again" })).toBeInTheDocument();
    // The deals view is untouched.
    fireEvent.click(within(panel()).getByRole("button", { name: "Deals" }));
    expect(within(panel()).getAllByText("Texas").length).toBeGreaterThan(0);
  });

  it("costs a sale at the price typed, from the dialed leads and the sales", async () => {
    renderPage();
    await screen.findByRole("list", { name: "States to buy and how many leads" }, { timeout: 5000 });
    fireEvent.click(within(panel()).getByRole("button", { name: "Leads" }));
    fireEvent.change(within(panel()).getByLabelText("Price per lead"), { target: { value: "0.40" } });
    // Texas: $0.40 x 5,949 dialed / 48 sales = $49.58 -> $50 a sale.
    expect((await within(panel()).findAllByText(/\$50 a sale/)).length).toBeGreaterThan(0);
  });

  it("is not on the page for an agent, and nothing asks for the states or the lead lists", async () => {
    auth.current = { user: { id: "user-1" }, isAdmin: false, isManager: false };
    renderPage();
    expect(await screen.findByText("Client0 Last0", undefined, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Where to buy leads" })).not.toBeInTheDocument();
    expect(rpcCalls()).not.toContain("book_state_summary");
    expect(rpcCalls()).not.toContain("lead_state_yield");
    // A shared ?state= link still narrows an agent's own list the same way.
    const second = renderPage("/dashboard/production?state=TX");
    await waitFor(() => expect(lastListRead()?.eqs).toEqual([["client_state", "TX"]]));
    second.unmount();
  });
});
