/**
 * CalendarPage truth states (review of F30 / F31 / F32 in the 2026-10-14
 * Galaxy OS map). Renders the real page with the two feeds and the count RPC
 * stubbed and checks what an operator sees:
 *   - a feed that failed or has not answered never prints "0 events in view",
 *     "Nothing on this day" or "Nothing in the next 14 days"; the selected
 *     day, the agenda and every grid cell say unavailable or loading instead;
 *   - a fetch paused offline (pending, nothing in flight) is loading, not an
 *     empty calendar;
 *   - the kind chips count the painted rows and follow "Show canceled" while
 *     the server total does not;
 *   - a Today count kept after a failed refresh offers Retry;
 *   - "No leads found" never sits beside the exact-match panel, and the
 *     submit button names the step in progress.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider, onlineManager } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";
import type { AgendaViewRow, CalendarWindowRow } from "@/lib/calendarAgenda";
import type { LeadResult } from "@/lib/leadSearch";

type Feed = { rows: unknown[]; truncated: boolean };
const feeds = vi.hoisted(() => ({
  window: (() => Promise.resolve({ rows: [], truncated: false })) as () => Promise<Feed>,
  agenda: (() => Promise.resolve({ rows: [], truncated: false })) as () => Promise<Feed>,
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-1" }, isAdmin: true, isManager: false, isVaManager: false, isVa: false }),
}));
vi.mock("@/hooks/useBusinessToday", () => ({ useBusinessToday: () => "2026-10-15" }));
vi.mock("@/hooks/useSoundEffects", () => ({ useSoundEffects: () => ({ playSound: () => undefined }) }));
vi.mock("@/components/dashboard/InterviewScheduler", () => ({
  InterviewScheduler: ({ applicantName }: { applicantName: string }) => <p>Scheduler for {applicantName}</p>,
}));
vi.mock("@/components/calendar/calendarApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/calendar/calendarApi")>()),
  fetchWindowRows: () => feeds.window(),
  fetchAgendaRows: () => feeds.agenda(),
}));

import CalendarPage from "@/pages/CalendarPage";

const ME = "user-1";
const AT = "2026-10-15T22:00:00.000Z"; // 3:00 PM Phoenix, after the faked "now"

const windowRow = (event_id: string, over: Partial<CalendarWindowRow> = {}): CalendarWindowRow => ({
  event_id,
  event_date: "2026-10-15",
  event_at: AT,
  kind: "interview",
  title: "Synthetic Person",
  subtitle: null,
  person_name: null,
  status: "scheduled",
  ref_id: null,
  link: null,
  ...over,
});
const agendaRow = (event_key: string, over: Partial<AgendaViewRow> = {}): AgendaViewRow => ({
  event_key,
  source_table: "interview_events",
  ref_id: event_key.slice(event_key.indexOf(":") + 1),
  kind: "interview",
  title: "Synthetic Person",
  person_name: null,
  person_email: null,
  application_id: null,
  agent_id: null,
  owner_user_id: ME,
  starts_at: AT,
  ends_at: null,
  event_tz: "America/Phoenix",
  meeting_link: null,
  status: "scheduled",
  outcome: null,
  booking_source: "manual",
  call_track: null,
  reminder_state: "pending",
  reschedule_url: null,
  cancel_url: null,
  was_rescheduled: false,
  cancel_reason: null,
  notes: null,
  updated_at: null,
  ...over,
});

// One live interview, one canceled interview, one birthday. The server's count
// RPC says interview 2 (it counts the canceled one); the list paints 1 with
// "Show canceled" off. Same shape as October 2026 measured live (7 vs 6).
const WINDOW = [
  windowRow("interview:a"),
  windowRow("interview:b", { status: "cancelled", title: "Canceled Person" }),
  windowRow("bday:c:2026", { kind: "birthday", status: "birthday", title: "Synthetic Birthday", event_at: "2026-10-15T07:00:00.000Z" }),
];
const AGENDA = [agendaRow("interview:a"), agendaRow("interview:b", { status: "canceled", title: "Canceled Person" })];
const SERVER_COUNTS = [{ kind: "interview", n: 2 }, { kind: "birthday", n: 1 }];

type Res = { data: unknown; error: unknown };
let countsResult: () => Res = () => ({ data: SERVER_COUNTS, error: null });
const appQueue: Array<Res | Promise<Res>> = [];

function chainFor(table: string) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "or", "is", "in", "order", "limit", "eq", "insert", "single"]) {
    chain[method] = () => chain;
  }
  chain.then = (onFulfilled: (r: Res) => unknown, onRejected?: (e: unknown) => unknown) => {
    const next = table === "applications" ? appQueue.shift() : { data: [], error: null };
    const result = next ?? { data: null, error: { message: `unexpected read of ${table}` } };
    return Promise.resolve(result).then(onFulfilled, onRejected);
  };
  return chain;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <CalendarPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}

/** The KPI tile whose label is exactly `label` (the header also has a "Today" button). */
function tile(label: string): HTMLElement {
  const p = screen.getAllByText(label).find((el) => el.tagName === "P");
  if (!p?.parentElement) throw new Error(`no tile labelled ${label}`);
  return p.parentElement;
}

/**
 * Only the tile's number, never its caption: the caption carries the range
 * ("Oct 15 – Oct 28, 2026"), so a digit or "2" check on the whole tile would
 * pass on the year and prove nothing.
 */
function tileValue(label: string): HTMLElement {
  const value = tile(label).children[1];
  if (!(value instanceof HTMLElement) || value.tagName !== "DIV") throw new Error(`no value under ${label}`);
  return value;
}

const okFeeds = () => {
  feeds.window = () => Promise.resolve({ rows: WINDOW, truncated: false });
  feeds.agenda = () => Promise.resolve({ rows: AGENDA, truncated: false });
};
const failedFeeds = () => {
  feeds.window = () => Promise.reject(new Error("feed down"));
  feeds.agenda = () => Promise.reject(new Error("feed down"));
};

beforeEach(() => {
  // Only Date is faked: the page seeds its anchor from the clock; timers stay real.
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-15T19:00:00.000Z"));
  localStorage.clear();
  appQueue.length = 0;
  countsResult = () => ({ data: SERVER_COUNTS, error: null });
  vi.mocked(supabase.rpc).mockImplementation(((fn: string) => Promise.resolve(
    fn === "calendar_window_counts" ? countsResult() : { data: null, error: { message: `no stub for ${fn}` } },
  )) as never);
  vi.mocked(supabase.from).mockImplementation(((table: string) => chainFor(table)) as never);
});

afterEach(() => {
  onlineManager.setOnline(true);
  vi.useRealTimers();
});

describe("a failed or unread feed is never shown as zero or empty", () => {
  it("both feeds failed: the agenda says it could not load and the banner says neither feed answered", async () => {
    failedFeeds();
    renderPage();
    expect(await screen.findByText("The agenda could not load.")).toBeInTheDocument();
    expect(screen.getByText(/Neither the date feed nor the appointments feed answered \(feed down\)\./)).toBeInTheDocument();
    expect(screen.queryByText(/interviews are shown read-only from the date feed/)).toBeNull();
    expect(screen.queryByText(/Nothing in the next 14 days/)).toBeNull();
    expect(screen.queryByText(/0 events in view/)).toBeNull();
    expect(tileValue("In view")).toHaveTextContent(/Unavailable/);
    expect(tileValue("In view").textContent).not.toMatch(/\d/);
  });

  it("both feeds failed in month view: the selected day and every grid cell say unavailable, never 0 events", async () => {
    failedFeeds();
    renderPage();
    await screen.findByText("The agenda could not load.");
    fireEvent.click(screen.getByRole("button", { name: "month" }));
    const header = (await screen.findByText("Thursday, October 15, 2026")).parentElement as HTMLElement;
    await waitFor(() => expect(within(header).getByRole("alert")).toHaveTextContent(/Unavailable/));
    expect(within(header).getByRole("button", { name: /Retry/ })).toBeInTheDocument();
    expect(screen.queryByText(/0 events in view/)).toBeNull();
    expect(screen.queryByText(/Nothing on this day/)).toBeNull();
    const cells = screen.getAllByRole("button", { name: /^\w+day, \w+ \d+: / });
    expect(cells.length).toBeGreaterThanOrEqual(28);
    for (const cell of cells) expect(cell).toHaveAccessibleName(/: events unavailable$/);
  });

  it("while loading in month view the selected day shows the loading state, not 0 events", async () => {
    feeds.window = () => new Promise<Feed>(() => undefined);
    feeds.agenda = () => new Promise<Feed>(() => undefined);
    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "month" }));
    expect(await screen.findByText("Loading this day's events")).toBeInTheDocument();
    expect(screen.queryByText(/0 events in view/)).toBeNull();
    expect(screen.queryByText(/Nothing on this day/)).toBeNull();
  });

  it("a fetch paused offline is loading, not an empty calendar or a 0, and loads when the network returns", async () => {
    okFeeds();
    onlineManager.setOnline(false);
    renderPage();
    expect(await screen.findByText("Loading events in view")).toBeInTheDocument();
    expect(screen.queryByText(/Nothing in the next 14 days/)).toBeNull();
    expect(tileValue("In view").textContent).not.toMatch(/\d/);
    act(() => { onlineManager.setOnline(true); });
    await waitFor(() => expect(tileValue("In view")).toHaveTextContent(/^2$/));
  });
});

describe("kind chips and the Today tile", () => {
  it("the Interview chip counts the painted rows and follows Show canceled; In view moves with it", async () => {
    okFeeds();
    renderPage();
    const chip = await screen.findByRole("button", { name: /^Interview\s*1$/ });
    expect(chip).toHaveAttribute("title", "Source: interview_events");
    expect(tileValue("In view")).toHaveTextContent(/^2$/);
    fireEvent.click(screen.getByRole("switch", { name: "Show canceled events" }));
    expect(await screen.findByRole("button", { name: /^Interview\s*2$/ })).toBeInTheDocument();
    expect(tileValue("In view")).toHaveTextContent(/^3$/);
  });

  it("a Today count kept after a failed refresh offers Retry, and Retry clears it", async () => {
    okFeeds();
    const client = renderPage();
    await waitFor(() => expect(tileValue("Today")).toHaveTextContent(/^3$/));
    countsResult = () => ({ data: null, error: { message: "counts down" } });
    await act(async () => { await client.refetchQueries({ queryKey: ["calendar-window-counts-today"] }); });
    const retry = await within(tile("Today")).findByRole("button", { name: "Retry today's events" });
    expect(within(tileValue("Today")).getByText("3")).toBeInTheDocument();
    expect(tile("Today")).toHaveTextContent(/last good value; the refresh failed/);
    countsResult = () => ({ data: SERVER_COUNTS, error: null });
    fireEvent.click(retry);
    await waitFor(() => expect(within(tile("Today")).queryByRole("button", { name: "Retry today's events" })).toBeNull());
    expect(tile("Today")).not.toHaveTextContent(/refresh failed/);
    expect(tileValue("Today")).toHaveTextContent(/^3$/);
  });
});

describe("Add New Applicant", () => {
  const existing: LeadResult = {
    id: "app-existing", first_name: "Existing", last_name: "Person", email: "dup@example.com",
    phone: null, status: "new", is_duplicate: false, duplicate_of: null,
  };
  const created: LeadResult = {
    id: "app-new", first_name: "Synthetic", last_name: "Person", email: "new.person@example.com",
    phone: null, status: "new", is_duplicate: false, duplicate_of: null,
  };

  it("hides 'No leads found' beside the exact-match panel and names the check and the insert separately", async () => {
    okFeeds();
    const lookup = deferred<Res>();
    const insert = deferred<Res>();
    appQueue.push({ data: [], error: null }, lookup.promise);
    renderPage();

    fireEvent.click(await screen.findByRole("button", { name: /Schedule interview/ }));
    fireEvent.change(await screen.findByPlaceholderText("Search by name, email, or phone..."), { target: { value: "zz" } });
    expect(await screen.findByText("No leads found")).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText("First Name *"), { target: { value: "Synthetic" } });
    fireEvent.change(screen.getByPlaceholderText("Last Name *"), { target: { value: "Person" } });
    fireEvent.change(screen.getByPlaceholderText("Email *"), { target: { value: "dup@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Add & Schedule" }));
    expect(await screen.findByRole("button", { name: "Checking..." })).toBeDisabled();

    await act(async () => { lookup.resolve({ data: [existing], error: null }); });
    expect(await screen.findByText(/An applicant with this email already exists/)).toBeInTheDocument();
    expect(screen.queryByText("No leads found")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(await screen.findByText("No leads found")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("Email *"), { target: { value: "new.person@example.com" } });
    appQueue.push({ data: [], error: null }, insert.promise);
    fireEvent.click(screen.getByRole("button", { name: "Add & Schedule" }));
    expect(await screen.findByRole("button", { name: "Adding..." })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Checking..." })).toBeNull();

    await act(async () => { insert.resolve({ data: created, error: null }); });
    expect(await screen.findByText("Scheduler for Synthetic Person")).toBeInTheDocument();
  });
});
