/**
 * My Pipeline (src/pages/ClientPipeline.tsx), OVERHAUL-agentpipeline 2026-10-31.
 *
 * Sam: "ridiculously ugly head to toe... Make this 10 times better." These pin the page agents open:
 * one gold button (Up next's call), four numbers that each equal the list they open, one list with the
 * stage in colour and words and one next action per row, the saved call results laid over the imported
 * rows, the whole book paged past 1,000 rows, whose client each is for a manager or the owner, and the
 * loading, empty and failed states that never show a zero for a number nobody could count.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Auth = { user: { id: string } | null; isAdmin: boolean; isManager: boolean; effectiveMode: string };
const auth = vi.hoisted(() => ({ current: null as unknown as Auth }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => auth.current }));
vi.mock("@/hooks/useAgentIdentity", () => ({ useAgentIdentity: () => ({ agentId: "agent-me" }) }));
vi.mock("@/hooks/useSoldCallKeys", () => ({ useSoldCallKeys: () => ({ ready: false, count: 0, has: () => false }) }));

const db = vi.hoisted(() => ({
  clients: [] as Array<Record<string, unknown>>,
  overrides: [] as Array<Record<string, unknown>>,
  agents: [] as Array<Record<string, unknown>>,
  failClients: false,
  ranges: [] as Array<{ table: string; from: number; to: number }>,
}));
vi.mock("@/integrations/supabase/client", () => {
  const query = (table: string) => {
    let rows: Array<Record<string, unknown>> =
      table === "agentlink_clients" ? db.clients : table === "client_pipeline_overrides" ? db.overrides : table === "agents" ? db.agents : [];
    const chain = {
      select: () => chain,
      order: () => chain,
      in: (col: string, values: unknown[]) => { rows = rows.filter((r) => values.includes(r[col])); return chain; },
      range: (from: number, to: number) => {
        db.ranges.push({ table, from, to });
        if (table === "agentlink_clients" && db.failClients) return Promise.resolve({ data: null, error: { message: "permission denied for table agentlink_clients" } });
        return Promise.resolve({ data: rows.slice(from, to + 1), error: null });
      },
      then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve, reject),
    };
    return chain;
  };
  return {
    supabase: {
      from: query,
      rpc: (fn: string) => Promise.resolve(fn === "get_leaderboard_profiles" ? { data: [{ user_id: "u-other", full_name: "Kaeden Vaughns", avatar_url: null }], error: null } : { data: null, error: null }),
    },
  };
});

import ClientPipeline from "@/pages/ClientPipeline";
import { pipelineBackTo } from "@/lib/clientPipelineView";

let seq = 0;
function client(o: Record<string, unknown> = {}) {
  seq += 1;
  return {
    id: `c${String(seq).padStart(4, "0")}`, insuracloud_pipeline_client_id: null, agent_id: "agent-me",
    first_name: "Pat", last_name: `Person ${seq}`, phone: "6025550100", email: null, state: "AZ", city: null,
    pipeline_stage: "NEW_INITIAL", created_at: "2026-10-20T15:00:00Z", updated_at: null, stage_changed_at: null,
    last_contact_date: null, next_action_date: null, callback_date: null, callback_time: null,
    do_not_call: false, do_not_email: false, do_not_text: false, hostile_language_detected: false, policy_number: null, ...o,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <p data-testid="location">{`${location.pathname}${location.search}`}</p>;
}

/** Stands in for the call sheet: shows where its Back to pipeline would go. */
function CallSheetProbe() {
  return <p data-testid="back-to">{pipelineBackTo(useLocation().state)}</p>;
}

function renderPage(path = "/dashboard/agent-pipeline") {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/dashboard/agent-pipeline" element={<ClientPipeline />} />
          <Route path="/dashboard/clients/:id" element={<CallSheetProbe />} />
        </Routes>
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

/** The value of a scoreboard tile, read from its button. */
function tileValue(label: string): string {
  const tile = screen.getByRole("button", { name: new RegExp(`^${label}`) });
  return within(tile).getAllByText(/^(\d[\d,]*|—)$/)[0].textContent ?? "";
}
/** Every client shown: Up next, then the rows. */
function shownNames(): string[] {
  const up = screen.queryByRole("heading", { name: /^Up next: / })?.textContent?.replace("Up next: ", "");
  const list = screen.queryByRole("list", { name: /./ });
  const rows = list
    ? within(list).getAllByRole("listitem").map((li) => {
        const link = within(li).getAllByRole("link")[0];
        return document.getElementById(link.getAttribute("aria-labelledby") ?? "")?.textContent ?? "";
      })
    : [];
  return [...(up ? [up] : []), ...rows];
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date(2026, 9, 31, 12, 0, 0));
  seq = 0;
  auth.current = { user: { id: "u-me" }, isAdmin: false, isManager: false, effectiveMode: "agent" };
  db.failClients = false;
  db.ranges = [];
  db.agents = [{ id: "agent-other", user_id: "u-other", display_name: "K. Vaughns" }];
  db.clients = [
    client({ first_name: "Lena", last_name: "Late", pipeline_stage: "FOLLOW_UP" }),
    client({ first_name: "Tia", last_name: "Today" }),
    client({ first_name: "Nora", last_name: "New", created_at: "2026-10-30T15:00:00Z" }),
    client({ first_name: "Owen", last_name: "Older", created_at: "2026-10-01T15:00:00Z" }),
    client({ first_name: "Fay", last_name: "Followup", last_contact_date: "2026-10-10T15:00:00Z" }),
    client({ first_name: "Al", last_name: "Almost", pipeline_stage: "ALMOST_THERE", last_contact_date: "2026-10-30T15:00:00Z" }),
    client({ first_name: "Sid", last_name: "Scheduled" }),
    client({ first_name: "Sol", last_name: "Sold", pipeline_stage: "SOLD" }),
    client({ first_name: "Ken", last_name: "Other", agent_id: "agent-other", created_at: "2026-10-25T15:00:00Z" }),
  ];
  // The call sheet's saved results: they decide Lena's late callback, Tia's, Sid's and Al's next step.
  db.overrides = [
    { client_id: "c0001", stage_override: "FOLLOW_UP", stage_changed_at: null, last_contact_date: "2026-10-25T15:00:00Z", next_action_date: null, callback_date: "2026-10-28", callback_time: null, schedule_overridden: true, reminder_notes: "Send the quote" },
    { client_id: "c0002", stage_override: "FOLLOW_UP", stage_changed_at: null, last_contact_date: "2026-10-29T15:00:00Z", next_action_date: null, callback_date: "2026-10-31", callback_time: "15:00", schedule_overridden: true, reminder_notes: null },
    { client_id: "c0007", stage_override: "FOLLOW_UP", stage_changed_at: null, last_contact_date: "2026-10-30T15:00:00Z", next_action_date: null, callback_date: "2026-11-04", callback_time: null, schedule_overridden: true, reminder_notes: null },
    { client_id: "c0006", stage_override: null, stage_changed_at: null, last_contact_date: null, next_action_date: "2026-11-02T00:00:00+00:00", callback_date: null, callback_time: null, schedule_overridden: true, reminder_notes: null },
  ];
});

afterEach(() => {
  vi.useRealTimers();
});

describe("My Pipeline", () => {
  it("leads with the person to call, what to do and why, and the page's one gold button", async () => {
    renderPage();
    const heading = await screen.findByRole("heading", { name: "Up next: Lena Late" });
    const card = within(heading.closest("section") as HTMLElement);
    const todo = within(card.getByRole("region", { name: "What to do next" }));
    expect(todo.getByText("Call back")).toBeInTheDocument();
    expect(todo.getByText("The callback was due Oct 28. Your note: “Send the quote”")).toBeInTheDocument();
    const call = card.getByRole("link", { name: "Call back: call Lena Late" });
    expect(call.getAttribute("href")).toMatch(/^(tel:|https:)/);
    const gold = Array.from(document.querySelectorAll("a, button")).filter((el) => el.classList.contains("bg-primary"));
    expect(gold).toEqual([call]);
  });

  it("shows four numbers, each equal to the list it opens, and To do as their sum", async () => {
    renderPage();
    await screen.findByRole("heading", { name: /^Up next: / });
    expect(tileValue("Call today")).toBe("2");
    expect(tileValue("Never called")).toBe("3");
    expect(tileValue("No next step")).toBe("1");
    expect(tileValue("Almost there")).toBe("1");
    expect(shownNames()).toEqual(["Lena Late", "Tia Today", "Nora New", "Ken Other", "Owen Older", "Fay Followup"]);

    for (const [label, expected] of [
      ["Call today", ["Lena Late", "Tia Today"]],
      ["Never called", ["Nora New", "Ken Other", "Owen Older"]],
      ["No next step", ["Fay Followup"]],
      ["Almost there", ["Al Almost"]],
    ] as const) {
      fireEvent.click(screen.getByRole("button", { name: new RegExp(`^${label}`) }));
      await waitFor(() => expect(shownNames()).toEqual(expected));
      expect(Number(tileValue(label))).toBe(expected.length);
    }
  });

  it("puts the list in the address bar, and a second tap on a number goes back to To do", async () => {
    renderPage();
    await screen.findByRole("heading", { name: /^Up next: / });
    const tile = screen.getByRole("button", { name: /^No next step/ });
    fireEvent.click(tile);
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/dashboard/agent-pipeline?list=follow_up"));
    expect(tile.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(tile);
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/dashboard/agent-pipeline"));
  });

  it("opens Scheduled, Sold and Everyone from the chips with counts that match", async () => {
    renderPage("/dashboard/agent-pipeline?list=scheduled");
    await screen.findByText("Sid Scheduled");
    const chips = within(screen.getByRole("group", { name: "Which clients to show" }));
    expect(chips.getByRole("button", { name: /^To do/ }).textContent).toBe("To do6");
    // Al is almost there with his next action set for Monday, so he waits here too, first.
    expect(chips.getByRole("button", { name: /^Scheduled/ }).textContent).toBe("Scheduled2");
    expect(shownNames()).toEqual(["Al Almost", "Sid Scheduled"]);
    // Nothing to do yet for a later callback: no Up next, no gold, the row says when.
    expect(screen.queryByRole("heading", { name: /^Up next: / })).toBeNull();
    expect(screen.getByText("Callback Nov 4")).toBeInTheDocument();
    expect(screen.getByText("Follow-up Nov 2")).toBeInTheDocument();
    expect(Array.from(document.querySelectorAll("a, button")).filter((el) => el.classList.contains("bg-primary"))).toEqual([]);

    fireEvent.click(chips.getByRole("button", { name: /^Sold/ }));
    await waitFor(() => expect(shownNames()).toEqual(["Sol Sold"]));
    expect(chips.getByRole("button", { name: /^Sold/ }).textContent).toBe("Sold1");

    fireEvent.click(chips.getByRole("button", { name: /^Everyone/ }));
    await waitFor(() => expect(shownNames()).toHaveLength(9));
    expect(chips.getByRole("button", { name: /^Everyone/ }).textContent).toBe("Everyone9");
  });

  it("gives each row its stage in words and one action that does the next step", async () => {
    renderPage();
    await screen.findByRole("heading", { name: /^Up next: / });
    const row = within(screen.getByText("Nora New").closest("li") as HTMLElement);
    expect(row.getByText("New")).toBeInTheDocument();
    expect(row.getByText("Added Oct 30")).toBeInTheDocument();
    expect(row.getAllByRole("link")).toEqual([row.getByRole("link", { name: "Nora New" }), row.getByRole("link", { name: "First call: call Nora New" })]);
    const fay = within(screen.getByText("Fay Followup").closest("li") as HTMLElement);
    expect(fay.getByText("Talked Oct 10 · no next step")).toBeInTheDocument();
    expect(fay.getByRole("link", { name: "Follow up: call Fay Followup" })).toBeInTheDocument();
  });

  it("dials and opens the call sheet underneath, so the outcome is one tap away", async () => {
    renderPage();
    const heading = await screen.findByRole("heading", { name: /^Up next: / });
    fireEvent.click(within(heading.closest("section") as HTMLElement).getByRole("link", { name: "Call back: call Lena Late" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/dashboard/clients/c0001"));
  });

  it("hands the call sheet the list and search to go back to", async () => {
    renderPage("/dashboard/agent-pipeline?list=new&q=o");
    await screen.findByRole("heading", { name: /^Up next: / });
    fireEvent.click(screen.getByRole("link", { name: "Owen Older" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toMatch(/^\/dashboard\/clients\/c\d+$/));
    expect(screen.getByTestId("back-to").textContent).toBe("/dashboard/agent-pipeline?list=new&q=o");
  });

  it("narrows every number and the list together when searching", async () => {
    renderPage();
    await screen.findByRole("heading", { name: /^Up next: / });
    fireEvent.change(screen.getByRole("searchbox", { name: "Search clients" }), { target: { value: "nora" } });
    await waitFor(() => expect(shownNames()).toEqual(["Nora New"]));
    // The numbers count as they change (a 280ms tween), then settle on the searched book.
    await waitFor(() => expect(tileValue("Call today")).toBe("0"));
    await waitFor(() => expect(tileValue("Never called")).toBe("1"));
    expect(screen.getByTestId("location").textContent).toBe("/dashboard/agent-pipeline?q=nora");
    fireEvent.change(screen.getByRole("searchbox", { name: "Search clients" }), { target: { value: "zzz" } });
    expect(await screen.findByText("Nobody here matches “zzz”")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));
    await waitFor(() => expect(shownNames()).toHaveLength(6));
  });

  it("says whose client each one is for the owner, but not on their own clients", async () => {
    auth.current = { user: { id: "u-me" }, isAdmin: true, isManager: false, effectiveMode: "admin" };
    renderPage();
    await screen.findByRole("heading", { name: /^Up next: / });
    expect(screen.getByText("All clients, in the order to call them.")).toBeInTheDocument();
    const ken = within(screen.getByText("Ken Other").closest("li") as HTMLElement);
    expect(await ken.findByText("Kaeden Vaughns")).toBeInTheDocument();
    const nora = within(screen.getByText("Nora New").closest("li") as HTMLElement);
    expect(nora.queryByText("Kaeden Vaughns")).toBeNull();
    // The owner can find a client by the agent's name.
    fireEvent.change(screen.getByRole("searchbox", { name: "Search clients" }), { target: { value: "kaeden" } });
    await waitFor(() => expect(shownNames()).toEqual(["Ken Other"]));
  });

  it("never names an agent on an agent's own book", async () => {
    renderPage();
    await screen.findByRole("heading", { name: /^Up next: / });
    expect(screen.getByText("Your clients, in the order to call them.")).toBeInTheDocument();
    expect(screen.queryByText("Kaeden Vaughns")).toBeNull();
    expect(db.ranges.some((r) => r.table === "agents")).toBe(false);
  });

  it("pages the whole book past PostgREST's 1,000-row cap", async () => {
    db.clients = Array.from({ length: 1_500 }, (_, i) => client({ first_name: "Bulk", last_name: `Client ${i}` }));
    db.overrides = [];
    renderPage();
    await screen.findByRole("heading", { name: /^Up next: / });
    expect(tileValue("Never called")).toBe("1,500");
    expect(db.ranges.filter((r) => r.table === "agentlink_clients").map((r) => r.from)).toEqual([0, 1_000]);
    // Fifty rows at a time after Up next, with the rest one tap away.
    expect(screen.getByRole("button", { name: "Show 50 more (1,449 not shown yet)" })).toBeInTheDocument();
  });

  it("shows a dash, not a zero, while loading and when the clients failed to load", async () => {
    db.failClients = true;
    renderPage();
    expect(await screen.findByText("Your clients did not load")).toBeInTheDocument();
    expect(screen.getByText("permission denied for table agentlink_clients")).toBeInTheDocument();
    for (const label of ["Call today", "Never called", "No next step", "Almost there"]) expect(tileValue(label)).toBe("—");
    expect(screen.getByText("The numbers are hidden because your clients did not load.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Try again/ })).toBeInTheDocument();
  });

  it("invites the first client when the book is empty, with the one gold button", async () => {
    db.clients = [];
    db.overrides = [];
    renderPage();
    expect(await screen.findByText("No clients yet")).toBeInTheDocument();
    // Nothing to count, sort or search yet: the welcome and Add client stand alone.
    expect(screen.queryByRole("region", { name: "Pipeline numbers" })).toBeNull();
    expect(screen.queryByRole("searchbox", { name: "Search clients" })).toBeNull();
    const gold = Array.from(document.querySelectorAll("a, button")).filter((el) => el.classList.contains("bg-primary"));
    expect(gold.map((el) => el.textContent?.trim())).toEqual(["Add client"]);
  });

  it("says when a list is clear and offers the way back", async () => {
    db.clients = db.clients.filter((c) => c.last_name !== "Almost");
    renderPage("/dashboard/agent-pipeline?list=almost");
    expect(await screen.findByText("Nobody is almost there yet")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Show the To do list" }));
    await waitFor(() => expect(screen.getByTestId("location").textContent).toBe("/dashboard/agent-pipeline"));
  });

  it("keeps the last good list when a reload fails, and says so", async () => {
    renderPage();
    await screen.findByRole("heading", { name: /^Up next: / });
    db.failClients = true;
    fireEvent.click(screen.getByRole("button", { name: "Reload clients" }));
    expect(await screen.findByText(/The latest reload failed: permission denied for table agentlink_clients/)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Up next: Lena Late" })).toBeInTheDocument();
    expect(tileValue("Call today")).toBe("2");
  });

  it("never offers a call to a do-not-call client", async () => {
    db.clients.push(client({ first_name: "Dee", last_name: "Nocall", do_not_call: true, email: "dee@example.com" }));
    renderPage("/dashboard/agent-pipeline?list=all");
    const row = within((await screen.findByText("Dee Nocall")).closest("li") as HTMLElement);
    expect(row.getByText("Do not call")).toBeInTheDocument();
    expect(row.getByRole("link", { name: "Email Dee Nocall" }).getAttribute("href")).toBe("mailto:dee@example.com");
    expect(row.queryByRole("link", { name: /call Dee Nocall/ })).toBeNull();
    expect(screen.getByRole("group", { name: "Which clients to show" }).textContent).toContain("To do6");
  });

  it("explains the order and the colours on request", async () => {
    renderPage();
    await screen.findByRole("heading", { name: /^Up next: / });
    const toggle = screen.getByRole("button", { name: /How it works/ });
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const panel = document.getElementById(toggle.getAttribute("aria-controls") ?? "") as HTMLElement;
    expect(panel.hidden).toBe(true);
    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(panel.hidden).toBe(false);
    expect(screen.getByText("Late callbacks, the oldest promise first.")).toBeInTheDocument();
    expect(screen.getByText("An appointment is set to finish the sale.")).toBeInTheDocument();
    expect(screen.getByText(/Dialing records nothing/)).toBeInTheDocument();
  });
});
