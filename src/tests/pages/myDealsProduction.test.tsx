/**
 * Production page (src/pages/MyDeals.tsx) rendered against a stubbed book,
 * for the 2026-10-15 review of the Galaxy OS production cluster.
 *
 * F09: the server answers fewer rows than .limit() asks (1,000 of 1,373 live),
 * so "Load more" must follow the server's count, not the page length. Here
 * the stub cuts page 1 short at 30 of 45 rows the same way.
 * F10 / F17: a manager whose team list fails sees that error, never their own
 * deals as the team's and never "No deals logged yet".
 * F11: a manager's tiles are counted in the list's scope.
 * F37: the header's Post a Deal hides at lg, where the shell rail carries one.
 * MP-304: a client with a sold call shows the packet panel on the row itself.
 * 2026-10-16: every client row shows phone (Call), date of birth and state, and a Resold button.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";
import type { UseAgentIdentityResult } from "@/hooks/useAgentIdentity";
import type { ResolvedDownline } from "@/hooks/useResolvedDownline";
import type { AgentIdentityRow } from "@/lib/agentIdentity";
import { STATUS_BUCKETS, dealsPageCursorFilter, statusBucketFilter } from "@/lib/productionBook";

const auth = vi.hoisted(() => ({ current: { user: { id: "user-1" }, isAdmin: true, isManager: false } }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth.current }));
const identity = vi.hoisted(() => ({ current: null as unknown }));
vi.mock("@/hooks/useAgentIdentity", () => ({ useAgentIdentity: () => identity.current }));
const downline = vi.hoisted(() => ({ current: null as unknown, calls: [] as unknown[][] }));
vi.mock("@/hooks/useResolvedDownline", () => ({
  useResolvedDownline: (...args: unknown[]) => {
    downline.calls.push(args);
    return downline.current;
  },
}));
vi.mock("@/hooks/useBusinessToday", () => ({ useBusinessToday: () => "2026-10-15" }));
vi.mock("@/components/deals/SubmitDealDialog", () => ({
  SubmitDealDialog: ({ trigger }: { trigger?: ReactNode }) => <>{trigger ?? <button type="button">Post a Deal (default)</button>}</>,
}));
const soldKeys = vi.hoisted(() => ({ names: new Set<string>() }));
vi.mock("@/hooks/useSoldCallKeys", () => ({
  SOLD_CALL_EXTRA_UID: "aisha",
  useSoldCallKeys: () => ({
    ready: true,
    count: soldKeys.names.size,
    has: (_phone?: string | null, first?: string | null, last?: string | null) => soldKeys.names.has(`${first ?? ""}|${last ?? ""}`),
  }),
}));
vi.mock("@/components/clients/SoldCallPanel", () => ({
  SoldCallPanel: ({ firstName, lastName }: { firstName?: string | null; lastName?: string | null }) => (
    <div data-testid="sold-call-panel">{`${firstName ?? ""}|${lastName ?? ""}`}</div>
  ),
}));

import MyDeals from "@/pages/MyDeals";

type Chain = {
  table: string;
  select?: string;
  options?: { count?: string; head?: boolean };
  ors: string[];
  ins: Array<[string, unknown]>;
  eqs: Array<[string, unknown]>;
  limit?: number;
};
type Answer = { data?: unknown; error?: unknown; count?: number | null };

const requests: Chain[] = [];
let respond: (chain: Chain) => Answer = () => ({ data: null, error: { message: "no stub" } });

function chainFor(table: string) {
  const chain: Chain = { table, ors: [], ins: [], eqs: [] };
  const builder: Record<string, unknown> = {
    select: (columns: string, options?: Chain["options"]) => {
      chain.select = columns;
      chain.options = options;
      return builder;
    },
    order: () => builder,
    limit: (n: number) => {
      chain.limit = n;
      return builder;
    },
    in: (column: string, values: unknown) => {
      chain.ins.push([column, values]);
      return builder;
    },
    or: (filter: string) => {
      chain.ors.push(filter);
      return builder;
    },
    eq: (column: string, value: unknown) => {
      chain.eqs.push([column, value]);
      return builder;
    },
    maybeSingle: () => builder,
    then: (onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) => {
      requests.push(chain);
      const answer = respond(chain);
      return Promise.resolve({ data: answer.data ?? null, error: answer.error ?? null, count: answer.count ?? null }).then(onFulfilled, onRejected);
    },
  };
  return builder;
}

const deal = (i: number) => ({
  row_key: `r${String(i).padStart(4, "0")}`,
  origin: "agentlink",
  agent_id: "agent-1",
  agent_name: "Test Agent",
  client_name: `Client${i} Last${i}`,
  carrier: "Carrier",
  product: "Term",
  policy_number: `P${i}`,
  annual_premium: 1000 + i,
  posted_date: `2026-${String(10 - Math.floor(i / 28)).padStart(2, "0")}-${String(28 - (i % 28)).padStart(2, "0")}`,
  effective_date: null,
  status: "Active",
  synced_at: "2026-10-15T12:00:00Z",
});
const book = Array.from({ length: 45 }, (_, i) => deal(i));
const PAGE_ONE = 30; // the stub's server cap, standing in for PostgREST's 1,000

const bookTruth = {
  premium_30d: 0, deals_30d: 0, premium_prior_30d: 0, premium_this_month: 0, deals_this_month: 0,
  total_annual_premium: 47_000, total_deals: 45,
};
const agencies = [
  { agency: "APEX Financial", is_primary: true, policies: 40, alp: 40_000, alp_mtd: 2_000, policies_mtd: 2, policies_30d: 4, alp_30d: 4_000 },
  { agency: "Vantage Financial", is_primary: false, policies: 5, alp: 7_000, alp_mtd: 0, policies_mtd: 0, policies_30d: 1, alp_30d: 900 },
];
const teamCounts: Record<string, number> = { active: 7, in_review: 2, carrier_na: 3 };

function bookResponder(overrides: { pages?: (chain: Chain) => Answer } = {}) {
  return (chain: Chain): Answer => {
    switch (chain.table) {
      case "v_production_unified": {
        if (chain.options?.head) {
          const bucket = STATUS_BUCKETS.find((b) => chain.ors.includes(statusBucketFilter(b)));
          return { count: bucket ? teamCounts[bucket] ?? 0 : book.length };
        }
        if (chain.eqs.length) return { data: book.filter((d) => d.row_key === chain.eqs[0][1]) };
        if (overrides.pages) return overrides.pages(chain);
        const isPageTwo = chain.ors.some((f) => f.includes("posted_date.lt."));
        if (isPageTwo) return { data: book.slice(PAGE_ONE), count: book.length - PAGE_ONE };
        return { data: book.slice(0, PAGE_ONE), count: book.length };
      }
      case "v_agentlink_book_truth":
        return { data: bookTruth };
      case "v_book_status_tiles":
        return { data: [{ bucket: "active", n: 45 }] };
      case "v_imo_by_agency":
        return { data: agencies };
      default:
        return { error: { message: `no stub for ${chain.table}` } };
    }
  };
}

const AGENT_ROW: AgentIdentityRow = {
  id: "agent-1", user_id: "user-1", agent_code: "AGT1", display_name: "Test Manager", status: "active",
  is_inactive: false, is_deactivated: false, created_at: "2026-01-01T00:00:00Z", canonical_agent_id: null,
};
const resolvedIdentity = (): UseAgentIdentityResult => ({
  identity: { status: "resolved", agentId: "agent-1", row: AGENT_ROW }, agentId: "agent-1",
  isLoading: false, isError: false, refetch: vi.fn(), userId: "user-1",
});
const noTeam = (): ResolvedDownline => ({ ids: undefined, isWaiting: false, isError: false, error: null, refetch: vi.fn(), source: "none" });

function renderPage(path = "/dashboard/production") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <MyDeals />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  requests.length = 0;
  downline.calls.length = 0;
  auth.current = { user: { id: "user-1" }, isAdmin: true, isManager: false };
  identity.current = resolvedIdentity();
  downline.current = noTeam();
  respond = bookResponder();
  vi.mocked(supabase.from).mockImplementation(((table: string) => chainFor(table)) as never);
  vi.mocked(supabase.rpc).mockImplementation((() => Promise.resolve({ data: [], error: null })) as never);
  soldKeys.names.clear();
});

describe("Production page", () => {
  it("offers Load more when the server cut the first page short, and the next page continues after the last row (F09)", async () => {
    renderPage();
    expect(await screen.findByText("Client0 Last0")).toBeInTheDocument();
    expect(await screen.findByText(`Showing ${PAGE_ONE} of 45 · ${PAGE_ONE} loaded`)).toBeInTheDocument();

    const pageOne = requests.find((c) => c.table === "v_production_unified" && c.select === "*");
    expect(pageOne?.options).toEqual({ count: "exact" });
    expect(pageOne?.limit).toBe(3000);

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Client44 Last44")).toBeInTheDocument();

    const pageTwo = requests.filter((c) => c.table === "v_production_unified" && c.select === "*").at(-1);
    const last = book[PAGE_ONE - 1];
    expect(pageTwo?.ors).toContain(dealsPageCursorFilter({ posted_date: last.posted_date, row_key: last.row_key }));
    // Everything is loaded and shown: the footer is gone, no further page is asked for.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument());
    expect(screen.queryByText(/loaded$/)).not.toBeInTheDocument();
    expect(requests.filter((c) => c.table === "v_production_unified" && c.select === "*")).toHaveLength(2);
  });

  it("says so when the count is higher than the rows loaded and no next page is known (F09)", async () => {
    respond = bookResponder({ pages: () => ({ data: book.slice(0, PAGE_ONE), count: PAGE_ONE }) });
    renderPage();
    expect(await screen.findByText(`Showing ${PAGE_ONE} of 45 · ${PAGE_ONE} loaded`)).toBeInTheDocument();
    expect(screen.getByText("The count is higher than the rows loaded.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload list" })).toBeInTheDocument();
  });

  it("shows the MP-304 sold-call panel on the row itself for a client with a sold call, never behind the expand", async () => {
    soldKeys.names.add("Client3|Last3");
    renderPage();
    expect(await screen.findByText("Client3 Last3")).toBeInTheDocument();
    // No click: the packet is on the row.
    const panels = await screen.findAllByTestId("sold-call-panel");
    expect(panels).toHaveLength(1);
    expect(panels[0]).toHaveTextContent("Client3|Last3");
  });

  it("puts the client's phone, date of birth and state on every client row, with Call and Resold, without expanding", async () => {
    vi.mocked(supabase.rpc).mockImplementation(((fn: string, args: { p_rows?: Array<{ row_key: string; policy_number: string | null }> }) => {
      if (fn !== "book_client_details") return Promise.resolve({ data: [], error: null });
      const rows = (args?.p_rows ?? []).filter((r) => r.policy_number === "P3").map((r) => ({
        row_key: r.row_key, phone: "6015551234", dob: "1958-03-07", state: "TX", city: "Tyler", do_not_call: false,
        best_time_to_call: null, flip_carrier: null, flip_policy_number: null, flip_client_key: null, flip_status: null,
        resold_policy_number: null, resold_carrier: null, resold_annual_premium: null,
      }));
      return Promise.resolve({ data: rows, error: null });
    }) as never);
    renderPage();
    const call = await screen.findByRole("link", { name: /Call \(601\) 555-1234/ });
    expect(call).toBeInTheDocument();
    expect(screen.getByText(/DOB 03\/07\/1958/)).toBeInTheDocument();
    expect(screen.getByText("Tyler, TX")).toBeInTheDocument();
    // The lookup asked for the rows on screen, by row key, origin, policy and carrier.
    const asked = vi.mocked(supabase.rpc).mock.calls.find((c) => String(c[0]) === "book_client_details");
    expect((asked?.[1] as { p_rows: unknown[] }).p_rows.length).toBeGreaterThan(0);
    // Every client row offers Resold.
    expect(screen.getAllByRole("button", { name: "Resold" }).length).toBeGreaterThanOrEqual(30);
    // A row with no details yet says so instead of hiding the line.
    expect(screen.getAllByText("No phone on file").length).toBeGreaterThan(0);
  });

  it("says so when client details fail to load, with a retry", async () => {
    vi.mocked(supabase.rpc).mockImplementation(((fn: string) => fn === "book_client_details"
      ? Promise.resolve({ data: null, error: { message: "permission denied" } })
      : Promise.resolve({ data: [], error: null })) as never);
    renderPage();
    expect(await screen.findByText(/Client phone and date of birth did not load: permission denied/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });

  it("shows the page's Post a Deal below lg only, and labels agency-wide totals without inventing an average (F37 / F10)", async () => {
    renderPage();
    const action = screen.getByRole("button", { name: "Post a Deal" });
    expect(action.className).toContain("lg:hidden");
    expect(await screen.findByText("Agency-wide totals.")).toBeInTheDocument();
    const avg = screen.getByText("Avg per deal").parentElement as HTMLElement;
    expect(within(avg).getByText("No deals")).toBeInTheDocument();
    expect(within(avg).queryByText("$0")).not.toBeInTheDocument();
  });

  it("names All time once, with no range (F08 heading)", async () => {
    renderPage();
    await screen.findByText(/This month · Oct 1 to Oct 15 · Agency-wide/);
    fireEvent.click(screen.getByRole("button", { name: "All time" }));
    const heading = await screen.findByText(/All time · Agency-wide/);
    expect(heading.textContent).not.toContain("All time · All time");
  });

  it("does not claim to be looking for a deep-linked deal after the list failed", async () => {
    respond = bookResponder({ pages: () => ({ error: { message: "canceling statement due to statement timeout", code: "57014" } }) });
    renderPage("/dashboard/production?deal=r0040");
    expect(await screen.findByText("That deal cannot be looked up until the list loads.")).toBeInTheDocument();
    expect(screen.queryByText("Looking for the deal you opened.")).not.toBeInTheDocument();
  });
});

describe("Production page for a manager (not an admin)", () => {
  beforeEach(() => {
    auth.current = { user: { id: "user-1" }, isAdmin: false, isManager: true };
  });

  it("reads the team under the resolved identity, and a failed team read is an error, never an empty or self-only book (F10 / F17)", async () => {
    downline.current = { ids: undefined, isWaiting: false, isError: true, error: { message: "canceling statement due to statement timeout", code: "57014" }, refetch: vi.fn(), source: "root" } satisfies ResolvedDownline;
    renderPage();
    expect(await screen.findByText("Your team list could not load.")).toBeInTheDocument();
    expect(downline.calls[0]).toEqual([resolvedIdentity().identity, true]);
    expect(screen.queryByText("No deals logged yet")).not.toBeInTheDocument();
    expect(screen.getByText(/Counts appear once your team is known/)).toBeInTheDocument();
    // Nothing was read from the book under a partial scope.
    expect(requests.filter((c) => c.table === "v_production_unified")).toHaveLength(0);
  });

  it("counts the status tiles over the team with the list's own filters, and says the totals are the team's (F11, PL-SEC-VIEW-LOCKDOWN)", async () => {
    downline.current = { ids: ["agent-2", "agent-3"], isWaiting: false, isError: false, error: null, refetch: vi.fn(), source: "root" } satisfies ResolvedDownline;
    renderPage();
    // The server scopes the book to the manager's team since PL-SEC-VIEW-LOCKDOWN, so the caption says so.
    expect(await screen.findByText("Your team's totals.")).toBeInTheDocument();
    expect(screen.queryByText(/Production by Agency/)).not.toBeInTheDocument();
    expect(screen.getByText(/Counts for your team\./)).toBeInTheDocument();
    const tiles = await screen.findByRole("group", { name: "Filter the deal list by policy status" });
    expect(within(tiles).getByRole("button", { name: /7\s*Active/ })).toBeInTheDocument();

    const tileCounts = requests.filter((c) => c.table === "v_production_unified" && c.options?.head && c.ors.length === 1);
    expect(tileCounts.map((c) => c.ors[0]).sort()).toEqual(STATUS_BUCKETS.map((b) => statusBucketFilter(b)).sort());
    for (const call of tileCounts) expect(call.ins).toEqual([["agent_id", ["agent-2", "agent-3", "agent-1"]]]);
    expect(requests.some((c) => c.table === "v_book_status_tiles")).toBe(false);
  });
});
