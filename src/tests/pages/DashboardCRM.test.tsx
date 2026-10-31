/**
 * My Team (src/pages/DashboardCRM.tsx), OVERHAUL-myteam 2026-10-31.
 *
 * Sam: "I literally just look at it and it gave me a full headache." These pin the page as people use it:
 * four numbers that each equal the list they open and add up to Everyone, one list in the order to work it
 * with each person's step in colour and words and one button, a merged duplicate shown as one person with
 * their sales, the lists that moved under More lists, the person card that now carries the training stage
 * and work days (every behaviour the old inline Overview pinned, kept on the card), the views that live in
 * the URL, and the loading, failed and empty states that never show a zero nobody counted.
 */
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RosterRow } from "@/lib/teamRoster";
import type { PersonFacts } from "@/lib/teamStage";
import { rosterRow } from "../helpers/teamRosterFixtures";
import { fakeTeamBackend, personFacts } from "../helpers/teamStageFixtures";

type Auth = { user: { id: string } | null; isAdmin: boolean; isManager: boolean; isVa: boolean; isVaManager: boolean; isLoading: boolean };
const auth = vi.hoisted(() => ({ current: null as unknown as Auth }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth.current }));
const identity = vi.hoisted(() => ({ agentId: "me" as string | null }));
vi.mock("@/hooks/useAgentIdentity", () => ({ useAgentIdentity: () => ({ agentId: identity.agentId }) }));
vi.mock("@/hooks/useBusinessToday", () => ({ useBusinessToday: () => "2026-10-31" }));
// The work-days editor refuses a start date before today; pin its today the way the old Overview test did.
vi.mock("@/lib/teamStage", async (orig) => { const real = await orig<typeof import("@/lib/teamStage")>(); return { ...real, phoenixToday: () => "2026-10-09" }; });
vi.mock("@/shared/realtime/useRealtimeTable", () => ({ useRealtimeTable: vi.fn() }));
vi.mock("@/hooks/usePortalLoginSender", () => ({ usePortalLoginSender: () => ({ sending: false, send: vi.fn() }) }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
// The other views and dialogs have their own tests; here they only need to show which one is open.
vi.mock("@/components/team/TeamAttendance", () => ({ TeamAttendance: () => <p>Attendance view</p> }));
vi.mock("@/components/team/ContractingCallList", () => ({ ContractingCallList: () => <p>Contracting calls view</p> }));
vi.mock("@/components/contracting-review/ContractingReviewWorkspace", () => ({ ContractingReviewWorkspace: () => <p>Contracting review view</p> }));
vi.mock("@/components/dashboard/TeamEngagementPanel", () => ({ TeamEngagementPanel: () => <p>Logins view</p> }));
vi.mock("@/components/dashboard/ApplicationDetailSheet", () => ({ ApplicationDetailSheet: () => null }));
vi.mock("@/components/dashboard/DeactivateAgentDialog", () => ({ DeactivateAgentDialog: () => null }));
vi.mock("@/components/dashboard/AgentQuickEditDialog", () => ({ AgentQuickEditDialog: () => null }));

const db = vi.hoisted(() => ({
  roster: [] as Array<Record<string, unknown>>,
  canonical: [] as Array<{ agent_id: string; canonical_agent_id: string }>,
  agents: [] as Array<Record<string, unknown>>,
  updates: [] as Array<{ table: string; values: Record<string, unknown>; id: unknown }>,
  rosterError: null as string | null,
  rosterGate: null as Promise<void> | null,
  team: null as null | { rpc: (n: string, a?: Record<string, unknown>) => Promise<unknown> },
  calls: [] as string[],
}));
vi.mock("@/integrations/supabase/client", () => {
  const from = (table: string) => {
    let rows: Array<Record<string, unknown>> = table === "v_agent_canonical_map" ? db.canonical : table === "agents" ? db.agents : [];
    let values: Record<string, unknown> | null = null;
    const chain = {
      select: () => chain,
      update: (v: Record<string, unknown>) => { values = v; return chain; },
      in: (col: string, list: unknown[]) => { rows = rows.filter((r) => list.includes(r[col])); return chain; },
      eq: (col: string, v: unknown) => {
        if (values) db.updates.push({ table, values, id: v });
        rows = rows.filter((r) => r[col] === v);
        return chain;
      },
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve, reject),
    };
    return chain;
  };
  const rpc = async (name: string, args?: Record<string, unknown>) => {
    db.calls.push(name);
    const roster = db.roster as Array<Record<string, unknown>>;
    switch (name) {
      case "crm_agent_roster":
        if (db.rosterGate) await db.rosterGate;
        return db.rosterError ? { data: null, error: { message: db.rosterError } } : { data: roster, error: null };
      case "crm_agent_sales_pulse":
        return { data: roster.map((r) => ({ agent_id: r.agent_id, today_alp: r.today_alp ?? 0, today_deals: r.today_deals ?? 0, selling_streak_days: r.selling_streak_days ?? 0 })), error: null };
      case "crm_agent_contacts":
        return { data: roster.map((r) => ({ agent_id: r.agent_id, full_name: r.full_name, email: r.email, phone: r.phone })), error: null };
      case "crm_agent_free_leads_status":
        return { data: roster.map((r) => ({ agent_id: r.agent_id, qualifies: r.free_leads_qualified ?? false, reason: "", needed_for_qual: r.free_leads_needed_for_qual ?? null })), error: null };
      default:
        return db.team!.rpc(name, args);
    }
  };
  return { supabase: { from, rpc, functions: { invoke: vi.fn(async () => ({ data: { success: true }, error: null })) } } };
});

import DashboardCRM from "@/pages/DashboardCRM";

let fb: ReturnType<typeof fakeTeamBackend>;

// Synthetic people only. Shaped like Sam's team on 2026-10-31: some licensed with no sale yet, one gone quiet,
// one getting licensed, sellers, the owner's own row, a merged duplicate holding its person's sales, an inactive
// seat and a placeholder seat.
const ROWS: RosterRow[] = [
  rosterRow({ agent_id: "me", full_name: "Sam Owner", tenure_days: 268, l30_deals: 3, l30_alp: 9456, lifetime_deals: 60, last_posted_date: "2026-10-16", phone: "+16025550100", manager_id: null, manager_name: null }),
  rosterRow({ agent_id: "ann", full_name: "Ann Lee", license_status: "licensed", tenure_days: 12, phone: "+16025550101", manager_id: "me", manager_name: "Sam Owner" }),
  rosterRow({ agent_id: "bo", full_name: "Bo Chen", license_status: "licensed", tenure_days: 40, phone: "+16025550102", manager_id: "m2", manager_name: "Mia Manager" }),
  rosterRow({ agent_id: "q1", full_name: "Quinn Quiet", tenure_days: 120, lifetime_deals: 4, lifetime_alp: 6000, last_posted_date: "2026-09-16", phone: "+16025550103" }),
  rosterRow({ agent_id: "l1", full_name: "Lee Learner", license_status: "unlicensed", license_progress: "passed_test", tenure_days: 20, phone: "+16025550104" }),
  rosterRow({ agent_id: "s1", full_name: "Sal Seller", tenure_days: 90, l30_deals: 2, l30_alp: 12000, lifetime_deals: 9, today_deals: 1, today_alp: 1500, last_posted_date: "2026-10-31", phone: "+16025550105" }),
  rosterRow({ agent_id: "canon", full_name: "Cara Canon", license_status: "licensed", tenure_days: 57, phone: "+16025550106" }),
  rosterRow({ agent_id: "twin", full_name: "Cara Canon", l30_deals: 6, l30_alp: 14346.12, mtd_alp: 14346.12, lifetime_deals: 11, last_posted_date: "2026-10-30", phone: null }),
  rosterRow({ agent_id: "i1", full_name: "Ira Inactive", status: "inactive" }),
  rosterRow({ agent_id: "g1", full_name: "GHOST seat", is_sync_only: true, license_status: "unlicensed", phone: null, email: null }),
];
const FACTS: PersonFacts[] = [
  personFacts({ id: "ann" }),
  personFacts({ id: "bo", stage: "training", schedule_set: true, weekdays: [1, 3, 5], access: { has_login: true, invitation: "accepted" } }),
  personFacts({ id: "me", stage: "released_in_field", schedule_set: true, weekdays: [1, 2, 3, 4, 5], access: { has_login: true, invitation: "none" } }),
  personFacts({ id: "q1", access: { has_login: true, invitation: "none" } }),
  personFacts({ id: "l1", stage: "online_training", access: { has_login: true, invitation: "accepted" } }),
  personFacts({ id: "s1", stage: "released_in_field", access: { has_login: true, invitation: "none" } }),
  personFacts({ id: "canon", stage: "online_training", access: { has_login: true, invitation: "accepted" } }),
];

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{`${location.pathname}${location.search}`}</p>;
}

function renderPage(path = "/dashboard/team") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <DashboardCRM />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The value of a scoreboard tile, read from its button. */
function tileValue(label: string): string {
  const board = screen.getByRole("region", { name: "Team numbers" });
  const tile = within(board).getByRole("button", { name: new RegExp(`^${label}`) });
  return within(tile).getAllByText(/^(\d[\d,]*|—)$/)[0].textContent ?? "";
}
/** The names on the list, in order. */
function shownNames(): string[] {
  const list = screen.getByRole("list", { name: /./ });
  return within(list).getAllByRole("listitem").map((li) => {
    const button = within(li).getAllByRole("button")[0];
    return document.getElementById(button.getAttribute("aria-labelledby") ?? "")?.textContent ?? "";
  });
}
const rowOf = (name: string) => within(screen.getByText(name, { selector: "[id$='-name']" }).closest("li") as HTMLElement);
const card = () => within(screen.getByRole("dialog"));
/** The person card, once it has opened (it opens when the roster has loaded and names the person in the URL). */
const openCard = async () => within(await screen.findByRole("dialog"));

beforeEach(() => {
  auth.current = { user: { id: "u-sam" }, isAdmin: true, isManager: false, isVa: false, isVaManager: false, isLoading: false };
  identity.agentId = "me";
  db.roster = ROWS.map((r) => ({ ...r }));
  db.canonical = ROWS.map((r) => ({ agent_id: r.agent_id, canonical_agent_id: r.agent_id === "twin" ? "canon" : r.agent_id }));
  db.agents = [{ id: "ann", source_application_id: "app-ann" }];
  db.updates = [];
  db.rosterError = null;
  db.rosterGate = null;
  db.calls = [];
  fb = fakeTeamBackend(FACTS, []);
  db.team = fb;
  Object.values(toast).forEach((f) => f.mockClear());
});

describe("My Team: four numbers, one list", () => {
  it("shows four numbers that each equal the list they open, and they add up to Everyone", async () => {
    renderPage();
    await screen.findByText("Ann Lee");
    expect(tileValue("No sale yet")).toBe("2");
    expect(tileValue("Gone quiet")).toBe("1");
    expect(tileValue("Getting licensed")).toBe("1");
    expect(tileValue("Selling")).toBe("3");
    expect(screen.getByRole("button", { name: /^Everyone\s*7$/ })).toHaveAttribute("aria-pressed", "true");
    expect(shownNames()).toHaveLength(7);

    const board = screen.getByRole("region", { name: "Team numbers" });
    fireEvent.click(within(board).getByRole("button", { name: /^No sale yet/ }));
    expect(within(board).getByRole("button", { name: /^No sale yet/ })).toHaveAttribute("aria-pressed", "true");
    expect(shownNames()).toEqual(["Ann Lee", "Bo Chen"]);
    expect(screen.getByTestId("location").textContent).toContain("list=no_sale");
    fireEvent.click(within(board).getByRole("button", { name: /^Selling/ }));
    expect(shownNames()).toEqual(["Cara Canon", "Sal Seller", "Sam Owner (you)"]);
    expect(screen.getByText(/\$35\.8K ALP in 30 days/)).toBeInTheDocument();
    // Tapping the list that is on goes back to Everyone.
    fireEvent.click(within(board).getByRole("button", { name: /^Selling/ }));
    expect(shownNames()).toHaveLength(7);
  });

  it("lists everyone in the order to work them: no sale yet, gone quiet, getting licensed, then selling", async () => {
    renderPage();
    await screen.findByText("Ann Lee");
    expect(shownNames()).toEqual(["Ann Lee", "Bo Chen", "Quinn Quiet", "Lee Learner", "Cara Canon", "Sal Seller", "Sam Owner (you)"]);
  });

  it("each row says the step in words beside its colour, one fact, and offers one button", async () => {
    renderPage();
    await screen.findByText("Ann Lee");
    expect(rowOf("Ann Lee").getByText("No sale yet")).toBeInTheDocument();
    expect(rowOf("Ann Lee").getByText(/On the team 12 days/)).toBeInTheDocument();
    expect(rowOf("Ann Lee").getByText("No login yet")).toBeInTheDocument();
    expect(rowOf("Quinn Quiet").getByText("Gone quiet")).toBeInTheDocument();
    expect(rowOf("Quinn Quiet").getByText(/Last sale 45 days ago/)).toBeInTheDocument();
    expect(rowOf("Lee Learner").getByText("Getting licensed")).toBeInTheDocument();
    expect(rowOf("Lee Learner").getByText(/Passed the test/)).toBeInTheDocument();
    expect(rowOf("Sal Seller").getByText(/Sold today · \$12\.0K in 30 days/)).toBeInTheDocument();
    expect(rowOf("Bo Chen").getByText("Training")).toBeInTheDocument();
    expect(rowOf("Bo Chen").getByText("Upline Mia Manager")).toBeInTheDocument();
    // Your own downline's upline is you, so it is not repeated on their row.
    expect(rowOf("Ann Lee").queryByText(/Upline/)).toBeNull();
    for (const li of within(screen.getByRole("list", { name: "Everyone" })).getAllByRole("listitem")) {
      const actions = within(li).queryAllByRole("link").length + within(li).getAllByRole("button").length - 1; // minus the row itself
      expect(actions).toBe(1);
    }
    // No contracting status, overdue wording or follow-up plan on any row.
    expect(within(screen.getByRole("list", { name: "Everyone" })).queryByText(/overdue|behind|follow-up|first contract|agentlink/i)).toBeNull();
  });

  it("Call dials and opens the person's card; dialing records nothing", async () => {
    renderPage();
    await screen.findByText("Ann Lee");
    const call = rowOf("Ann Lee").getByRole("link", { name: "Call Ann Lee: help them get a first sale" });
    expect(call.getAttribute("href")).toMatch(/voice\.google\.com|^tel:/);
    fireEvent.click(call);
    await waitFor(() => expect(screen.getByTestId("location").textContent).toContain("person=ann"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(card().getByRole("heading", { name: "Ann Lee" })).toBeInTheDocument();
    expect(card().getByText("No sale yet")).toBeInTheDocument();
    expect(fb.calls("set_agent_stage")).toHaveLength(0);
    expect(db.updates).toHaveLength(0);
  });

  it("sellers and your own row open the card instead of calling", async () => {
    renderPage();
    await screen.findByText("Ann Lee");
    expect(rowOf("Sal Seller").queryByRole("link", { name: /^Call/ })).toBeNull();
    expect(rowOf("Sal Seller").getByRole("button", { name: "Open Sal Seller" })).toBeInTheDocument();
    expect(rowOf("Sam Owner").getByRole("button", { name: "Open Sam Owner" })).toBeInTheDocument();
    expect(rowOf("Sam Owner").getByText("(you)")).toBeInTheDocument();
    fireEvent.click(rowOf("Sal Seller").getByRole("button", { name: "Open Sal Seller" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toContain("person=s1"));
  });

  it("shows a merged duplicate as one person, with the sales the duplicate held", async () => {
    renderPage();
    await screen.findByText("Ann Lee");
    expect(screen.getAllByText("Cara Canon", { selector: "[id$='-name']" })).toHaveLength(1);
    expect(rowOf("Cara Canon").getByText("Selling")).toBeInTheDocument();
    expect(rowOf("Cara Canon").getByText(/\$14\.3K in 30 days/)).toBeInTheDocument();
    expect(db.calls).toContain("crm_agent_roster");
  });

  it("keeps placeholder seats and inactive people off Everyone and under More lists, each list with its count", async () => {
    renderPage();
    await screen.findByText("Ann Lee");
    expect(screen.queryByText("GHOST seat")).toBeNull();
    expect(screen.queryByText("Ira Inactive")).toBeNull();
    fireEvent.keyDown(screen.getByRole("button", { name: "More lists" }), { key: "Enter" });
    const menu = await screen.findByRole("menu");
    const items = within(menu).getAllByRole("menuitem").map((m) => m.textContent);
    expect(items).toEqual([
      "Joined in the last 30 days2", "Free leads now0", "Close to free leads0", "No login yet1", "Training stage not set2",
      "No work days set5", "Not active1", "Placeholder seats1",
    ]);
    fireEvent.click(within(menu).getByRole("menuitem", { name: /Placeholder seats/ }));
    const trigger = screen.getByRole("button", { name: "More lists: Placeholder seats" });
    expect(trigger.textContent).toContain("1");
    expect(shownNames()).toEqual(["GHOST seat"]);
    expect(rowOf("GHOST seat").getByText("Placeholder seat")).toBeInTheDocument();
    expect(rowOf("GHOST seat").getByText(/Not a person/)).toBeInTheDocument();
    expect(rowOf("GHOST seat").queryByRole("link", { name: /^Call/ })).toBeNull();
  });

  it("search narrows the list and the numbers alike", async () => {
    renderPage();
    await screen.findByText("Ann Lee");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search your team" }), { target: { value: "chen" } });
    expect(shownNames()).toEqual(["Bo Chen"]);
    // The numbers count to their new value, so read them once they settle.
    await waitFor(() => expect(tileValue("No sale yet")).toBe("1"));
    await waitFor(() => expect(tileValue("Selling")).toBe("0"));
    fireEvent.change(screen.getByRole("searchbox", { name: "Search your team" }), { target: { value: "nobody here" } });
    expect(screen.getByText("Nobody here matches “nobody here”")).toBeInTheDocument();
  });
});

describe("My Team: the person card manages the training stage and work days", () => {
  it("shows the stage ('Stage not set' is visible), the work-day summary and an honest access line", async () => {
    renderPage("/dashboard/team?person=ann");
    const ann = await openCard();
    await waitFor(() => expect(ann.getAllByText("Stage not set").length).toBeGreaterThan(0));
    expect(ann.getAllByText("Schedule not set").length).toBeGreaterThan(0);
    expect(ann.getByText("No login yet")).toBeInTheDocument();
  });

  it("shows a set stage, the days they work and that they have signed in before", async () => {
    renderPage("/dashboard/team?person=bo");
    const bo = await openCard();
    await waitFor(() => expect((bo.getByRole("combobox", { name: "Stage for Bo Chen" }) as HTMLSelectElement).value).toBe("training"));
    expect(bo.getAllByText("Mon, Wed, Fri · 3 days/week").length).toBeGreaterThan(0);
    expect(bo.getByText("Signed in before")).toBeInTheDocument();
  });

  it("the stage selector offers exactly the three labels, saves at once with the state the screen believed, and offers Undo", async () => {
    renderPage("/dashboard/team?person=bo");
    const sel = await (await openCard()).findByRole("combobox", { name: "Stage for Bo Chen" }) as HTMLSelectElement;
    expect(Array.from(sel.options).map((o) => o.textContent)).toEqual(["Online training", "Training", "Released in field"]);
    fireEvent.change(sel, { target: { value: "released_in_field" } });
    await waitFor(() => expect(fb.calls("set_agent_stage")).toHaveLength(1));
    expect(fb.calls("set_agent_stage")[0].args).toEqual({ p_agent_id: "bo", p_stage: "released_in_field", p_expected: "training" });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Bo Chen: Released in field", expect.objectContaining({ action: expect.objectContaining({ label: "Undo" }) })));
    const undo = (toast.success.mock.calls[0][1] as { action: { onClick: () => void } }).action.onClick;
    await act(async () => { undo(); });
    await waitFor(() => expect(fb.calls("set_agent_stage").at(-1)!.args).toMatchObject({ p_stage: "training", p_expected: "released_in_field" }));
  });

  it("an unset stage sends 'expect unset' and the placeholder option disappears once set", async () => {
    renderPage("/dashboard/team?person=ann");
    const sel = await (await openCard()).findByRole("combobox", { name: "Stage for Ann Lee" }) as HTMLSelectElement;
    expect(sel.options[0].textContent).toBe("Stage not set");
    fireEvent.change(sel, { target: { value: "online_training" } });
    await waitFor(() => expect(fb.calls("set_agent_stage")[0].args).toEqual({ p_agent_id: "ann", p_stage: "online_training", p_expect_unset: true }));
    await waitFor(() => expect((card().getByRole("combobox", { name: "Stage for Ann Lee" }) as HTMLSelectElement).options[0].textContent).toBe("Online training"));
  });

  it("a stage save that does not land goes back to the previous value and says so", async () => {
    renderPage("/dashboard/team?person=bo");
    const sel = await (await openCard()).findByRole("combobox", { name: "Stage for Bo Chen" });
    fb.state.failNext = { name: "set_agent_stage" };
    let release!: () => void;
    fb.state.gate = { name: "team_people_facts", promise: new Promise<void>((r) => { release = r; }) };
    fireEvent.change(sel, { target: { value: "online_training" } });
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error.mock.calls[0][0]).toMatch(/did not save\. It is back to Training/);
    expect((card().getByRole("combobox", { name: "Stage for Bo Chen" }) as HTMLSelectElement).value).toBe("training");
    fb.state.gate = null; release();
  });

  it("work days: five weekday checkboxes, a live preview, and a save that sends the chosen days effective today", async () => {
    renderPage("/dashboard/team?person=ann");
    await (await openCard()).findByRole("combobox", { name: "Stage for Ann Lee" });
    const boxes = card().getAllByRole("checkbox");
    expect(boxes.map((b) => b.getAttribute("aria-label"))).toEqual(["Monday for Ann Lee", "Tuesday for Ann Lee", "Wednesday for Ann Lee", "Thursday for Ann Lee", "Friday for Ann Lee"]);
    fireEvent.click(boxes[0]); fireEvent.click(boxes[2]); fireEvent.click(boxes[4]);
    expect(card().getByText("Preview: Mon, Wed, Fri · 3 days/week")).toBeInTheDocument();
    fireEvent.click(card().getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fb.calls("set_work_commitment")).toHaveLength(1));
    expect(fb.calls("set_work_commitment")[0].args).toEqual({ p_agent_id: "ann", p_weekdays: [1, 3, 5], p_expect_unset: true });
    await waitFor(() => expect(card().getAllByText("Mon, Wed, Fri · 3 days/week").length).toBeGreaterThan(0));
  });

  it("work days can take effect on a later date, and the next schedule is shown without changing today's", async () => {
    renderPage("/dashboard/team?person=bo");
    await (await openCard()).findByRole("combobox", { name: "Stage for Bo Chen" });
    fireEvent.click(card().getByRole("checkbox", { name: "Tuesday for Bo Chen" }));
    fireEvent.change(card().getByLabelText(/Start date for Bo Chen/), { target: { value: "2026-10-20" } });
    let release!: () => void;
    fb.state.gate = { name: "team_people_facts", promise: new Promise<void>((r) => { release = r; }) };
    fireEvent.click(card().getByRole("button", { name: "Save from 2026-10-20" }));
    await waitFor(() => expect(fb.calls("set_work_commitment")[0].args).toEqual({ p_agent_id: "bo", p_weekdays: [1, 2, 3, 5], p_effective_from: "2026-10-20", p_expected: [1, 3, 5] }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(card().getAllByText("Mon, Wed, Fri · 3 days/week").length).toBeGreaterThan(0);
    expect(card().queryByText("Mon, Tue, Wed, Fri · 4 days/week")).toBeNull();
    fb.state.gate = null; release();
    await waitFor(() => expect(card().getByText("From 2026-10-20: Mon, Tue, Wed, Fri · 4 days/week")).toBeInTheDocument());
  });

  it("keeps selected days after a failed save and allows an explicit discard", async () => {
    renderPage("/dashboard/team?person=ann");
    await (await openCard()).findByRole("combobox", { name: "Stage for Ann Lee" });
    fireEvent.click(card().getByRole("checkbox", { name: "Monday for Ann Lee" }));
    fb.state.failNext = { name: "set_work_commitment" };
    fireEvent.click(card().getByRole("button", { name: "Save" }));
    await waitFor(() => expect(card().getByRole("alert")).toHaveTextContent("Schedule did not save"));
    expect(card().getByRole("checkbox", { name: "Monday for Ann Lee" })).toBeChecked();
    fireEvent.click(card().getByRole("button", { name: "Discard edit" }));
    expect(card().getByRole("checkbox", { name: "Monday for Ann Lee" })).not.toBeChecked();
  });

  it("a VA sees the card but cannot change a stage or schedule", async () => {
    auth.current = { ...auth.current, isAdmin: false, isVa: true };
    renderPage("/dashboard/team?person=ann");
    await screen.findByRole("dialog");
    await waitFor(() => expect(card().getAllByText("Stage not set").length).toBeGreaterThan(0));
    expect(card().queryByRole("combobox", { name: /Stage for/ })).toBeNull();
    expect(card().queryByRole("checkbox")).toBeNull();
    expect(card().queryByRole("button", { name: "Mark checked in" })).toBeNull();
  });

  it("Mark checked in writes the time to the person's application and says so", async () => {
    renderPage("/dashboard/team?person=ann");
    fireEvent.click(await (await openCard()).findByRole("button", { name: "Mark checked in" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Ann Lee marked checked in"));
    expect(db.updates).toEqual([{ table: "applications", values: { last_contacted_at: expect.any(String) }, id: "app-ann" }]);
  });
});

describe("My Team: honest states", () => {
  it("while the team loads, the numbers read — and the list is a skeleton, never placeholder money", async () => {
    let release!: () => void;
    db.rosterGate = new Promise<void>((r) => { release = r; });
    renderPage();
    expect(screen.getByLabelText("Loading your team")).toBeInTheDocument();
    expect(tileValue("No sale yet")).toBe("—");
    expect(tileValue("Selling")).toBe("—");
    expect(screen.queryByText(/\$/)).toBeNull();
    release();
    await screen.findByText("Ann Lee");
  });

  it("a failed roster read says so with Try again; it never shows an empty team", async () => {
    db.rosterError = "canceling statement due to statement timeout";
    renderPage();
    expect(await screen.findByText("Your team did not load")).toBeInTheDocument();
    expect(screen.getByText("The numbers are hidden because your team did not load.")).toBeInTheDocument();
    expect(tileValue("No sale yet")).toBe("—");
    expect(screen.queryByText("Nobody on your team yet")).toBeNull();
    db.rosterError = null;
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(await screen.findByText("Ann Lee")).toBeInTheDocument();
  });

  it("failed team facts are a notice with Try again; everyone is still listed and those lists read —", async () => {
    fb.state.readError = "timeout";
    renderPage();
    await screen.findByText("Ann Lee");
    expect(await screen.findByText(/Training stage, work days and logins did not load/)).toBeInTheDocument();
    expect(shownNames()).toHaveLength(7);
    fireEvent.keyDown(screen.getByRole("button", { name: "More lists" }), { key: "Enter" });
    const menu = await screen.findByRole("menu");
    expect(within(menu).getByRole("menuitem", { name: /No login yet/ }).textContent).toBe("No login yet—");
  });

  it("an empty team says so and offers the way to grow it", async () => {
    db.roster = [];
    db.canonical = [];
    renderPage();
    expect(await screen.findByText("Nobody on your team yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Invite an agent/ })).toHaveAttribute("href", "/admin/invite-links");
    expect(screen.queryByRole("region", { name: "Team numbers" })).toBeNull();
  });
});

describe("My Team: who sees what", () => {
  it("an agent sees their own team: no view tabs, no team-facts lists, and the facts are never read", async () => {
    auth.current = { user: { id: "u-agent" }, isAdmin: false, isManager: false, isVa: false, isVaManager: false, isLoading: false };
    identity.agentId = "ann";
    renderPage("/dashboard/team?view=attendance&list=no_login");
    await screen.findByText("Bo Chen");
    expect(screen.queryByRole("group", { name: "Team view" })).toBeNull();
    expect(screen.queryByText("Attendance view")).toBeNull();
    expect(screen.getByRole("button", { name: /^Everyone/ })).toHaveAttribute("aria-pressed", "true");
    fireEvent.keyDown(screen.getByRole("button", { name: "More lists" }), { key: "Enter" });
    const menu = await screen.findByRole("menu");
    expect(within(menu).queryByRole("menuitem", { name: /No login yet/ })).toBeNull();
    expect(fb.calls("team_people_facts")).toHaveLength(0);
    expect(rowOf("Ann Lee").getByText("(you)")).toBeInTheDocument();
  });

  it("the views live in the URL; the list's old name still lands on it, and Logins is the owner's alone", async () => {
    renderPage("/dashboard/team?view=attendance");
    expect(await screen.findByText("Attendance view")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Contracting calls" }));
    expect(await screen.findByText("Contracting calls view")).toBeInTheDocument();
    expect(screen.getByTestId("location").textContent).toContain("view=link");
    fireEvent.click(screen.getByRole("button", { name: "Logins" }));
    expect(await screen.findByText("Logins view")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Team" }));
    expect(await screen.findByText("Ann Lee")).toBeInTheDocument();
    expect(screen.getByTestId("location").textContent).not.toContain("view=");
  });

  it("a manager lands on the list from ?view=overview and has no Logins view", async () => {
    auth.current = { ...auth.current, isAdmin: false, isManager: true };
    renderPage("/dashboard/team?view=overview");
    expect(await screen.findByText("Ann Lee")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Team view" })).queryByRole("button", { name: "Logins" })).toBeNull();
  });

  it("a manager asking for ?view=logins gets the list, not the owner's panel", async () => {
    auth.current = { ...auth.current, isAdmin: false, isManager: true };
    renderPage("/dashboard/team?view=logins");
    expect(await screen.findByText("Ann Lee")).toBeInTheDocument();
    expect(screen.queryByText("Logins view")).toBeNull();
  });
});
