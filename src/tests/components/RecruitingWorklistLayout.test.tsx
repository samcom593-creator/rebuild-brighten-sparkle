import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Synthetic records only. The fake client answers head counts with the same
// predicates the hook sends, so the coverage arithmetic is exercised for real:
// a duplicate application and an interview booking are live but not eligible.
const ME = "00000000-0000-4000-8000-0000000000bb";

type Row = Record<string, unknown>;
type Filter = { op: "eq" | "neq" | "is" | "or"; col: string; val: unknown };
const db: { rows: Row[]; hiddenFromPage: string[]; countsFail: boolean; rowsFail: boolean } = {
  rows: [], hiddenFromPage: [], countsFail: false, rowsFail: false,
};

function makeRow(id: string, patch: Row = {}): Row {
  return {
    id, first_name: "Sample", last_name: id.toUpperCase(), email: `${id}@example.test`, phone: "+15555550123",
    state: "TX", license_status: "unlicensed", license_progress: "unlicensed", status: "new",
    next_step_stage_key: "applied", created_at: "2026-09-01T12:00:00Z", assigned_agent_id: "attrib-agent",
    last_contacted_at: null, next_action: null, next_action_due_at: null, next_step_due_at: null,
    phone_bad_at: null, email_bad_at: null, sms_consent_given: true, email_consent_given: true,
    time_zone: null, time_zone_source: null, recruiting_owner_user_id: null, last_contact_outcome: null,
    last_contact_outcome_at: null, last_contact_channel: null, next_action_set_at: null, waiting_reason: null,
    next_review_at: null, do_not_contact_at: null,
    terminated_at: null, record_type: "application", is_duplicate: false,
    ...patch,
  };
}

function matches(row: Row, f: Filter): boolean {
  const v = row[f.col];
  switch (f.op) {
    case "eq": return v === f.val;
    // PostgREST: a NULL column never satisfies neq.
    case "neq": return v !== null && v !== undefined && v !== f.val;
    case "is": return f.val === null ? v === null || v === undefined : v === f.val;
    // The hook's only .or(): is_duplicate is null or false.
    case "or": return v === null || v === undefined || v === false;
  }
}

vi.mock("@/integrations/supabase/client", () => {
  function from(table: string) {
    const filters: Filter[] = [];
    const q: Record<string, unknown> & { head: boolean; range_: [number, number] | null } = { head: false, range_: null };
    const chain = (fn?: (...a: unknown[]) => void) => (...a: unknown[]) => { fn?.(...a); return q; };
    Object.assign(q, {
      select: chain((_c: unknown, opts: unknown) => { q.head = Boolean((opts as { head?: boolean } | undefined)?.head); }),
      eq: chain((col: unknown, val: unknown) => { filters.push({ op: "eq", col: String(col), val }); }),
      neq: chain((col: unknown, val: unknown) => { filters.push({ op: "neq", col: String(col), val }); }),
      is: chain((col: unknown, val: unknown) => { filters.push({ op: "is", col: String(col), val }); }),
      or: chain(() => { filters.push({ op: "or", col: "is_duplicate", val: null }); }),
      order: chain(),
      range: chain((a: unknown, b: unknown) => { q.range_ = [a as number, b as number]; }),
      then(resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) {
        let result: unknown;
        if (table === "applications") {
          const hit = db.rows.filter((r) => filters.every((f) => matches(r, f)));
          if (q.head) {
            result = db.countsFail
              ? { data: null, error: { message: "count timed out" }, count: null }
              : { data: null, error: null, count: hit.length };
          } else if (db.rowsFail) {
            result = { data: null, error: { message: "canceling statement due to statement timeout", code: "57014" } };
          } else {
            const page = hit.filter((r) => !db.hiddenFromPage.includes(String(r.id)));
            result = { data: page.slice(q.range_?.[0] ?? 0, (q.range_?.[1] ?? 999) + 1), error: null };
          }
        } else if (table === "next_step_stages") {
          result = { data: [{ stage_key: "applied", display_name: "Applied", order_index: 1, is_terminal: false }], error: null };
        } else {
          result = { data: [], error: null };
        }
        return Promise.resolve(result).then(resolve, reject);
      },
    });
    return q;
  }
  return {
    supabase: {
      from,
      rpc: (fn: string) => Promise.resolve(fn === "recruiting_staff_directory"
        ? { data: [{ user_id: ME, display_name: "Test Staffer", roles: ["admin"] }], error: null }
        : { data: null, error: null }),
    },
  };
});

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: ME }, isAdmin: true, isManager: false, isVa: false, isVaManager: false, isRecruiter: false }),
}));

import { RecruitingWorklist } from "@/components/pipeline/worklist/RecruitingWorklist";

const WIDE = "(min-width: 1024px)";
const PHONE = "(max-width: 767px)";

/** A real browser answers exactly one of the two queries true (or neither, on a tablet). */
function setViewport(kind: "desktop" | "tablet" | "phone") {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: (query: string) => ({
      matches: (kind === "desktop" && query === WIDE) || (kind === "phone" && query === PHONE),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

function renderAt(path: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <RecruitingWorklist />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The Filters menu (same name as the sibling pages) holds the view switch, the license filter and the classic view link. */
function openMore() {
  // Radix positions the popover with ResizeObserver, which jsdom does not ship.
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  fireEvent.click(screen.getByRole("button", { name: "Filters" }));
}

function dataStatus(): HTMLDetailsElement {
  const details = screen.getByText("Data status").closest("details");
  if (!details) throw new Error("Data status disclosure not rendered");
  return details;
}

beforeEach(() => {
  window.sessionStorage.clear();
  window.localStorage.clear();
  db.hiddenFromPage = [];
  db.countsFail = false;
  db.rowsFail = false;
  db.rows = [
    makeRow("a1"),
    makeRow("a2", {
      recruiting_owner_user_id: ME, next_action: "Call back", next_action_due_at: "2020-01-01T00:00:00Z",
      next_action_set_at: "2019-12-31T00:00:00Z", last_contacted_at: "2019-12-30T00:00:00Z",
    }),
    makeRow("a3", { state: null, phone: null }),
    makeRow("d1", { is_duplicate: true }),
    makeRow("b1", { record_type: "interview_booking" }),
  ];
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("RecruitingWorklist layout (F28)", () => {
  it("desktop default: the compact list sits beside the person panel and no 980px table renders", async () => {
    setViewport("desktop");
    renderAt("/dashboard/recruiting?queue=all_open");
    const list = await screen.findByRole("list", { name: "Queue" });
    expect(screen.queryByRole("table")).toBeNull();
    expect(await screen.findByRole("complementary", { name: "Selected person" })).toBeTruthy();

    // Grow redesign: the row says who, the plain facts, the next step and a status in words.
    // Stage and owner moved to the person panel (Details / Owner) and the Table view.
    const a2 = within(list).getByRole("button", { name: /Sample A2/ });
    expect(a2.textContent).toContain("TX");
    expect(a2.textContent).toContain("Unlicensed");
    expect(a2.textContent).toMatch(/Last contact .+ ago/);
    expect(a2.textContent).toContain("Next: Call back");
    expect(a2.textContent).toMatch(/Late · /);
    const a3 = within(list).getByRole("button", { name: /Sample A3/ });
    expect(a3.textContent).toContain("No phone");
    expect(a3.textContent).toContain("Never contacted");
    expect(a3.textContent).toContain("No next step");
    expect(a3.textContent).not.toContain("Next:");
  });

  it("desktop ?view=table: the full table takes the whole width and nothing auto-opens", async () => {
    setViewport("desktop");
    renderAt("/dashboard/recruiting?queue=all_open&view=table");
    expect(await screen.findByRole("table")).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Queue" })).toBeNull();
    expect(screen.queryByRole("complementary", { name: "Selected person" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    openMore();
    expect(screen.getByRole("button", { name: "Table" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("phone ?view=table: no table, no Table toggle; rows are cards and a tap opens the person sheet", async () => {
    setViewport("phone");
    renderAt("/dashboard/recruiting?queue=all_open&view=table");
    const list = await screen.findByRole("list", { name: "Queue" });
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("complementary", { name: "Selected person" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    openMore();
    expect(screen.queryByRole("button", { name: "Table" })).toBeNull();
    // The toggles follow what renders, not the URL: the cards are the List view.
    expect(screen.getByRole("button", { name: "List" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.keyDown(document.activeElement ?? document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("button", { name: "List" })).toBeNull());
    fireEvent.click(within(list).getByRole("button", { name: /Sample A1/ }));
    const sheet = await screen.findByRole("dialog");
    expect((await within(sheet).findAllByText(/Sample A1/)).length).toBeGreaterThan(0);
  });

  it("phone: the sheet has a visible Back to list button that closes it", async () => {
    setViewport("phone");
    renderAt("/dashboard/recruiting?queue=all_open");
    const list = await screen.findByRole("list", { name: "Queue" });
    fireEvent.click(within(list).getByRole("button", { name: /Sample A1/ }));
    const sheet = await screen.findByRole("dialog");
    fireEvent.click(within(sheet).getByRole("button", { name: /Back to list/ }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(screen.getByRole("list", { name: "Queue" })).toBeTruthy();
  });

  it("tablet default: cards with the person in a sheet, not the split, and nothing auto-opens", async () => {
    setViewport("tablet");
    renderAt("/dashboard/recruiting?queue=all_open");
    await screen.findByRole("list", { name: "Queue" });
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("complementary", { name: "Selected person" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("tablet or landscape phone ?view=table: the 980px table needs 1024px, so neither it nor its toggle renders", async () => {
    setViewport("tablet");
    renderAt("/dashboard/recruiting?queue=all_open&view=table");
    await screen.findByRole("list", { name: "Queue" });
    expect(screen.queryByRole("table")).toBeNull();
    openMore();
    expect(screen.queryByRole("button", { name: "Table" })).toBeNull();
    expect(screen.getByRole("button", { name: "List" }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("RecruitingWorklist Up next (OVERHAUL-calllist)", () => {
  it("phone: the first person in the list sits on top with what to do and one gold Call; calling opens them and records nothing", async () => {
    setViewport("phone");
    renderAt("/dashboard/recruiting?queue=all_open");
    const list = await screen.findByRole("list", { name: "Queue" });
    const first = within(list).getAllByRole("button")[0];
    expect(first).toHaveAccessibleName(/^Sample A2/);
    const card = screen.getByRole("region", { name: /Up next: Sample A2/ });
    expect(within(card).getByRole("region", { name: "What to do next" }).textContent).toMatch(/^Call back/);
    // The page's one gold button is on the card; the header has none.
    expect(screen.queryByRole("button", { name: /Start calling/ })).toBeNull();
    const call = within(card).getByRole("link", { name: "Call Sample A2" });
    expect(call.getAttribute("href")).toBeTruthy();
    expect(call.className).toMatch(/bg-primary/);
    fireEvent.click(call);
    const sheet = await screen.findByRole("dialog");
    expect((await within(sheet).findAllByRole("heading", { level: 2, name: "Sample A2" })).length).toBeGreaterThan(0);
    // Position and Skip ride on the sheet's top row.
    expect(sheet.textContent).toMatch(/1 of 3/);
    expect(within(sheet).getByRole("button", { name: /Skip/ })).toBeTruthy();
  });

  it("phone: See details opens the person without dialing; a person with no phone gets Email for a working number", async () => {
    setViewport("phone");
    db.rows = [makeRow("a3", { state: null, phone: null })];
    renderAt("/dashboard/recruiting?queue=all_open");
    const card = await screen.findByRole("region", { name: /Up next: Sample A3/ });
    expect(within(card).getByRole("region", { name: "What to do next" }).textContent).toMatch(/^Email for a working number/);
    const email = within(card).getByRole("link", { name: "Email Sample A3" });
    expect(email.getAttribute("href")).toBe("mailto:a3@example.test");
    expect(within(card).queryByRole("link", { name: /^Call/ })).toBeNull();
    fireEvent.click(within(card).getByRole("button", { name: "See details" }));
    expect(await screen.findByRole("dialog")).toBeTruthy();
  });

  it("desktop: no Up next card, the panel beside the list is the person to call", async () => {
    setViewport("desktop");
    renderAt("/dashboard/recruiting?queue=all_open");
    await screen.findByRole("complementary", { name: "Selected person" });
    expect(screen.queryByRole("region", { name: /Up next:/ })).toBeNull();
  });
});

describe("RecruitingWorklist failed loads (review)", () => {
  it("a failed first load replaces the page with the error and a retry", async () => {
    setViewport("desktop");
    db.rowsFail = true;
    renderAt("/dashboard/recruiting?queue=all_open");
    expect(await screen.findByText(/The recruiting worklist could not load/)).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Queue" })).toBeNull();
    expect(screen.getByRole("button", { name: /Try again/ })).toBeTruthy();
  });

  it("a failed reload keeps the queue on screen behind a stale notice, and a retry clears it", async () => {
    setViewport("desktop");
    db.hiddenFromPage = ["a3"];
    renderAt("/dashboard/recruiting?queue=all_open");
    await screen.findByRole("list", { name: "Queue" });

    db.rowsFail = true;
    // The coverage warning's Reload (the scoreboard notice carries one too; both refetch).
    const coverageBanner = screen.getByText(/not in this list/).closest("[role=status]");
    if (!coverageBanner) throw new Error("coverage warning is not a live region");
    fireEvent.click(within(coverageBanner as HTMLElement).getByRole("button", { name: /Reload/ }));
    const stale = await screen.findByText(/The latest reload failed/);
    expect(stale.textContent).toMatch(/^Showing records loaded /);
    const notice = stale.closest("[role=status]");
    if (!notice) throw new Error("stale notice is not a live region");
    // The people being worked are still there; the full-page error is not.
    expect(within(screen.getByRole("list", { name: "Queue" })).getByRole("button", { name: /Sample A1/ })).toBeTruthy();
    expect(screen.queryByText(/The recruiting worklist could not load/)).toBeNull();

    db.rowsFail = false;
    fireEvent.click(within(notice as HTMLElement).getByRole("button", { name: /Retry/ }));
    await waitFor(() => expect(screen.queryByText(/The latest reload failed/)).toBeNull());
    expect(screen.getByRole("list", { name: "Queue" })).toBeTruthy();
  });
});

describe("RecruitingWorklist table columns (F28 configurable)", () => {
  const COLUMNS_KEY = `recruiting-worklist:v1:columns:${ME}`;

  function stubPopoverLayout() {
    // Radix positions the popover with ResizeObserver, which jsdom does not ship.
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  }

  it("a hidden column leaves the header and body, narrows the table, and survives a reload for this viewer", async () => {
    stubPopoverLayout();
    setViewport("desktop");
    const first = renderAt("/dashboard/recruiting?queue=all_open&view=table");
    const table = await screen.findByRole("table");
    expect(within(table).getByRole("columnheader", { name: "Phone" })).toBeTruthy();
    // The phone cells are there before the hide, so their absence afterwards means something.
    expect(within(table).getAllByText("(555) 555-0123").length).toBeGreaterThan(0);
    expect(table.style.minWidth).toBe("980px");

    fireEvent.click(screen.getByRole("button", { name: "Columns" }));
    expect((screen.getByRole("checkbox", { name: /Name/ }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole("checkbox", { name: "Phone" }));

    await waitFor(() => expect(within(screen.getByRole("table")).queryByRole("columnheader", { name: "Phone" })).toBeNull());
    expect(within(screen.getByRole("table")).queryByText("(555) 555-0123")).toBeNull();
    expect(screen.getByRole("table").style.minWidth).toBe("876px");
    expect(screen.getByRole("button", { name: /Columns \(1 hidden\)/ })).toBeTruthy();
    expect(JSON.parse(window.localStorage.getItem(COLUMNS_KEY) ?? "[]")).not.toContain("phone");

    first.unmount();
    renderAt("/dashboard/recruiting?queue=all_open&view=table");
    const again = await screen.findByRole("table");
    expect(within(again).queryByRole("columnheader", { name: "Phone" })).toBeNull();
    expect(within(again).getByRole("columnheader", { name: "Next action" })).toBeTruthy();
  });

  it("Show all brings every column back", async () => {
    stubPopoverLayout();
    setViewport("desktop");
    window.localStorage.setItem(COLUMNS_KEY, JSON.stringify(["name", "next_action", "due"]));
    renderAt("/dashboard/recruiting?queue=all_open&view=table");
    const table = await screen.findByRole("table");
    expect(within(table).getAllByRole("columnheader").map((th) => th.textContent)).toEqual(["Name", "Next action", "Due"]);

    fireEvent.click(screen.getByRole("button", { name: /Columns \(7 hidden\)/ }));
    fireEvent.click(screen.getByRole("button", { name: "Show all" }));
    await waitFor(() => expect(within(screen.getByRole("table")).getAllByRole("columnheader")).toHaveLength(10));
    expect(screen.getByRole("table").style.minWidth).toBe("980px");
  });

  it("the chooser exists only in the Table view", async () => {
    setViewport("desktop");
    renderAt("/dashboard/recruiting?queue=all_open");
    await screen.findByRole("list", { name: "Queue" });
    expect(screen.queryByRole("button", { name: /Columns/ })).toBeNull();
  });
});

describe("RecruitingWorklist data status (F29)", () => {
  it("one scope line; provenance sits inside the Data status disclosure and reads complete", async () => {
    setViewport("desktop");
    renderAt("/dashboard/recruiting?queue=all_open");
    await screen.findByRole("list", { name: "Queue" });
    // The page is called what the tab, sidebar and breadcrumb call it.
    expect(screen.getByRole("heading", { level: 1, name: "Call list" })).toBeTruthy();
    expect(screen.getByText(/^Organization-wide/)).toBeTruthy();
    expect(screen.getByText(/Everyone: 3 people\./)).toBeTruthy();
    // The classic view is one tap away, behind Filters.
    openMore();
    expect(screen.getByRole("link", { name: "Classic applicants view" })).toBeTruthy();

    const details = dataStatus();
    expect(details.querySelector("summary")?.textContent).toContain("complete, 3 of 3 eligible records loaded");
    expect(within(details).getByText("Worklist records loaded").nextElementSibling?.textContent).toBe("3");
    expect(within(details).getByText("Live records you can see").nextElementSibling?.textContent).toBe("5");
    expect(within(details).getByText("Marked duplicate, not shown").nextElementSibling?.textContent).toBe("1");
    expect(within(details).getByText("Interview bookings or tests, not shown").nextElementSibling?.textContent).toBe("1");
    expect(within(details).getByText(/List rule: Every open recruit you can see\./)).toBeTruthy();
    expect(within(details).getByText(/Phoenix business day/)).toBeTruthy();
    // Nothing is missing, so no warning anywhere on the page.
    expect(screen.queryByText(/not in this list/)).toBeNull();
    expect(screen.queryByText(/counts disagree/)).toBeNull();
    // Today's numbers show only because the load reconciled with the eligible count.
    const board = screen.getByRole("region", { name: "Today's numbers" });
    expect(board.textContent).not.toContain("—");
    expect(screen.queryByText(/Today's numbers are hidden/)).toBeNull();
  });

  it("an eligible record that did not load is a warning with a reload, outside the disclosure, never hidden", async () => {
    setViewport("desktop");
    db.hiddenFromPage = ["a3"];
    renderAt("/dashboard/recruiting?queue=all_open");
    await screen.findByRole("list", { name: "Queue" });
    const warning = screen.getByText(/1 eligible record is not in this list/);
    expect(warning.closest("details")).toBeNull();
    const banner = warning.closest("[role=status]");
    if (!banner) throw new Error("warning is not a live region");
    expect(within(banner as HTMLElement).getByRole("button", { name: /Reload/ })).toBeTruthy();
    expect(dataStatus().querySelector("summary")?.textContent).toContain("incomplete, 1 of 3 eligible records not loaded");
    expect(screen.getByText(/Everyone: 2 people\./)).toBeTruthy();
    // A number computed from a short load is never shown as today's number: a dash, the reason, a reload.
    const board = screen.getByRole("region", { name: "Today's numbers" });
    expect(within(board).getAllByText("—")).toHaveLength(4);
    expect(within(board).getByText(/Today's numbers are hidden until every eligible record is loaded/)).toBeTruthy();
    expect(within(board).getByRole("button", { name: /Reload/ })).toBeTruthy();
  });

  it("a failed count reads Unavailable with a retry, never a zero", async () => {
    setViewport("desktop");
    db.countsFail = true;
    renderAt("/dashboard/recruiting?queue=all_open");
    await screen.findByRole("list", { name: "Queue" });
    const details = dataStatus();
    expect(details.querySelector("summary")?.textContent).toContain("coverage unknown, 3 loaded and the eligible count is unavailable");
    expect(within(details).getByText("Live records you can see").nextElementSibling?.textContent).toBe("Unavailable");
    expect(within(details).getByText("Marked duplicate, not shown").nextElementSibling?.textContent).toBe("Unavailable");
    expect(within(details).getByText("Interview bookings or tests, not shown").nextElementSibling?.textContent).toBe("Unavailable");
    expect(within(details).getByRole("button", { name: /Retry the counts/ })).toBeTruthy();
    expect(details.textContent).not.toMatch(/\b0 marked duplicate\b/);
    expect(screen.queryByText(/not in this list/)).toBeNull();
    // Unverified is not zero: the scoreboard withholds all four numbers and says why.
    const board = screen.getByRole("region", { name: "Today's numbers" });
    expect(within(board).getAllByText("—")).toHaveLength(4);
    expect(within(board).getByText(/Today's numbers are hidden because the record counts could not be checked/)).toBeTruthy();
    expect(within(board).getByRole("button", { name: /Reload/ })).toBeTruthy();
  });
});
