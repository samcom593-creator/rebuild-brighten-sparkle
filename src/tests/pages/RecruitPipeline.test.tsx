/**
 * New hires page (src/pages/RecruitPipeline.tsx), Grow review fixes 2026-10-28.
 *
 * A failed recruit list is dashes, no stage chips and a reason with Retry, never zeros (5).
 * The header carries no button and the export lives with the filters (18). Red is kept for
 * the one destructive action; stale time is a warning and missing data is a muted link (19).
 * "No longer with us" sits behind a per-row More menu and stays two-step (20). Every row
 * and toolbar control is 44px tall with words no smaller than 13px, the bulk Move is 48px
 * (21, 34). Call and Text are labelled and record nothing (22). The next-step button says
 * "Move to X" or "Last step", and the chips carry no numeric prefixes (23). The Open
 * onboarding tile opens the onboarding queue (24). Every count on a button is the rows a
 * tap on it shows.
 *
 * Colour layer (2026-10-28, docs/DESIGN_SYSTEM.md "Colour, motion and sound"): every colour
 * is a rung of src/lib/hireLadder.ts through hireRungTone; the rung is said in words beside
 * the name and the initials bubble is hidden from assistive technology; a move up to
 * Producing is the full burst once, from the pressed button, any other step the pop, a bulk
 * move one success note, a close quiet, and a failed write the error toast alone. Nothing
 * plays on load.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Row = Record<string, unknown>;

const db = vi.hoisted(() => ({
  rows: [] as Row[],
  rowsError: null as null | { message: string },
  facts: [] as Row[],
  factsError: null as null | { message: string },
  rpcCalls: [] as Array<{ fn: string; args: unknown }>,
  /** What set_recruit_stage answers: an error, or a body such as { matched: false }. */
  writeError: null as null | { message: string },
  writeResult: null as null | Record<string, unknown>,
  /** What set_recruit_stage_bulk answers. */
  bulkResult: { moved: 2 } as Record<string, unknown>,
}));
const confirmMock = vi.hoisted(() => vi.fn(async (_opts: unknown) => true));
const removed = vi.hoisted(() => ({ calls: [] as unknown[] }));

const STAGES = [
  { stage_key: "applied", order_index: 1, display_name: "Applied", is_terminal: false, retired_at: null },
  { stage_key: "contacted", order_index: 2, display_name: "Contacted", is_terminal: false, retired_at: null },
  // Derived only: the engine sets it from evidence, so "Move to" skips over it.
  { stage_key: "watched_vsl", order_index: 3, display_name: "Watched video", is_terminal: false, retired_at: null },
  { stage_key: "interview_booked", order_index: 4, display_name: "Interview booked", is_terminal: false, retired_at: null },
  // Retired: kept in the table for history, never shown or offered.
  { stage_key: "seminar_booked", order_index: 5, display_name: "Seminar booked", is_terminal: false, retired_at: "2026-01-01T00:00:00Z" },
  { stage_key: "hired_unlicensed", order_index: 12, display_name: "Hired, unlicensed", is_terminal: false, retired_at: null },
  { stage_key: "licensed", order_index: 13, display_name: "Licensed", is_terminal: false, retired_at: null },
  { stage_key: "first_deal", order_index: 14, display_name: "First deal", is_terminal: true, retired_at: null },
  { stage_key: "closed_lost", order_index: 99, display_name: "Closed", is_terminal: true, retired_at: null },
];

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    from: (table: string) => {
      const q: Record<string, unknown> = {};
      q.select = () => q;
      q.order = () => Promise.resolve(table === "next_step_stages" ? { data: STAGES, error: null } : { data: [], error: null });
      return q;
    },
    rpc: (fn: string, args?: unknown) => {
      db.rpcCalls.push({ fn, args });
      if (fn === "recruit_pipeline_list") return Promise.resolve(db.rowsError ? { data: null, error: db.rowsError } : { data: db.rows, error: null });
      if (fn === "onboarding_exception_facts") return Promise.resolve(db.factsError ? { data: null, error: db.factsError } : { data: db.facts, error: null });
      if (fn === "set_recruit_stage") return Promise.resolve(db.writeError ? { data: null, error: db.writeError } : { data: db.writeResult, error: null });
      if (fn === "set_recruit_stage_bulk") return Promise.resolve(db.writeError ? { data: null, error: db.writeError } : { data: db.bulkResult, error: null });
      return Promise.resolve({ data: null, error: null });
    },
    channel: () => { const c = { on: () => c, subscribe: () => c }; return c; },
    removeChannel: () => {},
    functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "me" }, isAdmin: true, isManager: false, isVa: false, isVaManager: false, isRecruiter: false }),
}));
vi.mock("@/hooks/useConfirm", () => ({ useConfirm: () => confirmMock }));
vi.mock("@/lib/noLongerWithUs", () => ({
  markNoLongerWithUs: async (args: unknown) => { removed.calls.push(args); return { ok: true, message: "removed", emailFailed: false }; },
}));
// The burst and the sounds are spied, never run: jsdom has no canvas and no audio.
vi.mock("@/lib/celebrate", () => ({ celebrate: vi.fn(() => Promise.resolve()), prefersReducedMotion: () => true }));
vi.mock("@/hooks/useSoundEffects", () => ({ playSoundEffect: vi.fn(), useSoundEffects: () => ({ playSound: vi.fn() }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));

import RecruitPipeline from "@/pages/RecruitPipeline";
import { celebrate } from "@/lib/celebrate";
import { playSoundEffect } from "@/hooks/useSoundEffects";
import { toast } from "sonner";

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY).toISOString();
let seq = 0;
function person(over: Row & { display_name: string; person_type: "applicant" | "agent"; stage_key: string }): Row {
  seq += 1;
  const st = STAGES.find((s) => s.stage_key === over.stage_key)!;
  return {
    application_id: over.person_type === "applicant" ? `app-${seq}` : null,
    agent_id: over.person_type === "agent" ? `agent-${seq}` : null,
    phone: null, email: null, state: null, stage_name: st.display_name, order_index: st.order_index,
    entered_at: daysAgo(2), days_in_stage: 2, is_stalled: false, next_action_label: null,
    manager_name: "Sam James", license_status: null, license_progress: null, npn: null, last_contacted_at: null,
    manual_stage_key: null, status: "active", instagram: null, link_sent_at: null, link_used_at: null,
    last_sign_in_at: null, resident_state: "TX",
    ...over,
  };
}

// Ana: applicant on the first step, no state on file. Bo: applicant 25 days on a step, email only.
// Cy: hired, unlicensed agent 70 days on a step, no login link sent. Di: licensed agent on the
// last step. Ed: closed, so hidden unless "Show closed people too" is on.
const ana = person({ display_name: "Ana Ruiz", person_type: "applicant", stage_key: "applied", phone: "6015551001", resident_state: null, last_contacted_at: daysAgo(3) });
const bo = person({ display_name: "Bo Lee", person_type: "applicant", stage_key: "contacted", days_in_stage: 25, email: "bo@example.test" });
const cy = person({ display_name: "Cy Dunn", person_type: "agent", stage_key: "hired_unlicensed", agent_id: "agent-cy", days_in_stage: 70, phone: "6015551003", license_status: "unlicensed", license_progress: "course_purchased", manager_name: null });
const di = person({ display_name: "Di Park", person_type: "agent", stage_key: "first_deal", agent_id: "agent-di", days_in_stage: 1, phone: "6015551004", license_status: "licensed", license_progress: "licensed", link_used_at: daysAgo(1), instagram: "di.park" });
const ed = person({ display_name: "Ed Kim", person_type: "applicant", stage_key: "closed_lost", status: "closed", days_in_stage: 5 });
const EVERYONE = [ana, bo, cy, di, ed];

const DI_FACTS: Row = {
  agent_id: "agent-di", agent_name: "Di Park", owner_agent_id: null, owner_name: null, agent_status: "active",
  license_status: "licensed", onboarding_stage: null, hired_at: daysAgo(30), start_date: null, licensed_at: daysAgo(20),
  has_account: true, last_sign_in_at: daysAgo(1), login_link_sent_at: daysAgo(2), login_link_used_at: daysAgo(1),
  has_profile: true, licensing_ready: true, intake_status: "complete", intake_at: daysAgo(25), contracting_started: true,
  eo_on_file: true, eft_on_file: true, carrier_active_count: 2, carrier_pending_count: 0, carrier_first_active_at: daysAgo(10),
  training_required_total: 3, training_required_passed: 3, training_started: true, training_last_activity_at: daysAgo(3),
  has_dialer_login: true, onboarding_call_event_id: "evt-1", onboarding_call_at: daysAgo(20), onboarding_call_outcome: "attended",
  first_deal_at: daysAgo(1), expected_start_on: "2026-11-02", expected_start_status: "confirmed", expected_start_set_at: daysAgo(5),
  start_outcome: null, start_outcome_on: null, start_outcome_at: null, last_outreach_at: null, last_outreach_kind: null,
};

function LocationProbe() {
  const { pathname } = useLocation();
  return <output data-testid="location">{pathname}</output>;
}

function renderPage(path = "/dashboard/recruits") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <RecruitPipeline />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const board = () => screen.getByRole("region", { name: "New hire numbers" });
const tile = (label: string) => within(board()).getByRole("button", { name: new RegExp(`^${label.replace("+", "\\+")}`) });
const peopleShown = () => screen.getAllByRole("checkbox", { name: /^Select (?!everyone)/ }).length;
/** The "N shown" line; the N sits in its own span, so match the whole element's text. */
const shownLine = () => screen.getByText((_, el) => el?.tagName === "SPAN" && /^\d+ shown$/.test(el.textContent ?? ""));
const writes = () => db.rpcCalls.filter((c) => c.fn !== "recruit_pipeline_list" && c.fn !== "onboarding_exception_facts");
/** A person's row (an li), and the initials bubble in it: the one 40px round span. */
const rowOf = (name: string) => screen.getByText(name).closest("li") as HTMLElement;
const bubbleIn = (row: HTMLElement) => row.querySelector("span.h-10.w-10.rounded-full") as HTMLElement;
/** The tinted bubble around a lucide icon, by the icon's class. */
const iconBubble = (root: HTMLElement, icon: string) => root.querySelector(`svg.lucide-${icon}`)?.parentElement as HTMLElement | undefined;

beforeEach(() => {
  db.rows = EVERYONE;
  db.rowsError = null;
  db.facts = [DI_FACTS];
  db.factsError = null;
  db.rpcCalls = [];
  db.writeError = null;
  db.writeResult = null;
  db.bulkResult = { moved: 2 };
  removed.calls = [];
  confirmMock.mockReset();
  confirmMock.mockResolvedValue(true);
  vi.mocked(celebrate).mockClear();
  vi.mocked(playSoundEffect).mockClear();
  vi.mocked(toast.success).mockClear();
  vi.mocked(toast.error).mockClear();
  vi.mocked(toast.warning).mockClear();
  // Radix positions menus and popovers with ResizeObserver, which jsdom does not ship.
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
});

afterEach(() => vi.unstubAllGlobals());

describe("New hires", () => {
  it("every number is a list: tiles and chips count exactly the rows a tap shows, with no numeric prefixes", async () => {
    renderPage();
    await screen.findByText("Ana Ruiz");

    expect(tile("In progress")).toHaveTextContent(/In progress\s*4/);
    expect(tile("Stuck 7+ days")).toHaveTextContent(/Stuck 7\+ days\s*2/);
    expect(tile("Stuck 60+ days")).toHaveTextContent(/Stuck 60\+ days\s*1/);
    expect(peopleShown()).toBe(4);
    expect(shownLine()).toHaveTextContent("4 shown");

    const chips = screen.getByRole("navigation", { name: "Stages" });
    expect(within(chips).getByRole("button", { name: /^All\s*4$/ })).toBeInTheDocument();
    expect(within(chips).getByRole("button", { name: /^Applied\s*1$/ })).toBeInTheDocument();
    expect(within(chips).getByRole("button", { name: /^Hired, unlicensed\s*1$/ })).toBeInTheDocument();
    for (const b of within(chips).getAllByRole("button")) expect(b.textContent).not.toMatch(/^\d+\./);
    expect(within(chips).queryByRole("button", { name: /Seminar booked/ })).toBeNull();
    expect(within(chips).queryByRole("button", { name: /^Closed/ })).toBeNull();
    // Section headings carry the step's name, not its number.
    expect(screen.getByRole("heading", { level: 2, name: "Applied" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: /^\d+\./ })).toBeNull();

    fireEvent.click(tile("Stuck 7+ days"));
    expect(tile("Stuck 7+ days")).toHaveAttribute("aria-pressed", "true");
    expect(peopleShown()).toBe(2);
    expect(shownLine()).toHaveTextContent("2 shown");
    expect(screen.getByRole("button", { name: "Remove Stuck 7+ days filter" })).toBeInTheDocument();
    // With the idle filter on, the chips count within it, so a chip is still exactly its list.
    expect(within(chips).getByRole("button", { name: /^All\s*2$/ })).toBeInTheDocument();
    fireEvent.click(within(chips).getByRole("button", { name: /^Contacted\s*1$/ }));
    expect(peopleShown()).toBe(1);
    expect(screen.getByText("Bo Lee")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove Step: Contacted filter" })).toBeInTheDocument();

    // Closed people are hidden until asked for.
    expect(screen.queryByText("Ed Kim")).toBeNull();
  });

  it("the ?q= deep link from the onboarding queue prefilters the list", async () => {
    renderPage("/dashboard/recruits?q=Cy%20Dunn");
    await screen.findByText("Cy Dunn");
    expect(peopleShown()).toBe(1);
    expect(screen.getByRole("textbox", { name: "Search new hires" })).toHaveValue("Cy Dunn");
  });

  it("a failed recruit list is dashes, no stage chips and a reason with Retry, never zeros", async () => {
    db.rowsError = { message: "recruit list is down" };
    db.factsError = { message: "facts are down" };
    renderPage();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("The recruit list did not load: recruit list is down.");
    expect(within(board()).getAllByText("—")).toHaveLength(4);
    expect(within(board()).queryByText("0")).toBeNull();
    expect(screen.getByText(/numbers are hidden rather than shown as 0/)).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Stages" })).toBeNull();
    expect(screen.queryByText(/^All\s*0$/)).toBeNull();
    expect(screen.getByText("People did not load")).toBeInTheDocument();
    expect(screen.queryByText(/shown$/)).toBeNull();

    db.rowsError = null;
    db.factsError = null;
    fireEvent.click(within(alert).getByRole("button", { name: /Retry/ }));
    expect(await screen.findByText("Ana Ruiz")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("navigation", { name: "Stages" })).toBeInTheDocument();
    expect(tile("In progress")).toHaveTextContent(/In progress\s*4/);
  });

  it("the header has no button and a subtitle that fits a phone; the export lives in Filters", async () => {
    renderPage();
    await screen.findByText("Ana Ruiz");
    const header = screen.getByRole("heading", { level: 1, name: "New hires" }).closest("header") as HTMLElement;
    expect(within(header).queryAllByRole("button")).toHaveLength(0);
    expect(within(header).queryByText(/Download/)).toBeNull();
    const subtitle = screen.getByText("From hire to first deal, one step at a time.");
    expect(subtitle.textContent!.length).toBeLessThanOrEqual(48);
    // No gold button anywhere on the screen until something is selected.
    expect(document.querySelectorAll("button.bg-primary, a.bg-primary")).toHaveLength(0);

    fireEvent.click(screen.getByRole("button", { name: /^Filters/ }));
    const download = await screen.findByRole("button", { name: "Download this list (CSV)" });
    expect(download.className).toMatch(/\bh-11\b/);
  });

  it("Call and Text are labelled 44px buttons through the shared phone helpers, and a tap records nothing", async () => {
    renderPage();
    await screen.findByText("Ana Ruiz");
    const call = screen.getByRole("link", { name: "Call Ana Ruiz" });
    const text = screen.getByRole("link", { name: "Text Ana Ruiz" });
    expect(call).toHaveTextContent("Call");
    expect(text).toHaveTextContent("Text");
    expect(call.className).toMatch(/\bh-11\b/);
    expect(text.className).toMatch(/\bh-11\b/);
    // jsdom has no coarse pointer, so this is the desktop Google Voice path: https, in a new tab.
    expect(call.getAttribute("href")).toMatch(/^https:\/\/accounts\.google\.com\/AccountChooser\?continue=.*voice\.google\.com/);
    expect(call).toHaveAttribute("target", "_blank");
    expect(text).toHaveAttribute("target", "_blank");
    expect(screen.getByText("(601) 555-1001")).toBeInTheDocument();

    const stop = (e: Event) => e.preventDefault();
    document.addEventListener("click", stop, true);
    try {
      fireEvent.click(call);
      fireEvent.click(text);
    } finally {
      document.removeEventListener("click", stop, true);
    }
    expect(writes()).toHaveLength(0);
    // Email-only people get a mailto link; nobody gets a red warning for missing contact details.
    expect(screen.getByRole("link", { name: /bo@example\.test/ })).toHaveAttribute("href", "mailto:bo@example.test");
  });

  it("the next-step button says where it goes, skips derived steps, and reads Last step at the top", async () => {
    renderPage();
    await screen.findByText("Ana Ruiz");
    expect(screen.getByRole("button", { name: "Move to Contacted" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Move to Interview booked" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Watched video/ })).toBeNull();
    const last = screen.getByRole("button", { name: "Last step" });
    expect(last).toBeDisabled();
    expect(screen.queryByRole("button", { name: /^Done/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Move to Contacted" }));
    await waitFor(() => expect(writes().map((c) => c.fn)).toContain("set_recruit_stage"));
    expect(writes()[0].args).toMatchObject({ p_application_id: ana.application_id, p_to_stage: "contacted" });
  });

  it("a person whose step is not on their ladder keeps the step's name and gets no invented next step", async () => {
    db.rows = [ana, person({ display_name: "Fay Quinn", person_type: "agent", stage_key: "applied", agent_id: "agent-fay", phone: "6015551005" })];
    renderPage();
    await screen.findByText("Fay Quinn");
    expect(screen.getByRole("combobox", { name: "Stage for Fay Quinn" })).toHaveTextContent("Applied");
    expect(screen.getByRole("button", { name: "No next step" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Last step" })).toBeNull();
    expect(screen.getByRole("button", { name: "Move to Contacted" })).toBeEnabled();
  });

  it("the Open onboarding tile opens the onboarding queue and says so", async () => {
    renderPage();
    await screen.findByText("Ana Ruiz");
    const onboarding = tile("Open onboarding");
    expect(onboarding).toHaveAttribute("title", expect.stringContaining("onboarding queue"));
    fireEvent.click(onboarding);
    expect(screen.getByTestId("location")).toHaveTextContent("/dashboard/onboarding-ladder");
  });

  it("No longer with us lives in the row's More menu, only for agents, and stays two-step", async () => {
    renderPage();
    await screen.findByText("Ana Ruiz");
    expect(screen.queryByRole("button", { name: /No longer with us/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "More for Ana Ruiz" })).toBeNull();
    const more = screen.getByRole("button", { name: "More for Cy Dunn" });
    expect(more.className).toMatch(/\bh-11\b/);

    confirmMock.mockResolvedValueOnce(false);
    fireEvent.keyDown(more, { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /No longer with us/ }));
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
    expect(confirmMock.mock.calls[0][0]).toMatchObject({ title: "Cy Dunn is no longer with us?", tone: "danger" });
    expect(removed.calls).toHaveLength(0);

    confirmMock.mockResolvedValueOnce(true);
    fireEvent.keyDown(screen.getByRole("button", { name: "More for Cy Dunn" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("menuitem", { name: /No longer with us/ }));
    await waitFor(() => expect(removed.calls).toHaveLength(1));
    expect(removed.calls[0]).toMatchObject({ agentId: "agent-cy", displayName: "Cy Dunn" });
  });

  it("closing many people at once asks first", async () => {
    renderPage();
    await screen.findByText("Ana Ruiz");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Ana Ruiz" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Bo Lee" }));
    confirmMock.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole("button", { name: "Close all 2" }));
    await waitFor(() => expect(confirmMock).toHaveBeenCalledTimes(1));
    expect(confirmMock.mock.calls[0][0]).toMatchObject({ title: "Close 2 people?", tone: "danger" });
    expect(writes()).toHaveLength(0);
  });

  it("red is only the remove action; stale time is a warning and missing data is a muted link", async () => {
    renderPage();
    await screen.findByText("Ana Ruiz");
    const people = screen.getByRole("region", { name: "People" });
    expect(people.querySelectorAll(".text-destructive")).toHaveLength(0);
    expect(screen.getByText(/70 days on this step/).className).toMatch(/\btext-warning\b/);
    expect(screen.getByText(/25 days on this step/).className).toMatch(/\btext-warning\b/);
    expect(screen.getByText(/2 days on this step/).className).toMatch(/\btext-muted-foreground\b/);
    const addState = screen.getByRole("button", { name: "Add state for Ana Ruiz" });
    expect(addState).toHaveTextContent("Add state");
    expect(addState.className).toMatch(/\btext-muted-foreground\b/);
    expect(addState.className).toMatch(/\bunderline\b/);
    expect(addState.className).toMatch(/\bmin-h-11\b/);
    expect(screen.getByText("login link not sent").className).not.toMatch(/destructive/);
    expect(screen.getByText(/last contact 3 days ago/)).toBeInTheDocument();
  });

  it("one control scale: row and toolbar controls are 44px, the bulk Move is 48px, nothing under 13px", async () => {
    renderPage();
    await screen.findByText("Ana Ruiz");
    const h11 = (el: HTMLElement) => expect(el.className).toMatch(/\bh-11\b/);
    h11(screen.getByRole("button", { name: /Course Started/ }));
    h11(screen.getByRole("link", { name: "Instagram Di Park" }));
    h11(screen.getByRole("combobox", { name: "Stage for Ana Ruiz" }));
    h11(screen.getByRole("button", { name: "Move to Contacted" }));
    h11(screen.getByRole("button", { name: "Expected start for Di Park" }));
    expect(screen.getByRole("button", { name: "Expected start for Di Park" })).toHaveTextContent("Confirmed · 2026-11-02");
    const addIg = screen.getByRole("button", { name: "Add Instagram for Ana Ruiz" });
    expect(addIg).toHaveTextContent("Add Instagram");
    expect(addIg.className).toMatch(/\bmin-h-11\b/);
    expect(addIg.className).toMatch(/\btext-sm\b/);
    expect(screen.getByText("Licensed", { selector: "span" }).className).toMatch(/text-\[13px\]/);
    for (const chip of within(screen.getByRole("navigation", { name: "Stages" })).getAllByRole("button")) h11(chip);

    const people = screen.getByRole("region", { name: "People" });
    expect(people.querySelectorAll('[class*="text-xs"], [class*="text-[11px]"], [class*="text-[12px]"], [class*="text-[10px]"]')).toHaveLength(0);

    fireEvent.click(screen.getByRole("checkbox", { name: "Select Ana Ruiz" }));
    h11(screen.getByRole("combobox", { name: "Move selected to stage" }));
    expect(screen.getByRole("button", { name: "Move" }).className).toMatch(/\bh-12\b/);
    h11(screen.getByRole("button", { name: "Close all 1" }));
    h11(screen.getByRole("button", { name: "Clear" }));
    // The bulk Move is the one gold button on the screen.
    expect(document.querySelectorAll("button.bg-primary")).toHaveLength(1);
  });

  it("every colour is a rung: the header and tile bubbles, the rung in words beside each hire, an aria-hidden initials bubble in the same tone; nothing plays on load", async () => {
    const flo = person({ display_name: "Flo Nash", person_type: "agent", stage_key: "hired_unlicensed", agent_id: "agent-flo", phone: "6015551006" });
    db.rows = [...EVERYONE, flo];
    db.facts = [
      DI_FACTS,
      { ...DI_FACTS, agent_id: "agent-cy", agent_name: "Cy Dunn", onboarding_stage: "in_field_training" },
      { ...DI_FACTS, agent_id: "agent-flo", agent_name: "Flo Nash", onboarding_stage: "need_followup" },
    ];
    renderPage();
    await screen.findByText("Ana Ruiz");
    expect(celebrate).not.toHaveBeenCalled();
    expect(playSoundEffect).not.toHaveBeenCalled();

    // The header: a graduation cap in the "going well" tone, a bubble and not a button.
    const header = screen.getByRole("heading", { level: 1, name: "New hires" }).closest("header") as HTMLElement;
    const cap = iconBubble(header, "graduation-cap");
    expect(cap).toHaveAttribute("aria-hidden", "true");
    expect(cap!.className).toMatch(/\btext-tone-good\b/);
    expect(within(header).queryAllByRole("button")).toHaveLength(0);

    // The tiles: the Hired rung's gold handshake, the warning tone for time stuck (never red on
    // this page), the Onboarding rung's royal clipboard. The numbers are exactly as before.
    expect(iconBubble(tile("In progress"), "handshake")!.className).toMatch(/\btext-tone-gold\b/);
    expect(iconBubble(tile("Stuck 7+ days"), "clock")!.className).toMatch(/\btext-tone-warm\b/);
    expect(iconBubble(tile("Stuck 60+ days"), "hourglass")!.className).toMatch(/\btext-tone-warm\b/);
    expect(iconBubble(tile("Open onboarding"), "clipboard-list")!.className).toMatch(/\btext-tone-royal\b/);
    expect(tile("In progress")).toHaveTextContent(/In progress\s*5/);
    expect(board().querySelectorAll(".text-tone-hot, .text-destructive")).toHaveLength(0);

    // Cy's onboarding facts put him in field training: the pill says so, in the warm tone, and the
    // bubble beside his name matches it, hidden from assistive technology.
    const cy = rowOf("Cy Dunn");
    const cyPill = within(cy).getByText("Field training");
    expect(cyPill.className).toMatch(/\btext-tone-warm\b/);
    expect(cyPill.className).toMatch(/\bbg-tone-warm\/12\b/);
    const cyBubble = bubbleIn(cy);
    expect(cyBubble.textContent).toBe("CD");
    expect(cyBubble).toHaveAttribute("aria-hidden", "true");
    expect(cyBubble.className).toMatch(/\btext-tone-warm\b/);
    // Di has no onboarding_stage on file, so her First deal step places her at Producing.
    expect(within(rowOf("Di Park")).getByText("Producing").className).toMatch(/\btext-tone-good\b/);
    expect(bubbleIn(rowOf("Di Park")).textContent).toBe("DP");
    // An off-ladder flag is "act now", in its own words.
    expect(within(rowOf("Flo Nash")).getByText("Needs follow-up").className).toMatch(/\btext-tone-hot\b/);
    expect(bubbleIn(rowOf("Flo Nash")).className).toMatch(/\btext-tone-hot\b/);
    // An applicant has no rung yet: a quiet bubble and no rung claimed in words.
    const ana = rowOf("Ana Ruiz");
    expect(bubbleIn(ana).className).toMatch(/\btext-tone-slate\b/);
    expect(within(ana).queryByText(/^(Hired|Onboarding|In course|Field training|Producing)$/)).toBeNull();
    // Red is still only the remove action.
    expect(screen.getByRole("region", { name: "People" }).querySelectorAll(".text-destructive")).toHaveLength(0);

    // The chips: a step on the hire ladder carries its rung's dot and takes that tint when chosen;
    // an applicant step carries neither. The counts and aria-pressed are as before.
    const chips = screen.getByRole("navigation", { name: "Stages" });
    expect(chips.className).toMatch(/\bapex-rise-list\b/);
    const hired = within(chips).getByRole("button", { name: /^Hired, unlicensed\s*2$/ });
    expect(hired.querySelector(".bg-tone-gold")).not.toBeNull();
    expect(within(chips).getByRole("button", { name: /^Applied\s*1$/ }).querySelector('[class*="bg-tone-"]')).toBeNull();
    const firstDeal = within(chips).getByRole("button", { name: /^First deal\s*1$/ });
    fireEvent.click(firstDeal);
    expect(firstDeal).toHaveAttribute("aria-pressed", "true");
    expect(firstDeal.className).toMatch(/\bbg-tone-good\/12\b/);
    expect(firstDeal.className).toMatch(/\bh-11\b/);
    expect(peopleShown()).toBe(1);
    // A filter moved is a tick; a burst is only ever an action that finished.
    expect(playSoundEffect).toHaveBeenCalledTimes(1);
    expect(playSoundEffect).toHaveBeenCalledWith("tick");
    expect(celebrate).not.toHaveBeenCalled();
  });

  it("a move up to Producing is the full burst, once, from the pressed button; another step is the pop; a kept or failed write is its message alone", async () => {
    const gus = person({ display_name: "Gus Hale", person_type: "agent", stage_key: "licensed", agent_id: "agent-gus", phone: "6015551007", license_status: "licensed" });
    db.rows = [ana, gus];
    renderPage();
    await screen.findByText("Gus Hale");

    // First deal is the ladder's Producing (live) rung.
    const toProducing = screen.getByRole("button", { name: "Move to First deal" });
    fireEvent.click(toProducing);
    await waitFor(() => expect(celebrate).toHaveBeenCalledTimes(1));
    expect(celebrate).toHaveBeenCalledWith("hire", toProducing);
    expect(writes()).toEqual([{ fn: "set_recruit_stage", args: { p_application_id: null, p_agent_id: "agent-gus", p_to_stage: "first_deal", p_reason: null } }]);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(playSoundEffect).not.toHaveBeenCalled();

    // Any other step is the small pop, from its own button.
    const toContacted = screen.getByRole("button", { name: "Move to Contacted" });
    fireEvent.click(toContacted);
    await waitFor(() => expect(celebrate).toHaveBeenCalledTimes(2));
    expect(celebrate).toHaveBeenLastCalledWith("save", toContacted);

    // Kept where the evidence puts them: the warning, no burst.
    db.writeResult = { ok: true, final: "licensed", matched: false, message: "Evidence keeps Gus at Licensed." };
    fireEvent.click(screen.getByRole("button", { name: "Move to First deal" }));
    await waitFor(() => expect(toast.warning).toHaveBeenCalledTimes(1));
    expect(celebrate).toHaveBeenCalledTimes(2);

    // Refused: the error toast alone.
    db.writeResult = null;
    db.writeError = { message: "not allowed" };
    fireEvent.click(screen.getByRole("button", { name: "Move to First deal" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith("Gus Hale: not allowed"));
    expect(celebrate).toHaveBeenCalledTimes(2);
    expect(playSoundEffect).not.toHaveBeenCalled();
  });

  it("a bulk move over several people is one success note after it saved; closing them is quiet", async () => {
    renderPage();
    await screen.findByText("Ana Ruiz");
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Ana Ruiz" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Bo Lee" }));
    const picker = screen.getByRole("combobox", { name: "Move selected to stage" });
    fireEvent.keyDown(picker, { key: "ArrowDown" });
    fireEvent.keyDown(await screen.findByRole("option", { name: "Interview booked" }), { key: "Enter" });
    await waitFor(() => expect(picker).toHaveTextContent("Interview booked"));
    fireEvent.click(screen.getByRole("button", { name: "Move" }));
    await waitFor(() => expect(playSoundEffect).toHaveBeenCalledWith("success"));
    expect(playSoundEffect).toHaveBeenCalledTimes(1);
    expect(celebrate).not.toHaveBeenCalled();
    expect(writes()).toEqual([{
      fn: "set_recruit_stage_bulk",
      args: { p_people: [{ application_id: ana.application_id, agent_id: null }, { application_id: bo.application_id, agent_id: null }], p_to_stage: "interview_booked", p_reason: null },
    }]);

    // Closing people went through too, and nothing plays for it.
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Ana Ruiz" }));
    fireEvent.click(screen.getByRole("button", { name: "Close all 1" }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes()[1].args).toMatchObject({ p_to_stage: "closed_lost" });
    expect(playSoundEffect).toHaveBeenCalledTimes(1);
    expect(celebrate).not.toHaveBeenCalled();
  });
});
