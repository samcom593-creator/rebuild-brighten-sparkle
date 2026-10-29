/**
 * Book of Business (src/pages/MyDeals.tsx) rendered against a stubbed book.
 *
 * F09: the server answers fewer rows than .limit() asks (1,000 of 1,373 live),
 * so "Load more" must follow the server's count, not the page length. Here
 * the stub cuts page 1 short at 30 of 45 rows the same way.
 * F10 / F17: a manager whose team list fails sees that error, never their own
 * deals as the team's and never an empty book.
 * F37: the header's Post a Deal hides at lg, where the shell rail carries one.
 * MP-304: a client with a sold call shows the packet panel on the row itself.
 * 2026-10-16: every client row shows phone (Call), date of birth and state, and a Resold button.
 * OVERHAUL-book (2026-10-29): the page leads with who is on the books (Active, Pending, Lapsing,
 * Gone) and the policies with no status yet; each number opens exactly the list it counts, and the
 * money sections (totals, Production by Agency) are gone.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";
import type { UseAgentIdentityResult } from "@/hooks/useAgentIdentity";
import type { ResolvedDownline } from "@/hooks/useResolvedDownline";
import type { AgentIdentityRow } from "@/lib/agentIdentity";
import { dealsPageCursorFilter } from "@/lib/productionBook";

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
  nots: Array<[string, string, unknown]>;
  limit?: number;
};
type Answer = { data?: unknown; error?: unknown; count?: number | null };

const requests: Chain[] = [];
let respond: (chain: Chain) => Answer = () => ({ data: null, error: { message: "no stub" } });

function chainFor(table: string) {
  const chain: Chain = { table, ors: [], ins: [], eqs: [], nots: [] };
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
    not: (column: string, op: string, value: unknown) => {
      chain.nots.push([column, op, value]);
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

const STANDING_OF: Record<string, string> = {
  active: "active", issued_not_paid: "pending", in_review: "pending", lapse_pending: "lapsing", lapsed: "lapsing",
  declined: "gone", not_taken: "gone", unknown: "unknown",
};
const STATUS_TEXT: Record<string, string> = {
  active: "Active", issued_not_paid: "Issued, Not Paid", in_review: "In Review", lapse_pending: "Lapse Pending",
  lapsed: "Lapsed", declined: "Declined", not_taken: "Not Taken", unknown: "Unknown",
};
// Rows 0..44: most active, a few in every other standing so each tile has a list to open.
const keyFor = (i: number) => (i === 1 ? "lapse_pending" : i === 2 ? "lapsed" : i === 4 ? "declined" : i === 5 ? "issued_not_paid" : i === 7 ? "unknown" : "active");
const deal = (i: number) => {
  const status_key = keyFor(i);
  return {
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
    status: STATUS_TEXT[status_key],
    status_key,
    standing: STANDING_OF[status_key],
    synced_at: "2026-10-15T12:00:00Z",
  };
};
const book = Array.from({ length: 45 }, (_, i) => deal(i));
const PAGE_ONE = 30; // the stub's server cap, standing in for PostgREST's 1,000

/** The rows a chain's standing / status filters select, the way PostgREST would. */
function filtered(chain: Chain) {
  return book.filter((d) => {
    for (const [col, value] of chain.eqs) {
      if (col === "row_key" && d.row_key !== value) return false;
      if (col === "standing" && d.standing !== value) return false;
      if (col === "status_key" && d.status_key !== value) return false;
    }
    for (const [col, op, value] of chain.nots) {
      if (col === "standing" && op === "in" && String(value).replace(/[()]/g, "").split(",").includes(d.standing)) return false;
    }
    return true;
  });
}

/** book_of_business_counts() over the stub book: one row per standing and status. */
function countsOf(rows: typeof book) {
  const m = new Map<string, number>();
  for (const d of rows) m.set(`${d.standing}|${d.status_key}`, (m.get(`${d.standing}|${d.status_key}`) ?? 0) + 1);
  return [...m.entries()].map(([k, n]) => ({ standing: k.split("|")[0], status_key: k.split("|")[1], n }));
}

function bookResponder(overrides: { pages?: (chain: Chain) => Answer } = {}) {
  return (chain: Chain): Answer => {
    switch (chain.table) {
      case "v_book_of_business": {
        const rows = filtered(chain);
        if (chain.options?.head) return { count: rows.length };
        if (chain.eqs.some(([c]) => c === "row_key")) return { data: rows };
        if (overrides.pages) return overrides.pages(chain);
        const isPageTwo = chain.ors.some((f) => f.includes("posted_date.lt."));
        if (isPageTwo) return { data: rows.slice(PAGE_ONE), count: Math.max(0, rows.length - PAGE_ONE) };
        return { data: rows.slice(0, PAGE_ONE), count: rows.length };
      }
      default:
        return { error: { message: `no stub for ${chain.table}` } };
    }
  };
}

type RpcHandler = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }> | undefined;
let rpcOverride: RpcHandler = () => undefined;
const rpcCalls = () => vi.mocked(supabase.rpc).mock.calls.map((c) => ({ fn: String(c[0]), args: c[1] as Record<string, unknown> }));

const AGENT_ROW: AgentIdentityRow = {
  id: "agent-1", user_id: "user-1", agent_code: "AGT1", display_name: "Test Manager", status: "active",
  is_inactive: false, is_deactivated: false, created_at: "2026-01-01T00:00:00Z", canonical_agent_id: null,
};
const resolvedIdentity = (): UseAgentIdentityResult => ({
  identity: { status: "resolved", agentId: "agent-1", row: AGENT_ROW }, agentId: "agent-1",
  isLoading: false, isError: false, refetch: vi.fn(), userId: "user-1",
});
const noTeam = (): ResolvedDownline => ({ ids: undefined, isWaiting: false, isError: false, error: null, refetch: vi.fn(), source: "none" });

let lastSearch = "";
function LocationProbe() {
  lastSearch = useLocation().search;
  return null;
}

let lastClient: QueryClient | null = null;
function renderPage(path = "/dashboard/production") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  lastClient = client;
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[path]}>
        <MyDeals />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const board = () => screen.getByRole("region", { name: "Who is on the books" });
const tile = (name: RegExp) => within(board()).getByRole("button", { name });
/** The list read (not the head count, not a lookup) that the page sent last. */
const lastListRead = () => requests.filter((c) => c.table === "v_book_of_business" && c.select === "*" && !c.eqs.some(([col]) => col === "row_key")).at(-1);
const lastHeadCount = () => requests.filter((c) => c.table === "v_book_of_business" && c.options?.head).at(-1);

beforeEach(() => {
  requests.length = 0;
  downline.calls.length = 0;
  auth.current = { user: { id: "user-1" }, isAdmin: true, isManager: false };
  identity.current = resolvedIdentity();
  downline.current = noTeam();
  respond = bookResponder();
  rpcOverride = () => undefined;
  // Each test reads only its own calls.
  vi.mocked(supabase.from).mockClear();
  vi.mocked(supabase.rpc).mockClear();
  vi.mocked(supabase.from).mockImplementation(((table: string) => chainFor(table)) as never);
  vi.mocked(supabase.rpc).mockImplementation(((fn: string, args: Record<string, unknown>) => {
    const custom = rpcOverride(fn, args);
    if (custom) return custom;
    if (fn === "book_of_business_counts") return Promise.resolve({ data: countsOf(book), error: null });
    return Promise.resolve({ data: [], error: null });
  }) as never);
  soldKeys.names.clear();
});

describe("Book of Business", () => {
  it("offers Load more when the server cut the first page short, and the next page continues after the last row (F09)", async () => {
    renderPage();
    expect(await screen.findByText("Client0 Last0")).toBeInTheDocument();
    expect(await screen.findByText(`Showing ${PAGE_ONE} of 45 · ${PAGE_ONE} loaded`)).toBeInTheDocument();

    const pageOne = requests.find((c) => c.table === "v_book_of_business" && c.select === "*");
    expect(pageOne?.options).toEqual({ count: "exact" });
    expect(pageOne?.limit).toBe(3000);

    fireEvent.click(screen.getByRole("button", { name: "Load more" }));
    expect(await screen.findByText("Client44 Last44")).toBeInTheDocument();

    const pageTwo = requests.filter((c) => c.table === "v_book_of_business" && c.select === "*").at(-1);
    const last = book[PAGE_ONE - 1];
    expect(pageTwo?.ors).toContain(dealsPageCursorFilter({ posted_date: last.posted_date, row_key: last.row_key }));
    // Everything is loaded and shown: the footer is gone, no further page is asked for.
    await waitFor(() => expect(screen.queryByRole("button", { name: "Load more" })).not.toBeInTheDocument());
    expect(screen.queryByText(/loaded$/)).not.toBeInTheDocument();
    expect(requests.filter((c) => c.table === "v_book_of_business" && c.select === "*")).toHaveLength(2);
  });

  it("says so when the count is higher than the rows loaded and no next page is known (F09)", async () => {
    respond = bookResponder({ pages: () => ({ data: book.slice(0, PAGE_ONE), count: PAGE_ONE }) });
    renderPage();
    expect(await screen.findByText(`Showing ${PAGE_ONE} of 45 · ${PAGE_ONE} loaded`)).toBeInTheDocument();
    expect(screen.getByText("The count is higher than the rows loaded.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload list" })).toBeInTheDocument();
  });

  it("leads with Active, Pending, Lapsing and Gone, from the database's counts, with the no-status policies on their own line", async () => {
    renderPage();
    expect(await screen.findByText("Client0 Last0")).toBeInTheDocument();
    await waitFor(() => expect(tile(/Active/)).toHaveTextContent("40"));
    expect(tile(/Pending/)).toHaveTextContent("1");
    expect(tile(/Lapsing/)).toHaveTextContent("2");
    expect(tile(/Gone/)).toHaveTextContent("1");
    // Each tile says what it counts, in words, beside its number.
    expect(tile(/Lapsing/)).toHaveTextContent("Missed a payment. Call to save them");
    expect(tile(/Gone/)).toHaveTextContent("No longer on the books");
    // The four never pretend to be the whole book: the unreported policy has its own line.
    expect(screen.getByRole("button", { name: /1 policy with no status yet/ })).toBeInTheDocument();
    // An admin's counts cover the whole book: no agent list is passed.
    expect(rpcCalls().find((c) => c.fn === "book_of_business_counts")?.args).toEqual({});
  });

  it("opens exactly the policies a tile counts: the list and its count read the same filter, and the URL keeps it", async () => {
    renderPage();
    expect(await screen.findByText("Client0 Last0")).toBeInTheDocument();
    await waitFor(() => expect(tile(/Lapsing/)).toHaveTextContent("2"));
    fireEvent.click(tile(/Lapsing/));

    expect(await screen.findByText("Client1 Last1")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Client0 Last0")).not.toBeInTheDocument());
    expect(screen.getByText("Client2 Last2")).toBeInTheDocument();
    expect(lastListRead()?.eqs).toEqual([["standing", "lapsing"]]);
    expect(lastHeadCount()?.eqs).toEqual([["standing", "lapsing"]]);
    // The heading says what is showing, and its count is the tile's number.
    expect(screen.getByText("2 policies")).toBeInTheDocument();
    expect(tile(/Lapsing/)).toHaveAttribute("aria-pressed", "true");
    expect(lastSearch).toBe("?standing=lapsing");

    // Inside the tile: one chip per status, each with its own count, and each opens its own rows.
    const statuses = screen.getByRole("group", { name: "Lapsing by status" });
    fireEvent.click(within(statuses).getByRole("button", { name: /Lapsed\s*1/ }));
    await waitFor(() => expect(screen.queryByText("Client1 Last1")).not.toBeInTheDocument());
    expect(screen.getByText("Client2 Last2")).toBeInTheDocument();
    expect(lastListRead()?.eqs).toEqual([["standing", "lapsing"], ["status_key", "lapsed"]]);
    expect(lastSearch).toBe("?standing=lapsing&status=lapsed");

    // Show everyone goes back to the whole book.
    fireEvent.click(screen.getByRole("button", { name: "Show everyone" }));
    expect(await screen.findByText("Client0 Last0")).toBeInTheDocument();
    expect(lastSearch).toBe("");
  });

  it("lists the no-status policies as everything outside the four tiles", async () => {
    renderPage();
    const line = await screen.findByRole("button", { name: /1 policy with no status yet/ });
    fireEvent.click(line);
    expect(await screen.findByText("Client7 Last7")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Client0 Last0")).not.toBeInTheDocument());
    expect(lastListRead()?.nots).toEqual([["standing", "in", "(active,pending,lapsing,gone)"]]);
    expect(lastHeadCount()?.nots).toEqual([["standing", "in", "(active,pending,lapsing,gone)"]]);
    expect(screen.getByRole("button", { name: /1 policy with no status yet/ })).toHaveAttribute("aria-pressed", "true");
  });

  it("shows a gone policy on the list with its status in words, and the page's older links still open the right part", async () => {
    renderPage("/dashboard/production?group=inactive");
    expect(await screen.findByText("Client4 Last4")).toBeInTheDocument();
    expect(lastListRead()?.eqs).toEqual([["standing", "gone"]]);
    await waitFor(() => expect(tile(/Gone/)).toHaveAttribute("aria-pressed", "true"));
    const row = screen.getByText("Client4 Last4").closest("button") as HTMLElement;
    expect(within(row).getByText("Declined")).toBeInTheDocument();
  });

  it("never shows zeros when the counts fail: dashes, the reason and Try again", async () => {
    rpcOverride = (fn) => (fn === "book_of_business_counts" ? Promise.resolve({ data: null, error: { message: "canceling statement due to statement timeout" } }) : undefined);
    renderPage();
    expect(await screen.findByText(/The book counts did not load: canceling statement due to statement timeout/)).toBeInTheDocument();
    // Four dashes, one per tile, and not one zero; a tile with no number is not a button.
    expect(within(board()).getAllByText("—")).toHaveLength(4);
    expect(within(board()).queryByText("0")).not.toBeInTheDocument();
    expect(within(board()).getAllByRole("button").map((b) => b.textContent)).toEqual(["Try again"]);
    expect(screen.queryByText(/with no status yet/)).not.toBeInTheDocument();
    expect(within(board()).getByRole("button", { name: "Try again" })).toBeInTheDocument();
    // The list itself still loads: one failed number does not hide the book.
    expect(await screen.findByText("Client0 Last0")).toBeInTheDocument();
  });

  it("keeps the last counts through a failed refresh and says how old they are, never zeros", async () => {
    renderPage();
    await waitFor(() => expect(tile(/Active/)).toHaveTextContent("40"));
    rpcOverride = (fn) => (fn === "book_of_business_counts" ? Promise.resolve({ data: null, error: { message: "canceling statement due to statement timeout", code: "57014" } }) : undefined);
    await lastClient?.refetchQueries({ queryKey: ["book-standing"] });
    expect(await screen.findByText(/These counts are from .+\. The latest read failed: The server took too long to answer/)).toBeInTheDocument();
    // The numbers on hand stay, and still open their lists.
    expect(tile(/Active/)).toHaveTextContent("40");
    expect(tile(/Lapsing/)).toHaveTextContent("2");
    expect(within(board()).getByRole("button", { name: "Try again" })).toBeInTheDocument();
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
    rpcOverride = (fn, args) => {
      if (fn !== "book_client_details") return undefined;
      const rows = ((args?.p_rows ?? []) as Array<{ row_key: string; policy_number: string | null }>).filter((r) => r.policy_number === "P3").map((r) => ({
        row_key: r.row_key, phone: "6015551234", dob: "1958-03-07", state: "TX", city: "Tyler", do_not_call: false,
        best_time_to_call: null, flip_carrier: null, flip_policy_number: null, flip_client_key: null, flip_status: null,
        resold_policy_number: null, resold_carrier: null, resold_annual_premium: null,
      }));
      return Promise.resolve({ data: rows, error: null });
    };
    renderPage();
    const call = await screen.findByRole("link", { name: /Call \(601\) 555-1234/ });
    expect(call).toBeInTheDocument();
    expect(screen.getByText(/DOB 03\/07\/1958/)).toBeInTheDocument();
    expect(screen.getByText("Tyler, TX")).toBeInTheDocument();
    // The lookup asked for the rows on screen, by row key, origin, policy and carrier.
    const asked = rpcCalls().find((c) => c.fn === "book_client_details");
    expect((asked?.args as { p_rows: unknown[] }).p_rows.length).toBeGreaterThan(0);
    // Every client row offers Resold.
    expect(screen.getAllByRole("button", { name: "Resold" }).length).toBeGreaterThanOrEqual(30);
    // A row with no details yet says so instead of hiding the line.
    expect(screen.getAllByText("No phone on file").length).toBeGreaterThan(0);
  });

  const flipDetails = (status: string): RpcHandler => (fn, args) => {
    if (fn === "book_flip_set") return Promise.resolve({ data: null, error: null });
    if (fn !== "book_client_details") return undefined;
    const rows = ((args?.p_rows ?? []) as Array<{ row_key: string; policy_number: string | null }>).filter((r) => r.policy_number === "P3").map((r) => ({
      row_key: r.row_key, phone: "6015551234", dob: "1958-03-07", state: "TX", city: "Tyler", do_not_call: false,
      best_time_to_call: null, flip_carrier: "Carrier", flip_policy_number: "P3", flip_client_key: "client3last3", flip_status: status,
      resold_policy_number: null, resold_carrier: null, resold_annual_premium: null,
      attempts: 2, last_contact_at: "2026-10-15T18:00:00Z", callback_at: null, notes: "Left a voicemail",
    }));
    return Promise.resolve({ data: rows, error: null });
  };

  it("shows each policy's status and where the client stands, with the Book Flips options on the row (Sam 2026-10-16)", async () => {
    rpcOverride = flipDetails("no_answer");
    renderPage();
    expect(await screen.findByText("Left a voicemail")).toBeInTheDocument();
    expect(screen.getByText(/2 attempts/)).toBeInTheDocument();
    // Every row labels the carrier's policy status in words.
    expect(screen.getAllByText("Policy status").length).toBeGreaterThanOrEqual(30);
    expect(screen.getAllByText("Lapse pending").length).toBeGreaterThan(0);
    // The worked client gets the same outcomes as its Book Flips card; logging one writes the
    // shared book_flips record, so both pages show it.
    const noAnswer = screen.getAllByRole("button", { name: "No answer" });
    expect(noAnswer).toHaveLength(1);
    for (const name of ["Callback", "Appointment", "More…", "Note", "Back to call list"]) {
      expect(screen.getByRole("button", { name: new RegExp(name) })).toBeInTheDocument();
    }
    fireEvent.click(noAnswer[0]);
    await waitFor(() => expect(rpcCalls().some((c) => c.fn === "book_flip_set")).toBe(true));
    const set = rpcCalls().find((c) => c.fn === "book_flip_set");
    expect(set?.args).toEqual({ p_carrier: "Carrier", p_policy_number: "P3", p_client_key: "client3last3", p_status: "no_answer", p_count_attempt: true });
  });

  it("shows an agent where their client stands but leaves the call outcomes to admins and managers", async () => {
    auth.current = { user: { id: "user-1" }, isAdmin: false, isManager: false };
    rpcOverride = flipDetails("callback");
    renderPage();
    expect(await screen.findByText("Left a voicemail")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "No answer" })).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Resold" }).length).toBeGreaterThan(0);
    // An agent's counts and rows are their own: the same agent list goes to both.
    expect(rpcCalls().find((c) => c.fn === "book_of_business_counts")?.args).toEqual({ p_agent_ids: ["agent-1"] });
    expect(lastListRead()?.ins).toEqual([["agent_id", ["agent-1"]]]);
    expect(screen.getByText(/Who is on the books and who is not, for your clients\./)).toBeInTheDocument();
  });

  it("matches each row to its own client: the lookup carries the client name, since policy numbers are shared", async () => {
    renderPage();
    await screen.findByText("Client0 Last0");
    await waitFor(() => expect(rpcCalls().some((c) => c.fn === "book_client_details")).toBe(true));
    const asked = rpcCalls().find((c) => c.fn === "book_client_details");
    const rows = (asked?.args as { p_rows: Array<{ row_key: string; client_name: string | null }> }).p_rows;
    expect(rows.find((r) => r.row_key === "r0003")?.client_name).toBe("Client3 Last3");
  });

  it("does not offer Call or Text for a client marked Do not call or Bad number in Book Flips", async () => {
    rpcOverride = flipDetails("do_not_call");
    const first = renderPage();
    expect(await screen.findByText("Left a voicemail")).toBeInTheDocument();
    // The status chip and the contact line both say it; the contact line no longer offers the call.
    expect(screen.getAllByText("Do not call")).toHaveLength(2);
    expect(screen.queryByRole("link", { name: /Call \(601\) 555-1234/ })).not.toBeInTheDocument();
    first.unmount();

    rpcOverride = flipDetails("bad_number");
    renderPage();
    expect(await screen.findByText(/Bad number · \(601\) 555-1234/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Call \(601\) 555-1234/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Text/ })).not.toBeInTheDocument();
  });

  it("says so when client details fail to load, with a retry", async () => {
    rpcOverride = (fn) => (fn === "book_client_details" ? Promise.resolve({ data: null, error: { message: "permission denied" } }) : undefined);
    renderPage();
    expect(await screen.findByText(/Client phone and date of birth did not load: permission denied/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Try again" }).length).toBeGreaterThan(0);
    // The rows say the lookup failed; "No phone on file" would be a guess.
    expect(screen.getAllByText("Phone and date of birth did not load").length).toBeGreaterThanOrEqual(30);
    expect(screen.queryByText("No phone on file")).not.toBeInTheDocument();
  });

  it("shows the page's Post a Deal below lg only (F37), and none of the money sections Sam asked to remove", async () => {
    renderPage();
    const action = screen.getByRole("button", { name: "Post a Deal" });
    expect(action.className).toContain("lg:hidden");
    expect(await screen.findByText("Client0 Last0")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Book of Business" })).toBeInTheDocument();
    for (const gone of ["Agency-wide totals.", "Last 30 days", "Total book", "Avg per deal", "Production by Agency", "Policy Status"]) {
      expect(screen.queryByText(gone)).not.toBeInTheDocument();
    }
    // The book and the MP-310 dialer summary are all the page reads; no totals, tiles or agency reads.
    const tablesRead = [...new Set(requests.map((c) => c.table))].sort();
    expect(tablesRead).toEqual(["v_book_of_business", "v_book_row_call_summary"]);
    expect(rpcCalls().some((c) => c.fn === "production_attribution_exceptions")).toBe(false);
  });

  it("does not claim to be looking for a deep-linked deal after the list failed", async () => {
    respond = bookResponder({ pages: () => ({ error: { message: "canceling statement due to statement timeout", code: "57014" } }) });
    renderPage("/dashboard/production?deal=r0040");
    expect(await screen.findByText("That deal cannot be looked up until the list loads.")).toBeInTheDocument();
    expect(screen.queryByText("Looking for the deal you opened.")).not.toBeInTheDocument();
  });
});

describe("Book of Business for a manager (not an admin)", () => {
  beforeEach(() => {
    auth.current = { user: { id: "user-1" }, isAdmin: false, isManager: true };
  });

  it("reads the team under the resolved identity, and a failed team read is an error, never an empty or self-only book (F10 / F17)", async () => {
    downline.current = { ids: undefined, isWaiting: false, isError: true, error: { message: "canceling statement due to statement timeout", code: "57014" }, refetch: vi.fn(), source: "root" } satisfies ResolvedDownline;
    renderPage();
    expect(await screen.findByText("Your team list could not load.")).toBeInTheDocument();
    expect(downline.calls[0]).toEqual([resolvedIdentity().identity, true]);
    expect(screen.queryByText("Nothing on the book yet")).not.toBeInTheDocument();
    expect(screen.getByText(/The counts appear once your book is known/)).toBeInTheDocument();
    // Nothing was read from the book under a partial scope, and nothing was counted.
    expect(requests.filter((c) => c.table === "v_book_of_business")).toHaveLength(0);
    expect(rpcCalls().some((c) => c.fn === "book_of_business_counts")).toBe(false);
  });

  it("counts the tiles over the team with the list's own agent list, and says the book is the team's", async () => {
    downline.current = { ids: ["agent-2", "agent-3"], isWaiting: false, isError: false, error: null, refetch: vi.fn(), source: "root" } satisfies ResolvedDownline;
    renderPage();
    expect(await screen.findByText(/Who is on the books and who is not, on your team\./)).toBeInTheDocument();
    await waitFor(() => expect(rpcCalls().some((c) => c.fn === "book_of_business_counts")).toBe(true));
    const team = ["agent-2", "agent-3", "agent-1"];
    expect(rpcCalls().find((c) => c.fn === "book_of_business_counts")?.args).toEqual({ p_agent_ids: team });
    await waitFor(() => expect(lastListRead()?.ins).toEqual([["agent_id", team]]));
    expect(lastHeadCount()?.ins).toEqual([["agent_id", team]]);
    await waitFor(() => expect(tile(/Active/)).toHaveTextContent("40"));
  });
});
