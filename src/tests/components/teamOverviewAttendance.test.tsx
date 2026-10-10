import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { attPerson, fakeTeamBackend, personFacts } from "../helpers/teamStageFixtures";
import { rosterRow } from "../helpers/teamRosterFixtures";

const auth = vi.hoisted(() => ({ isAdmin: true, isManager: false, isVaManager: false, isVa: false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/shared/realtime/useRealtimeTable", () => ({ useRealtimeTable: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const backend = vi.hoisted(() => ({ current: null as null | { rpc: (n: string, a?: Record<string, unknown>) => Promise<unknown> } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (n: string, a?: Record<string, unknown>) => backend.current!.rpc(n, a) } }));
vi.mock("@/lib/teamStage", async (orig) => { const real = await orig<typeof import("@/lib/teamStage")>(); return { ...real, phoenixToday: () => "2026-10-09" }; });

import { TeamOverview } from "@/components/team/TeamOverview";
import { TeamAttendance } from "@/components/team/TeamAttendance";

let fb: ReturnType<typeof fakeTeamBackend>;
const wrap = (ui: React.ReactElement) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } })}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
const mountOverview = (facts = [personFacts({ id: "ann" }), personFacts({ id: "bo", stage: "training", schedule_set: true, weekdays: [1, 3, 5], access: { has_login: true, invitation: "accepted" } })]) => {
  fb = fakeTeamBackend(facts, []); backend.current = fb;
  return wrap(<TeamOverview rows={[rosterRow({ agent_id: "ann", full_name: "Ann Lee", email: "ann@example.test" }), rosterRow({ agent_id: "bo", full_name: "Bo Chen", email: "bo@example.test" })]} />);
};
const mountAttendance = (people = [attPerson({ id: "ann", display_name: "Ann Lee" }), attPerson({ id: "bo", display_name: "Bo Chen", expected: "no", stage: "training" }), attPerson({ id: "cy", display_name: "Cy Dee", expected: "unknown", weekdays: null })]) => {
  fb = fakeTeamBackend([], people); backend.current = fb;
  return wrap(<TeamAttendance />);
};
const row = (name: string) => within(screen.getByText(name).closest("li") as HTMLElement);

beforeEach(() => { Object.assign(auth, { isAdmin: true, isManager: false, isVaManager: false, isVa: false }); Object.values(toast).forEach((f) => f.mockClear()); });

describe("Overview: stage, work days and access", () => {
  it("shows every person with a stage badge ('Stage not set' is visible), the work-day summary and an honest access line", async () => {
    mountOverview();
    expect(await screen.findByText("Ann Lee")).toBeInTheDocument();
    expect(row("Ann Lee").getAllByText("Stage not set").length).toBeGreaterThan(0); // the badge, and the selector placeholder
    expect(row("Ann Lee").getByText("Schedule not set")).toBeInTheDocument();
    expect(row("Ann Lee").getByText("No login yet")).toBeInTheDocument();
    expect(row("Bo Chen").getAllByText("Training").length).toBeGreaterThan(0);
    expect(row("Bo Chen").getByText("Mon, Wed, Fri · 3 days/week")).toBeInTheDocument();
    expect(row("Bo Chen").getByText("Signed in before")).toBeInTheDocument();
    expect(screen.getByText(/2 people · 1 with no stage set · 1 with no schedule set/)).toBeInTheDocument();
  });

  it("the stage selector offers exactly the three labels, saves at once with the state the screen believed, and offers Undo on a change", async () => {
    mountOverview();
    await screen.findByText("Ann Lee");
    const sel = row("Bo Chen").getByRole("combobox", { name: "Stage for Bo Chen" }) as HTMLSelectElement;
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
    mountOverview();
    await screen.findByText("Ann Lee");
    const sel = row("Ann Lee").getByRole("combobox", { name: "Stage for Ann Lee" }) as HTMLSelectElement;
    expect(sel.options[0].textContent).toBe("Stage not set");
    fireEvent.change(sel, { target: { value: "online_training" } });
    await waitFor(() => expect(fb.calls("set_agent_stage")[0].args).toEqual({ p_agent_id: "ann", p_stage: "online_training", p_expect_unset: true }));
    await waitFor(() => expect((row("Ann Lee").getByRole("combobox", { name: "Stage for Ann Lee" }) as HTMLSelectElement).options[0].textContent).toBe("Online training"));
  });

  it("a stage save that does not land goes back to the previous value and says so", async () => {
    mountOverview();
    await screen.findByText("Ann Lee");
    fb.state.failNext = { name: "set_agent_stage" };
    // Hold the follow-up refetch so the check sees the immediate restore, not the server's later answer.
    let release!: () => void;
    fb.state.gate = { name: "team_people_facts", promise: new Promise<void>((r) => { release = r; }) };
    fireEvent.change(row("Bo Chen").getByRole("combobox", { name: "Stage for Bo Chen" }), { target: { value: "online_training" } });
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error.mock.calls[0][0]).toMatch(/did not save\. It is back to Training/);
    expect((row("Bo Chen").getByRole("combobox", { name: "Stage for Bo Chen" }) as HTMLSelectElement).value).toBe("training");
    fb.state.gate = null; release();
  });

  it("work days: five weekday checkboxes, a live preview, and a save that sends the chosen days effective today", async () => {
    mountOverview();
    await screen.findByText("Ann Lee");
    fireEvent.click(row("Ann Lee").getByRole("button", { name: /Work days/ }));
    const boxes = row("Ann Lee").getAllByRole("checkbox");
    expect(boxes.map((b) => b.getAttribute("aria-label"))).toEqual(["Monday for Ann Lee", "Tuesday for Ann Lee", "Wednesday for Ann Lee", "Thursday for Ann Lee", "Friday for Ann Lee"]);
    fireEvent.click(boxes[0]); fireEvent.click(boxes[2]); fireEvent.click(boxes[4]);
    expect(row("Ann Lee").getByText("Preview: Mon, Wed, Fri · 3 days/week")).toBeInTheDocument();
    fireEvent.click(row("Ann Lee").getByRole("button", { name: "Save" }));
    await waitFor(() => expect(fb.calls("set_work_commitment")).toHaveLength(1));
    expect(fb.calls("set_work_commitment")[0].args).toEqual({ p_agent_id: "ann", p_weekdays: [1, 3, 5], p_expect_unset: true });
    await waitFor(() => expect(row("Ann Lee").getAllByText("Mon, Wed, Fri · 3 days/week").length).toBeGreaterThan(0));
  });

  it("work days can take effect on a later date, and the next schedule is shown without changing today's", async () => {
    mountOverview();
    await screen.findByText("Ann Lee");
    fireEvent.click(row("Bo Chen").getByRole("button", { name: /Work days/ }));
    fireEvent.click(row("Bo Chen").getByRole("checkbox", { name: "Tuesday for Bo Chen" }));
    fireEvent.change(row("Bo Chen").getByLabelText(/Start date for Bo Chen/), { target: { value: "2026-10-20" } });
    // Hold the follow-up refetch: today's schedule must stay as it was on screen without the server's help.
    let release!: () => void;
    fb.state.gate = { name: "team_people_facts", promise: new Promise<void>((r) => { release = r; }) };
    fireEvent.click(row("Bo Chen").getByRole("button", { name: "Save from 2026-10-20" }));
    await waitFor(() => expect(fb.calls("set_work_commitment")[0].args).toEqual({ p_agent_id: "bo", p_weekdays: [1, 2, 3, 5], p_effective_from: "2026-10-20", p_expected: [1, 3, 5] }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    expect(row("Bo Chen").getAllByText("Mon, Wed, Fri · 3 days/week").length).toBeGreaterThan(0);
    expect(row("Bo Chen").queryByText("Mon, Tue, Wed, Fri · 4 days/week")).toBeNull();
    fb.state.gate = null; release();
    await waitFor(() => expect(row("Bo Chen").getByText("From 2026-10-20: Mon, Tue, Wed, Fri · 4 days/week")).toBeInTheDocument());
    expect(row("Bo Chen").getAllByText("Mon, Wed, Fri · 3 days/week").length).toBeGreaterThan(0);
  });

  it("a VA sees everything but cannot change a stage or schedule", async () => {
    Object.assign(auth, { isAdmin: false, isVa: true });
    mountOverview();
    await screen.findByText("Ann Lee");
    expect(screen.queryByRole("combobox", { name: /Stage for/ })).toBeNull();
    fireEvent.click(row("Ann Lee").getByRole("button", { name: /Work days/ }));
    expect(row("Ann Lee").queryByRole("checkbox")).toBeNull();
  });

  it("a failed read is an error with Retry, never an empty list", async () => {
    fb = fakeTeamBackend([personFacts({ id: "ann" })], []); fb.state.readError = "timeout"; backend.current = fb;
    wrap(<TeamOverview rows={[rosterRow({ agent_id: "ann", full_name: "Ann Lee" })]} />);
    expect(await screen.findByRole("alert")).toHaveTextContent("did not load");
    expect(screen.queryByText("Ann Lee")).toBeNull();
  });
});

describe("Attendance: one day, one tap", () => {
  it("opens on today in Phoenix, says who is expected, not scheduled or has no schedule, and counts them", async () => {
    mountAttendance();
    await screen.findByText("Ann Lee");
    expect(screen.getByText(/today, Phoenix/)).toBeInTheDocument();
    expect(screen.getByLabelText("Attendance date")).toHaveValue("2026-10-09");
    expect(row("Ann Lee").getByText("Expected")).toBeInTheDocument();
    expect(row("Bo Chen").getByText("Not scheduled")).toBeInTheDocument();
    expect(row("Cy Dee").getByText("Schedule not set")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(/1 expected · 0 present · 0 absent · 0 excused · 1 unmarked · 1 not scheduled · 1 with no schedule set/);
  });

  it("marks Present in one tap with the state the screen believed, offers Undo, and Undo clears it", async () => {
    mountAttendance();
    await screen.findByText("Ann Lee");
    fireEvent.click(row("Ann Lee").getByRole("button", { name: "Present for Ann Lee" }));
    await waitFor(() => expect(fb.calls("set_workday_attendance")[0].args).toEqual({ p_agent_id: "ann", p_date: "2026-10-09", p_status: "present", p_expected: "unmarked" }));
    await waitFor(() => expect(row("Ann Lee").getByRole("button", { name: /^Present for Ann Lee/ })).toHaveAttribute("aria-pressed", "true"));
    expect(toast.success).toHaveBeenCalledWith("Ann Lee: Present", expect.objectContaining({ action: expect.objectContaining({ label: "Undo" }) }));
    await act(async () => { (toast.success.mock.calls[0][1] as { action: { onClick: () => void } }).action.onClick(); });
    await waitFor(() => expect(fb.calls("set_workday_attendance").at(-1)!.args).toMatchObject({ p_status: "unmarked", p_expected: "present" }));
    await waitFor(() => expect(row("Ann Lee").getByText("Unmarked")).toBeInTheDocument());
  });

  it("a correction (Present to Absent) sends the status it replaces; pressing the current mark clears it", async () => {
    mountAttendance([attPerson({ id: "ann", display_name: "Ann Lee", status: "present", marked_by_name: "Mia" })]);
    await screen.findByText("Ann Lee");
    fireEvent.click(row("Ann Lee").getByRole("button", { name: "Absent for Ann Lee" }));
    await waitFor(() => expect(fb.calls("set_workday_attendance")[0].args).toMatchObject({ p_status: "absent", p_expected: "present" }));
    fireEvent.click(await row("Ann Lee").findByRole("button", { name: /^Absent for Ann Lee/ }));
    await waitFor(() => expect(fb.calls("set_workday_attendance").at(-1)!.args).toMatchObject({ p_status: "unmarked", p_expected: "absent" }));
  });

  it("a mark that does not land goes back and says so; a mark changed elsewhere shows the saved one", async () => {
    mountAttendance();
    await screen.findByText("Ann Lee");
    fb.state.failNext = { name: "set_workday_attendance" };
    let release!: () => void;
    fb.state.gate = { name: "team_attendance_day", promise: new Promise<void>((r) => { release = r; }) };
    fireEvent.click(row("Ann Lee").getByRole("button", { name: "Present for Ann Lee" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error.mock.calls[0][0]).toMatch(/did not save\. It is back to Unmarked/);
    expect(row("Ann Lee").getByText("Unmarked")).toBeInTheDocument();
    fb.state.gate = null; release();
    fb.state.att.find((p) => p.agent_id === "ann")!.status = "excused";
    fireEvent.click(row("Ann Lee").getByRole("button", { name: "Present for Ann Lee" }));
    await waitFor(() => expect(toast.message).toHaveBeenCalled());
    await waitFor(() => expect(row("Ann Lee").getByRole("button", { name: /^Excused for Ann Lee/ })).toHaveAttribute("aria-pressed", "true"));
  });

  it("the date can move back but never forward past today, and the read is per day", async () => {
    mountAttendance();
    await screen.findByText("Ann Lee");
    expect(screen.getByRole("button", { name: "Next day" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Previous day" }));
    await waitFor(() => expect(fb.calls("team_attendance_day").at(-1)!.args).toEqual({ p_date: "2026-10-08" }));
    expect(screen.getByLabelText("Attendance date")).toHaveValue("2026-10-08");
    fireEvent.change(screen.getByLabelText("Attendance date"), { target: { value: "2026-10-11" } });
    expect(screen.getByLabelText("Attendance date")).toHaveValue("2026-10-08");
  });

  it("bulk needs an explicit selection and a preview, changes only unmarked people, and leaves marks alone", async () => {
    mountAttendance([attPerson({ id: "ann", display_name: "Ann Lee" }), attPerson({ id: "bo", display_name: "Bo Chen", status: "excused" }), attPerson({ id: "cy", display_name: "Cy Dee" })]);
    await screen.findByText("Ann Lee");
    expect(screen.queryByRole("button", { name: /^Mark \d+ as/ })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Select several" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Ann Lee" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select Bo Chen" }));
    expect(screen.getByText(/Preview: 1 will be marked Present; 1 already marked and left alone/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Mark 1 as Present" }));
    await waitFor(() => expect(fb.calls("set_workday_attendance_bulk")[0].args).toEqual({ p_date: "2026-10-09", p_agent_ids: ["ann"], p_status: "present" }));
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith(expect.stringMatching(/^1 marked Present/)));
    expect(fb.state.att.find((p) => p.agent_id === "bo")!.status).toBe("excused");
    expect(fb.state.att.find((p) => p.agent_id === "cy")!.status).toBe("unmarked");
  });

  it("filters by stage and 'expected only'", async () => {
    mountAttendance();
    await screen.findByText("Ann Lee");
    fireEvent.change(screen.getByLabelText("Stage filter"), { target: { value: "training" } });
    expect(screen.queryByText("Ann Lee")).toBeNull(); expect(screen.getByText("Bo Chen")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Stage filter"), { target: { value: "all" } });
    fireEvent.click(screen.getByLabelText("Expected only"));
    expect(screen.getByText("Ann Lee")).toBeInTheDocument(); expect(screen.queryByText("Bo Chen")).toBeNull();
  });

  it("a VA sees the day but every mark control is disabled and no write is sent", async () => {
    Object.assign(auth, { isAdmin: false, isVa: true });
    mountAttendance();
    await screen.findByText("Ann Lee");
    const b = row("Ann Lee").getByRole("button", { name: "Present for Ann Lee" });
    expect(b).toBeDisabled(); fireEvent.click(b);
    expect(fb.calls("set_workday_attendance")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Select several" })).toBeNull();
  });

  it("a failed day read is an error with Retry, never 'nobody expected'", async () => {
    fb = fakeTeamBackend([], [attPerson({ id: "ann", display_name: "Ann Lee" })]); fb.state.readError = "timeout"; backend.current = fb;
    wrap(<TeamAttendance />);
    expect(await screen.findByRole("alert")).toHaveTextContent("did not load");
    expect(screen.queryByText("Ann Lee")).toBeNull();
    fb.state.readError = null;
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(await screen.findByText("Ann Lee")).toBeInTheDocument();
  });
});
