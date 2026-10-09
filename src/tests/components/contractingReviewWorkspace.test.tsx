import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { agent, emptyProfile, fakeBackend } from "../helpers/reviewFixtures";

const auth = vi.hoisted(() => ({ isAdmin: true, isManager: false, isVaManager: false, isVa: false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth }));
vi.mock("@/shared/realtime/useRealtimeTable", () => ({ useRealtimeTable: vi.fn() }));
const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), message: vi.fn() }));
vi.mock("sonner", () => ({ toast }));
const backend = vi.hoisted(() => ({ current: null as null | { rpc: (n: string, a?: Record<string, unknown>) => Promise<unknown> } }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (n: string, a?: Record<string, unknown>) => backend.current!.rpc(n, a) } }));

import { ContractingReviewWorkspace } from "@/components/contracting-review/ContractingReviewWorkspace";

let fb: ReturnType<typeof fakeBackend>;
const mount = (agents = [agent({ id: "ann", display_name: "Ann Lee" }), agent({ id: "bo", display_name: "Bo Chen", marked: ["aflac"] })]) => {
  fb = fakeBackend(agents);
  backend.current = fb;
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  return render(<QueryClientProvider client={qc}><MemoryRouter><ContractingReviewWorkspace /></MemoryRouter></QueryClientProvider>);
};
const circle = (name: RegExp) => screen.getByRole("button", { name });
const circlesFor = (rowName: string) => within(screen.getByText(rowName).closest("li") as HTMLElement);

beforeEach(() => {
  Object.assign(auth, { isAdmin: true, isManager: false, isVaManager: false, isVa: false });
  Object.values(toast).forEach((f) => f.mockClear());
});

describe("the contracting review: what you see", () => {
  it("starts on 'Needs review' and lists everyone who still has a circle to review, each circle a labelled control", async () => {
    mount();
    expect(await screen.findByText("Ann Lee")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Needs review/ })).toHaveAttribute("aria-pressed", "true");
    const ann = circlesFor("Ann Lee");
    for (const label of ["Combine", "AFLAC", "GTO", "Ethos"]) {
      expect(ann.getByRole("button", { name: new RegExp(`^${label}: Not yet reviewed\\. Press to confirm`) })).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("shows the four circles in the order Combine, AFLAC, GTO, Ethos", async () => {
    mount();
    await screen.findByText("Ann Lee");
    const order = Array.from(circlesFor("Ann Lee").getAllByRole("button", { name: /Press to/ })).map((b) => b.getAttribute("data-circle"));
    expect(order).toEqual(["combine", "aflac", "gto", "ethos"]);
  });

  it("shows an unknown level as 'Not set', never 0", async () => {
    mount();
    await screen.findByText("Ann Lee");
    expect(circlesFor("Ann Lee").getByText("Not set")).toBeInTheDocument();
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("offers no way to mark everyone", async () => {
    mount();
    await screen.findByText("Ann Lee");
    expect(screen.queryByRole("button", { name: /mark (all|everyone)|all complete|complete all/i })).not.toBeInTheDocument();
  });

  it("filter chips show distinct-person counts and each filter lists the right people", async () => {
    mount([agent({ id: "n", display_name: "None Yet" }), agent({ id: "p", display_name: "Part Way", marked: ["aflac", "gto"] }), agent({ id: "f", display_name: "Fully Done", marked: ["combine", "aflac", "gto", "ethos"] })]);
    await screen.findByText("None Yet");
    expect(screen.getByRole("button", { name: /Needs review/ })).toHaveTextContent("2");
    expect(screen.getByRole("button", { name: /Partially marked/ })).toHaveTextContent("1");
    expect(screen.getByRole("button", { name: /All four marked/ })).toHaveTextContent("1");
    expect(screen.queryByText("Fully Done")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Partially marked/ }));
    expect(screen.getByText("Part Way")).toBeInTheDocument();
    expect(screen.queryByText("None Yet")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /All four marked/ }));
    expect(screen.getByText("Fully Done")).toBeInTheDocument();
  });

  it("searches by name, email or NPN and says so when nothing matches", async () => {
    mount([agent({ id: "n", display_name: "Ann Lee", profile: emptyProfile({ npn: "0123456" }) }), agent({ id: "b", display_name: "Bo Chen" })]);
    await screen.findByText("Ann Lee");
    fireEvent.change(screen.getByLabelText("Search agents"), { target: { value: "0123456" } });
    expect(screen.getByText("Ann Lee")).toBeInTheDocument();
    expect(screen.queryByText("Bo Chen")).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search agents"), { target: { value: "zzzz" } });
    expect(screen.getByText("Nobody matches these filters.")).toBeInTheDocument();
  });

  it("pages a long list in full: 120 people, 50 at a time, nothing dropped", async () => {
    mount(Array.from({ length: 120 }, (_, i) => agent({ id: `p${String(i).padStart(3, "0")}`, display_name: `Person ${String(i).padStart(3, "0")}` })));
    await screen.findByText("Person 000");
    expect(screen.getAllByRole("button", { name: /^Details for/ })).toHaveLength(50);
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    fireEvent.click(screen.getByRole("button", { name: "Show more" }));
    expect(screen.getAllByRole("button", { name: /^Details for/ })).toHaveLength(120);
    expect(screen.getByText("Showing all 120.")).toBeInTheDocument();
  });

  it("a failed read is an error with a retry, never an empty list that reads as 'nobody needs review'", async () => {
    fb = fakeBackend([agent({ id: "a" })]);
    fb.state.rosterError = "statement timeout";
    backend.current = fb;
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } })}><MemoryRouter><ContractingReviewWorkspace /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByRole("alert")).toHaveTextContent("did not load");
    expect(screen.queryByText(/Nobody needs review/)).not.toBeInTheDocument();
    expect(screen.queryByText("Agent a")).not.toBeInTheDocument();
    fb.state.rosterError = null;
    fireEvent.click(screen.getByRole("button", { name: /Try again/ }));
    expect(await screen.findByText("Agent a")).toBeInTheDocument();
  });

  it("a short read (fewer people than its own count) is an error, not a smaller list", async () => {
    fb = fakeBackend([agent({ id: "a" })]);
    fb.state.rosterShort = true;
    backend.current = fb;
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } })}><MemoryRouter><ContractingReviewWorkspace /></MemoryRouter></QueryClientProvider>);
    expect(await screen.findByRole("alert")).toHaveTextContent("did not load");
  });

  it("a successful read of nobody is its own message, different from a failure", async () => {
    mount([]);
    expect(await screen.findByText("There are no active agents to review.")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("tapping a circle", () => {
  it("saves immediately with the state the screen believed it was in, and shows Confirmed with an Undo", async () => {
    mount();
    await screen.findByText("Ann Lee");
    fireEvent.click(circlesFor("Ann Lee").getByRole("button", { name: /^GTO:/ }));
    await waitFor(() => expect(circlesFor("Ann Lee").getByRole("button", { name: /^GTO: Confirmed/ })).toHaveAttribute("aria-pressed", "true"));
    expect(fb.calls("set_contract_review_mark")[0].args).toEqual({ p_agent_id: "ann", p_carrier_key: "gto", p_confirmed: true, p_expected: false });
    expect(toast.success).toHaveBeenCalledWith("GTO confirmed for Ann Lee", expect.objectContaining({ action: expect.objectContaining({ label: "Undo" }) }));
  });

  it("Undo returns the circle to Not yet reviewed", async () => {
    mount();
    await screen.findByText("Ann Lee");
    fireEvent.click(circlesFor("Ann Lee").getByRole("button", { name: /^Combine:/ }));
    await waitFor(() => expect(toast.success).toHaveBeenCalled());
    const undo = (toast.success.mock.calls[0][1] as { action: { onClick: () => void } }).action.onClick;
    await act(async () => { undo(); });
    await waitFor(() => expect(circlesFor("Ann Lee").getByRole("button", { name: /^Combine: Not yet reviewed/ })).toBeInTheDocument());
    expect(fb.calls("set_contract_review_mark").at(-1)!.args).toMatchObject({ p_confirmed: false, p_expected: true });
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it("clearing a confirmed circle returns it to Not yet reviewed", async () => {
    mount();
    await screen.findByText("Bo Chen");
    fireEvent.click(circlesFor("Bo Chen").getByRole("button", { name: /^AFLAC: Confirmed/ }));
    await waitFor(() => expect(circlesFor("Bo Chen").getByRole("button", { name: /^AFLAC: Not yet reviewed/ })).toBeInTheDocument());
  });

  it("blocks a double tap while saving: one request, and the circle is busy and disabled", async () => {
    mount();
    await screen.findByText("Ann Lee");
    let release!: () => void;
    fb.state.gate = { name: "set_contract_review_mark", promise: new Promise<void>((r) => { release = r; }) };
    const btn = circlesFor("Ann Lee").getByRole("button", { name: /^Ethos:/ });
    fireEvent.click(btn);
    await waitFor(() => expect(circlesFor("Ann Lee").getByRole("button", { name: /^Ethos:/ })).toHaveAttribute("aria-busy", "true"));
    expect(circlesFor("Ann Lee").getByRole("button", { name: /^Ethos:/ })).toBeDisabled();
    fireEvent.click(circlesFor("Ann Lee").getByRole("button", { name: /^Ethos:/ }));
    release();
    await waitFor(() => expect(circlesFor("Ann Lee").getByRole("button", { name: /^Ethos: Confirmed/ })).toBeInTheDocument());
    expect(fb.calls("set_contract_review_mark")).toHaveLength(1);
  });

  it("a save that does not land restores the previous state, says so, and offers Retry", async () => {
    mount();
    await screen.findByText("Ann Lee");
    fb.state.failNext = { name: "set_contract_review_mark" };
    // Hold the follow-up refetch so the check below sees the immediate restore, not the server's later answer.
    let releaseRefetch!: () => void;
    fb.state.gate = { name: "contract_review_roster", promise: new Promise<void>((r) => { releaseRefetch = r; }) };
    fireEvent.click(circlesFor("Ann Lee").getByRole("button", { name: /^GTO:/ }));
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.error.mock.calls[0][0]).toMatch(/GTO for Ann Lee did not save\. It is back to Not yet reviewed/);
    expect(toast.error.mock.calls[0][1]).toMatchObject({ action: { label: "Retry" } });
    expect(circlesFor("Ann Lee").getByRole("button", { name: /^GTO: Not yet reviewed/ })).toHaveAttribute("aria-pressed", "false");
    expect(toast.success).not.toHaveBeenCalled();
    fb.state.gate = null; releaseRefetch();
    // Retry works and is a normal save.
    await act(async () => { (toast.error.mock.calls[0][1] as { action: { onClick: () => void } }).action.onClick(); });
    await waitFor(() => expect(circlesFor("Ann Lee").getByRole("button", { name: /^GTO: Confirmed/ })).toBeInTheDocument());
  });

  it("a circle changed in another session shows the saved state and says so, instead of overwriting it", async () => {
    mount();
    await screen.findByText("Ann Lee");
    // Another session confirmed GTO after this screen loaded.
    fb.state.agents.find((a) => a.agent_id === "ann")!.marks.gto = { at: "2026-10-09T16:00:00Z", by: "x", by_name: "Max Manager" };
    fireEvent.click(circlesFor("Ann Lee").getByRole("button", { name: /^GTO:/ }));
    await waitFor(() => expect(toast.message).toHaveBeenCalled());
    expect(toast.message.mock.calls[0][0]).toMatch(/was just changed somewhere else/);
    await waitFor(() => expect(circlesFor("Ann Lee").getByRole("button", { name: /^GTO: Confirmed/ })).toBeInTheDocument());
  });

  it("the four circles save independently", async () => {
    mount();
    await screen.findByText("Ann Lee");
    for (const l of ["Combine", "Ethos"]) {
      fireEvent.click(circlesFor("Ann Lee").getByRole("button", { name: new RegExp(`^${l}:`) }));
      await waitFor(() => expect(circlesFor("Ann Lee").getByRole("button", { name: new RegExp(`^${l}: Confirmed`) })).toBeInTheDocument());
    }
    expect(circlesFor("Ann Lee").getByRole("button", { name: /^AFLAC: Not yet reviewed/ })).toBeInTheDocument();
    expect(circlesFor("Ann Lee").getByRole("button", { name: /^GTO: Not yet reviewed/ })).toBeInTheDocument();
  });
});

describe("the person you are working on", () => {
  const all = ["combine", "aflac", "gto", "ethos"];
  it("stays on screen after their last circle is confirmed, until you move to the next person", async () => {
    mount([agent({ id: "ann", display_name: "Ann Lee", marked: all.slice(0, 3) }), agent({ id: "bo", display_name: "Bo Chen" })]);
    await screen.findByText("Ann Lee");
    fireEvent.click(circlesFor("Ann Lee").getByRole("button", { name: /^Ethos:/ }));
    await waitFor(() => expect(circlesFor("Ann Lee").getByRole("button", { name: /^Ethos: Confirmed/ })).toBeInTheDocument());
    await waitFor(() => expect(fb.calls("contract_review_roster").length).toBeGreaterThan(1));
    // Ann now has all four, but is still listed, and so is Bo.
    expect(screen.getByText("Ann Lee")).toBeInTheDocument();
    expect(screen.getByText("Bo Chen")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next unreviewed" }));
    await waitFor(() => expect(screen.queryByText("Ann Lee")).not.toBeInTheDocument());
    expect(screen.getByText("Bo Chen")).toBeInTheDocument();
  });

  it("'Next unreviewed' on the toolbar says nothing is left when everyone is done", async () => {
    mount([agent({ id: "f", display_name: "Fully Done", marked: all })]);
    expect(await screen.findByText(/Nobody needs review/)).toBeInTheDocument();
    expect(screen.getByText(/Every active agent has all four circles confirmed\. Confirm a circle/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Next unreviewed" })).toBeDisabled();
  });

  it("keeps the search text and filter when a details drawer is opened and closed", async () => {
    mount([agent({ id: "ann", display_name: "Ann Lee" }), agent({ id: "bo", display_name: "Bo Chen" })]);
    await screen.findByText("Ann Lee");
    fireEvent.change(screen.getByLabelText("Search agents"), { target: { value: "ann" } });
    fireEvent.click(screen.getByRole("button", { name: "Details for Ann Lee" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByLabelText("Search agents")).toHaveValue("ann");
    expect(screen.queryByText("Bo Chen")).not.toBeInTheDocument();
  });
});

describe("who may change things", () => {
  it("a VA sees the circles but cannot press them, and is told it is view only", async () => {
    Object.assign(auth, { isAdmin: false, isVa: true });
    mount();
    await screen.findByText("Ann Lee");
    const c = circlesFor("Ann Lee").getByRole("button", { name: /^GTO:.*View only/ });
    expect(c).toBeDisabled();
    fireEvent.click(c);
    expect(fb.calls("set_contract_review_mark")).toHaveLength(0);
    expect(screen.getByText(/View only\. Admins and managers confirm carriers\./)).toBeInTheDocument();
  });

  it("someone with no contracting role gets no data call at all", async () => {
    Object.assign(auth, { isAdmin: false });
    mount();
    expect(await screen.findByText(/for admins, managers and the team that supports them/)).toBeInTheDocument();
    expect(fb.calls("contract_review_roster")).toHaveLength(0);
  });
});

describe("the details drawer", () => {
  const open = async (name = "Ann Lee") => {
    fireEvent.click(await screen.findByRole("button", { name: `Details for ${name}` }));
    return within(await screen.findByRole("dialog"));
  };

  it("offers 'Open portal' only for the carrier whose portal address is verified, and says opening it marks nothing", async () => {
    mount();
    const d = await open();
    const links = d.getAllByRole("link", { name: /Open portal/ });
    expect(links).toHaveLength(1);
    expect(d.getAllByText(/Open portal/)).toHaveLength(1);
    expect(links[0]).toHaveAttribute("href", "https://login.aflac.com/");
    expect(links[0]).toHaveAttribute("target", "_blank");
    expect(links[0]).toHaveAttribute("rel", expect.stringContaining("noopener"));
    expect(d.getByText(/Opening a portal does not mark anything/)).toBeInTheDocument();
    expect(fb.calls("set_contract_review_mark")).toHaveLength(0);
  });

  it("says saving the profile does not mean carrier contracting is complete", async () => {
    mount();
    const d = await open();
    expect(d.getByText(/does not mean carrier contracting is complete/)).toBeInTheDocument();
  });

  it("saves the five fields, keeping the NPN's leading zero as typed", async () => {
    mount();
    const d = await open();
    fireEvent.change(d.getByLabelText("First name"), { target: { value: "Ann" } });
    fireEvent.change(d.getByLabelText("Last name"), { target: { value: "Lee" } });
    fireEvent.change(d.getByLabelText("Email"), { target: { value: "ann@lee.test" } });
    fireEvent.change(d.getByLabelText("NPN number"), { target: { value: "0123456" } });
    fireEvent.change(d.getByLabelText("Resident state"), { target: { value: "TX" } });
    fireEvent.click(d.getByRole("button", { name: "Save profile" }));
    await waitFor(() => expect(fb.calls("save_contract_review_profile")).toHaveLength(1));
    expect(fb.calls("save_contract_review_profile")[0].args).toEqual({ p_agent_id: "ann", p_npn: "0123456", p_first: "Ann", p_last: "Lee", p_email: "ann@lee.test", p_state: "TX" });
  });

  it("explains a bad NPN on the field without a round trip", async () => {
    mount();
    const d = await open();
    fireEvent.change(d.getByLabelText("NPN number"), { target: { value: "12" } });
    fireEvent.click(d.getByRole("button", { name: "Save profile" }));
    expect(await d.findByRole("alert")).toHaveTextContent(/5 to 10 digits/);
    expect(fb.calls("save_contract_review_profile")).toHaveLength(0);
  });

  it("shows a conflict with the other person's name and does not pretend it saved", async () => {
    mount();
    const d = await open();
    fb.state.profileResult = { ok: false, conflict: "npn_in_use", field: "npn", other_name: "Bo Chen", error: "That NPN is already on another profile (Bo Chen). Nothing was saved. Staff must resolve it." };
    fireEvent.change(d.getByLabelText("NPN number"), { target: { value: "7654321" } });
    fireEvent.click(d.getByRole("button", { name: "Save profile" }));
    expect(await d.findByRole("alert")).toHaveTextContent(/already on another profile \(Bo Chen\)/);
    expect(toast.success).not.toHaveBeenCalledWith("Contracting profile saved");
  });

  it("sets the placement level, shows it, and an Undo returns to unset", async () => {
    mount();
    const d = await open();
    fireEvent.change(d.getByLabelText("Placement level percent"), { target: { value: "80" } });
    fireEvent.click(d.getByRole("button", { name: "Set level" }));
    await waitFor(() => expect(fb.state.agents.find((a) => a.agent_id === "ann")!.level?.pct).toBe(80));
    expect(fb.calls("set_review_placement_level")[0].args).toEqual({ p_agent_id: "ann", p_pct: 80, p_expect_unset: true });
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith("Level set to 80% for Ann Lee", expect.anything()));
  });

  it("refuses a level outside 0 to 200 on the field", async () => {
    mount();
    const d = await open();
    fireEvent.change(d.getByLabelText("Placement level percent"), { target: { value: "250" } });
    fireEvent.click(d.getByRole("button", { name: "Set level" }));
    expect(await d.findByRole("alert")).toHaveTextContent("0 to 200");
    expect(fb.calls("set_review_placement_level")).toHaveLength(0);
  });

  it("Save & Next saves the edited profile FIRST, then moves to the next person", async () => {
    mount([agent({ id: "ann", display_name: "Ann Lee" }), agent({ id: "bo", display_name: "Bo Chen" })]);
    const d = await open("Ann Lee");
    fireEvent.change(d.getByLabelText("NPN number"), { target: { value: "0123456" } });
    fireEvent.click(d.getByRole("button", { name: "Save & Next" }));
    await waitFor(() => expect(within(screen.getByRole("dialog")).getByRole("heading", { name: "Bo Chen" })).toBeInTheDocument());
    expect(fb.calls("save_contract_review_profile")).toHaveLength(1);
    expect(fb.calls("save_contract_review_profile")[0].args).toMatchObject({ p_agent_id: "ann", p_npn: "0123456" });
  });

  it("Save & Next does NOT move on when the save is refused: you stay on this person with the reason", async () => {
    mount([agent({ id: "ann", display_name: "Ann Lee" }), agent({ id: "bo", display_name: "Bo Chen" })]);
    const d = await open("Ann Lee");
    fb.state.profileResult = { ok: false, conflict: "npn_in_use", field: "npn", other_name: "Bo Chen", error: "That NPN is already on another profile (Bo Chen). Nothing was saved. Staff must resolve it." };
    fireEvent.change(d.getByLabelText("NPN number"), { target: { value: "7654321" } });
    fireEvent.click(d.getByRole("button", { name: "Save & Next" }));
    expect(await d.findByRole("alert")).toHaveTextContent(/already on another profile/);
    expect(within(screen.getByRole("dialog")).getByRole("heading", { name: "Ann Lee" })).toBeInTheDocument();
  });

  it("Next unreviewed moves the drawer to the next person who still has a circle to review", async () => {
    mount([agent({ id: "ann", display_name: "Ann Lee" }), agent({ id: "bo", display_name: "Bo Chen" })]);
    const d = await open("Ann Lee");
    fireEvent.click(d.getByRole("button", { name: "Next unreviewed" }));
    await waitFor(() => expect(within(screen.getByRole("dialog")).getByRole("heading", { name: "Bo Chen" })).toBeInTheDocument());
  });

  it("loads the history lazily and shows who and when", async () => {
    mount();
    const d = await open();
    expect(await d.findByText(/AFLAC confirmed/)).toBeInTheDocument();
    expect(d.getAllByText(/Mia Manager/).length).toBeGreaterThan(0);
  });
});
