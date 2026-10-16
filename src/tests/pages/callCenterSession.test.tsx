/**
 * CallCenter dial session (F04 / F05 / F06 of the 2026-10-14 Galaxy OS map,
 * review round 2). Drives the real page with the child components reduced to
 * buttons, and a Supabase stub that records every request.
 *
 * F04: the hire path saves the call notes once; a failure after the hire says
 * the agent account exists; Previous, the queue rail, Exit and every other way
 * of leaving a lead save the notes first and stay put when that fails; a
 * second key press while a save runs does nothing; words that arrive after
 * their lead left the screen are saved to that lead, never to the next one;
 * keys behind an open dialog do nothing.
 * F05: rescheduling an aged lead writes nothing and points to Needs follow-up.
 * F06: closed records stay out of the queue unless an admin opts in, and the
 * header shows coverage only for a loaded queue.
 */
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { useEffect, useRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { supabase } from "@/integrations/supabase/client";
import type { AgentIdentityRow } from "@/lib/agentIdentity";

type Op = { method: string; args: unknown[] };
type Req = { table: string; ops: Op[] };
type Result = { data?: unknown; error?: unknown; count?: number | null };

const state = vi.hoisted(() => ({
  toasts: [] as Array<{ level: string; title: string; options?: { description?: string } }>,
  transcriptCallbacks: new Map<string, (text: string) => void>(),
  playSound: (() => undefined) as (sound: string) => void,
  identity: null as unknown,
  auth: null as unknown,
  pageSize: 500,
}));

vi.mock("sonner", () => {
  const make = (level: string) => (title: unknown, options?: { description?: string }) => {
    state.toasts.push({ level, title: String(title), options });
  };
  return { toast: Object.assign(make("message"), { success: make("success"), error: make("error"), info: make("info"), warning: make("warning") }) };
});
vi.mock("@/lib/callCenterQueue", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/callCenterQueue")>();
  return {
    ...actual,
    get QUEUE_PAGE_SIZE() {
      return state.pageSize;
    },
    pageHasMore: (pageLength: number) => pageLength >= state.pageSize,
  };
});
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => state.auth }));
vi.mock("@/hooks/useAgentIdentity", () => ({ useAgentIdentity: () => state.identity }));
vi.mock("@/hooks/useSoundEffects", () => ({ useSoundEffects: () => ({ playSound: state.playSound }) }));
vi.mock("@/lib/hireToOnboarding", () => ({
  createCanonicalHire: vi.fn(),
  promoteApplicationToAgent: vi.fn(),
}));
vi.mock("@/components/dashboard/ConfettiCelebration", () => ({ ConfettiCelebration: () => null }));
vi.mock("@/components/dashboard/InterviewScheduler", () => ({ InterviewScheduler: () => null }));
vi.mock("@/components/dashboard/ApplicationDetailSheet", () => ({ ApplicationDetailSheet: () => null }));
vi.mock("@/components/dashboard/ContractedModal", () => ({ ContractedModal: () => null }));
vi.mock("@/components/callcenter/HireConfirmModal", () => ({
  HireConfirmModal: (props: { open: boolean; applicantName: string; onConfirm: (bought: boolean, npn: string) => void }) =>
    props.open ? (
      <div role="dialog">
        <p>Hire {props.applicantName}</p>
        <button type="button" onClick={() => props.onConfirm(false, "1234567")}>
          Confirm hire
        </button>
      </div>
    ) : null,
}));
vi.mock("@/components/callcenter", () => ({
  CallCenterFilters: (props: { onStart: () => void; disabled?: boolean }) => (
    <button type="button" onClick={props.onStart} disabled={props.disabled}>
      Start calling
    </button>
  ),
  CallCenterLeadCard: function FakeLeadCard(props: { lead: { id: string; firstName: string }; onTranscriptionUpdate: (text: string) => void }) {
    // The recorder captures the callback once, on mount, the way its effect does.
    const captured = useRef(props.onTranscriptionUpdate);
    useEffect(() => {
      state.transcriptCallbacks.set(props.lead.id, captured.current);
    }, [props.lead.id]);
    return <h2 data-testid="lead-name">{props.lead.firstName}</h2>;
  },
  CallCenterActions: (props: { onAction: (id: string) => void; onSkip: () => void; onPrevious?: () => void }) => (
    <div>
      <button type="button" onClick={() => props.onAction("hired")}>Hired</button>
      <button type="button" onClick={() => props.onAction("contacted")}>Contacted</button>
      <button type="button" onClick={() => props.onAction("reschedule")}>Reschedule</button>
      <button type="button" onClick={props.onSkip}>Skip</button>
      <button type="button" onClick={() => props.onPrevious?.()}>Previous</button>
    </div>
  ),
  CallCenterProgressRing: () => null,
}));

import CallCenter from "@/pages/CallCenter";
import { promoteApplicationToAgent } from "@/lib/hireToOnboarding";

const requests: Req[] = [];
let respond: (req: Req) => Result | Promise<Result>;
const serverNotes = new Map<string, string | null>();

function chainFor(table: string) {
  const req: Req = { table, ops: [] };
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "is", "not", "or", "gt", "lt", "gte", "order", "limit", "update"]) {
    chain[method] = (...args: unknown[]) => {
      req.ops.push({ method, args });
      return chain;
    };
  }
  chain.then = (onFulfilled: (r: Result) => unknown, onRejected?: (e: unknown) => unknown) => {
    requests.push(req);
    return Promise.resolve()
      .then(() => respond(req))
      .then(onFulfilled, onRejected);
  };
  return chain;
}

const op = (req: Req, method: string) => req.ops.find((o) => o.method === method);
const eqValue = (req: Req, column: string) => req.ops.find((o) => o.method === "eq" && o.args[0] === column)?.args[1];
const isUpdate = (req: Req) => Boolean(op(req, "update"));
const updatePayload = (req: Req) => (op(req, "update")?.args[0] ?? {}) as Record<string, unknown>;
const isHead = (req: Req) => Boolean((op(req, "select")?.args[1] as { head?: boolean } | undefined)?.head);
const isNotesRead = (req: Req) => !isUpdate(req) && ["notes", "notes, updated_at"].includes(String(op(req, "select")?.args[0]));
const isNotesWrite = (req: Req) => isUpdate(req) && "notes" in updatePayload(req);
const isDisposition = (req: Req) => isUpdate(req) && !("notes" in updatePayload(req));
const isPage = (req: Req) => !isUpdate(req) && !isHead(req) && !isNotesRead(req);
const isAfterCursor = (req: Req) => req.ops.some((o) => o.method === "or" && String(o.args[0]).startsWith("created_at."));

function application(id: string, firstName: string, createdAt: string) {
  return {
    id,
    first_name: firstName,
    last_name: "Lee",
    email: `${firstName.toLowerCase()}@example.com`,
    phone: "5550100",
    instagram_handle: null,
    notes: null,
    license_status: "unlicensed",
    license_progress: null,
    test_scheduled_date: null,
    created_at: createdAt,
    status: "new",
    contacted_at: null,
    last_contacted_at: null,
    previous_company: null,
    nipr_number: null,
    licensed_states: null,
    city: null,
    state: null,
    availability: null,
    assigned_agent_id: null,
    hiring_manager_user_id: null,
    referral_manager_id: "agent-1",
    recruiter_id: null,
    terminated_at: null,
    contracted_at: null,
    closed_at: null,
    agents: null,
  };
}

function agedLead(id: string, firstName: string) {
  return {
    id,
    first_name: firstName,
    last_name: null,
    email: null,
    phone: "5550101",
    instagram_handle: null,
    notes: null,
    motivation: null,
    license_status: "unknown",
    created_at: "2026-01-01T00:00:00Z",
    status: "new",
    contacted_at: null,
    last_contacted_at: null,
    assigned_manager_id: null,
    agents: null,
  };
}

/** A server that answers pages, counts, note reads and guarded note writes, and accepts dispositions. */
function serverWith(rows: { aged_leads?: unknown[]; applications?: unknown[] }) {
  return (req: Req): Result => {
    const tableRows = (rows[req.table as "aged_leads" | "applications"] ?? []) as unknown[];
    if (isHead(req)) return { count: tableRows.length, error: null, data: null };
    if (isPage(req)) return { data: tableRows, error: null };
    const id = String(eqValue(req, "id"));
    if (isNotesRead(req)) return { data: [{ notes: serverNotes.get(id) ?? null, updated_at: "2026-10-15T00:00:00Z" }], error: null };
    if (isNotesWrite(req)) {
      const next = String(updatePayload(req).notes);
      serverNotes.set(id, next);
      return { data: [{ notes: next }], error: null };
    }
    if (isDisposition(req)) return { data: [{ id }], error: null };
    return { data: null, error: { message: `unexpected request on ${req.table}` } };
  };
}

const ROW: AgentIdentityRow = {
  id: "agent-1",
  user_id: "user-1",
  agent_code: "SJ1",
  display_name: "Sam James",
  status: "active",
  is_inactive: false,
  is_deactivated: false,
  created_at: "2026-01-01T00:00:00Z",
  canonical_agent_id: null,
};

async function startSession() {
  render(
    <MemoryRouter>
      <CallCenter />
    </MemoryRouter>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Start calling" }));
  return screen.findByTestId("lead-name");
}

function speak(leadId: string, text: string) {
  const callback = state.transcriptCallbacks.get(leadId);
  if (!callback) throw new Error(`no recorder mounted for ${leadId}`);
  act(() => callback(text));
}

const notesWrites = () => requests.filter(isNotesWrite);
const toastTitles = (level: string) => state.toasts.filter((t) => t.level === level).map((t) => t.title);

beforeEach(() => {
  state.pageSize = 500;
  requests.length = 0;
  serverNotes.clear();
  state.toasts.length = 0;
  state.transcriptCallbacks.clear();
  state.playSound = vi.fn();
  state.auth = {
    isAdmin: true,
    isVa: false,
    isVaManager: false,
    isRecruiter: false,
    isLoading: false,
    user: { id: "user-1", email: "sam@example.com" },
    profile: { full_name: "Sam James" },
  };
  state.identity = { identity: { status: "resolved", agentId: "agent-1", row: ROW }, agentId: "agent-1", isLoading: false, isError: false, refetch: vi.fn(), userId: "user-1" };
  vi.mocked(supabase.from).mockImplementation(((table: string) => chainFor(table)) as never);
  vi.mocked(supabase.functions.invoke).mockResolvedValue({ data: { success: true, emailSent: true, emailId: "re_1" }, error: null } as never);
  vi.mocked(supabase.rpc).mockResolvedValue({ data: null, error: null } as never);
  vi.mocked(promoteApplicationToAgent).mockResolvedValue({ agentId: "new-agent", partial: false, message: "ok" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("CallCenter session", () => {
  it("saves the call notes once on a hire, then marks the lead hired", async () => {
    respond = serverWith({ applications: [application("app-a", "Alice", "2026-10-01T00:00:00Z")] });
    expect(await startSession()).toHaveTextContent("Alice");

    speak("app-a", "spoke about Tuesday ");
    fireEvent.click(screen.getByRole("button", { name: "Hired" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm hire" }));

    await waitFor(() => expect(requests.some(isDisposition)).toBe(true));
    await waitFor(() => expect(toastTitles("success")).toContain("Lead marked as hired. Follow-up email accepted by the mail provider."));
    expect(promoteApplicationToAgent).toHaveBeenCalledTimes(1);
    expect(notesWrites()).toHaveLength(1);
    const written = String(updatePayload(notesWrites()[0]).notes);
    expect(written.match(/spoke about Tuesday/g)).toHaveLength(1);
    expect(written).toContain("by Sam James]");
    // The notes were saved before the hire started, and the disposition came after the hire.
    const order = requests.map((r) => (isNotesWrite(r) ? "notes" : isDisposition(r) ? "disposition" : null)).filter(Boolean);
    expect(order).toEqual(["notes", "disposition"]);
  });

  it("says the agent account exists when marking the lead hired is refused after the hire", async () => {
    const base = serverWith({ applications: [application("app-a", "Alice", "2026-10-01T00:00:00Z")] });
    respond = (req) => (isDisposition(req) ? { data: [], error: null } : base(req));
    await startSession();

    fireEvent.click(screen.getByRole("button", { name: "Hired" }));
    fireEvent.click(await screen.findByRole("button", { name: "Confirm hire" }));

    await waitFor(() => expect(toastTitles("error")).toContain("The agent account was created, but this lead was not marked hired"));
    expect(toastTitles("success")).toContain("Agent account created · onboarding started");
    expect(toastTitles("success")).not.toContain("Lead marked as hired. Follow-up email accepted by the mail provider.");
    // Nothing moved: the lead is still on screen.
    expect(screen.getByTestId("lead-name")).toHaveTextContent("Alice");
  });

  it("saves the notes before Previous moves, and stays put with the draft kept when that save fails", async () => {
    const base = serverWith({
      applications: [application("app-a", "Alice", "2026-10-01T00:00:00Z"), application("app-b", "Bob", "2026-10-02T00:00:00Z")],
    });
    let failWrites = true;
    respond = (req) => (isNotesWrite(req) && failWrites ? { data: null, error: { message: "write refused" } } : base(req));
    await startSession();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(screen.getByTestId("lead-name")).toHaveTextContent("Bob"));

    speak("app-b", "Bob wants a callback ");
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() => expect(toastTitles("error")).toContain("Call notes for Bob Lee were NOT saved, so the queue did not move"));
    expect(screen.getByTestId("lead-name")).toHaveTextContent("Bob");

    failWrites = false;
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() => expect(screen.getByTestId("lead-name")).toHaveTextContent("Alice"));
    const landed = notesWrites().filter((r) => !("error" in r));
    expect(eqValue(landed[landed.length - 1], "id")).toBe("app-b");
    expect(String(serverNotes.get("app-b"))).toContain("Bob wants a callback");
  });

  it("ignores a second Skip while the notes are saving: one save, one step", async () => {
    const base = serverWith({
      applications: [
        application("app-a", "Alice", "2026-10-01T00:00:00Z"),
        application("app-b", "Bob", "2026-10-02T00:00:00Z"),
        application("app-c", "Cara", "2026-10-03T00:00:00Z"),
      ],
    });
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    respond = async (req) => {
      if (isNotesWrite(req)) await gate;
      return base(req);
    };
    await startSession();
    speak("app-a", "left a voicemail ");

    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    fireEvent.keyDown(window, { key: "n" });
    await act(async () => {
      release();
      await gate;
    });

    await waitFor(() => expect(screen.getByTestId("lead-name")).toHaveTextContent("Bob"));
    expect(notesWrites()).toHaveLength(1);
    // Give any stray second advance a chance to land; it must not.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.getByTestId("lead-name")).toHaveTextContent("Bob");
  });

  it("saves words that arrive after their lead left the screen to that lead, never to the one now showing", async () => {
    respond = serverWith({
      applications: [application("app-a", "Alice", "2026-10-01T00:00:00Z"), application("app-b", "Bob", "2026-10-02T00:00:00Z")],
    });
    await startSession();
    speak("app-a", "first part ");
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(screen.getByTestId("lead-name")).toHaveTextContent("Bob"));
    expect(notesWrites().map((r) => eqValue(r, "id"))).toEqual(["app-a"]);

    // The speech service delivers the last words for Alice after her card left.
    speak("app-a", "first part and the rest ");
    fireEvent.click(screen.getByRole("button", { name: "Contacted" }));
    await waitFor(() => expect(requests.some(isDisposition)).toBe(true));

    expect(notesWrites().map((r) => eqValue(r, "id"))).toEqual(["app-a", "app-a"]);
    const second = String(updatePayload(notesWrites()[1]).notes);
    expect(second.endsWith("\nand the rest")).toBe(true);
    expect(second.match(/first part/g)).toHaveLength(1);
    expect(serverNotes.has("app-b")).toBe(false);
    expect(eqValue(requests.filter(isDisposition)[0], "id")).toBe("app-b");
  });

  it("ignores queue keys while the hire dialog is open", async () => {
    respond = serverWith({
      applications: [application("app-a", "Alice", "2026-10-01T00:00:00Z"), application("app-b", "Bob", "2026-10-02T00:00:00Z")],
    });
    await startSession();
    fireEvent.click(screen.getByRole("button", { name: "Hired" }));
    expect(await screen.findByText("Hire Alice Lee")).toBeInTheDocument();

    fireEvent.keyDown(window, { key: "n" });
    fireEvent.keyDown(window, { key: "4" });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    expect(screen.getByTestId("lead-name")).toHaveTextContent("Alice");
    expect(screen.getByText("Hire Alice Lee")).toBeInTheDocument();
    expect(requests.some(isUpdate)).toBe(false);
  });

  it("does not schedule or move an aged lead, and points to Needs follow-up", async () => {
    respond = serverWith({ aged_leads: [agedLead("aged-1", "Dana")] });
    await startSession();
    fireEvent.click(screen.getByRole("button", { name: "Reschedule" }));

    await waitFor(() => expect(toastTitles("error")).toContain("Scheduling needs an application record"));
    const toast = state.toasts.find((t) => t.title === "Scheduling needs an application record");
    expect(toast?.options?.description).toContain("Use Needs follow-up");
    expect(toast?.options?.description).not.toContain("unlicensed-all");
    expect(requests.some(isUpdate)).toBe(false);
    expect(supabase.rpc).not.toHaveBeenCalled();
    expect(screen.getByTestId("lead-name")).toHaveTextContent("Dana");
  });

  it("keeps closed records out by default, lets an admin opt in, and shows coverage only for a loaded queue", async () => {
    respond = serverWith({ applications: [application("app-a", "Alice", "2026-10-01T00:00:00Z")] });
    render(
      <MemoryRouter>
        <CallCenter />
      </MemoryRouter>,
    );
    const toggle = screen.getByRole("switch", { name: "Include closed records" });
    expect(toggle).toHaveAttribute("aria-checked", "false");

    fireEvent.click(screen.getByRole("button", { name: "Start calling" }));
    await screen.findByTestId("lead-name");
    const firstPage = requests.find((r) => r.table === "applications" && isPage(r));
    expect(firstPage?.ops).toContainEqual({ method: "not", args: ["status", "in", "(rejected,disqualified,lapsed)"] });
    expect(firstPage?.ops).toContainEqual({ method: "is", args: ["closed_at", null] });
    expect(firstPage?.ops).toContainEqual({ method: "is", args: ["do_not_contact_at", null] });
    const agedPage = requests.find((r) => r.table === "aged_leads" && isPage(r));
    expect(agedPage?.ops).toContainEqual({ method: "not", args: ["dnc", "is", true] });
    expect(screen.getByText(/1 loaded so far · 1 match now \(counted /)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Exit call center" }));
    fireEvent.click(await screen.findByRole("switch", { name: "Include closed records" }));
    requests.length = 0;
    fireEvent.click(screen.getByRole("button", { name: "Start calling" }));
    await screen.findByTestId("lead-name");
    const optedIn = requests.find((r) => r.table === "applications" && isPage(r));
    expect(optedIn?.ops).not.toContainEqual({ method: "is", args: ["closed_at", null] });
    expect(optedIn?.ops).toContainEqual({ method: "is", args: ["do_not_contact_at", null] });
    expect(optedIn?.ops).toContainEqual({ method: "is", args: ["phone_bad_at", null] });
  });

  it("advances into a page loaded during the session instead of calling the old last lead the end", async () => {
    state.pageSize = 2;
    const firstPage = [application("app-a", "Alice", "2026-10-01T00:00:00Z"), application("app-b", "Bob", "2026-10-02T00:00:00Z")];
    const nextPage = [application("app-c", "Cara", "2026-10-03T00:00:00Z")];
    const base = serverWith({ applications: firstPage });
    respond = (req) => {
      if (req.table === "applications" && isPage(req)) return { data: isAfterCursor(req) ? nextPage : firstPage, error: null };
      if (req.table === "applications" && isHead(req)) return { count: isAfterCursor(req) ? nextPage.length : 3, error: null, data: null };
      return base(req);
    };
    await startSession();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(screen.getByTestId("lead-name")).toHaveTextContent("Bob"));
    expect(screen.getByText(/2 loaded so far · 3 match now/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Load more leads/ }));
    await waitFor(() => expect(screen.getByText(/3 loaded so far/)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Contacted" }));

    await waitFor(() => expect(screen.getByTestId("lead-name")).toHaveTextContent("Cara"));
    expect(toastTitles("message").concat(toastTitles("info"))).not.toContain("You've reached the last lead");
  });

  it("guards an aged-lead notes append on the text it read, and reports a refused write as refused, not as a race", async () => {
    serverNotes.set("aged-1", "older note");
    const base = serverWith({ aged_leads: [agedLead("aged-1", "Dana")] });
    let refuse = false;
    respond = (req) => (isNotesWrite(req) && refuse ? { data: [], error: null } : base(req));
    await startSession();

    speak("aged-1", "asked for a text ");
    refuse = true;
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(toastTitles("error")).toContain("Call notes for Dana were NOT saved, so the queue did not move"));
    const refused = state.toasts.find((t) => t.title.startsWith("Call notes for Dana"));
    expect(refused?.options?.description).toContain("would not update this lead");
    // One guarded write, then a re-read that found the text unchanged: no blind retry.
    expect(notesWrites()).toHaveLength(1);
    expect(notesWrites()[0].ops).toContainEqual({ method: "eq", args: ["notes", "older note"] });

    refuse = false;
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    await waitFor(() => expect(String(serverNotes.get("aged-1"))).toContain("asked for a text"));
    expect(String(serverNotes.get("aged-1")).startsWith("older note")).toBe(true);
  });

  it("saves the notes before Exit leaves the session", async () => {
    respond = serverWith({ applications: [application("app-a", "Alice", "2026-10-01T00:00:00Z")] });
    await startSession();
    speak("app-a", "call back Friday ");
    fireEvent.click(screen.getByRole("button", { name: "Exit call center" }));

    expect(await screen.findByRole("button", { name: "Start calling" })).toBeInTheDocument();
    expect(notesWrites().map((r) => eqValue(r, "id"))).toEqual(["app-a"]);
    expect(String(serverNotes.get("app-a"))).toContain("call back Friday");
  });

  it("does not offer the closed-records opt-in to a VA", async () => {
    state.auth = { ...(state.auth as Record<string, unknown>), isAdmin: false, isVa: true };
    respond = serverWith({ applications: [] });
    render(
      <MemoryRouter>
        <CallCenter />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("switch", { name: "Include closed records" })).not.toBeInTheDocument();
  });
});
